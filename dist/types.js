export const GLOBAL_KEY_REF = "MINIMAX_API_KEY";
export const CN_KEY_REF = "MINIMAX_CN_API_KEY";
/** Official FAQ hosts first; `api.*` is the TLS-stable fallback. */
export const REMAINS_URLS = {
    global: [
        "https://www.minimax.io/v1/token_plan/remains",
        "https://api.minimax.io/v1/token_plan/remains",
    ],
    cn: [
        "https://api.minimaxi.com/v1/token_plan/remains",
        "https://www.minimaxi.com/v1/token_plan/remains",
    ],
};
export const CACHE_TTL_MS = 45_000;
export const FETCH_TIMEOUT_MS = 8_000;
//# sourceMappingURL=types.js.map