import { type Region } from "./types.js";
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export declare function fetchRemains(region: Region, apiKey: string, fetchImpl?: FetchLike, timeoutMs?: number): Promise<unknown>;
export declare function describeFetchError(err: Error): string;
export declare function isRetryableFetchError(err: Error): boolean;
//# sourceMappingURL=fetch.d.ts.map