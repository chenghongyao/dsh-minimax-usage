/**
 * dsh-minimax-usage — MiniMax Token Plan usage in the DSH Web UI.
 *
 * Cordis host plugin entry. Loaded through the package's cordis.patch.yml
 * bundle layer. Zero runtime dependencies on `@deepseek-ai/*`: DSH services
 * are read through `ctx.get(...)` / `ctx.inject(...)`.
 */
import { CN_KEY_REF, GLOBAL_KEY_REF } from "./types.js";
import { regionOfProvider, RefreshScheduler } from "./refresh.js";
import { UsageService } from "./service.js";
export const name = "dsh-minimax-usage";
export const inject = [];
export function apply(ctx) {
    const context = ctx;
    const service = new UsageService(context);
    const scheduler = new RefreshScheduler({
        snapshot: (force, reason) => {
            service.heartbeatMs = scheduler.heartbeatMs;
            return service.snapshot(force, reason);
        },
    });
    // Resolve the first usable snapshot before any /status request lands so the
    // Web UI never flashes the "unconfigured" error during the brief window in
    // which `dsh-credentials-local` is still loading `.credentials.yaml`.
    // Runs concurrently with the event subscriptions and route registration
    // below; the .catch guarantees the service can never get stuck in "init".
    void service.prewarm().catch(() => {
        service.markReady();
    });
    if (typeof context.on === "function") {
        context.on("llm/stream", (options, next) => {
            const optionsObject = options !== null && typeof options === "object"
                ? options
                : undefined;
            const provider = optionsObject?.provider;
            const sessionId = typeof optionsObject?.sessionId === "string" ? optionsObject.sessionId : undefined;
            const region = regionOfProvider(provider);
            const auxiliary = optionsObject?.purpose === "compaction" || optionsObject?.purpose === "session-title";
            if (auxiliary) {
                if (region !== undefined)
                    scheduler.markDirty(region);
            }
            else {
                scheduler.observeProvider(region, sessionId);
            }
            const nxt = next;
            return nxt();
        });
        context.on("agent/status", (payload) => {
            const payloadObject = payload !== null && typeof payload === "object"
                ? payload
                : undefined;
            const status = payloadObject?.status;
            const agentId = typeof payloadObject?.agent?.id === "string" ? payloadObject.agent.id : undefined;
            if (status === "running")
                scheduler.onRunning(agentId);
            else if (status === "idle")
                scheduler.onIdle(agentId);
        });
        context.on("credentials/reference-updated", (ref) => {
            if (ref !== GLOBAL_KEY_REF && ref !== CN_KEY_REF)
                return;
            void scheduler.refreshNow("credential");
        });
    }
    if (typeof context.inject === "function") {
        context.inject(["webServer"], (httpCtx) => {
            const webServer = httpCtx.get("webServer");
            if (!webServer) {
                console.warn("[dsh-minimax-usage] webServer unavailable; Web UI disabled");
                return;
            }
            webServer.register({
                kind: "exact",
                path: "/minimax-usage/api/status",
                handler: (req, res) => {
                    void handleStatus(req, res, service, scheduler, false);
                },
            });
            webServer.register({
                kind: "exact",
                path: "/minimax-usage/api/refresh",
                handler: (req, res) => {
                    void handleStatus(req, res, service, scheduler, true);
                },
            });
            console.log("[dsh-minimax-usage] floating usage bubble available on the Web UI");
        });
    }
    else {
        console.warn("[dsh-minimax-usage] ctx.inject unavailable; Web UI disabled");
    }
    return () => {
        scheduler.dispose();
        service.dispose();
    };
}
async function handleStatus(req, res, service, scheduler, force) {
    const method = String(req.method ?? "GET").toUpperCase();
    if (force && method !== "POST" && method !== "GET") {
        sendJson(res, 405, { error: "method not allowed" });
        return;
    }
    try {
        if (force)
            await scheduler.refreshNow("manual");
        service.heartbeatMs = scheduler.heartbeatMs;
        const snapshot = await service.snapshot(false, force ? "manual" : "startup");
        sendJson(res, 200, snapshot);
    }
    catch (err) {
        sendJson(res, 500, {
            fetchedAt: null,
            error: err instanceof Error ? err.message : String(err),
            accounts: [],
        });
    }
}
function sendJson(res, status, body) {
    const response = res;
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify(body));
}
//# sourceMappingURL=index.js.map