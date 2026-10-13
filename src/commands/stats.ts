import type { SessionState } from "../state/types.ts";
import { formatDcpTokens } from "../tui/formatters.ts";

function renderRows(title: string, rows: Array<[string, string]>): string {
  const width = Math.max(...rows.map(([label]) => label.length + 1));
  const lines = rows.map(([label, value]) => `  ${`${label}:`.padEnd(width)} ${value}`);
  return [title, ...lines].join("\n");
}

export function statsCommand(state: SessionState): string {
  return renderRows("DCP Session Statistics:", [
    ["Tools pruned this session", String(state.stats.toolsPruned)],
    ["Cumulative tokens saved by pruning", formatDcpTokens(state.stats.totalPruneTokens, true)],
    ["Messages compressed this session", String(state.stats.messagesCompressed)],
    ["Prune token counter", formatDcpTokens(state.stats.pruneTokenCounter, true)],
  ]);
}
