import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";
import { PURGED_ERROR_INPUT } from "../strategies/purge-errors.ts";

/**
 * Filter out compressed message ranges and inject summaries.
 * Messages covered by active blocks are removed and replaced with
 * a synthetic user message containing the summary at the anchor position.
 */
export function filterCompressedRanges(
  state: SessionState,
  messages: AgentMessage[],
): AgentMessage[] {
  if (state.prune.messages.activeBlockIds.size === 0) return messages;

  const result: AgentMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    // Check if there's a summary to inject at this anchor point
    const blockId = state.prune.messages.activeByAnchorIndex.get(i);
    if (blockId !== undefined) {
      const block = state.prune.messages.blocksById.get(blockId);
      if (block?.active && block.summary) {
        result.push({
          role: "user",
          content: [{ type: "text", text: block.summary }],
          timestamp: Date.now(),
        } as AgentMessage);
      }
    }

    // Skip messages that are covered by active blocks
    const entry = state.prune.messages.byMessageIndex.get(i);
    if (entry && entry.activeBlockIds.length > 0) {
      continue;
    }

    result.push(messages[i]);
  }

  // Safety net: remove orphaned toolResult messages
  return removeOrphanedToolResults(result);
}

/**
 * Remove toolResult messages whose toolCallId has no matching toolCall
 * in an assistant message in the output array.
 *
 * This intentionally does not remove assistant toolCalls whose result is
 * absent: Pi normalizes those unmatched calls with an error result.
 */
function removeOrphanedToolResults(messages: AgentMessage[]): AgentMessage[] {
  // Collect all toolCall IDs from assistant messages
  const toolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (typeof part !== "object" || part === null) continue;
      const p = part as unknown as Record<string, unknown>;
      if (p.type === "toolCall" && typeof p.id === "string") {
        toolCallIds.add(p.id as string);
      }
    }
  }

  // Filter out toolResult messages without a matching toolCall
  return messages.filter((msg) => {
    if (msg.role !== "toolResult") return true;
    return toolCallIds.has((msg as unknown as { toolCallId: string }).toolCallId);
  });
}

const PRUNED_OUTPUT_TEXT =
  "[Output removed to save context - information superseded or no longer needed]";

/**
 * Replace outputs of pruned tool results with placeholder text.
 * Returns a new array (does not mutate input).
 */
export function pruneToolOutputs(
  state: SessionState,
  messages: AgentMessage[],
): AgentMessage[] {
  if (state.prune.tools.size === 0) return messages;

  return messages.map((msg) => {
    if (msg.role !== "toolResult") return msg;
    if (!state.prune.tools.has(msg.toolCallId)) return msg;
    if (msg.isError) return msg;

    return {
      ...msg,
      content: [{ type: "text" as const, text: PRUNED_OUTPUT_TEXT }],
    };
  });
}

/** Replace arguments of pruned failed tool calls while preserving diagnostics. */
export function pruneFailedInputs(
  state: SessionState,
  messages: AgentMessage[],
): AgentMessage[] {
  if (state.prune.tools.size === 0) return messages;

  const failedIds = new Set(
    [...state.prune.tools.keys()].filter(
      (id) => state.toolParameters.get(id)?.status === "error",
    ),
  );
  if (failedIds.size === 0) return messages;

  return messages.map((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      return message;
    }

    let changed = false;
    const content = message.content.map((part) => {
      if (part.type !== "toolCall" || !failedIds.has(part.id)) return part;
      changed = true;
      return { ...part, arguments: { __purged: PURGED_ERROR_INPUT } };
    });

    return changed ? { ...message, content } : message;
  });
}

/**
 * Apply all pruning passes to a message array.
 * Returns a new array.
 */
export function applyPruning(
  state: SessionState,
  messages: AgentMessage[],
): AgentMessage[] {
  let result = filterCompressedRanges(state, messages);
  result = pruneToolOutputs(state, result);
  result = pruneFailedInputs(state, result);
  return result;
}
