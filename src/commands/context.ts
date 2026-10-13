import type { ContextUsage, SessionState } from "../state/types.ts";
import { formatDcpTokens } from "../tui/formatters.ts";

function renderRows(title: string, rows: Array<[string, string]>): string {
  const width = Math.max(...rows.map(([label]) => label.length + 1));
  const lines = rows.map(([label, value]) => `  ${`${label}:`.padEnd(width)} ${value}`);
  return [title, ...lines].join("\n");
}

export function contextCommand(
  state: SessionState,
  contextUsage: ContextUsage | undefined,
  modelDisabled = false,
): string {
  let tokens: string;
  if (contextUsage && contextUsage.tokens != null && contextUsage.percent != null) {
    tokens = `${formatDcpTokens(contextUsage.tokens, true)} / ${formatDcpTokens(contextUsage.contextWindow)} (${contextUsage.percent.toFixed(1)}%)`;
  } else if (contextUsage) {
    tokens = `Unavailable (context window: ${formatDcpTokens(contextUsage.contextWindow)})`;
  } else {
    tokens = "Unavailable";
  }

  const rows: Array<[string, string]> = [
    ["Tokens", tokens],
    ["Currently pruned tool calls", String(state.prune.tools.size)],
    ["Active compression blocks", String(state.prune.messages.activeBlockIds.size)],
    ["Total blocks", String(state.prune.messages.blocksById.size)],
    ["Tool cache entries", String(state.toolParameters.size)],
    ["Current user turn", String(state.currentUserTurn)],
    ["Manual mode", state.manualMode || "off"],
  ];

  if (modelDisabled) {
    rows.push(["DCP status", "disabled for the current model"]);
  }

  return renderRows("DCP Context Usage:", rows);
}
