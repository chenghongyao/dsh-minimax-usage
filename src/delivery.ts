import { randomUUID } from "node:crypto";
import type { RateLimitSessionView } from "./types.js";

/** Text sent to a Session once its 5h MiniMax quota window has reset. */
export const CONTINUE_TEXT = "继续";
/** Upper bound for one subagent prompt admission. */
const SUBAGENT_DELIVERY_TIMEOUT_MS = 15_000;

interface DeliveryContext {
  get<T = unknown>(name: string): T | undefined;
}

interface AgentLike {
  session?: SessionLike;
  followup?(message: unknown): void;
}

interface SessionLike {
  id?: string;
  header?: { origin?: string; parentSession?: string };
}

interface SessionControllerLike {
  resolveAgent?(sessionId: string): Promise<{ agent?: AgentLike; error?: { message?: string } } | undefined>;
}

interface SessionsLike {
  flush?(session: unknown): Promise<boolean>;
}

interface SubagentDeliveryOptions {
  signal: AbortSignal;
  source: unknown;
  delivery?: "steer" | "followup";
}

interface SubagentsLike {
  deliverPrompt?(childId: string, content: unknown[], options: SubagentDeliveryOptions): Promise<string>;
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
export function createContinueDelivery(
  context: DeliveryContext,
): (record: RateLimitSessionView) => Promise<void> {
  return async (record) => {
    if (record.subagent === true) {
      const subagents = context.get<SubagentsLike>("subagents");
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

    const agents = context.get<{ get?(id: string): AgentLike | undefined }>("agents");
    let agent = agents?.get?.(record.sessionId);
    if (agent === undefined) {
      const controller = context.get<SessionControllerLike>("sessionController");
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
    if (agent === undefined) throw new Error(`session ${record.sessionId} has no live agent`);
    if (typeof agent.followup !== "function") {
      throw new Error(`session ${record.sessionId} cannot accept a follow-up message`);
    }
    agent.followup(continueMessage());
    const sessions = context.get<SessionsLike>("sessions");
    const session = agent.session;
    if (sessions?.flush !== undefined && session !== undefined) {
      try {
        const acknowledged = await sessions.flush(session);
        if (acknowledged === false) {
          console.warn("[dsh-minimax-usage] session persistence did not acknowledge 继续 delivery");
        }
      } catch (error) {
        console.warn(`[dsh-minimax-usage] failed to flush 继续 delivery: ${String(error)}`);
      }
    }
  };
}

/** One frozen user message carrying the continue prompt. */
export function continueMessage(): unknown {
  return deepFreeze({
    id: randomUUID(),
    role: "user",
    content: [{ type: "text", text: CONTINUE_TEXT }],
    source: { kind: "user" },
  });
}

function abortAfter(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller.signal;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
