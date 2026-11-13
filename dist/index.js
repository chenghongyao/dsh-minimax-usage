/**
 * dsh-minimax-usage — MiniMax Token Plan usage in the DSH Web UI.
 *
 * Cordis host plugin entry. Loaded through the package's cordis.patch.yml
 * bundle layer. Zero runtime dependencies on `@deepseek-ai/*`: DSH services
 * are read through `ctx.get(...)` / `ctx.inject(...)`.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CN_KEY_REF, GLOBAL_KEY_REF } from "./types.js";
import { regionOfProvider, RefreshScheduler } from "./refresh.js";
import { isRateLimitError, providerForRegion, RateLimitWatcher } from "./rate-limits.js";
import { UsageService } from "./service.js";
export const name = "dsh-minimax-usage";
export const inject = [];
/** Text sent to a Session once its 5h MiniMax quota window has reset. */
const CONTINUE_TEXT = "继续";
const STORE_DIR = "dsh-minimax-usage";
const STORE_FILE = "rate-limits.json";
/**
 * This MUST stay an arrow function. Cordis decides with `isConstructor(cb)` — true for
 * anything carrying a `prototype`, i.e. a plain `function` declaration or a class — and
 * then loads the plugin through its class branch (`new cb(ctx, config)`), where the
 * disposer returned below is dropped. Losing that disposer left the scheduler's heartbeat
 * timer armed forever, so the host process could never exit and desktop updates failed
 * with "Host did not complete graceful task teardown". An arrow function keeps the callback
 * non-constructible, so cordis takes the function branch and collects the disposer.
 */
