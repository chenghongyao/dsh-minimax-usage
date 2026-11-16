import { systemClock } from "./refresh.js";
/** Fallback wait when no 5h-window end is known: assume one full window. */
export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
/** Grace past the 5h window end: quota propagation can lag the reset moment. */
export const CONTINUE_DELAY_MS = 2 * 60 * 1000;
/** Retry cadence after a failed delivery (Session gone, Agent not resumable, ...). */
export const DELIVERY_RETRY_MS = 5 * 60 * 1000;
/** Give up after this many failed deliveries so a dead Session cannot retry forever. */
export const MAX_DELIVERY_ATTEMPTS = 6;
/** Delay used when a persisted record is already due at Hydrate time (Host just started). */
export const HYDRATE_SEND_DELAY_MS = 2_000;
/** Largest delay a single timer may carry (Node clamps anything above it to 1ms). */
const MAX_TIMER_DELAY_MS = 2_147_483_647;
/**
 * Recognize the provider-neutral `RATE_LIMIT` failure (LlmError code) that the
 * MiniMax adapter derives from `rate_limit_error` responses and HTTP 429.
 * Never throw from here: the input is an arbitrary agent error value.
 */
export function isRateLimitError(error) {
    if (error === null || typeof error !== "object")
        return false;
    const facts = error;
    const failure = facts.failure;
    const code = typeof facts.code === "string"
        ? facts.code
        : typeof failure?.code === "string"
            ? failure.code
            : undefined;
    if (code === "RATE_LIMIT")
        return true;
    const status = typeof facts.status === "number"
        ? facts.status
        : typeof failure?.status === "number"
            ? failure.status
            : undefined;
    if (status === 429)
        return true;
    const text = [facts.name, facts.message, failure?.message]
        .filter((part) => typeof part === "string")
        .join(" ");
    return /rate[_\s-]?limit/i.test(text) || /\b429\b/.test(text);
}
/** Provider id reported for one region. */
export function providerForRegion(region) {
    return region === "cn" ? "minimax-cn" : "minimax";
}
/**
 * Delivery failures that will never succeed on a retry: the target subagent
 * cannot be resumed (one-shot/closed/foreign tree) or its persistence layer is
 * missing. Retrying only spams the log, so the watcher drops the record.
 */
const PERMANENT_DELIVERY_CODES = new Set([
    "NOT_RESUMABLE",
    "UNAUTHORIZED",
    "INPUT_CLOSED",
    "PERSISTENCE_UNAVAILABLE",
    "CONTINUATION_UNAVAILABLE",
]);
export function isPermanentDeliveryError(error) {
    if (error === null || typeof error !== "object")
        return false;
    const code = error.code;
    return typeof code === "string" && PERMANENT_DELIVERY_CODES.has(code);
}
/**
 * Records Sessions that hit a MiniMax rate limit and delivers one `继续`
 * message to each of them after its 5h window resets.
 *
 * Records are keyed by Session id (a repeat error refreshes the deadline), can
 * be removed individually or cleared as a whole from the usage panel, and are
 * rehydrated on Host start so a restart does not lose a pending delivery.
 */
