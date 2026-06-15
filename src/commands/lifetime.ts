import { loadAllSessionStats } from "../state/persistence.ts";

export function lifetimeCommand(sessionsParentDir: string): string {
  const stats = loadAllSessionStats(sessionsParentDir);

  return [
    "DCP Lifetime Statistics:",
    `  Sessions tracked: ${stats.sessionCount} sessions`,
    `  Total tokens saved: ${stats.totalTokensSaved}`,
    `  Total tools pruned: ${stats.totalToolsPruned}`,
    `  Total messages compressed: ${stats.totalMessagesCompressed}`,
  ].join("\n");
}
