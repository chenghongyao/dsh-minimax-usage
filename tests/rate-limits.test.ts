import { describe, expect, it } from "vitest";
import {
  CONTINUE_DELAY_MS,
  DELIVERY_RETRY_MS,
  FIVE_HOURS_MS,
  HYDRATE_SEND_DELAY_MS,
  MAX_DELIVERY_ATTEMPTS,
  isPermanentDeliveryError,
  isRateLimitError,
  RateLimitWatcher,
  providerForRegion,
} from "../src/rate-limits.js";
import { type Clock } from "../src/refresh.js";
import type { RateLimitSessionView } from "../src/types.js";

class FakeClock implements Clock {
  nowMs = 0;
  private readonly timers: Array<{ at: number; cb: () => void; cancelled: boolean }> = [];

  now(): number {
    return this.nowMs;
  }

  timeout(callback: () => void, delay: number): () => void {
    const timer = { at: this.nowMs + delay, cb: callback, cancelled: false };
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  }

  get live(): number {
    return this.timers.filter((timer) => !timer.cancelled).length;
  }

  async advance(ms: number): Promise<void> {
    const target = this.nowMs + ms;
    while (true) {
      const due = this.timers
        .filter((timer) => !timer.cancelled && timer.at <= target)
        .sort((a, b) => a.at - b.at);
      if (due.length === 0) {
        this.nowMs = target;
        return;
      }
      const next = due[0]!;
      this.nowMs = Math.max(this.nowMs, next.at);
      next.cancelled = true;
      next.cb();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
  }
}

interface Harness {
  clock: FakeClock;
  delivered: string[];
  persisted: RateLimitSessionView[][];
  watcher: RateLimitWatcher;
}

function harness(options: {
  resetAt?: number;
  deliver?: (record: RateLimitSessionView) => Promise<void>;
  titleFor?: (sessionId: string) => string | undefined;
  workspaceFor?: (sessionId: string) => string | undefined;
  clock?: FakeClock;
} = {}): Harness {
  const clock = options.clock ?? new FakeClock();
  const delivered: string[] = [];
  const persisted: RateLimitSessionView[][] = [];
  const watcher = new RateLimitWatcher({
    clock,
    deliver:
      options.deliver ??
      (async (record) => {
        delivered.push(record.sessionId);
      }),
    persist: (records) => {
      persisted.push(records);
    },
    resolveResetAt: () => options.resetAt,
    ...(options.titleFor === undefined ? {} : { titleFor: options.titleFor }),
    ...(options.workspaceFor === undefined ? {} : { workspaceFor: options.workspaceFor }),
    warn: () => {},
  });
  return { clock, delivered, persisted, watcher };
}

function record(h: Harness, sessionId = "session-a", region: "cn" | "global" = "cn"): void {
  h.watcher.record({ sessionId, region, provider: providerForRegion(region) });
}

describe("isRateLimitError", () => {
  it("accepts the provider-neutral RATE_LIMIT code", () => {
    expect(isRateLimitError({ code: "RATE_LIMIT" })).toBe(true);
    expect(isRateLimitError(Object.assign(new Error("limited"), { code: "RATE_LIMIT" }))).toBe(true);
  });

  it("accepts a serialized failure code and HTTP 429", () => {
    expect(isRateLimitError({ failure: { code: "RATE_LIMIT" } })).toBe(true);
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ failure: { status: 429 } })).toBe(true);
  });

  it("accepts a rate_limit_error message", () => {
    expect(isRateLimitError(new Error("provider error type rate_limit_error"))).toBe(true);
    expect(isRateLimitError(new Error("429 Too Many Requests"))).toBe(true);
  });

  it("rejects unrelated failures", () => {
    expect(isRateLimitError(new Error("ECONNRESET"))).toBe(false);
    expect(isRateLimitError({ code: "QUOTA" })).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
    expect(isRateLimitError("rate limit")).toBe(false);
  });
});

