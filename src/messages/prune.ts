import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";

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

  return result;
}

const PRUNED_OUTPUT_TEXT =
  "[Output removed to save context - information superseded or no longer needed]";
const PRUNED_ERROR_INPUT_TEXT = "[input removed due to failed tool call]";

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

/**
 * Replace content of pruned error tool results with placeholder text.
 * Returns a new array (does not mutate input).
 */
export function pruneToolErrors(
  state: SessionState,
  messages: AgentMessage[],
): AgentMessage[] {
  if (state.prune.tools.size === 0) return messages;

  return messages.map((msg) => {
    if (msg.role !== "toolResult") return msg;
    if (!state.prune.tools.has(msg.toolCallId)) return msg;
    if (!msg.isError) return msg;

    return {
      ...msg,
      content: [{ type: "text" as const, text: PRUNED_ERROR_INPUT_TEXT }],
    };
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
  result = pruneToolErrors(state, result);
  return result;
}
