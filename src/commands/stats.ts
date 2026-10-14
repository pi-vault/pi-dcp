import type { SessionState } from "../state/types.ts";
import { readDcpSessionFacts } from "../reporting.ts";
import { formatDcpTokens } from "../tui/formatters.ts";

function renderRows(title: string, rows: Array<[string, string]>): string {
  const width = Math.max(...rows.map(([label]) => label.length + 1));
  const lines = rows.map(([label, value]) => `  ${`${label}:`.padEnd(width)} ${value}`);
  return [title, ...lines].join("\n");
}

export function statsCommand(state: SessionState): string {
  const stats = readDcpSessionFacts(state);
  return renderRows("DCP Session Statistics:", [
    ["Tools pruned this session", String(stats.toolsPruned)],
    ["Cumulative tokens saved by pruning", formatDcpTokens(stats.totalPruneTokens, true)],
    ["Messages compressed this session", String(stats.messagesCompressed)],
    ["Prune token counter", formatDcpTokens(stats.pruneTokenCounter, true)],
  ]);
}
