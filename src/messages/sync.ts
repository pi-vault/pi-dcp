import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";

/**
 * Reconcile compression blocks with their owning assistant tool calls.
 */
export function syncCompressionBlocks(
  state: SessionState,
  messages: AgentMessage[],
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
  const ownerIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (typeof part !== "object" || part === null) continue;
      const value = part as unknown as Record<string, unknown>;
      if (value.type === "toolCall" && typeof value.id === "string") {
        ownerIds.add(value.id);
      }
    }
  }

  for (const block of blocks) {
    if (!ownerIds.has(block.compressToolCallId)) {
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
