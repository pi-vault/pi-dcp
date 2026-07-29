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
  const ownerIds = collectOwnerIds(messages);

  // Unit-level callers without assigned refs retain the legacy ownership-only sync.
  if (state.messageIds.byIndex.size === 0) {
    rebuildCompressionState(
      state,
      new Set(
        [...messagesState.blocksById.values()]
          .filter((block) => ownerIds.has(block.compressToolCallId))
          .map((block) => block.blockId),
      ),
    );
    return;
  }

  const keyToIndex = new Map<string, number>();
  for (const [index, ref] of state.messageIds.byIndex) {
    const key = state.messageIds.byRef.get(ref);
    if (key) keyToIndex.set(key, index);
  }

  const hasOwner = (toolCallId: string) =>
    state.toolParameters.size > 0
      ? state.toolParameters.has(toolCallId)
      : ownerIds.has(toolCallId);

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
      !hasOwner(block.compressToolCallId)
    ) {
      messagesState.blocksById.delete(blockId);
      continue;
    }

    block.startIndex = startIndex;
    block.endIndex = endIndex;
    block.anchorIndex = anchorIndex;
    block.parentBlockIds = [];
    block.directMessageIndices = Array.from(
      { length: endIndex - startIndex + 1 },
      (_, offset) => startIndex + offset,
    );
    block.effectiveMessageIndices = [...block.directMessageIndices];
    block.directToolIds = collectToolIds(messages, startIndex, endIndex);
    block.effectiveToolIds = [...block.directToolIds];
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
  }

  rebuildCompressionState(
    state,
    new Set(
      [...messagesState.blocksById.values()]
        .filter((block) => hasOwner(block.compressToolCallId))
        .map((block) => block.blockId),
    ),
  );
}

function collectOwnerIds(messages: AgentMessage[]): Set<string> {
  const ownerIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "toolCall" && typeof part.id === "string") ownerIds.add(part.id);
    }
  }
  return ownerIds;
}

function collectToolIds(messages: AgentMessage[], start: number, end: number): string[] {
  const toolIds = new Set<string>();
  for (let index = start; index <= end; index++) {
    const message = messages[index];
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "toolCall" && typeof part.id === "string") toolIds.add(part.id);
    }
  }
  return [...toolIds].sort();
}
