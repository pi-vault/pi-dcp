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
