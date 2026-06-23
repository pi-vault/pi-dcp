import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ContextUsage, SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { getActiveSummaryTokenUsage } from "../compress/state.ts";
import { isContextOverLimits } from "../utils/context-limits.ts";
import { formatMessageRef, formatMessageIdTag, getMessageKey } from "../utils/message-ids.ts";
import type { PriorityMap } from "./priority.ts";
import { appendText, mapText } from "../utils/message-content.ts";
import { stripHallucinationsFromString } from "./strip.ts";
import {
  CONTEXT_LIMIT_NUDGE,
  TURN_NUDGE,
  ITERATION_NUDGE,
} from "../prompts/nudges.ts";

/**
 * Assign sequential message refs (m0001, m0002, ...) using content-derived stable keys.
 * Refs are stored in state.messageIds.byRawId (persistent) and byIndex (runtime cache).
 * A message always gets the same ref regardless of its position in the array.
 *
 * Counter logic: For messages sharing the same role:timestamp, a 0-based counter
 * disambiguates them based on their order in the array. ToolResult messages use
 * toolCallId (unique) and bypass the counter.
 */
export function assignMessageRefs(
  state: SessionState,
  messages: AgentMessage[],
): void {
  // Clear runtime index cache — rebuilt each pass
  state.messageIds.byIndex.clear();

  // Count occurrences of each role:timestamp prefix to assign counters
  const prefixCounters = new Map<string, number>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    let key: string;
    if (msg.role === "toolResult") {
      key = getMessageKey(msg, 0); // counter ignored for toolResult
    } else {
      const ts = (msg as unknown as { timestamp: number }).timestamp;
      const prefix = `${msg.role}:${ts}`;
      const counter = prefixCounters.get(prefix) ?? 0;
      prefixCounters.set(prefix, counter + 1);
      key = getMessageKey(msg, counter);
    }

    let ref = state.messageIds.byRawId.get(key);

    if (!ref) {
      ref = formatMessageRef(state.messageIds.nextRefIndex);
      state.messageIds.byRawId.set(key, ref);
      state.messageIds.byRef.set(ref, key);
      state.messageIds.nextRefIndex++;
    }

    state.messageIds.byIndex.set(i, ref);
  }
}

/**
 * Inject <dcp-message-id> tags into message text content.
 * Returns a new array. Strips existing DCP tags before injecting fresh ones.
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

    // Strip any existing (stale/partial) DCP tags before injecting fresh ones.
    // This replaces marker-based idempotency — always inject clean.
    // Note: not idempotent in isolation (repeated calls add trailing \n\n).
    // Safe because this runs exactly once per context pass on fresh stored messages.
    const cleaned = mapText(msg, stripHallucinationsFromString);
    return appendText(cleaned, `\n\n${tag}`);
  });
}

/**
 * Inject compress nudges into messages based on context usage.
 * Thresholds resolved via isContextOverLimits (absolute tokens, per-model overrides, legacy percentage fallback):
 * - Context limit nudge: tokens >= maxContextLimit (urgent)
 * - Turn nudge: tokens >= minContextLimit and last message is a user message
 * - Iteration nudge: tokens >= minContextLimit and many consecutive assistant messages
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

  // Resolve context limits (absolute tokens, per-model overrides, legacy percentage fallback)
  let { overMaxLimit: overMax, overMinLimit: overMin } = isContextOverLimits(
    config,
    state,
    contextUsage,
  );

  // Summary buffer: if over max, check whether summary tokens account for the overshoot.
  // Subtract active summary tokens from effective usage and re-check.
  if (overMax && config.compress.summaryBuffer && contextUsage.tokens != null) {
    const summaryTokens = getActiveSummaryTokenUsage(state);
    if (summaryTokens > 0) {
      const effectiveTokens = contextUsage.tokens - summaryTokens;
      const adjusted = isContextOverLimits(config, state, {
        ...contextUsage,
        tokens: effectiveTokens,
        percent:
          contextUsage.contextWindow > 0
            ? (effectiveTokens / contextUsage.contextWindow) * 100
            : contextUsage.percent,
      });
      overMax = adjusted.overMaxLimit;
    }
  }

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
