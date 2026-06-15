import type { SessionState } from "../state/types.ts";

export function statsCommand(state: SessionState): string {
  return [
    "DCP Session Statistics:",
    `  Tools pruned: ${state.stats.toolsPruned}`,
    `  Total tokens saved (pruning): ${state.stats.totalPruneTokens}`,
    `  Messages compressed: ${state.stats.messagesCompressed}`,
    `  Prune token counter: ${state.stats.pruneTokenCounter}`,
  ].join("\n");
}
