import { type AccountSnapshot, type Region } from "./types.js";
interface CacheEntry {
    at: number;
    account: AccountSnapshot;
}
export declare class UsageCache {
    private readonly ttlMs;
    private readonly entries;
    constructor(ttlMs?: number);
    get(region: Region, now?: number): CacheEntry | undefined;
    peek(region: Region): CacheEntry | undefined;
    set(region: Region, account: AccountSnapshot, now?: number): void;
    clear(): void;
}
export {};
//# sourceMappingURL=cache.d.ts.map