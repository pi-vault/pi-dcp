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
 * Inject compress nudges using persistent anchored positions.
 * Two stages:
 *   1. Decision: determine nudge type, add anchor if frequency allows
 *   2. Application: inject nudge text at all anchored positions
 *
 * Requires assignMessageRefs to have been called for this pipeline pass.
 */
export function injectCompressNudges(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  contextUsage: ContextUsage | undefined,
): AgentMessage[] {
  if (!contextUsage) return messages;
  if (messages.length === 0) return messages;
  if (state.manualMode) return messages;
  if (state.compressPermission === "deny") return messages;

  // --- Decision Stage ---
  const { overMaxLimit: overMax, overMinLimit: overMin } = isContextOverLimits(
    config,
    state,
    contextUsage,
  );

  // Summary buffer adjustment (from Phase 3)
  let effectiveOverMax = overMax;
  if (
    effectiveOverMax &&
    config.compress.summaryBuffer &&
    contextUsage.tokens != null
  ) {
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
      effectiveOverMax = adjusted.overMaxLimit;
    }
  }

  if (!overMin) return messages;

  // Determine which nudge to add
  let nudgeType: "contextLimit" | "turn" | "iteration" | undefined;
  if (effectiveOverMax) {
    nudgeType = "contextLimit";
  } else {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === "user") {
      nudgeType = "turn";
    } else {
      let messagesSinceUser = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") break;
        if (messages[i].role === "assistant") messagesSinceUser++;
      }
      if (messagesSinceUser >= config.compress.iterationNudgeThreshold) {
        nudgeType = "iteration";
      }
    }
  }

  if (nudgeType) {
    const targetIndex = messages.length - 1;
    const targetKey = getKeyForIndex(state, targetIndex);

    if (targetKey) {
      const anchorSet =
        nudgeType === "contextLimit"
          ? state.nudges.contextLimitAnchors
          : nudgeType === "turn"
            ? state.nudges.turnAnchors
            : state.nudges.iterationAnchors;

      // Context limit nudges always anchor (ignore frequency)
      if (nudgeType === "contextLimit") {
        anchorSet.add(targetKey);
      } else {
        addAnchorIfAllowed(
          anchorSet,
          targetKey,
          targetIndex,
          state,
          messages.length,
          config.compress.nudgeFrequency,
        );
      }
    }
  }

  // --- Application Stage ---
  return applyAnchoredNudges(state, messages);
}

/**
 * Get the stable message key for a message at a given index.
 * Requires assignMessageRefs to have been called on this pass.
 * Returns undefined if the index has no assigned key.
 */
function getKeyForIndex(state: SessionState, index: number): string | undefined {
  const ref = state.messageIds.byIndex.get(index);
  if (!ref) return undefined;
  return state.messageIds.byRef.get(ref);
}

/**
 * Build a reverse map from message key to array index for the current messages.
 * Used by anchor distance calculations.
 */
function buildKeyToIndexMap(state: SessionState, messageCount: number): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < messageCount; i++) {
    const key = getKeyForIndex(state, i);
    if (key) map.set(key, i);
  }
  return map;
}

/**
 * Add anchor only if the nearest existing anchor in the set is >= frequency messages away.
 */
function addAnchorIfAllowed(
  anchorSet: Set<string>,
  targetKey: string,
  targetIndex: number,
  state: SessionState,
  messageCount: number,
  frequency: number,
): void {
  if (anchorSet.has(targetKey)) return;

  // Build key → index lookup for current messages
  const keyToIndex = buildKeyToIndexMap(state, messageCount);

  // Find the closest existing anchor by message distance
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const existingKey of anchorSet) {
    const existingIndex = keyToIndex.get(existingKey);
    if (existingIndex !== undefined) {
      closestDistance = Math.min(
        closestDistance,
        Math.abs(targetIndex - existingIndex),
      );
    }
    // Anchors not in current messages (stale) are ignored for distance calculation
  }

  // TODO: Stale anchors (keys not present in current messages) are never pruned from the Sets.
  // In sessions with heavy compaction, Sets may grow over time. A future task should clean them
  // up — e.g., after compaction by intersecting anchor sets with keys of surviving messages.

  if (closestDistance >= frequency) {
    anchorSet.add(targetKey);
  }
}

/**
 * Inject nudge text at all anchored message positions.
 */
function applyAnchoredNudges(
  state: SessionState,
  messages: AgentMessage[],
): AgentMessage[] {
  const result = [...messages];
  let changed = false;

  for (let i = 0; i < result.length; i++) {
    const key = getKeyForIndex(state, i);
    if (!key) continue;

    let nudgeText: string | undefined;

    if (state.nudges.contextLimitAnchors.has(key)) {
      nudgeText = CONTEXT_LIMIT_NUDGE;
    } else if (state.nudges.turnAnchors.has(key)) {
      nudgeText = TURN_NUDGE;
    } else if (state.nudges.iterationAnchors.has(key)) {
      nudgeText = ITERATION_NUDGE;
    }

    if (!nudgeText) continue;

    const msg = result[i];
    if (msg.role !== "user" && msg.role !== "assistant") continue;

    // Skip if already has nudge text
    if (hasExistingNudge(msg)) continue;

    result[i] = appendText(msg, `\n\n${nudgeText}`);
    changed = true;
  }

  return changed ? result : messages;
}

function hasExistingNudge(msg: AgentMessage): boolean {
  if (!("content" in msg)) return false;
  if (typeof msg.content === "string")
    return msg.content.includes("<dcp-system-reminder>");
  if (!Array.isArray(msg.content)) return false;
  return msg.content.some((p) => {
    if (typeof p !== "object" || p === null) return false;
    const part = p as unknown as Record<string, unknown>;
    return (
      part.type === "text" &&
      typeof part.text === "string" &&
      (part.text as string).includes("<dcp-system-reminder>")
    );
  });
}
