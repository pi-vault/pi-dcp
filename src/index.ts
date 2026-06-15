import * as crypto from "node:crypto";
import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig } from "./config.ts";
import { handleRangeCompress, type RangeCompressArgs } from "./compress/range.ts";
import { handleMessageCompress, type MessageCompressArgs } from "./compress/message.ts";
import { buildPriorityMap, type PriorityMap } from "./messages/priority.ts";
import { COMPRESS_MESSAGE_PROMPT } from "./prompts/compress-message.ts";
import { Logger } from "./logger.ts";
import { applyPruning } from "./messages/prune.ts";
import { syncCompressionBlocks } from "./messages/sync.ts";
import { stripHallucinations } from "./messages/strip.ts";
import { assignMessageRefs, injectCompressNudges, injectMessageIds } from "./messages/inject.ts";
import { DCP_SYSTEM_PROMPT } from "./prompts/system.ts";
import { createSessionState, resetSessionState } from "./state/state.ts";
import { syncToolCache, buildToolIdList } from "./state/tool-cache.ts";
import { runStrategies } from "./strategies/runner.ts";
import type { SessionState } from "./state/types.ts";
import { registerDcpCommands } from "./commands/register.ts";
import { saveSessionState, loadSessionState } from "./state/persistence.ts";

export default function createExtension(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const configFilePath = path.join(agentDir, "extensions", "dcp.json");

  let { config } = loadConfig(configFilePath);
  let logger: Logger = new Logger(config.debug);
  const state: SessionState = createSessionState();
  let latestMessages: AgentMessage[] = [];
  let sessionDir: string = "";

  function reloadConfig(logDir?: string): void {
    const result = loadConfig(configFilePath);
    config = result.config;
    logger = new Logger(config.debug, logDir);
    for (const w of result.warnings) {
      logger.info("config", w);
    }
  }

  if (!config.enabled) return;

  registerDcpCommands(pi, state, config);

  if (config.compress.mode === "message") {
    pi.registerTool({
      name: "compress",
      label: "Compress",
      description: COMPRESS_MESSAGE_PROMPT,
      parameters: Type.Object({
        topic: Type.String({
          description: "Short label (3-5 words) for display",
        }),
        targets: Type.Array(
          Type.Object({
            messageId: Type.String({
              description: "Message ID to compress (e.g. m0001)",
            }),
            summary: Type.String({
              description: "Complete technical summary replacing message content",
            }),
          }),
          { description: "Messages to compress" },
        ),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const typedArgs = params as unknown as MessageCompressArgs;
        const resultText = handleMessageCompress(state, config, latestMessages, typedArgs);
        return {
          content: [{ type: "text" as const, text: resultText }],
          details: {},
        };
      },
    });
  } else {
    pi.registerTool({
      name: "compress",
      label: "Compress",
      description:
        "Compress conversation ranges into summaries. Use message IDs (m0001, m0002...) visible in context as boundaries.",
      parameters: Type.Object({
        topic: Type.String({ description: "Short label (3-5 words) for display" }),
        content: Type.Array(
          Type.Object({
            startId: Type.String({
              description: "Message or block ID marking range start (e.g. m0001, b2)",
            }),
            endId: Type.String({
              description: "Message or block ID marking range end (e.g. m0012, b5)",
            }),
            summary: Type.String({
              description: "Complete technical summary replacing all content in range",
            }),
          }),
          { description: "Ranges to compress, each with start/end boundaries and summary" },
        ),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const typedArgs = params as unknown as RangeCompressArgs;
        const resultText = handleRangeCompress(state, config, latestMessages, typedArgs);
        return {
          content: [{ type: "text" as const, text: resultText }],
          details: {},
        };
      },
    });
  }

  pi.on("before_agent_start", async (event, _ctx) => {
    if (!config.enabled) return;
    if (config.compress.permission === "deny") return;

    return {
      systemPrompt: (event.systemPrompt ?? "") + DCP_SYSTEM_PROMPT,
    };
  });

  pi.on("session_start", async (event, ctx) => {
    sessionDir = ctx.sessionManager.getSessionDir();
    const logDir = path.join(sessionDir, "dcp", "logs");
    reloadConfig(logDir);
    if (!config.enabled) return;

    resetSessionState(state);
    state.sessionId = `pi-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    state.manualMode = config.manualMode.default;

    // Load persisted state if resuming
    if (event.reason === "resume") {
      const persisted = loadSessionState(sessionDir);
      if (persisted) {
        state.currentTurn = persisted.currentTurn;
        state.stats = persisted.stats;
        state.lastCompaction = persisted.lastCompaction;
        logger.info("dcp", "resumed persisted state", { turn: state.currentTurn });
      }
    }

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
    state.messageIds.byIndex.clear();
    state.messageIds.byRef.clear();
    state.messageIds.nextRefIndex = 1;
    state.lastCompaction = Date.now();
    logger.info("dcp", "compaction detected, pruning state reset");
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    if (sessionDir) {
      try {
        saveSessionState(state, sessionDir);
        logger.info("dcp", "session shutdown, state saved");
      } catch (err) {
        logger.info("dcp", "session shutdown, failed to save state", { error: String(err) });
      }
    } else {
      logger.info("dcp", "session shutdown");
    }
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

    // Step 0: Cache messages for compress tool
    latestMessages = event.messages;

    let messages = event.messages;

    // Step 0.5: Sync compression blocks
    syncCompressionBlocks(state, messages.length);

    // Step 1: Strip hallucinated DCP tags
    messages = stripHallucinations(messages);

    // Step 2: Build tool caches
    syncToolCache(state, messages);
    buildToolIdList(state, messages);

    // Step 3: Run strategies
    const strategyResult = runStrategies(state, config);
    if (strategyResult.pruned > 0) {
      logger.info("strategies", "pruned tool outputs", {
        count: strategyResult.pruned,
        tokens: strategyResult.tokensSaved,
      });
    }

    // Step 4: Assign message refs to raw messages (before filtering, so refs are stable raw indices)
    assignMessageRefs(state, messages);

    // Step 4.5: Build priority map for message-mode compression
    let priorityMap: PriorityMap | undefined;
    if (config.compress.mode === "message") {
      priorityMap = buildPriorityMap(state, messages);
    }

    // Step 5: Inject message IDs into raw messages (with priority attrs if message mode)
    messages = injectMessageIds(state, messages, priorityMap);

    // Step 6: Apply pruning to messages (compressed ranges removed, tool outputs pruned)
    messages = applyPruning(state, messages);

    // Step 7: Inject nudges based on context usage (reuse initial usage snapshot)
    messages = injectCompressNudges(state, config, messages, usage ?? undefined);

    // Step 8: Update status bar with token savings
    if (ctx.hasUI && state.stats.totalPruneTokens > 0) {
      ctx.ui.setStatus("dcp", `DCP: ${state.stats.totalPruneTokens} tokens saved`);
    }

    return { messages };
  });
}
