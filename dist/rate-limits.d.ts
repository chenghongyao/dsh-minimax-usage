import { type Clock } from "./refresh.js";
import type { RateLimitSessionView, Region } from "./types.js";
/** Fallback wait when no 5h-window end is known: assume one full window. */
export declare const FIVE_HOURS_MS: number;
/** Retry cadence after a failed delivery (Session gone, Agent not resumable, ...). */
export declare const DELIVERY_RETRY_MS: number;
/** Give up after this many failed deliveries so a dead Session cannot retry forever. */
export declare const MAX_DELIVERY_ATTEMPTS = 6;
/** Delay used when a persisted record is already due at Hydrate time (Host just started). */
export declare const HYDRATE_SEND_DELAY_MS = 2000;
export interface RateLimitWatcherOptions {
    /** Clock seam for tests. Defaults to the real system clock. */
    readonly clock?: Clock;
    /** Deliver the "继续" message to one recorded Session. Rejection schedules a retry. */
    readonly deliver: (record: RateLimitSessionView) => Promise<void>;
    /** Persist the current record list after every change. */
    readonly persist: (records: RateLimitSessionView[]) => void;
    /** Current 5h-window end, when known. Falls back to now + {@link FIVE_HOURS_MS}. */
    readonly resolveResetAt?: () => number | undefined;
    /** Live Session title lookup used when rendering the list. */
    readonly titleFor?: (sessionId: string) => string | undefined;
    /** Diagnostics sink; defaults to `console.warn`. */
    readonly warn?: (message: string) => void;
}
/**
 * Recognize the provider-neutral `RATE_LIMIT` failure (LlmError code) that the
 * MiniMax adapter derives from `rate_limit_error` responses and HTTP 429.
 * Never throw from here: the input is an arbitrary agent error value.
 */
export declare function isRateLimitError(error: unknown): boolean;
/** Provider id reported for one region. */
export declare function providerForRegion(region: Region): string;
/**
 * Records Sessions that hit a MiniMax rate limit and delivers one `继续`
 * message to each of them after its 5h window resets.
 *
 * Records are keyed by Session id (a repeat error refreshes the deadline), can
 * be removed individually or cleared as a whole from the usage panel, and are
 * rehydrated on Host start so a restart does not lose a pending delivery.
 */
export declare class RateLimitWatcher {
    private readonly clock;
    private readonly deliver;
    private readonly persistFn;
    private readonly resolveResetAt;
    private readonly titleFor;
    private readonly warn;
    private readonly records;
    private readonly timers;
    /** Last provider observed per Session, used to attribute an `agent/error`. */
    private readonly providers;
    private disposed;
    constructor(options: RateLimitWatcherOptions);
    /** Remember the provider of the latest LLM request for one Session. */
    observeProvider(sessionId: string | undefined, region: Region | undefined, provider: string | undefined): void;
    /** Provider observed for one Session, if any. */
    providerOf(sessionId: string): {
        region?: Region;
        provider?: string;
    } | undefined;
    /** Record one rate-limited Session and (re)arm its delivery timer. */
    record(input: {
        sessionId: string;
        title?: string;
        provider?: string;
        region: Region;
        errorAt?: number;
    }): void;
    /** Remove one Session record; it will never receive the `继续` message. */
    remove(sessionId: string): boolean;
    /** Remove every Session record and cancel all pending deliveries. */
    clear(): number;
    /** Browser-facing list, soonest delivery first, with fresh titles where available. */
    list(): RateLimitSessionView[];
    /** Load persisted records after a Host restart and arm each remaining delivery. */
    hydrate(records: readonly RateLimitSessionView[]): void;
    /** Stop all timers. Pending records are kept on disk for the next Host start. */
    dispose(): void;
    private schedule;
    private cancelTimer;
    private deliverOne;
    private safePersist;
    private recordsSnapshot;
}
//# sourceMappingURL=rate-limits.d.ts.map