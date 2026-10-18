import type { Region, RefreshReason, UsageSnapshot } from "./types.js";
export declare const IDLE_DELAY_MS = 15000;
export declare const RUNNING_REFRESH_INTERVAL_MS = 30000;
export declare const HEARTBEAT_MIN_MS: number;
export declare const HEARTBEAT_MAX_MS: number;
/** Fixed offset past the 5h-window reset time at which we re-fetch. */
export declare const RESET_REFRESH_DELAY_MS = 30000;
export declare function nextHeartbeatMs(current: number): number;
export declare function regionOfProvider(provider: unknown): Region | undefined;
export interface Clock {
    now(): number;
    timeout(callback: () => void, delay: number): () => void;
}
export declare const systemClock: Clock;
export interface RefreshTarget {
    snapshot(force: boolean, reason: RefreshReason): Promise<UsageSnapshot | undefined>;
}
/**
 * Earliest fire time across all `ok` accounts/models: `intervalEndAt + RESET_REFRESH_DELAY_MS`.
 * Returns undefined when no model carries a usable end time, or when the computed fire time has
 * already passed (the reset already happened — we don't fire in the past).
 */
export declare function computeResetFireAt(snap: UsageSnapshot | undefined, now: number): number | undefined;
export declare class RefreshScheduler {
    private readonly target;
    private readonly clock;
    private readonly dirty;
    private readonly runningAgents;
    private readonly minimaxRunningAgents;
    private idleCancel;
    private heartbeatCancel;
    private runningCancel;
    private resetCancel;
    private resetFireAt;
    private prefetching;
    heartbeatMs: number;
    constructor(target: RefreshTarget, clock?: Clock);
    markDirty(region: Region): void;
    private resolveAgentKey;
    /**
     * Observe the provider used by one LLM request. MiniMax requests make that
     * running agent eligible for the 30-second refresh loop; another provider
     * removes the eligibility without discarding the dirty region used by the
     * existing idle refresh path.
     */
    observeProvider(region: Region | undefined, agentId?: string): void;
    get dirtyRegions(): Region[];
    onRunning(agentId?: string): void;
    onIdle(agentId?: string): void;
    refreshNow(reason: RefreshReason): Promise<void>;
    dispose(): void;
    private prefetch;
    private hasEligibleRunningAgent;
    private syncRunningRefresh;
    private syncBackgroundRefresh;
    private armRunningRefresh;
    private armHeartbeat;
    /**
     * One-shot timer scheduled at the earliest 5h-window reset time + 30s. Re-armed on every
     * successful snapshot so the timer always tracks the latest known reset moment. When the
     * timer fires while an idle-prefetch is already pending we re-arm against the same fireAt;
     * if `fireAt` has since passed (the idle window dragged us past it) we simply drop it —
     * the next prefetch (post-idle) will re-arm with the freshly-fetched reset time.
     */
    private armResetRefresh;
    private armResetRefreshAt;
    private clearIdleTimer;
    private clearHeartbeat;
    private clearRunningRefresh;
    private clearResetRefresh;
}
//# sourceMappingURL=refresh.d.ts.map