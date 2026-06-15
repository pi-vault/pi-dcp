import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";

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
  let result = pruneToolOutputs(state, messages);
  result = pruneToolErrors(state, result);
  return result;
}
