import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { formatMessageRef, formatMessageIdTag } from "../utils/message-ids.ts";
import {
  CONTEXT_LIMIT_NUDGE,
  TURN_NUDGE,
  ITERATION_NUDGE,
} from "../prompts/nudges.ts";

/**
 * Assign sequential message refs (m0001, m0002, ...) to messages.
 * Refs are cached in state.messageIds.byIndex so re-runs don't reallocate.
 */
export function assignMessageRefs(
  state: SessionState,
  messages: AgentMessage[],
): void {
  for (let i = 0; i < messages.length; i++) {
    if (state.messageIds.byIndex.has(i)) continue;

    const ref = formatMessageRef(state.messageIds.nextRefIndex);
    state.messageIds.byIndex.set(i, ref);
    state.messageIds.nextRefIndex++;
  }
}

/**
 * Inject <dcp-message-id> tags into message text content.
 * Returns a new array. Idempotent: skips if tag is already present.
 *
 * Handles both array content and plain-string content (E9: UserMessage.content
 * can be a plain string — normalize to array form before injecting).
 */
export function injectMessageIds(
  state: SessionState,
  messages: AgentMessage[],
): AgentMessage[] {
  return messages.map((msg, i) => {
    const ref = state.messageIds.byIndex.get(i);
    if (!ref) return msg;

    if (msg.role !== "user" && msg.role !== "assistant") return msg;

    const tag = formatMessageIdTag(ref);

    // E9: UserMessage.content can be a plain string
    if (typeof msg.content === "string") {
      if (msg.content.includes("<dcp-message-id>")) return msg;
      return {
        ...msg,
        content: [{ type: "text" as const, text: `${msg.content}\n\n${tag}` }],
      } as AgentMessage;
    }

    if (!Array.isArray(msg.content)) return msg;

    const textPartIndex = msg.content.findIndex(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        (p as unknown as Record<string, unknown>).type === "text",
    );
    if (textPartIndex === -1) return msg;

    const textPart = msg.content[textPartIndex] as { type: "text"; text: string };
    if (textPart.text.includes("<dcp-message-id>")) return msg;

    const newContent = [...msg.content];
    newContent[textPartIndex] = {
      ...textPart,
      text: `${textPart.text}\n\n${tag}`,
    } as (typeof newContent)[number];

    return { ...msg, content: newContent } as AgentMessage;
  });
}

/**
 * Context usage info from Pi's ctx.getContextUsage().
 * E5: tokens and percent can be null when unknown.
 */
export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

/**
 * Inject compress nudges into messages based on context usage.
 * Three tiers:
 * - Context limit nudge: percent >= maxContextPercent (urgent)
 * - Turn nudge: percent >= minContextPercent and last message is a user message
 * - Iteration nudge: percent >= minContextPercent and many consecutive assistant messages
 *
 * Nudge text is appended to the last message that has text content.
 * Returns a new array. Idempotent: skips if <dcp-system-reminder> is already present.
 *
 * Handles plain-string user message content (E9).
 */
export function injectCompressNudges(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  contextUsage: ContextUsage | undefined,
): AgentMessage[] {
  if (!contextUsage) return messages;

  // E5: percent can be null when unknown
  if (contextUsage.percent == null) return messages;

  const percent = contextUsage.percent;
  const overMax = percent >= config.compress.maxContextPercent;
  const overMin = percent >= config.compress.minContextPercent;

  if (!overMin) return messages;

  if (state.manualMode) return messages;
  if (state.compressPermission === "deny") return messages;

  if (messages.length === 0) return messages;

  let nudgeText: string | undefined;

  if (overMax) {
    nudgeText = CONTEXT_LIMIT_NUDGE;
  } else {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === "user") {
      nudgeText = TURN_NUDGE;
    } else {
      // Count consecutive assistant messages since the last user message
      let messagesSinceUser = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") break;
        messagesSinceUser++;
      }
      if (messagesSinceUser >= config.compress.iterationNudgeThreshold) {
        nudgeText = ITERATION_NUDGE;
      }
    }
  }

  if (!nudgeText) return messages;

  // Inject into the last message that has text content
  const result = [...messages];
  for (let i = result.length - 1; i >= 0; i--) {
    const msg = result[i];
    if (msg.role !== "user" && msg.role !== "assistant") continue;

    // E9: handle plain-string content
    if (typeof msg.content === "string") {
      if (msg.content.includes("<dcp-system-reminder>")) break;
      result[i] = {
        ...msg,
        content: [
          { type: "text" as const, text: `${msg.content}\n\n${nudgeText}` },
        ],
      } as AgentMessage;
      break;
    }

    if (!Array.isArray(msg.content)) continue;

    const textPartIndex = msg.content.findIndex(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        (p as unknown as Record<string, unknown>).type === "text",
    );
    if (textPartIndex === -1) continue;

    const textPart = msg.content[textPartIndex] as { type: "text"; text: string };
    if (textPart.text.includes("<dcp-system-reminder>")) break;

    const newContent = [...msg.content];
    newContent[textPartIndex] = {
      ...textPart,
      text: `${textPart.text}\n\n${nudgeText}`,
    } as (typeof newContent)[number];
    result[i] = { ...msg, content: newContent } as AgentMessage;
    break;
  }

  return result;
}
