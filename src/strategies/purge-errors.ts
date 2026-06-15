/**
 * Staleness predicate for error tool results.
 *
 * Used by the strategy runner to identify error outputs
 * old enough to be pruned from context.
 */

export function isStaleError(
  entry: {
    status: "pending" | "running" | "completed" | "error" | undefined;
    turn: number;
  },
  currentTurn: number,
  turnThreshold: number,
): boolean {
  if (entry.status !== "error") return false;
  return currentTurn - entry.turn >= turnThreshold;
}
