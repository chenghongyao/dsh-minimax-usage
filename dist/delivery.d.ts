import type { RateLimitSessionView } from "./types.js";
/** Text sent to a Session once its 5h MiniMax quota window has reset. */
export declare const CONTINUE_TEXT = "\u7EE7\u7EED";
interface DeliveryContext {
    get<T = unknown>(name: string): T | undefined;
}
/**
 * Build the delivery callback used by {@link RateLimitWatcher}.
 *
 * Subagent Sessions cannot be resumed through the ordinary Session controller
 * (`session/writer-held` / "use subagent delivery"), so they go through the
 * `subagents` service, which delivers through the owning subagent tree and
 * restores a continuable child when it is no longer resident. Top-level
 * Sessions keep the original path: live Agent, otherwise `resolveAgent`.
 */
export declare function createContinueDelivery(context: DeliveryContext): (record: RateLimitSessionView) => Promise<void>;
/** One frozen user message carrying the continue prompt. */
export declare function continueMessage(): unknown;
export {};
//# sourceMappingURL=delivery.d.ts.map