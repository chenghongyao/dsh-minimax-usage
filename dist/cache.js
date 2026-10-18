import { CACHE_TTL_MS } from "./types.js";
export class UsageCache {
    ttlMs;
    entries = new Map();
    constructor(ttlMs = CACHE_TTL_MS) {
        this.ttlMs = ttlMs;
    }
    get(region, now = Date.now()) {
        const entry = this.entries.get(region);
        if (entry === undefined)
            return undefined;
        if (now - entry.at > this.ttlMs)
            return undefined;
        return entry;
    }
    peek(region) {
        return this.entries.get(region);
    }
    set(region, account, now = Date.now()) {
        this.entries.set(region, { at: now, account });
    }
    clear() {
        this.entries.clear();
    }
}
//# sourceMappingURL=cache.js.map