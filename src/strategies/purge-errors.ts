import { countTokens } from "../utils/tokens.ts";

/**
 * Staleness predicate for error tool results.
 *
 * Used by the strategy runner to identify error outputs
 * old enough to be pruned from context.
 */

export const PURGED_ERROR_INPUT = "input removed due to failed tool call";

export function estimatePurgedInputSavings(parameters: unknown): number {
  const original = JSON.stringify(parameters);
  const replacement = JSON.stringify({ __purged: PURGED_ERROR_INPUT });
  if (original === undefined || replacement === undefined) return 0;
  return Math.max(0, countTokens(original) - countTokens(replacement));
}

export function isStaleError(
  entry: {
    status: "pending" | "running" | "completed" | "error" | undefined;
    userTurn: number;
  },
  currentUserTurn: number,
  turnThreshold: number,
): boolean {
  if (entry.status !== "error") return false;
  return currentUserTurn - entry.userTurn >= turnThreshold;
}
