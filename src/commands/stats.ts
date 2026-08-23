import type { SessionState } from "../state/types.ts";

export function statsCommand(state: SessionState): string {
  return [
    "DCP Session Statistics:",
    `  Tools pruned this session: ${state.stats.toolsPruned}`,
    `  Cumulative tokens saved by pruning: ${state.stats.totalPruneTokens}`,
    `  Messages compressed this session: ${state.stats.messagesCompressed}`,
    `  Prune token counter: ${state.stats.pruneTokenCounter}`,
  ].join("\n");
}
