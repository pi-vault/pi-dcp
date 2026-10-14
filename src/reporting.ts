import type { LifetimeStats } from "./state/persistence.ts";
import type { ContextUsage, SessionState, SessionStats } from "./state/types.ts";

/**
 * Read-only context facts shared by the text and dashboard adapters.
 *
 * Every read copies the current nested values. It never retains live maps, sets,
 * or state objects, so restoration that replaces nested state is picked up on
 * the next call.
 */
export interface DcpContextFacts {
  readonly usage: Readonly<ContextUsage> | undefined;
  readonly prunedToolCalls: number;
  readonly activeBlocks: number;
  readonly totalBlocks: number;
  readonly toolCacheEntries: number;
  readonly currentUserTurn: number;
  readonly manualMode: SessionState["manualMode"];
}

/** Copy current context counts and the supplied usage snapshot. */
export function readDcpContextFacts(
  state: SessionState,
  usage: ContextUsage | undefined,
): DcpContextFacts {
  return {
    usage: usage === undefined ? undefined : { ...usage },
    prunedToolCalls: state.prune.tools.size,
    activeBlocks: state.prune.messages.activeBlockIds.size,
    totalBlocks: state.prune.messages.blocksById.size,
    toolCacheEntries: state.toolParameters.size,
    currentUserTurn: state.currentUserTurn,
    manualMode: state.manualMode,
  };
}

/** Copy current session statistics without retaining the state object. */
export function readDcpSessionFacts(state: SessionState): Readonly<SessionStats> {
  return {
    pruneTokenCounter: state.stats.pruneTokenCounter,
    totalPruneTokens: state.stats.totalPruneTokens,
    toolsPruned: state.stats.toolsPruned,
    messagesCompressed: state.stats.messagesCompressed,
  };
}

/** Copy loaded lifetime totals without retaining the persistence result. */
export function readDcpLifetimeFacts(stats: LifetimeStats): Readonly<LifetimeStats> {
  return {
    totalTokensSaved: stats.totalTokensSaved,
    totalToolsPruned: stats.totalToolsPruned,
    totalMessagesCompressed: stats.totalMessagesCompressed,
    sessionCount: stats.sessionCount,
  };
}
