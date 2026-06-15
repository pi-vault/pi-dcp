import { BASE_PROTECTED_TOOLS, type DcpConfig } from "../config.ts";
import type { SessionState } from "../state/types.ts";
import {
  isToolNameProtected,
  getFilePathsFromParameters,
  isFilePathProtected,
} from "./protected-patterns.ts";
import { createToolSignature } from "./deduplication.ts";
import { isStaleError } from "./purge-errors.ts";

export interface StrategyResult {
  pruned: number;
  tokensSaved: number;
}

/**
 * Run all enabled pruning strategies against the current tool cache.
 * Owns: guard checks, protected-tools resolution, eligibility filtering, stat bookkeeping.
 */
export function runStrategies(
  state: SessionState,
  config: DcpConfig,
): StrategyResult {
  if (state.toolIdList.length === 0) {
    return { pruned: 0, tokensSaved: 0 };
  }
  if (state.manualMode === "active" && !config.manualMode.automaticStrategies) {
    return { pruned: 0, tokensSaved: 0 };
  }

  let pruned = 0;
  let tokensSaved = 0;

  // --- Deduplication ---
  if (config.strategies.deduplication.enabled) {
    const protectedTools = [
      ...BASE_PROTECTED_TOOLS,
      ...config.strategies.deduplication.protectedTools,
    ];

    const unpruned = state.toolIdList.filter(
      (id) => !state.prune.tools.has(id),
    );

    // Group by signature
    const groups = new Map<string, string[]>();
    for (const callId of unpruned) {
      const entry = state.toolParameters.get(callId);
      if (!entry) continue;
      if (isToolNameProtected(entry.tool, protectedTools)) continue;

      const filePaths = getFilePathsFromParameters(
        entry.tool,
        entry.parameters as Record<string, unknown>,
      );
      if (isFilePathProtected(filePaths, config.protectedFilePatterns))
        continue;

      const sig = createToolSignature(entry.tool, entry.parameters);
      const group = groups.get(sig) ?? [];
      group.push(callId);
      groups.set(sig, group);
    }

    // Prune all but last in each group
    for (const [, callIds] of groups) {
      if (callIds.length <= 1) continue;
      for (let i = 0; i < callIds.length - 1; i++) {
        const callId = callIds[i];
        const entry = state.toolParameters.get(callId);
        const tokens = entry?.tokenCount ?? 0;
        state.prune.tools.set(callId, tokens);
        pruned++;
        tokensSaved += tokens;
      }
    }
  }

  // --- Purge Errors ---
  if (config.strategies.purgeErrors.enabled) {
    const protectedTools = [
      ...BASE_PROTECTED_TOOLS,
      ...config.strategies.purgeErrors.protectedTools,
    ];
    const turnThreshold = config.strategies.purgeErrors.turns;
    const unpruned = state.toolIdList.filter(
      (id) => !state.prune.tools.has(id),
    );

    for (const callId of unpruned) {
      const entry = state.toolParameters.get(callId);
      if (!entry) continue;
      if (isToolNameProtected(entry.tool, protectedTools)) continue;
      if (!isStaleError(entry, state.currentTurn, turnThreshold)) continue;

      const filePaths = getFilePathsFromParameters(
        entry.tool,
        entry.parameters as Record<string, unknown>,
      );
      if (isFilePathProtected(filePaths, config.protectedFilePatterns))
        continue;

      const tokens = entry.tokenCount ?? 0;
      state.prune.tools.set(callId, tokens);
      pruned++;
      tokensSaved += tokens;
    }
  }

  // Update stats once
  state.stats.totalPruneTokens += tokensSaved;
  state.stats.toolsPruned += pruned;

  return { pruned, tokensSaved };
}

/**
 * Sweep variant: prune all non-protected completed tool outputs.
 * Used by the dcp:sweep command.
 */
export function sweepAll(
  state: SessionState,
  config: DcpConfig,
): StrategyResult {
  const protectedTools = new Set([
    ...BASE_PROTECTED_TOOLS,
    ...config.compress.protectedTools,
  ]);

  let pruned = 0;
  let tokensSaved = 0;

  for (const [toolCallId, entry] of state.toolParameters) {
    if (state.prune.tools.has(toolCallId)) continue;
    if (protectedTools.has(entry.tool)) continue;
    if (entry.status !== "completed") continue;

    const tokens = entry.tokenCount ?? 0;
    state.prune.tools.set(toolCallId, tokens);
    pruned++;
    tokensSaved += tokens;
  }

  state.stats.toolsPruned += pruned;
  state.stats.totalPruneTokens += tokensSaved;
  state.stats.pruneTokenCounter += tokensSaved;

  return { pruned, tokensSaved };
}
