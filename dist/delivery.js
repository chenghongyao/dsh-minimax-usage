import { randomUUID } from "node:crypto";
/** Text sent to a Session once its 5h MiniMax quota window has reset. */
export const CONTINUE_TEXT = "继续";
/** Upper bound for one subagent prompt admission. */
const SUBAGENT_DELIVERY_TIMEOUT_MS = 15_000;
/**
 * Build the delivery callback used by {@link RateLimitWatcher}.
 *
 * Subagent Sessions cannot be resumed through the ordinary Session controller
 * (`session/writer-held` / "use subagent delivery"), so they go through the
 * `subagents` service, which delivers through the owning subagent tree and
 * restores a continuable child when it is no longer resident. Top-level
 * Sessions keep the original path: live Agent, otherwise `resolveAgent`.
 */
export function createContinueDelivery(context) {
    return async (record) => {
        if (record.subagent === true) {
            const subagents = context.get("subagents");
            if (subagents?.deliverPrompt !== undefined) {
                await subagents.deliverPrompt(record.sessionId, [{ type: "text", text: CONTINUE_TEXT }], {
                    signal: abortAfter(SUBAGENT_DELIVERY_TIMEOUT_MS),
                    source: { kind: "user" },
                    delivery: "followup",
                });
                return;
            }
            // No subagent runtime mounted: fall through and try a live Agent.
        }
        const agents = context.get("agents");
        let agent = agents?.get?.(record.sessionId);
        if (agent === undefined) {
            const controller = context.get("sessionController");
            if (controller?.resolveAgent === undefined) {
                throw new Error("sessionController service is unavailable");
            }
            // `resolveAgent` resumes a Session that is not live after a Host restart.
            const resolved = await controller.resolveAgent(record.sessionId);
            if (resolved?.error !== undefined) {
                throw new Error(resolved.error.message ?? "session is unavailable");
            }
            agent = resolved?.agent;
        }
        if (agent === undefined)
            throw new Error(`session ${record.sessionId} has no live agent`);
        if (typeof agent.followup !== "function") {
            throw new Error(`session ${record.sessionId} cannot accept a follow-up message`);
        }
        agent.followup(continueMessage());
        const sessions = context.get("sessions");
        const session = agent.session;
        if (sessions?.flush !== undefined && session !== undefined) {
            try {
                const acknowledged = await sessions.flush(session);
                if (acknowledged === false) {
                    console.warn("[dsh-minimax-usage] session persistence did not acknowledge 继续 delivery");
                }
            }
            catch (error) {
                console.warn(`[dsh-minimax-usage] failed to flush 继续 delivery: ${String(error)}`);
            }
        }
    };
}
/** One frozen user message carrying the continue prompt. */
export function continueMessage() {
    return deepFreeze({
        id: randomUUID(),
        role: "user",
        content: [{ type: "text", text: CONTINUE_TEXT }],
        source: { kind: "user" },
    });
}
function abortAfter(ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    timer.unref?.();
    controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    return controller.signal;
}
function deepFreeze(value) {
    if (value === null || typeof value !== "object")
        return value;
    for (const child of Object.values(value))
        deepFreeze(child);
    return Object.freeze(value);
}
//# sourceMappingURL=delivery.js.map