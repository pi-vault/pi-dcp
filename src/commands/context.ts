import type { ContextUsage, SessionState } from "../state/types.ts";
import { readDcpContextFacts } from "../reporting.ts";
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
  const facts = readDcpContextFacts(state, contextUsage);
  const usage = facts.usage;
  let tokens: string;
  if (usage && usage.tokens != null && usage.percent != null) {
    tokens = `${formatDcpTokens(usage.tokens, true)} / ${formatDcpTokens(usage.contextWindow)} (${usage.percent.toFixed(1)}%)`;
  } else if (usage) {
    tokens = `Unavailable (context window: ${formatDcpTokens(usage.contextWindow)})`;
  } else {
    tokens = "Unavailable";
  }

  const rows: Array<[string, string]> = [
    ["Tokens", tokens],
    ["Currently pruned tool calls", String(facts.prunedToolCalls)],
    ["Active compression blocks", String(facts.activeBlocks)],
    ["Total blocks", String(facts.totalBlocks)],
    ["Tool cache entries", String(facts.toolCacheEntries)],
    ["Current user turn", String(facts.currentUserTurn)],
    ["Manual mode", facts.manualMode || "off"],
  ];

  if (modelDisabled) {
    rows.push(["DCP status", "disabled for the current model"]);
  }

  return renderRows("DCP Context Usage:", rows);
}