describe("RateLimitWatcher", () => {
  it("schedules the continue message at the 5h reset plus the reset grace", async () => {
    const resetAt = 2 * 60 * 60 * 1000;
    const h = harness({ resetAt });
    record(h);

    expect(h.watcher.list()).toHaveLength(1);
    expect(h.watcher.list()[0]?.sendAt).toBe(resetAt + CONTINUE_DELAY_MS);
    expect(h.clock.live).toBe(1);
    expect(h.persisted.at(-1)).toHaveLength(1);

    await h.clock.advance(resetAt + CONTINUE_DELAY_MS - 1);
    expect(h.delivered).toEqual([]);
    await h.clock.advance(1);
    expect(h.delivered).toEqual(["session-a"]);
    expect(h.watcher.list()).toEqual([]);
    expect(h.persisted.at(-1)).toEqual([]);
  });

  it("falls back to a full 5h window when no reset time is known", async () => {
    const h = harness();
    record(h);
    expect(h.watcher.list()[0]?.sendAt).toBe(FIVE_HOURS_MS + CONTINUE_DELAY_MS);

    await h.clock.advance(FIVE_HOURS_MS + CONTINUE_DELAY_MS);
    expect(h.delivered).toEqual(["session-a"]);
  });

  it("refreshes the deadline instead of duplicating a Session", async () => {
    const h = harness({ resetAt: 60 * 60 * 1000 });
    record(h);
    const first = h.watcher.list()[0]!;
    h.clock.nowMs = 1000;
    record(h);

    expect(h.watcher.list()).toHaveLength(1);
    expect(h.watcher.list()[0]?.errorAt).toBe(1000);
    expect(h.watcher.list()[0]?.sendAt).toBe(60 * 60 * 1000 + CONTINUE_DELAY_MS);
    expect(h.clock.live).toBe(1);
    expect(first.sendAt).toBe(h.watcher.list()[0]?.sendAt);
  });

  it("never sends after a Session record is removed", async () => {
    const resetAt = 60 * 60 * 1000;
    const h = harness({ resetAt });
    record(h);
    record(h, "session-b", "global");
    expect(h.watcher.list()).toHaveLength(2);

    expect(h.watcher.remove("session-a")).toBe(true);
    expect(h.watcher.remove("session-a")).toBe(false);
    await h.clock.advance(resetAt + CONTINUE_DELAY_MS + 1);

    expect(h.delivered).toEqual(["session-b"]);
    expect(h.watcher.list()).toEqual([]);
  });

  it("clears every record and cancels every timer", async () => {
    const resetAt = 60 * 60 * 1000;
    const h = harness({ resetAt });
    record(h);
    record(h, "session-b", "global");
    record(h, "session-c", "cn");

    expect(h.watcher.clear()).toBe(3);
    expect(h.watcher.clear()).toBe(0);
    expect(h.clock.live).toBe(0);
    await h.clock.advance(resetAt + CONTINUE_DELAY_MS + 1);
    expect(h.delivered).toEqual([]);
    expect(h.persisted.at(-1)).toEqual([]);
  });

  it("rehydrates a pending record and re-arms its timer", async () => {
    const h = harness();
    const sendAt = 3 * 60 * 60 * 1000;
    h.watcher.hydrate([
      { sessionId: "session-a", provider: "minimax-cn", region: "cn", errorAt: 0, sendAt },
    ]);

    expect(h.watcher.list()).toHaveLength(1);
    await h.clock.advance(sendAt);
    expect(h.delivered).toEqual(["session-a"]);
  });

  it("delivers a due record shortly after hydration", async () => {
    const h = harness();
    h.watcher.hydrate([
      { sessionId: "session-a", provider: "minimax", region: "global", errorAt: 0, sendAt: 0 },
    ]);

    await h.clock.advance(HYDRATE_SEND_DELAY_MS - 1);
    expect(h.delivered).toEqual([]);
    await h.clock.advance(1);
    expect(h.delivered).toEqual(["session-a"]);
  });

  it("ignores malformed persisted records", () => {
    const h = harness();
    h.watcher.hydrate([
      { sessionId: "", provider: "minimax", region: "cn", errorAt: 0, sendAt: 0 },
      { sessionId: "session-a", provider: "minimax", region: "mars", errorAt: 0, sendAt: 0 },
      { sessionId: "session-b", provider: "minimax", region: "cn", errorAt: 0, sendAt: "soon" },
      {
        sessionId: "session-c",
        provider: "minimax",
        region: "cn",
        errorAt: 1,
        sendAt: 2,
      } as unknown as RateLimitSessionView,
    ] as unknown as RateLimitSessionView[]);
    expect(h.watcher.list().map((item) => item.sessionId)).toEqual(["session-c"]);
  });

  it("retries a failed delivery and then drops the record", async () => {
    const resetAt = 60 * 60 * 1000;
    let attempts = 0;
    const h = harness({
      resetAt,
      deliver: async (item) => {
        attempts += 1;
        if (attempts === 1) throw new Error("session not live");
        h.delivered.push(item.sessionId);
      },
    });
    record(h);

    await h.clock.advance(resetAt + CONTINUE_DELAY_MS);
    expect(attempts).toBe(1);
    const pending = h.watcher.list()[0]!;
    expect(pending.attempts).toBe(1);
    expect(pending.lastError).toBe("session not live");
    expect(h.clock.live).toBe(1);

    await h.clock.advance(DELIVERY_RETRY_MS);
    expect(attempts).toBe(2);
    expect(h.delivered).toEqual(["session-a"]);
    expect(h.watcher.list()).toEqual([]);
  });

  it("gives up after the attempt cap", async () => {
    const resetAt = 60 * 60 * 1000;
    const warnings: string[] = [];
    const clock = new FakeClock();
    const watcher = new RateLimitWatcher({
      clock,
      deliver: async () => {
        throw new Error("nope");
      },
      persist: () => {},
      resolveResetAt: () => resetAt,
      warn: (message) => {
        warnings.push(message);
      },
    });
    watcher.record({ sessionId: "session-a", region: "cn" });

    await clock.advance(resetAt + CONTINUE_DELAY_MS);
    for (let attempt = 1; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      expect(watcher.list()).toHaveLength(1);
      await clock.advance(DELIVERY_RETRY_MS);
    }
    expect(watcher.list()).toEqual([]);
    expect(warnings.some((message) => message.includes("gave up"))).toBe(true);
    expect(clock.live).toBe(0);
  });

  it("stops sending once disposed", async () => {
    const resetAt = 60 * 60 * 1000;
    const h = harness({ resetAt });
    record(h);
    h.watcher.dispose();

    await h.clock.advance(resetAt + CONTINUE_DELAY_MS + 1);
    expect(h.delivered).toEqual([]);
    expect(h.clock.live).toBe(0);
  });

  it("reports the live title over the stored one", () => {
    const h = harness({ titleFor: (sessionId) => `live-${sessionId}` });
    h.watcher.hydrate([
      {
        sessionId: "session-a",
        title: "stored",
        provider: "minimax-cn",
        region: "cn",
        errorAt: 0,
        sendAt: 1000,
      },
    ]);
    expect(h.watcher.list()[0]?.title).toBe("live-session-a");
  });

  it("captures the workspace at record time and reports the live one on the list", () => {
    const stored = harness();
    stored.watcher.record({ sessionId: "session-a", region: "cn", workspace: "工作区 A" });
    expect(stored.watcher.list()[0]?.workspace).toBe("工作区 A");

    const live = harness({ workspaceFor: () => "工作区 B" });
    live.watcher.hydrate([
      {
        sessionId: "session-a",
        workspace: "工作区 A",
        provider: "minimax-cn",
        region: "cn",
        errorAt: 0,
        sendAt: 1000,
      },
    ]);
    expect(live.watcher.list()[0]?.workspace).toBe("工作区 B");
  });

  it("remembers the last provider per Session", () => {
    const h = harness();
    h.watcher.observeProvider("session-a", "cn", "minimax-cn");
    expect(h.watcher.providerOf("session-a")).toEqual({ region: "cn", provider: "minimax-cn" });
    h.watcher.observeProvider("session-a", undefined, "grok");
    expect(h.watcher.providerOf("session-a")).toEqual({ provider: "grok" });
    expect(h.watcher.providerOf("missing")).toBeUndefined();
  });
});

