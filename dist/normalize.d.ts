import type { AccountSnapshot, Region } from "./types.js";
export declare function isAuthFailureMessage(message: string): boolean;
export declare function mapHttpError(status: number, body: unknown): string;
export declare function normalizeRemainsPayload(payload: unknown, region: Region, now?: number): AccountSnapshot;
//# sourceMappingURL=normalize.d.ts.map