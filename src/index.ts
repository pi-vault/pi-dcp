import * as crypto from "node:crypto";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadConfig, type DcpConfig } from "./config.ts";
import { Logger } from "./logger.ts";
import { applyPruning } from "./messages/prune.ts";
import { stripHallucinations } from "./messages/strip.ts";
import { assignMessageRefs, injectCompressNudges, injectMessageIds } from "./messages/inject.ts";
import { DCP_SYSTEM_PROMPT } from "./prompts/system.ts";
import { createSessionState, resetSessionState } from "./state/state.ts";
import { syncToolCache, buildToolIdList } from "./state/tool-cache.ts";
import { deduplicate } from "./strategies/deduplication.ts";
import { purgeErrors } from "./strategies/purge-errors.ts";
import type { SessionState } from "./state/types.ts";

export default function createExtension(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const configFilePath = path.join(agentDir, "extensions", "dcp.json");

  let config: DcpConfig = loadConfig(configFilePath);
  let logger: Logger = new Logger(config.debug);
  const state: SessionState = createSessionState();

  function reloadConfig(logDir?: string): void {
    config = loadConfig(configFilePath);
    logger = new Logger(config.debug, logDir);
  }

  if (!config.enabled) return;

  pi.on("before_agent_start", async (event, _ctx) => {
    if (!config.enabled) return;
    if (config.compress.permission === "deny") return;

    return {
      systemPrompt: (event.systemPrompt ?? "") + DCP_SYSTEM_PROMPT,
    };
  });

  pi.on("session_start", async (event, ctx) => {
    const sessionDir = ctx.sessionManager.getSessionDir();
    const logDir = path.join(sessionDir, "dcp", "logs");
    reloadConfig(logDir);
    if (!config.enabled) return;

    resetSessionState(state);
    state.sessionId = `pi-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    state.manualMode = config.manualMode.default;

    const usage = ctx.getContextUsage();
    if (usage) {
      state.modelContextWindow = usage.contextWindow;
    }

    logger.info("dcp", "session started", {
      sessionId: state.sessionId,
      reason: event.reason,
      mode: config.compress.mode,
    });
  });

  pi.on("session_compact", async (_event, _ctx) => {
    state.prune.tools.clear();
    state.prune.messages.byMessageIndex.clear();
    state.prune.messages.blocksById.clear();
    state.prune.messages.activeBlockIds.clear();
    state.prune.messages.activeByAnchorIndex.clear();
    state.lastCompaction = Date.now();
    logger.info("dcp", "compaction detected, pruning state reset");
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    logger.info("dcp", "session shutdown");
  });

  pi.on("turn_end", async (_event, _ctx) => {
    state.currentTurn++;
  });

  pi.on("context", async (event, ctx) => {
    if (!config.enabled) return;

    const usage = ctx.getContextUsage();
    if (usage) {
      state.modelContextWindow = usage.contextWindow;
    }

    let messages = event.messages;

    // Step 1: Strip hallucinated DCP tags
    messages = stripHallucinations(messages);

    // Step 2: Build tool caches
    syncToolCache(state, messages);
    buildToolIdList(state, messages);

    // Step 3: Run strategies
    const dedupResult = deduplicate(state, config);
    const purgeResult = purgeErrors(state, config);

    if (dedupResult.pruned > 0) {
      logger.info("dedup", "pruned duplicates", {
        count: dedupResult.pruned,
        tokens: dedupResult.tokensSaved,
      });
    }
    if (purgeResult.pruned > 0) {
      logger.info("purge", "pruned error inputs", {
        count: purgeResult.pruned,
        tokens: purgeResult.tokensSaved,
      });
    }

    // Step 4: Apply pruning to messages
    messages = applyPruning(state, messages);

    // Step 5: Assign message refs
    assignMessageRefs(state, messages);

    // Step 6: Inject nudges based on context usage
    const nudgeUsage = ctx.getContextUsage();
    messages = injectCompressNudges(state, config, messages, nudgeUsage ? {
      tokens: nudgeUsage.tokens,
      contextWindow: nudgeUsage.contextWindow,
      percent: nudgeUsage.percent,
    } : undefined);

    // Step 7: Inject message IDs
    messages = injectMessageIds(state, messages);

    return { messages };
  });
}
