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

  rebuildCompressionState(
    state,
    new Set(
      [...messagesState.blocksById.values()]
        .filter((block) => ownerIds.has(block.compressToolCallId))
        .map((block) => block.blockId),
    ),
  );
}
