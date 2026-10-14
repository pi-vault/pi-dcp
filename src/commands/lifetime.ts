import { readDcpLifetimeFacts } from "../reporting.ts";
import { loadAllSessionStats } from "../state/persistence.ts";
import { formatDcpTokens } from "../tui/formatters.ts";

function renderRows(title: string, rows: Array<[string, string]>): string {
  const width = Math.max(...rows.map(([label]) => label.length + 1));
  const lines = rows.map(([label, value]) => `  ${`${label}:`.padEnd(width)} ${value}`);
  return [title, ...lines].join("\n");
}

export async function lifetimeCommand(sessionsParentDir: string): Promise<string> {
  const stats = readDcpLifetimeFacts(await loadAllSessionStats(sessionsParentDir));

  return renderRows("DCP Lifetime Statistics:", [
    [
      "Sessions tracked",
      `${stats.sessionCount} ${stats.sessionCount === 1 ? "session" : "sessions"}`,
    ],
    ["Total tokens saved", formatDcpTokens(stats.totalTokensSaved, true)],
    ["Total tools pruned", String(stats.totalToolsPruned)],
    ["Total messages compressed", String(stats.totalMessagesCompressed)],
  ]);
}
