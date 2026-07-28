import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";
import { parseBoundaryId } from "../utils/message-ids.ts";

/** Return the first message index in the newest protected user turns. */
export function getProtectedTurnStart(
  messages: AgentMessage[],
  turns: number,
): number | undefined {
  if (turns <= 0) return undefined;
  const userIndices = messages.flatMap((message, index) =>
    message.role === "user" ? [index] : [],
  );
  return userIndices[Math.max(0, userIndices.length - turns)];
}

/**
 * Resolve a boundary ID (m0001 or b1) to a message array index.
 */
export function resolveBoundaryIndex(
  state: SessionState,
  boundaryId: string,
): number | undefined {
  const parsed = parseBoundaryId(boundaryId);
  if (!parsed) return undefined;

  if (parsed.type === "message") {
    const ref = boundaryId;
    // Reverse-lookup: find the index that maps to this ref in the runtime cache.
    // byRef now maps ref->rawId (not ref->index), so we scan byIndex instead.
    for (const [idx, r] of state.messageIds.byIndex) {
      if (r === ref) return idx;
    }
    return undefined;
  }

  if (parsed.type === "block") {
    // Find the anchor index for this block
    for (const [anchorIndex, blockId] of state.prune.messages.activeByAnchorIndex) {
      if (blockId === parsed.blockId) return anchorIndex;
    }
    return undefined;
  }

  return undefined;
}

export interface SelectionResult {
  messageIndices: number[];
  startIndex: number;
  endIndex: number;
}

export interface ExpandedRange {
  startIndex: number;
  endIndex: number;
}

/**
 * Expand a compression range to ensure all tool call chains are complete.
 * If state is provided with populated toolParameters, uses cached assistantIndex/resultIndex
 * for O(C) lookups (C = cached tool calls) instead of scanning the full message array O(N).
 * Falls back to scan when state is not provided or toolParameters is empty.
 */
export function expandRangeForToolChains(
  messages: AgentMessage[],
  startIndex: number,
  endIndex: number,
  state?: SessionState,
): ExpandedRange {
  // Fast path: use cached indices from tool parameter entries
  if (state && state.toolParameters.size > 0) {
    return expandWithCachedIndices(messages, startIndex, endIndex, state);
  }

  // Fallback: scan-based expansion (original implementation)
  return expandByScan(messages, startIndex, endIndex);
}

function expandWithCachedIndices(
  messages: AgentMessage[],
  startIndex: number,
  endIndex: number,
  state: SessionState,
): ExpandedRange {
  let start = startIndex;
  let end = endIndex;
  let changed = true;
  const maxIndex = messages.length - 1;

  while (changed) {
    changed = false;

    for (const [, entry] of state.toolParameters) {
      const aIdx = entry.assistantIndex;
      const rIdx = entry.resultIndex;
      if (aIdx === undefined) continue;

      // Skip entries with stale indices beyond current messages array
      if (aIdx > maxIndex || (rIdx !== undefined && rIdx > maxIndex)) continue;

      // Assistant in range but result outside → expand end
      if (rIdx !== undefined && aIdx >= start && aIdx <= end && rIdx > end) {
        end = rIdx;
        changed = true;
      }

      // Result in range but assistant outside → expand start
      if (rIdx !== undefined && rIdx >= start && rIdx <= end && aIdx < start) {
        start = aIdx;
        changed = true;
      }
    }
  }

  return { startIndex: start, endIndex: end };
}

function expandByScan(
  messages: AgentMessage[],
  startIndex: number,
  endIndex: number,
): ExpandedRange {
  let start = startIndex;
  let end = endIndex;
  let changed = true;

  while (changed) {
    changed = false;

    // Collect all toolCall IDs from assistant messages in [start, end]
    const callIdsInRange = new Set<string>();
    for (let i = start; i <= end; i++) {
      const msg = messages[i];
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (typeof part !== "object" || part === null) continue;
        const p = part as unknown as Record<string, unknown>;
        if (p.type === "toolCall" && typeof p.id === "string") {
          callIdsInRange.add(p.id as string);
        }
      }
    }

    // For each toolCall in range, ensure its toolResult is also in range
    for (let i = end + 1; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== "toolResult") continue;
      if (callIdsInRange.has(msg.toolCallId)) {
        end = i;
        changed = true;
      }
    }

    // Collect all toolResult toolCallIds in [start, end]
    const resultCallIdsInRange = new Set<string>();
    for (let i = start; i <= end; i++) {
      const msg = messages[i];
      if (msg.role !== "toolResult") continue;
      resultCallIdsInRange.add(msg.toolCallId);
    }

    // For each toolResult in range, ensure its assistant toolCall is also in range
    for (let i = 0; i < start; i++) {
      const msg = messages[i];
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (typeof part !== "object" || part === null) continue;
        const p = part as unknown as Record<string, unknown>;
        if (p.type === "toolCall" && typeof p.id === "string") {
          if (resultCallIdsInRange.has(p.id as string)) {
            start = i;
            changed = true;
          }
        }
      }
    }
  }

  return { startIndex: start, endIndex: end };
}

/**
 * Collect message indices in a range [startIndex, endIndex].
 * Auto-expands the range to protect tool call chains from being split.
 * If state is provided, uses cached indices for faster expansion.
 */
export function resolveSelection(
  messages: AgentMessage[],
  startIndex: number,
  endIndex: number,
  state?: SessionState,
): SelectionResult {
  if (startIndex > endIndex) {
    throw new Error(
      `startId appears after endId in the conversation. Start must come before end.`,
    );
  }

  if (startIndex < 0 || endIndex >= messages.length) {
    throw new Error(
      `Boundary indices out of range. Valid range: 0-${messages.length - 1}`,
    );
  }

  // Expand range to avoid splitting tool call chains
  const expanded = expandRangeForToolChains(messages, startIndex, endIndex, state);

  const messageIndices: number[] = [];
  for (let i = expanded.startIndex; i <= expanded.endIndex; i++) {
    messageIndices.push(i);
  }

  return {
    messageIndices,
    startIndex: expanded.startIndex,
    endIndex: expanded.endIndex,
  };
}
