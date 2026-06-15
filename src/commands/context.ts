import type { ContextUsage, SessionState } from "../state/types.ts";

export function contextCommand(
  state: SessionState,
  contextUsage: ContextUsage | undefined,
): string {
  const lines: string[] = ["DCP Context Usage:"];

  if (contextUsage && contextUsage.tokens != null && contextUsage.percent != null) {
    lines.push(`  Tokens: ${contextUsage.tokens} / ${contextUsage.contextWindow} (${contextUsage.percent.toFixed(1)}%)`);
  } else if (contextUsage) {
    lines.push(`  Tokens: unavailable (context window: ${contextUsage.contextWindow})`);
  } else {
    lines.push("  Tokens: unavailable");
  }

  lines.push(`  Pruned tool outputs: ${state.prune.tools.size}`);
  lines.push(`  Active compression blocks: ${state.prune.messages.activeBlockIds.size}`);
  lines.push(`  Total blocks: ${state.prune.messages.blocksById.size}`);
  lines.push(`  Tool cache entries: ${state.toolParameters.size}`);
  lines.push(`  Current turn: ${state.currentTurn}`);
  lines.push(`  Manual mode: ${state.manualMode || "off"}`);

  return lines.join("\n");
}
