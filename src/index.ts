import * as crypto from "node:crypto";
import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig } from "./config.ts";
import {
  buildMinimalMessage,
  buildDetailedMessage,
} from "./ui/notification.ts";
import { handleCompress, type CompressArgs } from "./compress/handler.ts";
import { stripHallucinationsFromString } from "./messages/strip.ts";
import { mapText } from "./utils/message-content.ts";
import { COMPRESS_MESSAGE_PROMPT } from "./prompts/compress-message.ts";
import { Logger } from "./logger.ts";
import { DCP_SYSTEM_PROMPT } from "./prompts/system.ts";
import { createSessionState, resetSessionState } from "./state/state.ts";
import type { SessionState } from "./state/types.ts";
import { registerDcpCommands } from "./commands/register.ts";
import { saveSessionState, loadSessionState } from "./state/persistence.ts";
import { runPipeline } from "./pipeline.ts";

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
        const resultText = handleCompress(state, config, latestMessages, {
          ...(params as Record<string, unknown>),
          mode: "message",
        } as CompressArgs);
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
        const resultText = handleCompress(state, config, latestMessages, {
          ...(params as Record<string, unknown>),
          mode: "range",
        } as CompressArgs);
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
        if (persisted.messageIds) {
          state.messageIds.byRawId = persisted.messageIds.byRawId;
          state.messageIds.byRef = persisted.messageIds.byRef;
          state.messageIds.nextRefIndex = persisted.messageIds.nextRefIndex;
          // byIndex is rebuilt by assignMessageRefs on first pipeline pass
        }
        if (persisted.nudges) {
          state.nudges.contextLimitAnchors = persisted.nudges.contextLimitAnchors;
          state.nudges.turnAnchors = persisted.nudges.turnAnchors;
          state.nudges.iterationAnchors = persisted.nudges.iterationAnchors;
        }
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
    // Retain byRawId and byRef — stable keys survive compaction.
    // Only clear index cache (rebuilt each pipeline pass).
    // Do NOT reset nextRefIndex — new messages continue the sequence.
    state.compressionTiming.startTimes.clear();
    state.compressionTiming.callIdToBlockId.clear();
    state.compressionTiming.pendingDurations.clear();
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

  pi.on("message_end", async (event, _ctx) => {
    if (!config.enabled) return;
    if (event.message.role !== "assistant") return;

    const stripped = mapText(event.message, stripHallucinationsFromString);
    if (stripped !== event.message) {
      return { message: stripped };
    }
  });

  pi.on("tool_execution_start", async (event, _ctx) => {
    if (!config.enabled) return;
    if (event.toolName !== "compress") return;
    state.compressionTiming.startTimes.set(event.toolCallId, Date.now());
  });

  pi.on("tool_execution_end", async (event, _ctx) => {
    if (!config.enabled) return;
    if (event.toolName !== "compress") return;

    const startTime = state.compressionTiming.startTimes.get(event.toolCallId);
    if (startTime === undefined) return;

    const durationMs = Date.now() - startTime;
    state.compressionTiming.startTimes.delete(event.toolCallId);

    if (event.isError) return;

    // Find the block created by this call. Compression is serial, so the most
    // recently created block corresponds to this call. If the call created
    // multiple blocks (batch), the duration is attached to the last one.
    let latestBlockId: number | undefined;
    let latestCreatedAt = 0;
    for (const [blockId, block] of state.prune.messages.blocksById) {
      if (block.createdAt > latestCreatedAt) {
        latestCreatedAt = block.createdAt;
        latestBlockId = blockId;
      }
    }

    if (latestBlockId !== undefined) {
      state.compressionTiming.callIdToBlockId.set(event.toolCallId, latestBlockId);
    }
    state.compressionTiming.pendingDurations.set(event.toolCallId, durationMs);
  });

  pi.on("context", async (event, ctx) => {
    if (!config.enabled) return;

    const usage = ctx.getContextUsage();
    if (usage) state.modelContextWindow = usage.contextWindow;
    if (ctx.model) {
      state.modelId = ctx.model.id;
      state.modelProvider = ctx.model.provider;
    }
    latestMessages = event.messages;

    const result = runPipeline(
      state,
      config,
      event.messages,
      usage
        ? {
            tokens: usage.tokens,
            contextWindow: usage.contextWindow,
            percent: usage.percent,
          }
        : undefined,
    );

    if (result.strategyResult.pruned > 0) {
      logger.info("strategies", "pruned tool outputs", {
        count: result.strategyResult.pruned,
        tokens: result.strategyResult.tokensSaved,
      });
    }

    if (ctx.hasUI && config.nudgeNotification !== "off") {
      if (config.nudgeNotificationType === "toast") {
        // Toast: per-pass stats, only fire when something was pruned this pass
        if (result.strategyResult.pruned > 0) {
          const stats = {
            tokensSaved: result.strategyResult.tokensSaved,
            pruned: result.strategyResult.pruned,
          };
          const message =
            config.nudgeNotification === "detailed"
              ? buildDetailedMessage(stats, result.strategyResult.prunedToolNames)
              : buildMinimalMessage(stats);
          if (message) ctx.ui.notify(message, "info");
        }
      } else {
        // Status: cumulative stats, always update when savings exist
        if (state.stats.totalPruneTokens > 0) {
          const stats = {
            tokensSaved: state.stats.totalPruneTokens,
            pruned: state.stats.toolsPruned,
          };
          const message = buildMinimalMessage(stats);
          if (message) ctx.ui.setStatus("dcp", message);
        }
      }
    }

    return { messages: result.messages };
  });
}
