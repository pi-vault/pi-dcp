import { BASE_PROTECTED_TOOLS, type DcpConfig } from "../config.ts";
import type { SessionState } from "../state/types.ts";
import {
  isToolNameProtected,
  getFilePathsFromParameters,
  isFilePathProtected,
} from "./protected-patterns.ts";

export interface PurgeErrorsResult {
  pruned: number;
  tokensSaved: number;
}

export function purgeErrors(
  state: SessionState,
  config: DcpConfig,
): PurgeErrorsResult {
  if (!config.strategies.purgeErrors.enabled) {
    return { pruned: 0, tokensSaved: 0 };
  }

  if (state.manualMode === "active" && !config.manualMode.automaticStrategies) {
    return { pruned: 0, tokensSaved: 0 };
  }

  if (state.toolIdList.length === 0) {
    return { pruned: 0, tokensSaved: 0 };
  }

  const protectedTools = [
    ...BASE_PROTECTED_TOOLS,
    ...config.strategies.purgeErrors.protectedTools,
  ];

  const turnThreshold = config.strategies.purgeErrors.turns;
  const unpruned = state.toolIdList.filter((id) => !state.prune.tools.has(id));

  let pruned = 0;
  let tokensSaved = 0;

  for (const callId of unpruned) {
    const entry = state.toolParameters.get(callId);
    if (!entry) continue;
    if (entry.status !== "error") continue;

    if (isToolNameProtected(entry.tool, protectedTools)) continue;

    const filePaths = getFilePathsFromParameters(
      entry.tool,
      entry.parameters as Record<string, unknown>,
    );
    if (isFilePathProtected(filePaths, config.protectedFilePatterns)) continue;

    const turnAge = state.currentTurn - entry.turn;
    if (turnAge < turnThreshold) continue;

    const tokens = entry.tokenCount ?? 0;
    state.prune.tools.set(callId, tokens);
    pruned++;
    tokensSaved += tokens;
  }

  state.stats.totalPruneTokens += tokensSaved;
  state.stats.toolsPruned += pruned;

  return { pruned, tokensSaved };
}
