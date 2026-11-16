import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../src/index.js";

interface Route {
  path: string;
  handler: (req: unknown, res: unknown) => void;
}

interface Wiring {
  emit(event: string, ...args: unknown[]): unknown;
  route(path: string): Route;
  dispose(): void;
}

const KEY_ENV = ["MINIMAX_API_KEY", "MINIMAX_CN_API_KEY"] as const;
const savedEnv = new Map<string, string | undefined>();

/** Drive the real `apply` wiring: llm/stream → agent/error → status/remove/clear routes. */
function boot(context: Record<string, unknown>): Wiring {
  const listeners = new Map<string, (...args: unknown[]) => unknown>();
  const routes = new Map<string, Route>();
  let effectDispose: () => void = () => {};

  const webServer = {
    register(route: Route) {
      routes.set(route.path, route);
      return {};
    },
  };

  const ctx = {
    get(name: string) {
      if (name === "webServer") return webServer;
      return context[name];
    },
    on(event: string, listener: (...args: unknown[]) => unknown) {
      listeners.set(event, listener);
      return () => {
        listeners.delete(event);
      };
    },
    inject(_deps: string[], callback: (ctx: unknown) => unknown) {
      callback({ get: (name: string) => (name === "webServer" ? webServer : undefined) });
      return undefined;
    },
    effect(execute: () => unknown) {
      const returned = execute();
      if (typeof returned === "function") effectDispose = returned as () => void;
      return () => {};
    },
  };

  const pluginDispose = apply(ctx);
  const dispose = () => {
    pluginDispose();
    effectDispose();
  };
  return {
    emit(event, ...args) {
      return listeners.get(event)?.(...args);
    },
    route(path) {
      const route = routes.get(path);
      if (route === undefined) throw new Error(`route ${path} not registered`);
      return route;
    },
    dispose,
  };
}

async function callRoute(
  wiring: Wiring,
  path: string,
  request: { method: string; body?: unknown },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const result = { status: 0, body: {} as Record<string, unknown> };
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const response = {
    statusCode: 0,
    setHeader() {
      // No headers are asserted here.
    },
    end(chunk: string) {
      result.body = JSON.parse(chunk) as Record<string, unknown>;
      resolveDone();
    },
  };

  const req: Record<string, unknown> = { method: request.method };
  if (request.body !== undefined) {
    const text = JSON.stringify(request.body);
    Object.defineProperty(req, Symbol.asyncIterator, {
      value: async function* () {
        yield Buffer.from(text, "utf8");
      },
      enumerable: false,
    });
  }
  wiring.route(path).handler(req, response);
  await done;
  result.status = response.statusCode;
  return result;
}

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dsh-minimax-usage-wiring-"));
  for (const key of KEY_ENV) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(async () => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  await rm(dir, { recursive: true, force: true });
});

