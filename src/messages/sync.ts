import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";
import { rebuildCompressionState } from "../compress/state.ts";

/**
 * Reconcile compression blocks with their owning assistant tool calls.
 */
export function syncCompressionBlocks(
  state: SessionState,
  messages: AgentMessage[],
): void {
  const messagesState = state.prune.messages;
  if (messagesState.blocksById.size === 0) return;

  const keyToIndex = new Map<string, number>();
  for (const [index, ref] of state.messageIds.byIndex) {
    const key = state.messageIds.byRef.get(ref);
    if (key) keyToIndex.set(key, index);
  }

  state.prune.messages.byMessageIndex.clear();
  for (const [blockId, block] of messagesState.blocksById) {
    const startIndex = keyToIndex.get(block.startKey);
    const endIndex = keyToIndex.get(block.endKey);
    const anchorIndex = keyToIndex.get(block.anchorKey);
    if (
      startIndex === undefined ||
      endIndex === undefined ||
      anchorIndex === undefined ||
      startIndex > endIndex ||
      !state.toolParameters.has(block.compressToolCallId)
    ) {
      messagesState.blocksById.delete(blockId);
      continue;
    }

    block.startIndex = startIndex;
    block.endIndex = endIndex;
    block.anchorIndex = anchorIndex;
    block.parentBlockIds = [];
    block.effectiveMessageIndices = Array.from(
      { length: endIndex - startIndex + 1 },
      (_, offset) => startIndex + offset,
    );
    block.effectiveToolIds = collectToolIds(messages, block.effectiveMessageIndices);
  }

  const blockIds = new Set(messagesState.blocksById.keys());
  for (const block of messagesState.blocksById.values()) {
    block.consumedBlockIds = block.consumedBlockIds.filter((id) => blockIds.has(id));
    for (const childId of block.consumedBlockIds) {
      const child = messagesState.blocksById.get(childId);
      if (child && !child.parentBlockIds.includes(block.blockId)) {
        child.parentBlockIds.push(block.blockId);
      }
    }
    const coveredIndices = new Set(
      block.consumedBlockIds.flatMap(
        (id) => messagesState.blocksById.get(id)?.effectiveMessageIndices ?? [],
      ),
    );
    block.directMessageIndices = block.effectiveMessageIndices.filter(
      (index) => !coveredIndices.has(index),
    );
    block.directToolIds = collectToolIds(messages, block.directMessageIndices);
  }

  rebuildCompressionState(state, new Set(messagesState.blocksById.keys()));
}

function collectToolIds(messages: AgentMessage[], indices: number[]): string[] {
  const toolIds = new Set<string>();
  for (const index of indices) {
    const message = messages[index];
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "toolCall" && typeof part.id === "string") toolIds.add(part.id);
    }
  }
  return [...toolIds].sort();
}
