import { UsageCache } from "./cache.js";
import { configuredRegions, resolveKeys } from "./credentials.js";
import { fetchRemains } from "./fetch.js";
import { normalizeRemainsPayload } from "./normalize.js";
const UNCONFIGURED = "未配置 MiniMax 订阅 Key。请到 设置 → 模型 填写 Token Plan 订阅 Key（MINIMAX_API_KEY / MINIMAX_CN_API_KEY）。";
export class UsageService {
    ctx;
    cache = new UsageCache();
    lastOk = new Map();
    fetchImpl;
    env;
    latest;
    /**
     * "init" between construction and {@link prewarm} completion; during this
     * window, {@link snapshot} returns a loading-state snapshot so the Web UI
     * does not flash the "unconfigured" error on every DSH restart. Set to
     * "ready" by {@link prewarm} (success or timeout) or by {@link markReady}
     * (manual escape hatch on prewarm error).
     */
    phase = "init";
    heartbeatMs = 2 * 60 * 1000;
    constructor(ctx, options = {}) {
        this.ctx = ctx;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.env = options.env ?? process.env;
    }
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
    async snapshot(force = false, reason = force ? "manual" : "startup") {
        if (!force && this.latest !== undefined) {
            return { ...this.latest, heartbeatMs: this.heartbeatMs, phase: "ready" };
        }
        if (this.phase === "init") {
            return {
                fetchedAt: null,
                phase: "init",
                reason,
                heartbeatMs: this.heartbeatMs,
                accounts: [],
            };
        }
        const snap = await this.fetchAll(reason);
        if (snap.error !== UNCONFIGURED) {
            this.latest = snap;
        }
        return { ...snap, heartbeatMs: this.heartbeatMs, phase: "ready" };
    }
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
    async prewarm(maxWaitMs = 750) {
        const startedAt = Date.now();
        let keys = {};
        while (Date.now() - startedAt < maxWaitMs) {
            keys = await this.keys();
            if (Object.keys(keys).length > 0)
                break;
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        this.phase = "ready";
        if (Object.keys(keys).length === 0)
            return;
        const snap = await this.fetchAll("startup");
        if (snap.error !== UNCONFIGURED) {
            this.latest = snap;
        }
    }
    /**
     * Force-exit the prewarm phase (e.g. on prewarm error). Safe to call any
     * time; idempotent on an already-ready service.
     */
    markReady() {
        this.phase = "ready";
    }
    invalidate(region) {
        if (region === undefined)
            this.cache.clear();
        else {
            const peek = this.cache.peek(region);
            if (peek !== undefined)
                this.cache.set(region, peek.account, 0);
        }
    }
    dispose() {
        this.cache.clear();
        this.lastOk.clear();
        this.latest = undefined;
        this.phase = "init";
    }
    async keys() {
        return resolveKeys(this.ctx.get("credentials"), this.env);
    }
    async fetchAll(reason) {
        const keys = await this.keys();
        const regions = configuredRegions(keys);
        if (regions.length === 0) {
            return { fetchedAt: null, error: UNCONFIGURED, reason, heartbeatMs: this.heartbeatMs, accounts: [] };
        }
        const results = await Promise.all(regions.map((region) => this.loadRegion(region, keys, true)));
        const accounts = results.map((item) => item.account);
        const fetchedAt = results.reduce((max, item) => {
            if (max === null || item.at > max)
                return item.at;
            return max;
        }, null);
        return { fetchedAt, reason, heartbeatMs: this.heartbeatMs, accounts };
    }
    async loadRegion(region, keys, force) {
        const now = Date.now();
        if (!force) {
            const cached = this.cache.get(region, now);
            if (cached !== undefined)
                return cached;
        }
        const apiKey = keys[region];
        if (apiKey === undefined) {
            return {
                at: now,
                account: { region, configured: false, ok: false, error: UNCONFIGURED, models: [] },
            };
        }
        try {
            const payload = await fetchRemains(region, apiKey, this.fetchImpl);
            const account = normalizeRemainsPayload(payload, region, now);
            if (account.ok) {
                this.cache.set(region, account, now);
                this.lastOk.set(region, account);
            }
            return { at: now, account };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const stale = this.lastOk.get(region);
            if (stale !== undefined) {
                return {
                    at: this.cache.peek(region)?.at ?? now,
                    account: {
                        ...stale,
                        stale: true,
                        error: `可能过期：${message}`,
                    },
                };
            }
            return {
                at: now,
                account: { region, configured: true, ok: false, error: message, models: [] },
            };
        }
    }
}
//# sourceMappingURL=service.js.map