describe("rate-limit wiring", () => {
  it("records a MiniMax rate-limit error and exposes it on /status", async () => {
    const wiring = boot({
      dshHomePath: (...segments: string[]) => join(dir, ...segments),
      workspaceRegistry: {
        list: () => [{ title: "我的工作区", path: "/work/my-project", sessionIds: ["session-a"] }],
      },
    });
    try {
      wiring.emit("llm/stream", { provider: "minimax-cn", sessionId: "session-a" }, () => "chunk");
      wiring.emit("agent/error", {
        agent: {
          session: { id: "session-a", header: { origin: "user" } },
          followup: () => {},
        },
        error: { code: "RATE_LIMIT", message: "rate_limit_error" },
      });

      const status = await callRoute(wiring, "/minimax-usage/api/status", { method: "GET" });
      const rateLimits = status.body["rateLimits"] as Array<Record<string, unknown>>;
      expect(rateLimits).toHaveLength(1);
      expect(rateLimits[0]?.["sessionId"]).toBe("session-a");
      expect(rateLimits[0]?.["region"]).toBe("cn");
      expect(rateLimits[0]?.["provider"]).toBe("minimax-cn");
      expect(rateLimits[0]?.["workspace"]).toBe("我的工作区");
      expect(rateLimits[0]?.["sendAt"]).toBeGreaterThan(Date.now());

      // The record reaches disk so a Host restart can still deliver it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const stored = JSON.parse(
        await readFile(join(dir, "data", "dsh-minimax-usage", "rate-limits.json"), "utf8"),
      ) as Array<Record<string, unknown>>;
      expect(stored).toHaveLength(1);
      expect(stored[0]?.["sessionId"]).toBe("session-a");
    } finally {
      wiring.dispose();
    }
  });

  it("records subagent Sessions and inherits the parent Workspace", async () => {
    const wiring = boot({
      dshHomePath: (...segments: string[]) => join(dir, ...segments),
      workspaceRegistry: {
        list: () => [{ id: "ws-1", title: "工作区 X", path: "/work/x", sessionIds: ["session-parent"] }],
      },
    });
    try {
      wiring.emit("llm/stream", { provider: "minimax-cn", sessionId: "sub-1" }, () => "chunk");
      wiring.emit("agent/error", {
        agent: {
          session: { id: "sub-1", header: { origin: "subagent", parentSession: "session-parent" } },
          followup: () => {},
        },
        error: { code: "RATE_LIMIT" },
      });

      const status = await callRoute(wiring, "/minimax-usage/api/status", { method: "GET" });
      const rateLimits = status.body["rateLimits"] as Array<Record<string, unknown>>;
      expect(rateLimits).toHaveLength(1);
      expect(rateLimits[0]?.["sessionId"]).toBe("sub-1");
      expect(rateLimits[0]?.["subagent"]).toBe(true);
      expect(rateLimits[0]?.["workspace"]).toBe("工作区 X");
    } finally {
      wiring.dispose();
    }
  });

  it("ignores non-MiniMax and non-rate-limit errors", async () => {
    const wiring = boot({ dshHomePath: (...segments: string[]) => join(dir, ...segments) });
    try {
      wiring.emit("llm/stream", { provider: "grok", sessionId: "session-b" }, () => "chunk");
      wiring.emit("agent/error", {
        agent: { session: { id: "session-b", header: { origin: "user" } }, followup: () => {} },
        error: { code: "RATE_LIMIT" },
      });
      wiring.emit("llm/stream", { provider: "minimax", sessionId: "session-c" }, () => "chunk");
      wiring.emit("agent/error", {
        agent: { session: { id: "session-c", header: { origin: "user" } }, followup: () => {} },
        error: { code: "SERVER", message: "boom" },
      });

      const status = await callRoute(wiring, "/minimax-usage/api/status", { method: "GET" });
      expect(status.body["rateLimits"]).toEqual([]);
    } finally {
      wiring.dispose();
    }
  });

  it("lists existing Sessions and adds one to the continue queue", async () => {
    const wiring = boot({
      dshHomePath: (...segments: string[]) => join(dir, ...segments),
      sessionController: {
        list: async () => ({
          items: [
            { sessionId: "session-x", origin: "user", projections: { values: { title: "会话 X" } } },
            { sessionId: "sub-session", origin: "subagent", projections: { values: { title: "子代理" } } },
            { sessionId: "session-y", origin: "user", projections: { values: { title: null } } },
          ],
        }),
      },
      workspaceRegistry: {
        list: () => [{ id: "ws-1", title: "工作区 X", path: "/work/x", sessionIds: ["session-x"] }],
      },
    });
    try {
      const candidates = await callRoute(wiring, "/minimax-usage/api/rate-limits/candidates", {
        method: "GET",
      });
      expect(candidates.status).toBe(200);
      expect(candidates.body["items"]).toEqual([
        { sessionId: "session-x", title: "会话 X", workspace: "工作区 X", workspaceId: "ws-1" },
        { sessionId: "session-y" },
      ]);

      const added = await callRoute(wiring, "/minimax-usage/api/rate-limits/add", {
        method: "POST",
        body: { sessionId: "session-x" },
      });
      expect(added.status).toBe(200);
      expect(added.body["added"]).toBe(true);
      const rateLimits = added.body["rateLimits"] as Array<Record<string, unknown>>;
      expect(rateLimits).toHaveLength(1);
      expect(rateLimits[0]?.["sessionId"]).toBe("session-x");
      expect(rateLimits[0]?.["title"]).toBe("会话 X");
      expect(rateLimits[0]?.["workspace"]).toBe("工作区 X");

      // A recorded Session drops out of the picker until it is removed again.
      const after = await callRoute(wiring, "/minimax-usage/api/rate-limits/candidates", {
        method: "GET",
      });
      expect(after.body["items"]).toEqual([{ sessionId: "session-y" }]);

      const missing = await callRoute(wiring, "/minimax-usage/api/rate-limits/add", {
        method: "POST",
        body: { sessionId: "does-not-exist" },
      });
      expect(missing.status).toBe(404);
    } finally {
      wiring.dispose();
    }
  });

  it("removes and clears records through the panel routes", async () => {
    const wiring = boot({ dshHomePath: (...segments: string[]) => join(dir, ...segments) });
    try {
      for (const sessionId of ["session-a", "session-b"]) {
        wiring.emit("llm/stream", { provider: "minimax", sessionId }, () => "chunk");
        wiring.emit("agent/error", {
          agent: { session: { id: sessionId, header: { origin: "user" } }, followup: () => {} },
          error: { code: "RATE_LIMIT" },
        });
      }
      let status = await callRoute(wiring, "/minimax-usage/api/status", { method: "GET" });
      expect(status.body["rateLimits"]).toHaveLength(2);

      const removed = await callRoute(wiring, "/minimax-usage/api/rate-limits/remove", {
        method: "POST",
        body: { sessionId: "session-a" },
      });
      expect(removed.status).toBe(200);
      expect(removed.body["removed"]).toBe(true);
      const remaining = removed.body["rateLimits"] as Array<Record<string, unknown>>;
      expect(remaining.map((item) => item["sessionId"])).toEqual(["session-b"]);

      const cleared = await callRoute(wiring, "/minimax-usage/api/rate-limits/clear", {
        method: "POST",
      });
      expect(cleared.status).toBe(200);
      expect(cleared.body["cleared"]).toBe(1);

      status = await callRoute(wiring, "/minimax-usage/api/status", { method: "GET" });
      expect(status.body["rateLimits"]).toEqual([]);

      const rejected = await callRoute(wiring, "/minimax-usage/api/rate-limits/clear", {
        method: "GET",
      });
      expect(rejected.status).toBe(405);
    } finally {
      wiring.dispose();
    }
  });
});
