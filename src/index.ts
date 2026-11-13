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
import { CN_KEY_REF, GLOBAL_KEY_REF, type RateLimitSessionView, type UsageSnapshot } from "./types.js";
import { regionOfProvider, RefreshScheduler } from "./refresh.js";
import { isRateLimitError, providerForRegion, RateLimitWatcher } from "./rate-limits.js";
import { UsageService } from "./service.js";

export const name = "dsh-minimax-usage";
export const inject: string[] = [];

/** Text sent to a Session once its 5h MiniMax quota window has reset. */
const CONTINUE_TEXT = "继续";
const STORE_DIR = "dsh-minimax-usage";
const STORE_FILE = "rate-limits.json";

interface PluginContext {
  get<T = unknown>(name: string): T | undefined;
  on?(event: string, listener: (...args: unknown[]) => unknown): () => void;
  effect?(execute: () => unknown): unknown;
  inject?: (deps: string[], callback: (ctx: unknown) => unknown) => unknown;
}

interface AgentLike {
  session?: SessionLike;
  followup?(message: unknown): void;
}

interface SessionLike {
  id?: string;
  header?: { origin?: string };
}

interface SessionControllerLike {
  resolveAgent?(sessionId: string): Promise<{ agent?: AgentLike; error?: { message?: string } } | undefined>;
}

interface SessionsLike {
  get?(sessionId: string): SessionLike | undefined;
  flush?(session: unknown): Promise<boolean>;
}

interface SessionTitleLike {
  get?(session: SessionLike): { title?: string } | undefined;
}

/**
 * This MUST stay an arrow function. Cordis decides with `isConstructor(cb)` — true for
 * anything carrying a `prototype`, i.e. a plain `function` declaration or a class — and
 * then loads the plugin through its class branch (`new cb(ctx, config)`), where the
 * disposer returned below is dropped. Losing that disposer left the scheduler's heartbeat
 * timer armed forever, so the host process could never exit and desktop updates failed
 * with "Host did not complete graceful task teardown". An arrow function keeps the callback
 * non-constructible, so cordis takes the function branch and collects the disposer.
 */
export const apply = (ctx: unknown): (() => void) => {
  const context = ctx as PluginContext;
  const service = new UsageService(context);
  const scheduler = new RefreshScheduler({
    snapshot: (force, reason) => {
      service.heartbeatMs = scheduler.heartbeatMs;
      return service.snapshot(force, reason);
    },
  });

  const titleOf = (session: SessionLike | undefined): string | undefined => {
    if (session === undefined) return undefined;
    try {
      const titles = context.get<SessionTitleLike>("sessionTitle");
      const title = titles?.get?.(session)?.title;
      return typeof title === "string" && title !== "" ? title : undefined;
    } catch {
      return undefined;
    }
  };

  const deliverContinue = async (record: RateLimitSessionView): Promise<void> => {
    const agents = context.get<{ get?(id: string): AgentLike | undefined }>("agents");
    let agent = agents?.get?.(record.sessionId);
    if (agent === undefined) {
      const controller = context.get<SessionControllerLike>("sessionController");
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
    if (agent === undefined) throw new Error(`session ${record.sessionId} has no live agent`);
    if (typeof agent.followup !== "function") {
      throw new Error(`session ${record.sessionId} cannot accept a follow-up message`);
    }
    agent.followup(continueMessage());
    const sessions = context.get<SessionsLike>("sessions");
    const session = agent.session;
    if (sessions?.flush !== undefined && session !== undefined) {
      try {
        const acknowledged = await sessions.flush(session);
        if (acknowledged === false) {
          console.warn("[dsh-minimax-usage] session persistence did not acknowledge 继续 delivery");
        }
      } catch (error) {
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
      const sessions = context.get<SessionsLike>("sessions");
      return titleOf(sessions?.get?.(sessionId));
    },
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
      const optionsObject =
        options !== null && typeof options === "object"
          ? (options as { provider?: unknown; sessionId?: unknown; purpose?: unknown })
          : undefined;
      const provider = optionsObject?.provider;
      const sessionId =
        typeof optionsObject?.sessionId === "string" ? optionsObject.sessionId : undefined;
      const region = regionOfProvider(provider);
      watcher.observeProvider(sessionId, region, typeof provider === "string" ? provider : undefined);
      const auxiliary =
        optionsObject?.purpose === "compaction" || optionsObject?.purpose === "session-title";
      if (auxiliary) {
        if (region !== undefined) scheduler.markDirty(region);
      } else {
        scheduler.observeProvider(region, sessionId);
      }
      const nxt = next as () => unknown;
      return nxt();
    });
    context.on("agent/status", (payload) => {
      const payloadObject =
        payload !== null && typeof payload === "object"
          ? (payload as { status?: unknown; agent?: { id?: unknown } })
          : undefined;
      const status = payloadObject?.status;
      const agentId = typeof payloadObject?.agent?.id === "string" ? payloadObject.agent.id : undefined;
      if (status === "running") scheduler.onRunning(agentId);
      else if (status === "idle") scheduler.onIdle(agentId);
    });
    context.on("agent/error", (payload) => {
      try {
        const payloadObject =
          payload !== null && typeof payload === "object"
            ? (payload as { agent?: AgentLike; error?: unknown })
            : undefined;
        if (!isRateLimitError(payloadObject?.error)) return;
        const agent = payloadObject?.agent;
        const session = agent?.session;
        const sessionId = session?.id;
        if (typeof sessionId !== "string" || sessionId === "") return;
        // Subagent Sessions are driven by their parent; do not inject work there.
        if (session?.header?.origin === "subagent") return;
        const observed = watcher.providerOf(sessionId);
        if (observed?.region === undefined) return;
        const title = titleOf(session);
        watcher.record({
          sessionId,
          region: observed.region,
          provider: observed.provider ?? providerForRegion(observed.region),
          ...(title === undefined ? {} : { title }),
        });
      } catch (error) {
        console.warn(`[dsh-minimax-usage] failed to record a rate-limit session: ${String(error)}`);
      }
    });
    context.on("credentials/reference-updated", (ref) => {
      if (ref !== GLOBAL_KEY_REF && ref !== CN_KEY_REF) return;
      void scheduler.refreshNow("credential");
    });
  }

  if (typeof context.inject === "function") {
    context.inject(["webServer"], (httpCtx) => {
      const webServer = (httpCtx as {
        get<T = unknown>(name: string): T | undefined;
      }).get<{
        register(route: {
          kind: "exact" | "prefix";
          path: string;
          handler: (req: unknown, res: unknown) => void;
        }): unknown;
      }>("webServer");
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
      console.log("[dsh-minimax-usage] inline usage indicator available on the Web UI");
    });
  } else {
    console.warn("[dsh-minimax-usage] ctx.inject unavailable; Web UI disabled");
  }

  const dispose = (): void => {
    watcher.dispose();
    scheduler.dispose();
    service.dispose();
  };

  // Register the cleanup through cordis' effect scope as well, so it still runs when a
  // host loads this plugin through the class-plugin branch (which ignores the return
  // value). Both paths are idempotent.
  if (typeof context.effect === "function") context.effect(() => dispose);

  return dispose;
};

