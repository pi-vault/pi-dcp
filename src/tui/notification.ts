import { flattenDcpLabel, formatDcpTokens } from "./formatters.ts";

export interface NotificationStats {
  tokensSaved: number;
  pruned: number;
}

export interface CompressNotificationParams {
  compressedTokens: number;
  summaryTokens: number;
  messagesCompressed: number;
  topic: string;
  summary?: string;
  showCompression?: boolean;
}

/**
 * Build minimal notification message.
 * Returns undefined if nothing to report.
 */
export function buildMinimalMessage(stats: NotificationStats): string | undefined {
  if (stats.tokensSaved === 0 && stats.pruned === 0) return undefined;
  const tokenNoun = stats.tokensSaved === 1 ? "token" : "tokens";
  const outputNoun = stats.pruned === 1 ? "output" : "outputs";
  return `DCP · saved ${formatDcpTokens(stats.tokensSaved, true)} ${tokenNoun} · pruned ${stats.pruned} ${outputNoun}`;
}

/**
 * Build detailed notification message with pruned tool names.
 * Normalizes and deduplicates labels, preserving first-occurrence order.
 * Falls back to minimal when the normalized list is empty.
 */
export function buildDetailedMessage(
  stats: NotificationStats,
  prunedTools: string[],
): string | undefined {
  const base = buildMinimalMessage(stats);
  if (!base) return undefined;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of prunedTools) {
    const label = flattenDcpLabel(raw);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    unique.push(label);
  }
  if (unique.length === 0) return base;
  return `${base}\nPruned: ${unique.join(", ")}`;
}

/**
 * Build minimal compression notification.
 * Format: "DCP · compressed ~12.4k tokens · summary ~2.1k · 5 messages"
 */
export function buildCompressNotificationMinimal(params: CompressNotificationParams): string {
  const tokenNoun = params.compressedTokens === 1 ? "token" : "tokens";
  const messageNoun = params.messagesCompressed === 1 ? "message" : "messages";
  return `DCP · compressed ${formatDcpTokens(params.compressedTokens, true)} ${tokenNoun} · summary ${formatDcpTokens(params.summaryTokens, true)} · ${params.messagesCompressed} ${messageNoun}`;
}

/**
 * Build detailed compression notification with topic and optional summary.
 * Summary text is only included when showCompression is true.
 */
export function buildCompressNotificationDetailed(params: CompressNotificationParams): string {
  let msg = buildCompressNotificationMinimal(params);
  msg += `\nTopic: ${flattenDcpLabel(params.topic)}`;
  if (params.showCompression && params.summary) {
    msg += `\nSummary (${formatDcpTokens(params.summaryTokens, true)}): ${params.summary}`;
  }
  return msg;
}