export const apply = (ctx) => {
    const context = ctx;
    const service = new UsageService(context);
    const scheduler = new RefreshScheduler({
        snapshot: (force, reason) => {
            service.heartbeatMs = scheduler.heartbeatMs;
            return service.snapshot(force, reason);
        },
    });
    const titleOf = (session) => {
        if (session === undefined)
            return undefined;
        try {
            const titles = context.get("sessionTitle");
            const title = titles?.get?.(session)?.title;
            return typeof title === "string" && title !== "" ? title : undefined;
        }
        catch {
            return undefined;
        }
    };
    const workspaceOf = (sessionId) => {
        try {
            const registry = context.get("workspaceRegistry");
            const workspaces = registry?.list?.();
            if (!Array.isArray(workspaces))
                return undefined;
            for (const workspace of workspaces) {
                const sessionIds = workspace?.sessionIds;
                if (!Array.isArray(sessionIds) || !sessionIds.includes(sessionId))
                    continue;
                if (typeof workspace.title === "string" && workspace.title !== "")
                    return workspace.title;
                if (typeof workspace.path !== "string" || workspace.path === "")
                    return undefined;
                const segments = workspace.path.split(/[\\/]/).filter((segment) => segment !== "");
                const last = segments.at(-1);
                return last !== undefined ? last : workspace.path;
            }
        }
        catch {
            // Workspace registry unavailable or not initialized yet.
        }
        return undefined;
    };
    const candidateOf = (sessionId, title) => {
        const workspace = workspaceOf(sessionId);
        return {
            sessionId,
            ...(title === undefined ? {} : { title }),
            ...(workspace === undefined ? {} : { workspace }),
        };
    };
    /** Sessions offered by the picker: every visible top-level Session, newest activity first. */
    const listSessionCandidates = async (exclude) => {
        const candidates = [];
        const seen = new Set();
        const push = (sessionId, title) => {
            if (sessionId === "" || exclude.has(sessionId) || seen.has(sessionId))
                return;
            seen.add(sessionId);
            candidates.push(candidateOf(sessionId, title));
        };
        const controller = context.get("sessionController");
        if (controller?.list !== undefined) {
            try {
                const result = await controller.list({}, undefined);
                for (const item of result?.items ?? []) {
                    const sessionId = typeof item?.sessionId === "string" ? item.sessionId : undefined;
                    if (sessionId === undefined || item?.origin === "subagent")
                        continue;
                    const title = item?.projections?.values?.["title"];
                    push(sessionId, typeof title === "string" && title !== "" ? title : undefined);
                }
            }
            catch {
                // Fall through to the live-Session view below.
            }
        }
        if (candidates.length === 0) {
            const agents = context.get("agents");
            for (const agent of agents?.roots?.() ?? []) {
                const session = agent?.session;
                const sessionId = session?.id;
                if (typeof sessionId === "string" && session?.header?.origin !== "subagent") {
                    push(sessionId, titleOf(session));
                }
            }
            for (const session of context.get("sessions")?.list?.() ?? []) {
                const sessionId = session?.id;
                if (typeof sessionId === "string" && session?.header?.origin !== "subagent") {
                    push(sessionId, titleOf(session));
                }
            }
        }
        return candidates.slice(0, 50);
    };
    const findSessionCandidate = async (sessionId) => {
        const candidates = await listSessionCandidates(new Set());
        const match = candidates.find((candidate) => candidate.sessionId === sessionId);
        if (match !== undefined)
            return match;
        const live = context.get("sessions")?.get?.(sessionId);
        return live === undefined ? undefined : candidateOf(sessionId, titleOf(live));
    };
    const deliverContinue = async (record) => {
        const agents = context.get("agents");
        let agent = agents?.get?.(record.sessionId);
        if (agent === undefined) {
            const controller = context.get("sessionController");
            if (controller?.resolveAgent === undefined) {
                throw new Error("sessionController service is unavailable");
            }
            // `resolveAgent` resumes a Session that is not live after a Host restart.
            const resolved = await controller.resolveAgent(record.sessionId);
            if (resolved?.error !== undefined) {
                throw new Error(resolved.error.message ?? "session is unavailable");
            }
            agent = resolved?.agent;
        }
        if (agent === undefined)
            throw new Error(`session ${record.sessionId} has no live agent`);
        if (typeof agent.followup !== "function") {
            throw new Error(`session ${record.sessionId} cannot accept a follow-up message`);
        }
        agent.followup(continueMessage());
        const sessions = context.get("sessions");
        const session = agent.session;
        if (sessions?.flush !== undefined && session !== undefined) {
            try {
                const acknowledged = await sessions.flush(session);
                if (acknowledged === false) {
                    console.warn("[dsh-minimax-usage] session persistence did not acknowledge 继续 delivery");
                }
            }
            catch (error) {
                console.warn(`[dsh-minimax-usage] failed to flush 继续 delivery: ${String(error)}`);
            }
        }
    };
    const storeFile = rateLimitStorePath(context);
    const watcher = new RateLimitWatcher({
        deliver: deliverContinue,
        persist: (records) => {
            void saveRateLimits(storeFile, records);
        },
        resolveResetAt: () => service.nextResetAt(),
        titleFor: (sessionId) => {
            const sessions = context.get("sessions");
            return titleOf(sessions?.get?.(sessionId));
        },
        workspaceFor: (sessionId) => workspaceOf(sessionId),
    });
    void loadRateLimits(storeFile)
        .then((records) => watcher.hydrate(records))
        .catch((error) => {
        console.warn(`[dsh-minimax-usage] failed to load rate-limit records: ${String(error)}`);
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
            watcher.observeProvider(sessionId, region, typeof provider === "string" ? provider : undefined);
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
        context.on("agent/error", (payload) => {
            try {
                const payloadObject = payload !== null && typeof payload === "object"
                    ? payload
                    : undefined;
                if (!isRateLimitError(payloadObject?.error))
                    return;
                const agent = payloadObject?.agent;
                const session = agent?.session;
                const sessionId = session?.id;
                if (typeof sessionId !== "string" || sessionId === "")
                    return;
                // Subagent Sessions are driven by their parent; do not inject work there.
                if (session?.header?.origin === "subagent")
                    return;
                const observed = watcher.providerOf(sessionId);
                if (observed?.region === undefined)
                    return;
                const title = titleOf(session);
                const workspace = workspaceOf(sessionId);
                watcher.record({
                    sessionId,
                    region: observed.region,
                    provider: observed.provider ?? providerForRegion(observed.region),
                    ...(title === undefined ? {} : { title }),
                    ...(workspace === undefined ? {} : { workspace }),
                });
            }
            catch (error) {
                console.warn(`[dsh-minimax-usage] failed to record a rate-limit session: ${String(error)}`);
            }
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
                    void handleStatus(req, res, service, scheduler, watcher, false);
                },
            });
            webServer.register({
                kind: "exact",
                path: "/minimax-usage/api/refresh",
                handler: (req, res) => {
                    void handleStatus(req, res, service, scheduler, watcher, true);
                },
            });
            webServer.register({
                kind: "exact",
                path: "/minimax-usage/api/rate-limits/remove",
                handler: (req, res) => {
                    void handleRateLimitRemove(req, res, watcher);
                },
            });
            webServer.register({
                kind: "exact",
                path: "/minimax-usage/api/rate-limits/clear",
                handler: (req, res) => {
                    void handleRateLimitClear(req, res, watcher);
                },
            });
            webServer.register({
                kind: "exact",
                path: "/minimax-usage/api/rate-limits/candidates",
                handler: (req, res) => {
                    void handleRateLimitCandidates(req, res, () => {
                        const recorded = new Set(watcher.list().map((item) => item.sessionId));
                        return listSessionCandidates(recorded);
                    });
                },
            });
            webServer.register({
                kind: "exact",
                path: "/minimax-usage/api/rate-limits/add",
                handler: (req, res) => {
                    void handleRateLimitAdd(req, res, watcher, findSessionCandidate, () => {
                        return service.preferredRegion() ?? "cn";
                    });
                },
            });
            console.log("[dsh-minimax-usage] inline usage indicator available on the Web UI");
        });
    }
    else {
        console.warn("[dsh-minimax-usage] ctx.inject unavailable; Web UI disabled");
    }
    const dispose = () => {
        watcher.dispose();
        scheduler.dispose();
        service.dispose();
    };
    // Register the cleanup through cordis' effect scope as well, so it still runs when a
    // host loads this plugin through the class-plugin branch (which ignores the return
    // value). Both paths are idempotent.
    if (typeof context.effect === "function")
        context.effect(() => dispose);
    return dispose;
};
/** One frozen user message carrying the continue prompt. */
function continueMessage() {
    return deepFreeze({
        id: randomUUID(),
        role: "user",
        content: [{ type: "text", text: CONTINUE_TEXT }],
        source: { kind: "user" },
    });
}
function deepFreeze(value) {
    if (value === null || typeof value !== "object")
        return value;
    for (const child of Object.values(value))
        deepFreeze(child);
    return Object.freeze(value);
}
async function handleStatus(req, res, service, scheduler, watcher, force) {
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
        sendJson(res, 200, { ...snapshot, rateLimits: watcher.list() });
    }
    catch (err) {
        sendJson(res, 500, {
            fetchedAt: null,
            error: err instanceof Error ? err.message : String(err),
            accounts: [],
            rateLimits: watcher.list(),
        });
    }
}
async function handleRateLimitRemove(req, res, watcher) {
    if (!requirePost(req, res))
        return;
    try {
        const body = await readJsonBody(req);
        const sessionId = body["sessionId"];
        if (typeof sessionId !== "string" || sessionId === "") {
            sendJson(res, 400, { error: "sessionId is required" });
            return;
        }
        const removed = watcher.remove(sessionId);
        sendJson(res, 200, { removed, rateLimits: watcher.list() });
    }
    catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
}
async function handleRateLimitClear(req, res, watcher) {
    if (!requirePost(req, res))
        return;
    try {
        const cleared = watcher.clear();
        sendJson(res, 200, { cleared, rateLimits: watcher.list() });
    }
    catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
}
function requirePost(req, res) {
    return requireMethod(req, res, "POST");
}
function requireMethod(req, res, expected) {
    const method = String(req.method ?? "GET").toUpperCase();
    if (method === expected)
        return true;
    sendJson(res, 405, { error: "method not allowed" });
    return false;
}
async function handleRateLimitCandidates(req, res, list) {
    if (!requireMethod(req, res, "GET"))
        return;
    try {
        sendJson(res, 200, { items: await list() });
    }
    catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
}
async function handleRateLimitAdd(req, res, watcher, find, region) {
    if (!requirePost(req, res))
        return;
    try {
        const body = await readJsonBody(req);
        const sessionId = body["sessionId"];
        if (typeof sessionId !== "string" || sessionId === "") {
            sendJson(res, 400, { error: "sessionId is required" });
            return;
        }
        const candidate = await find(sessionId);
        if (candidate === undefined) {
            sendJson(res, 404, { error: "session not found" });
            return;
        }
        const resolvedRegion = region() === "global" ? "global" : "cn";
        watcher.record({
            sessionId,
            region: resolvedRegion,
            provider: providerForRegion(resolvedRegion),
            ...(candidate.title === undefined ? {} : { title: candidate.title }),
            ...(candidate.workspace === undefined ? {} : { workspace: candidate.workspace }),
        });
        sendJson(res, 200, { added: true, rateLimits: watcher.list() });
    }
    catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
}
async function readJsonBody(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
        total += buffer.length;
        if (total > 8192)
            throw new Error("request body too large");
        chunks.push(buffer);
    }
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (text === "")
        return {};
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
        return {};
    return parsed;
}
/** Data file under the DSH home; falls back to the default home when the service is absent. */
function rateLimitStorePath(context) {
    const homePath = context.get("dshHomePath");
    if (typeof homePath === "function") {
        try {
            return homePath("data", STORE_DIR, STORE_FILE);
        }
        catch {
            // Fall through to the default home.
        }
    }
    return join(homedir(), ".dsh", "data", STORE_DIR, STORE_FILE);
}
async function loadRateLimits(file) {
    try {
        const text = await readFile(file, "utf8");
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter((item) => item !== null && typeof item === "object");
    }
    catch {
        // Missing file (first run) and unreadable JSON both start empty.
        return [];
    }
}
async function saveRateLimits(file, records) {
    try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    }
    catch (error) {
        console.warn(`[dsh-minimax-usage] failed to persist rate-limit records: ${String(error)}`);
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