import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ContextUsage, SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { formatMessageRef, formatMessageIdTag } from "../utils/message-ids.ts";
import type { PriorityMap } from "./priority.ts";
import { appendText } from "../utils/message-content.ts";
import {
  CONTEXT_LIMIT_NUDGE,
  TURN_NUDGE,
  ITERATION_NUDGE,
} from "../prompts/nudges.ts";

/**
 * Assign sequential message refs (m0001, m0002, ...) to messages.
 * Refs are cached in state.messageIds.byIndex so re-runs don't reallocate.
 * Also maintains a reverse map (byRef) for O(1) ref-to-index resolution.
 */
export function assignMessageRefs(
  state: SessionState,
  messages: AgentMessage[],
): void {
  for (let i = 0; i < messages.length; i++) {
    if (state.messageIds.byIndex.has(i)) continue;

    const ref = formatMessageRef(state.messageIds.nextRefIndex);
    state.messageIds.byIndex.set(i, ref);
    state.messageIds.byRef.set(ref, i);
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
  priorityMap?: PriorityMap,
): AgentMessage[] {
  return messages.map((msg, i) => {
    const ref = state.messageIds.byIndex.get(i);
    if (!ref) return msg;

    if (msg.role !== "user" && msg.role !== "assistant") return msg;

    const priorityEntry = priorityMap?.get(i);
    const tag = formatMessageIdTag(
      ref,
      priorityEntry ? { priority: priorityEntry.priority } : undefined,
    );

    // Idempotency marker uses "<dcp-message-id" (no closing >) to match both
    // plain and priority-attribute variants.
    return appendText(msg, `\n\n${tag}`, "<dcp-message-id");
  });
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
 *
 * NOTE: config.compress.nudgeFrequency and state.nudges anchor tracking are
 * reserved for Phase 4+ throttling — not yet implemented.
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
      // Count only assistant messages since the last user message
      let messagesSinceUser = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") break;
        if (messages[i].role === "assistant") messagesSinceUser++;
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

    // Check for existing marker — stop searching if found
    if (typeof msg.content === "string") {
      if (msg.content.includes("<dcp-system-reminder>")) break;
    } else if (Array.isArray(msg.content)) {
      const tp = msg.content.find(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          (p as unknown as Record<string, unknown>).type === "text",
      ) as unknown as { text: string } | undefined;
      if (!tp) continue;
      if (tp.text.includes("<dcp-system-reminder>")) break;
    } else {
      continue;
    }

    result[i] = appendText(msg, `\n\n${nudgeText}`);
    break;
  }

  return result;
}
