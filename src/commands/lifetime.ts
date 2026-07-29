import { loadAllSessionStats } from "../state/persistence.ts";

export async function lifetimeCommand(sessionsParentDir: string): Promise<string> {
  const stats = await loadAllSessionStats(sessionsParentDir);

  return [
    "DCP Lifetime Statistics:",
    `  Sessions tracked: ${stats.sessionCount} sessions`,
    `  Total tokens saved: ${stats.totalTokensSaved}`,
    `  Total tools pruned: ${stats.totalToolsPruned}`,
    `  Total messages compressed: ${stats.totalMessagesCompressed}`,
  ].join("\n");
}