export class RateLimitWatcher {
    clock;
    deliver;
    persistFn;
    resolveResetAt;
    titleFor;
    workspaceFor;
    warn;
    records = new Map();
    timers = new Map();
    /** Last provider observed per Session, used to attribute an `agent/error`. */
    providers = new Map();
    disposed = false;
    constructor(options) {
        this.clock = options.clock ?? systemClock;
        this.deliver = options.deliver;
        this.persistFn = options.persist;
        this.resolveResetAt = options.resolveResetAt;
        this.titleFor = options.titleFor;
        this.workspaceFor = options.workspaceFor;
        this.warn = options.warn ?? ((message) => console.warn(`[dsh-minimax-usage] ${message}`));
    }
    /** Remember the provider of the latest LLM request for one Session. */
    observeProvider(sessionId, region, provider) {
        if (sessionId === undefined || sessionId === "" || this.disposed)
            return;
        this.providers.set(sessionId, {
            ...(region === undefined ? {} : { region }),
            ...(provider === undefined ? {} : { provider }),
        });
        if (this.providers.size > 500) {
            const oldest = this.providers.keys().next();
            if (oldest.done !== true)
                this.providers.delete(oldest.value);
        }
    }
    /** Provider observed for one Session, if any. */
    providerOf(sessionId) {
        return this.providers.get(sessionId);
    }
    /** Record one rate-limited Session and (re)arm its delivery timer. */
    record(input) {
        if (this.disposed || input.sessionId === "")
            return;
        const now = this.clock.now();
        const errorAt = input.errorAt ?? now;
        const resetAt = this.resolveResetAt?.();
        const known = resetAt !== undefined && Number.isFinite(resetAt) && resetAt > now;
        const sendAt = (known ? resetAt : now + FIVE_HOURS_MS) + CONTINUE_DELAY_MS;
        this.records.set(input.sessionId, {
            sessionId: input.sessionId,
            ...(input.title === undefined || input.title === "" ? {} : { title: input.title }),
            ...(input.workspace === undefined || input.workspace === "" ? {} : { workspace: input.workspace }),
            provider: input.provider ?? providerForRegion(input.region),
            region: input.region,
            ...(input.subagent === true ? { subagent: true } : {}),
            errorAt,
            sendAt,
        });
        this.schedule(input.sessionId, sendAt - now);
        this.safePersist();
    }
    /** Remove one Session record; it will never receive the `继续` message. */
    remove(sessionId) {
        const existed = this.records.delete(sessionId);
        this.cancelTimer(sessionId);
        if (existed)
            this.safePersist();
        return existed;
    }
    /** Remove every Session record and cancel all pending deliveries. */
    clear() {
        const count = this.records.size;
        this.records.clear();
        for (const sessionId of [...this.timers.keys()])
            this.cancelTimer(sessionId);
        if (count > 0)
            this.safePersist();
        return count;
    }
    /** Browser-facing list, soonest delivery first, with fresh titles/workspaces where available. */
    list() {
        const items = [];
        for (const record of this.records.values()) {
            const title = this.titleFor?.(record.sessionId);
            const workspace = this.workspaceFor?.(record.sessionId);
            items.push({
                ...record,
                ...(title === undefined || title === "" ? {} : { title }),
                ...(workspace === undefined || workspace === "" ? {} : { workspace }),
            });
        }
        items.sort((a, b) => a.sendAt - b.sendAt || a.sessionId.localeCompare(b.sessionId));
        return items;
    }
    /** Load persisted records after a Host restart and arm each remaining delivery. */
    hydrate(records) {
        if (this.disposed)
            return;
        const now = this.clock.now();
        for (const record of records) {
            if (!isRateLimitSessionView(record))
                continue;
            this.records.set(record.sessionId, { ...record });
            this.schedule(record.sessionId, Math.max(record.sendAt - now, HYDRATE_SEND_DELAY_MS));
        }
    }
    /** Stop all timers. Pending records are kept on disk for the next Host start. */
    dispose() {
        this.disposed = true;
        for (const cancel of this.timers.values())
            cancel();
        this.timers.clear();
    }
    schedule(sessionId, delayMs) {
        this.cancelTimer(sessionId);
        if (this.disposed)
            return;
        const delay = Math.max(0, Math.min(Math.trunc(delayMs), MAX_TIMER_DELAY_MS));
        const cancel = this.clock.timeout(() => {
            this.timers.delete(sessionId);
            void this.deliverOne(sessionId);
        }, delay);
        this.timers.set(sessionId, cancel);
    }
    cancelTimer(sessionId) {
        const cancel = this.timers.get(sessionId);
        if (cancel === undefined)
            return;
        cancel();
        this.timers.delete(sessionId);
    }
    async deliverOne(sessionId) {
        const record = this.records.get(sessionId);
        if (record === undefined || this.disposed)
            return;
        try {
            await this.deliver(record);
            if (this.disposed)
                return;
            this.records.delete(sessionId);
            this.safePersist();
        }
        catch (error) {
            if (this.disposed)
                return;
            const message = error instanceof Error ? error.message : String(error);
            if (isPermanentDeliveryError(error)) {
                this.records.delete(sessionId);
                this.safePersist();
                this.warn(`cannot deliver "继续" to session ${sessionId}: ${message}; dropping the record`);
                return;
            }
            const attempts = (record.attempts ?? 0) + 1;
            if (attempts >= MAX_DELIVERY_ATTEMPTS) {
                this.records.delete(sessionId);
                this.safePersist();
                this.warn(`gave up delivering "继续" to session ${sessionId} after ${attempts} attempts: ${message}`);
                return;
            }
            this.records.set(sessionId, { ...record, attempts, lastError: message });
            this.schedule(sessionId, DELIVERY_RETRY_MS);
            this.safePersist();
        }
    }
    safePersist() {
        try {
            this.persistFn(this.recordsSnapshot());
        }
        catch (error) {
            this.warn(`failed to persist rate-limit records: ${String(error)}`);
        }
    }
    recordsSnapshot() {
        return [...this.records.values()].map((record) => ({ ...record }));
    }
}
/** Structural guard for records loaded from disk (untrusted JSON). */
function isRateLimitSessionView(value) {
    if (value === null || typeof value !== "object")
        return false;
    const record = value;
    return (typeof record.sessionId === "string" &&
        record.sessionId !== "" &&
        (record.region === "cn" || record.region === "global") &&
        typeof record.provider === "string" &&
        typeof record.errorAt === "number" &&
        Number.isFinite(record.errorAt) &&
        typeof record.sendAt === "number" &&
        Number.isFinite(record.sendAt) &&
        (record.title === undefined || typeof record.title === "string"));
}
//# sourceMappingURL=rate-limits.js.map