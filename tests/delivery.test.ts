import { describe, expect, it, vi } from "vitest";
import { createContinueDelivery } from "../src/delivery.js";
import type { RateLimitSessionView } from "../src/types.js";

function record(overrides: Partial<RateLimitSessionView> = {}): RateLimitSessionView {
  return {
    sessionId: "session-a",
    provider: "minimax-cn",
    region: "cn",
    errorAt: 0,
    sendAt: 1,
    ...overrides,
  };
}

function contextWith(services: Record<string, unknown>): { get<T = unknown>(name: string): T | undefined } {
  return {
    get<T = unknown>(name: string): T | undefined {
      return services[name] as T | undefined;
    },
  };
}

describe("createContinueDelivery", () => {
  it("follows up on the live top-level Agent and flushes the Session", async () => {
    const followup = vi.fn();
    const flush = vi.fn(async () => true);
    const deliver = createContinueDelivery(
      contextWith({
        agents: {
          get: (id: string) =>
            id === "session-a" ? { session: { id: "session-a" }, followup } : undefined,
        },
        sessions: { flush },
      }),
    );

    await deliver(record());

    expect(followup).toHaveBeenCalledTimes(1);
    const message = followup.mock.calls[0]?.[0] as {
      role: string;
      content: Array<{ type: string; text: string }>;
      source: { kind: string };
    };
    expect(message.role).toBe("user");
    expect(message.content).toEqual([{ type: "text", text: "继续" }]);
    expect(message.source).toEqual({ kind: "user" });
    expect(Object.isFrozen(message)).toBe(true);
    expect(flush).toHaveBeenCalledWith({ id: "session-a" });
  });

  it("resumes a top-level Session through the Session controller", async () => {
    const followup = vi.fn();
    const resolveAgent = vi.fn(async () => ({
      agent: { session: { id: "session-a" }, followup },
    }));
    const deliver = createContinueDelivery(
      contextWith({
        agents: { get: () => undefined },
        sessionController: { resolveAgent },
        sessions: { flush: async () => true },
      }),
    );

    await deliver(record());

    expect(resolveAgent).toHaveBeenCalledWith("session-a");
    expect(followup).toHaveBeenCalledTimes(1);
  });

  it("delivers to a subagent through the subagents service", async () => {
    const deliverPrompt = vi.fn(async () => "message-1");
    const agentsGet = vi.fn();
    const deliver = createContinueDelivery(
      contextWith({
        subagents: { deliverPrompt },
        agents: { get: agentsGet },
      }),
    );

    await deliver(record({ subagent: true }));

    expect(deliverPrompt).toHaveBeenCalledTimes(1);
    const [childId, content, options] = deliverPrompt.mock.calls[0] as unknown as [
      string,
      Array<{ type: string; text: string }>,
      { source: unknown; delivery: string; signal: AbortSignal },
    ];
    expect(childId).toBe("session-a");
    expect(content).toEqual([{ type: "text", text: "继续" }]);
    expect(options.source).toEqual({ kind: "user" });
    expect(options.delivery).toBe("followup");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    // The subagent path returns before the generic live-Agent lookup.
    expect(agentsGet).not.toHaveBeenCalled();
  });

  it("falls back to a live Agent when no subagent runtime is mounted", async () => {
    const followup = vi.fn();
    const deliver = createContinueDelivery(
      contextWith({
        agents: {
          get: () => ({ session: { id: "session-a" }, followup }),
        },
      }),
    );

    await deliver(record({ subagent: true }));

    expect(followup).toHaveBeenCalledTimes(1);
  });

  it("reports missing delivery services", async () => {
    const deliver = createContinueDelivery(contextWith({ agents: { get: () => undefined } }));
    await expect(deliver(record())).rejects.toThrow(/sessionController/);
  });

  it("propagates a Session-controller error", async () => {
    const deliver = createContinueDelivery(
      contextWith({
        agents: { get: () => undefined },
        sessionController: {
          resolveAgent: async () => ({ error: { message: "session is unavailable" } }),
        },
      }),
    );
    await expect(deliver(record())).rejects.toThrow(/session is unavailable/);
  });
});