/** One frozen user message carrying the continue prompt. */
function continueMessage(): unknown {
  return deepFreeze({
    id: randomUUID(),
    role: "user",
    content: [{ type: "text", text: CONTINUE_TEXT }],
    source: { kind: "user" },
  });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

async function handleStatus(
  req: unknown,
  res: unknown,
  service: UsageService,
  scheduler: RefreshScheduler,
  watcher: RateLimitWatcher,
  force: boolean,
): Promise<void> {
  const method = String((req as { method?: string }).method ?? "GET").toUpperCase();
  if (force && method !== "POST" && method !== "GET") {
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }
  try {
    if (force) await scheduler.refreshNow("manual");
    service.heartbeatMs = scheduler.heartbeatMs;
    const snapshot: UsageSnapshot = await service.snapshot(false, force ? "manual" : "startup");
    sendJson(res, 200, { ...snapshot, rateLimits: watcher.list() });
  } catch (err) {
    sendJson(res, 500, {
      fetchedAt: null,
      error: err instanceof Error ? err.message : String(err),
      accounts: [],
      rateLimits: watcher.list(),
    } satisfies UsageSnapshot);
  }
}

async function handleRateLimitRemove(
  req: unknown,
  res: unknown,
  watcher: RateLimitWatcher,
): Promise<void> {
  if (!requirePost(req, res)) return;
  try {
    const body = await readJsonBody(req);
    const sessionId = body["sessionId"];
    if (typeof sessionId !== "string" || sessionId === "") {
      sendJson(res, 400, { error: "sessionId is required" });
      return;
    }
    const removed = watcher.remove(sessionId);
    sendJson(res, 200, { removed, rateLimits: watcher.list() });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleRateLimitClear(
  req: unknown,
  res: unknown,
  watcher: RateLimitWatcher,
): Promise<void> {
  if (!requirePost(req, res)) return;
  try {
    const cleared = watcher.clear();
    sendJson(res, 200, { cleared, rateLimits: watcher.list() });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

function requirePost(req: unknown, res: unknown): boolean {
  const method = String((req as { method?: string }).method ?? "GET").toUpperCase();
  if (method === "POST") return true;
  sendJson(res, 405, { error: "method not allowed" });
  return false;
}

async function readJsonBody(req: unknown): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    total += buffer.length;
    if (total > 8192) throw new Error("request body too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text === "") return {};
  const parsed = JSON.parse(text) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

/** Data file under the DSH home; falls back to the default home when the service is absent. */
function rateLimitStorePath(context: PluginContext): string {
  const homePath = context.get<(...segments: string[]) => string>("dshHomePath");
  if (typeof homePath === "function") {
    try {
      return homePath("data", STORE_DIR, STORE_FILE);
    } catch {
      // Fall through to the default home.
    }
  }
  return join(homedir(), ".dsh", "data", STORE_DIR, STORE_FILE);
}

async function loadRateLimits(file: string): Promise<RateLimitSessionView[]> {
  try {
    const text = await readFile(file, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RateLimitSessionView => item !== null && typeof item === "object",
    );
  } catch {
    // Missing file (first run) and unreadable JSON both start empty.
    return [];
  }
}

async function saveRateLimits(
  file: string,
  records: readonly RateLimitSessionView[],
): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn(`[dsh-minimax-usage] failed to persist rate-limit records: ${String(error)}`);
  }
}

interface HttpResponse {
  statusCode?: number;
  setHeader(name: string, value: string): void;
  end(chunk: string): void;
}

function sendJson(res: unknown, status: number, body: unknown): void {
  const response = res as HttpResponse;
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}
