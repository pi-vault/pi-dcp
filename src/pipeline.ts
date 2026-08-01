import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState, ContextUsage } from "./state/types.ts";
import type { DcpConfig } from "./config.ts";
import type { RuntimePrompts } from "./prompts/store.ts";
import { syncCompressionBlocks } from "./messages/sync.ts";
import { stripHallucinations } from "./messages/strip.ts";
import { syncToolCache, buildToolIdList } from "./state/tool-cache.ts";
import { runStrategies, type StrategyResult } from "./strategies/runner.ts";
import { assignMessageRefs, injectCompressNudges, injectMessageIds } from "./messages/inject.ts";
import { buildPriorityMap, type PriorityMap } from "./messages/priority.ts";
import { applyPruning } from "./messages/prune.ts";

export interface PipelineResult {
  messages: AgentMessage[];
  strategyResult: StrategyResult;
}

/**
 * Run the full DCP context processing pipeline.
 * Pure function of (state, config, messages, usage) → transformed messages.
 * State is mutated (tool cache, pruning marks, stats) as a side effect.
 */
export function runPipeline(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  contextUsage: ContextUsage | undefined,
  runtimePrompts?: RuntimePrompts,
): PipelineResult {
  // Step 0: Strip stale tags, then rebuild stable refs before state rehydration.
  let result = stripHallucinations(messages);

  assignMessageRefs(state, result);
  syncToolCache(state, result);
  buildToolIdList(state, result);
  state.prune.tools = new Map(
    [...state.prune.tools].filter(([toolCallId]) => state.toolParameters.has(toolCallId)),
  );
  const currentKeys = new Set(state.messageIds.byIndex.values());
  const rawKeys = new Set(
    [...currentKeys]
      .map((ref) => state.messageIds.byRef.get(ref))
      .filter((key): key is string => key !== undefined),
  );
  state.messageIds.byRawId = new Map(
    [...state.messageIds.byRawId].filter(([key]) => rawKeys.has(key)),
  );
  state.messageIds.byRef = new Map([...state.messageIds.byRawId].map(([key, ref]) => [ref, key]));
  for (const anchors of Object.values(state.nudges)) {
    for (const key of anchors) if (!rawKeys.has(key)) anchors.delete(key);
  }
  syncCompressionBlocks(state, result);

  // Step 1: Run strategies (deduplication + purge errors)
  const strategyResult = runStrategies(state, config);

  // Step 4.5: Build priority map for message-mode compression
  let priorityMap: PriorityMap | undefined;
  if (config.compress.mode === "message") {
    priorityMap = buildPriorityMap(state, result);
  }

  // Step 5: Inject message IDs (with priority attrs if message mode)
  result = injectMessageIds(state, result, priorityMap);

  // Step 6: Inject nudges while message indices still match the raw refs
  result = injectCompressNudges(state, config, result, contextUsage, runtimePrompts);

  // Step 7: Apply pruning (compressed ranges removed, tool outputs pruned)
  result = applyPruning(state, result);

  return { messages: result, strategyResult };
}
