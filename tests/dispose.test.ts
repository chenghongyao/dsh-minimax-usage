import { describe, expect, it } from "vitest";
import { RefreshScheduler, type Clock } from "../src/refresh.js";
import { apply } from "../src/index.js";

/**
 * Regression tests for the shutdown leak that broke DeepSeek Harness desktop updates:
 * a ref'd heartbeat timer survived plugin disposal, so the host process never exited and
 * the shell rejected the update with "Host did not complete graceful task teardown".
 */
class RecordingClock implements Clock {
  nowMs = 0;
  readonly armed: Array<{ at: number; delay: number; cb: () => void; cancelled: boolean }> = [];

  now(): number {
    return this.nowMs;
  }

  timeout(callback: () => void, delay: number): () => void {
    const timer = { at: this.nowMs + delay, delay, cb: callback, cancelled: false };
    this.armed.push(timer);
    return () => {
      timer.cancelled = true;
    };
  }

  get live(): Array<{ at: number; delay: number; cb: () => void; cancelled: boolean }> {
    return this.armed.filter((timer) => !timer.cancelled);
  }
}

describe("RefreshScheduler.dispose", () => {
  it("cancels the heartbeat timer armed by the constructor", () => {
    const clock = new RecordingClock();
    const scheduler = new RefreshScheduler({ snapshot: async () => undefined }, clock);
    expect(clock.live.length).toBe(1);

    scheduler.dispose();
    expect(clock.live.length).toBe(0);
  });

  it("stays silent when agent events arrive after dispose", () => {
    const clock = new RecordingClock();
    const scheduler = new RefreshScheduler({ snapshot: async () => undefined }, clock);
    scheduler.dispose();

    scheduler.markDirty("global");
    scheduler.onRunning("agent-1");
    scheduler.observeProvider("global", "agent-1");
    scheduler.onIdle("agent-1");
    void scheduler.refreshNow("manual");

    expect(clock.live.length).toBe(0);
  });

  it("does not re-arm when an in-flight prefetch resolves after dispose", async () => {
    let release: (value: undefined) => void = () => {};
    const clock = new RecordingClock();
    const scheduler = new RefreshScheduler(
      {
        snapshot: () =>
          new Promise<undefined>((resolve) => {
            release = resolve;
          }),
      },
      clock,
    );

    // fire the heartbeat so a prefetch is in flight when we dispose
    const heartbeat = clock.live[0]!;
    heartbeat.cancelled = true; // a fired one-shot timer is no longer pending
    heartbeat.cb();
    await Promise.resolve();
    scheduler.dispose();

    release(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clock.live.length).toBe(0);
  });
});

describe("apply", () => {
  it("is not constructible so cordis collects the returned disposer", () => {
    // A plain `function apply` has a prototype, so cordis loads it as a class plugin
    // (`new cb(...)`) and silently drops the disposer it returns.
    expect(Object.getOwnPropertyDescriptor(apply, "prototype")).toBeUndefined();
    expect(() => new (apply as unknown as new () => unknown)()).toThrow();
  });

  it("registers its cleanup through the cordis effect scope and returns it", () => {
    const effects: Array<() => unknown> = [];
    const ctx = {
      get: () => undefined,
      on: () => () => {},
      inject: () => undefined,
      effect: (execute: () => unknown) => {
        effects.push(execute);
        return () => {};
      },
    };

    const dispose = apply(ctx);

    expect(typeof dispose).toBe("function");
    expect(effects.length).toBe(1);
    expect(typeof effects[0]!()).toBe("function");
  });
});
