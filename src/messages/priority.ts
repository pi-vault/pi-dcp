import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";
import { countMessageTokens } from "../utils/tokens.ts";

export interface MessagePriorityEntry {
  index: number;
  ref: string;
  priority: number;
  tokens: number;
}

export type PriorityMap = Map<number, MessagePriorityEntry>;

/**
 * Build a priority map for message-mode compression.
 * Priority 1 = highest (compress first), 5 = lowest (keep).
 *
 * Ranking factors:
 * - Position: earlier messages get higher priority (compress first)
 * - Token count: larger messages get higher priority (compress first)
 * - Role: tool results are resolved content, slightly prioritized for compression
 */
export function buildPriorityMap(state: SessionState, messages: AgentMessage[]): PriorityMap {
  if (messages.length === 0) return new Map();

  const entries: Array<{ index: number; score: number; tokens: number }> = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const ref = state.messageIds.byIndex.get(i);
    if (!ref) continue;

    // Skip messages already covered by active blocks
    const pruneEntry = state.prune.messages.byMessageIndex.get(i);
    if (pruneEntry && pruneEntry.activeBlockIds.length > 0) continue;

    const tokens = countMessageTokens(msg);

    // Score: higher = compress first
    // Position weight: earlier messages score higher
    const positionScore = (messages.length - i) / messages.length;
    // Token weight: larger messages score higher
    const tokenScore = Math.min(tokens / 500, 1);
    // Role weight
    const roleWeight = msg.role === "toolResult" ? 0.2 : 0;

    const score = positionScore * 0.6 + tokenScore * 0.3 + roleWeight;
    entries.push({ index: i, score, tokens });
  }

  // Sort by score descending (highest score = highest priority)
  entries.sort((a, b) => b.score - a.score);

  // Assign priorities 1-5 based on quintiles
  const map: PriorityMap = new Map();
  const quintileSize = Math.max(1, Math.ceil(entries.length / 5));

  for (let rank = 0; rank < entries.length; rank++) {
    const entry = entries[rank];
    const priority = Math.min(5, Math.floor(rank / quintileSize) + 1);
    const ref = state.messageIds.byIndex.get(entry.index)!;

    map.set(entry.index, {
      index: entry.index,
      ref,
      priority,
      tokens: entry.tokens,
    });
  }

  return map;
}