describe("isPermanentDeliveryError", () => {
  it("recognizes unrecoverable subagent failures", () => {
    expect(isPermanentDeliveryError({ code: "NOT_RESUMABLE" })).toBe(true);
    expect(isPermanentDeliveryError({ code: "INPUT_CLOSED" })).toBe(true);
    expect(isPermanentDeliveryError({ code: "UNAUTHORIZED" })).toBe(true);
  });

  it("keeps transient failures retryable", () => {
    expect(isPermanentDeliveryError(new Error("temporarily unavailable"))).toBe(false);
    expect(isPermanentDeliveryError({ code: "ACTIVATION_CLOSING" })).toBe(false);
    expect(isPermanentDeliveryError(null)).toBe(false);
  });
});

describe("RateLimitWatcher delivery outcomes", () => {
  it("marks a recorded subagent Session", () => {
    const h = harness();
    h.watcher.record({ sessionId: "session-a", region: "cn", subagent: true });
    expect(h.watcher.list()[0]?.subagent).toBe(true);
  });

  it("drops a record when the delivery failure is permanent", async () => {
    const resetAt = 60 * 60 * 1000;
    const warnings: string[] = [];
    const clock = new FakeClock();
    const watcher = new RateLimitWatcher({
      clock,
      deliver: async () => {
        throw Object.assign(new Error("subagent has no continuation state"), { code: "NOT_RESUMABLE" });
      },
      persist: () => {},
      resolveResetAt: () => resetAt,
      warn: (message) => {
        warnings.push(message);
      },
    });
    watcher.record({ sessionId: "session-a", region: "cn", subagent: true });

    await clock.advance(resetAt + CONTINUE_DELAY_MS);
    expect(watcher.list()).toEqual([]);
    expect(clock.live).toBe(0);
    expect(warnings.some((message) => message.includes("dropping the record"))).toBe(true);
  });
});
