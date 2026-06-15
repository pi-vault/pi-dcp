import type { SessionState } from "../state/types.ts";

/**
 * Reconcile compression block state with current message count.
 * Blocks whose compressMessageIndex exceeds the message array length
 * are deactivated (the compress tool call was compacted away).
 */
export function syncCompressionBlocks(
  state: SessionState,
  messageCount: number,
): void {
  const messagesState = state.prune.messages;
  if (messagesState.blocksById.size === 0) return;

  const now = Date.now();

  // Sort blocks by creation order for deterministic processing
  const blocks = Array.from(messagesState.blocksById.values()).sort(
    (a, b) => a.createdAt - b.createdAt || a.blockId - b.blockId,
  );

  messagesState.activeBlockIds.clear();
  messagesState.activeByAnchorIndex.clear();

  for (const block of blocks) {
    // If the compress tool call message no longer exists, deactivate
    if (block.compressMessageIndex >= messageCount) {
      block.active = false;
      block.deactivatedAt = now;
      continue;
    }

    if (block.deactivatedByUser) {
      block.active = false;
      if (block.deactivatedAt === undefined) {
        block.deactivatedAt = now;
      }
      continue;
    }

    // Reactivate if the compress message still exists
    block.active = true;
    block.deactivatedAt = undefined;
    block.deactivatedByBlockId = undefined;
    messagesState.activeBlockIds.add(block.blockId);
    messagesState.activeByAnchorIndex.set(block.anchorIndex, block.blockId);
  }

  // Update per-message entries
  for (const entry of messagesState.byMessageIndex.values()) {
    entry.activeBlockIds = entry.blockIds.filter((id) =>
      messagesState.activeBlockIds.has(id),
    );
  }
}
