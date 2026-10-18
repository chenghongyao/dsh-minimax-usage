import { type FetchLike } from "./fetch.js";
import type { RefreshReason, Region, UsageSnapshot } from "./types.js";
export interface UsageContext {
    get<T = unknown>(name: string): T | undefined;
}
export declare class UsageService {
    private readonly ctx;
    private readonly cache;
    private readonly lastOk;
    private readonly fetchImpl;
    private readonly env;
    private latest;
    /**
     * "init" between construction and {@link prewarm} completion; during this
     * window, {@link snapshot} returns a loading-state snapshot so the Web UI
     * does not flash the "unconfigured" error on every DSH restart. Set to
     * "ready" by {@link prewarm} (success or timeout) or by {@link markReady}
     * (manual escape hatch on prewarm error).
     */
    private phase;
    heartbeatMs: number;
    constructor(ctx: UsageContext, options?: {
        fetchImpl?: FetchLike;
        env?: NodeJS.ProcessEnv;
    });
    /**
     * Cached snapshot. While {@link phase} is "init" returns a loading-state
     * snapshot (no `error`, empty `accounts`, `phase: "init"`) so the client
     * never flashes an unconfigured-error banner just because the first
     * `/status` request landed before the credentials service finished loading
     * `.credentials.yaml`. After prewarm, falls through to the cached snapshot
     * (if any) or performs a fresh fetch and caches it — except that an
     * `UNCONFIGURED` result is intentionally NOT cached, so the next call
     * retries once credentials may have become available.
     */
    snapshot(force?: boolean, reason?: RefreshReason): Promise<UsageSnapshot>;
    /**
     * Wait for the credentials service to expose at least one key, then fetch
     * the first real snapshot. The HTTP routes are already registered before
     * this runs, so any `/status` request that lands during prewarming gets
     * the loading-state snapshot (see {@link snapshot}); the next call after
     * prewarm returns the freshly cached real data.
     *
     * The polling window is bounded so a permanently empty store still
     * transitions out of "init" in finite time. 750 ms is generous against
     * `dsh-credentials-local`'s first load (a tiny YAML read on warm SSD:
     * <50 ms) while staying well under "the user notices a stuck spinner".
     */
    prewarm(maxWaitMs?: number): Promise<void>;
    /**
     * Force-exit the prewarm phase (e.g. on prewarm error). Safe to call any
     * time; idempotent on an already-ready service.
     */
    markReady(): void;
    invalidate(region?: Region): void;
    dispose(): void;
    private keys;
    private fetchAll;
    private loadRegion;
}
//# sourceMappingURL=service.d.ts.map