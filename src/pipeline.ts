import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState, ContextUsage } from "./state/types.ts";
import type { DcpConfig } from "./config.ts";
import type { RuntimePrompts } from "./prompts/store.ts";
import { syncCompressionBlocks } from "./messages/sync.ts";
import { stripHallucinations } from "./messages/strip.ts";
import { syncToolCache, buildToolIdList } from "./state/tool-cache.ts";
import { runStrategies, type StrategyResult } from "./strategies/runner.ts";
import {
  assignMessageRefs,
  injectCompressNudges,
  injectMessageIds,
} from "./messages/inject.ts";
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
  // Step 0: Reconcile real tool-call ownership before compression state.
  syncToolCache(state, messages);
  syncCompressionBlocks(state, messages);

  // Step 1: Strip hallucinated DCP tags from assistant messages
  let result = stripHallucinations(messages);

  // Step 2: Rebuild ordered tool ID list
  buildToolIdList(state, result);

  // Step 3: Run strategies (deduplication + purge errors)
  const strategyResult = runStrategies(state, config);

  // Step 4: Assign message refs (stable raw indices)
  assignMessageRefs(state, result);

  // Step 4.5: Build priority map for message-mode compression
  let priorityMap: PriorityMap | undefined;
  if (config.compress.mode === "message") {
    priorityMap = buildPriorityMap(state, result);
  }

  // Step 5: Inject message IDs (with priority attrs if message mode)
  result = injectMessageIds(state, result, priorityMap);

  // Step 6: Apply pruning (compressed ranges removed, tool outputs pruned)
  result = applyPruning(state, result);

  // Step 7: Inject nudges based on context usage
  result = injectCompressNudges(state, config, result, contextUsage, runtimePrompts);

  return { messages: result, strategyResult };
}
