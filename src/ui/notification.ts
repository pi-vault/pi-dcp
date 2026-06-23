export interface NotificationStats {
  tokensSaved: number;
  pruned: number;
}

/**
 * Format token count for display (e.g. 12400 -> "~12.4K").
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `~${(tokens / 1000).toFixed(1)}K`;
  }
  return `~${tokens}`;
}

/**
 * Build minimal notification message.
 * Returns undefined if nothing to report.
 */
export function buildMinimalMessage(
  stats: NotificationStats,
): string | undefined {
  if (stats.tokensSaved === 0 && stats.pruned === 0) return undefined;
  return `DCP: ${formatTokens(stats.tokensSaved)} tokens saved (${stats.pruned} items pruned)`;
}

/**
 * Build detailed notification message with pruned tool names.
 * Deduplicates tool names. Falls back to minimal when list is empty.
 */
export function buildDetailedMessage(
  stats: NotificationStats,
  prunedTools: string[],
): string | undefined {
  const base = buildMinimalMessage(stats);
  if (!base) return undefined;
  const unique = [...new Set(prunedTools)];
  if (unique.length === 0) return base;
  return `${base}\nPruned: ${unique.join(", ")}`;
}
