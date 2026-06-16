import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";
import { parseBoundaryId } from "../utils/message-ids.ts";

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
    return state.messageIds.byRef.get(boundaryId);
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
 * If the range includes an assistant message with toolCall but not its toolResult,
 * expand endIndex. If it includes a toolResult but not its assistant, expand startIndex.
 * Repeats until stable.
 */
export function expandRangeForToolChains(
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
 */
export function resolveSelection(
  messages: AgentMessage[],
  startIndex: number,
  endIndex: number,
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

  const messageIndices: number[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    messageIndices.push(i);
  }

  return { messageIndices, startIndex, endIndex };
}
