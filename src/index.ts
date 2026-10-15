import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig, type DcpConfig } from "./config.ts";
import { getDcpCapabilities } from "./capabilities.ts";
import { PromptStore, writeDefaultPrompts } from "./prompts/store.ts";
import type { RuntimePrompts } from "./prompts/store.ts";
import {
  buildMinimalMessage,
  buildDetailedMessage,
  buildCompressNotificationMinimal,
  buildCompressNotificationDetailed,
} from "./tui/notification.ts";
import {
  clearCompressionBlocks,
  type CompressArgs,
  type CompressResult,
} from "./compress/blocks.ts";
import {
  createCompressionExecution,
  type CompressionExecutionOutcome,
} from "./compress/execution.ts";
import {
  createCompressionDisplayDetails,
  renderCompressCall,
  renderCompressResult,
} from "./tui/compress-render.ts";
import { stripHallucinationsFromString } from "./messages/strip.ts";
import { mapText } from "./utils/message-content.ts";
import { COMPRESS_MESSAGE_PROMPT } from "./prompts/compress-message.ts";
import { Logger } from "./logger.ts";
import { DCP_SYSTEM_PROMPT } from "./prompts/system.ts";
import { createSessionState } from "./state/state.ts";
import type { SessionState } from "./state/types.ts";
import { registerDcpCommands } from "./commands/register.ts";
import { createDcpCheckpoints } from "./state/checkpoints.ts";
import { runPipeline } from "./pipeline.ts";
import { parseChildSessionResults } from "./subagents/subagent-results.ts";
import { createCompressionToolSelection } from "./tool-selection.ts";

/**
 * Extract plain summary text from compression blocks, stripping delimiters.
 */
function buildCombinedSummary(state: SessionState, blockIds: number[]): string {
  return blockIds
    .map((id) => {
      const block = state.prune.messages.blocksById.get(id);
      if (!block?.summary) return "";
      return block.summary
        .replace(/^\[Compressed Block b\d+\]\n/, "")
        .replace(/\n\[End Block b\d+\]$/, "");
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Send a compression notification via ctx.ui.
 * Skips when UI is unavailable or nudgeNotification is "off".
 */
function sendCompressNotification(
  result: CompressResult,
  state: SessionState,
  config: DcpConfig,
  ctx: ExtensionContext,
): void {
  if (!ctx.hasUI || config.nudgeNotification === "off") return;
  if (result.messagesCompressed === 0) return;
  const notifParams = {
    compressedTokens: result.compressedTokens,
    summaryTokens: result.summaryTokens,
    messagesCompressed: result.messagesCompressed,
    topic: result.topic,
    summary: buildCombinedSummary(state, result.blockIds),
    showCompression: config.compress.showCompression,
  };
  const message =
    config.nudgeNotification === "detailed" && config.nudgeNotificationType === "toast"
      ? buildCompressNotificationDetailed(notifParams)
      : buildCompressNotificationMinimal(notifParams);
  if (config.nudgeNotificationType === "toast") {
    ctx.ui.notify(message, "info");
  } else {
    ctx.ui.setStatus("dcp", message);
  }
}

export default function createExtension(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const configFilePath = path.join(agentDir, "extensions", "dcp.json");

  const { config } = loadConfig(configFilePath);
  let logger: Logger = new Logger(config.debug);
  const state: SessionState = createSessionState();
  const selection = createCompressionToolSelection(pi, state, config);
  let latestMessages: AgentMessage[] = [];
  let promptStore: PromptStore | undefined;
  let runtimePrompts: RuntimePrompts | undefined;

  /** Policy capabilities for the current model identity. */
  function evaluateCapabilities(ctx?: ExtensionContext) {
    return getDcpCapabilities(
      config,
      state,
      ctx?.model?.provider ?? state.modelProvider,
      ctx?.model?.id ?? state.modelId,
    );
  }

  const checkpoints = createDcpCheckpoints(pi, state, config, (message, details) =>
    logger.warn("dcp", message, details),
  );

  const execution = createCompressionExecution({
    state,
    config,
    getMessages: () => latestMessages,
    onCompressed: (result, ctx) => sendCompressNotification(result, state, config, ctx),
    persist: () => checkpoints.persist(),
  });

  function reloadConfig(ctx: ExtensionContext, logDir?: string): void {
    const projectConfigPath = ctx.isProjectTrusted?.()
      ? path.join(ctx.cwd, ".pi", "dcp.json")
      : undefined;
    const result = loadConfig(configFilePath, projectConfigPath);
    Object.assign(config, result.config);
    logger = new Logger(config.debug, logDir);
    for (const warning of result.warnings) {
      logger.warnAlways("config", warning);
    }
    if (ctx.hasUI && result.warnings.length > 0) {
      const count = result.warnings.length;
      const paths = [configFilePath, projectConfigPath].filter(
        (value): value is string => typeof value === "string",
      );
      ctx.ui.notify(
        `DCP: ${count} configuration problem${count === 1 ? "" : "s"} in ${paths.join(" and ")}. Check the DCP log for details.`,
        "warning",
      );
    }
  }

  /** Refresh the runtime prompt snapshot once per agent run. */
  function refreshRuntimePrompts(): void {
    if (!promptStore) return;
    promptStore.reload();
    runtimePrompts = promptStore.getRuntimePrompts();
  }

  function setupPromptStore(ctx: ExtensionContext): void {
    if (config.experimental.customPrompts) {
      const projectOverrideDir = ctx.isProjectTrusted?.()
        ? path.join(ctx.cwd, ".pi", "dcp-prompts", "overrides")
        : undefined;
      const globalOverrideDir = path.join(agentDir, "extensions", "dcp-prompts", "overrides");
      promptStore = new PromptStore({ projectOverrideDir, globalOverrideDir });
      promptStore.reload();
      runtimePrompts = promptStore.getRuntimePrompts();

      // Write defaults for reference on first run
      const defaultsDir = path.join(agentDir, "extensions", "dcp-prompts", "defaults");
      writeDefaultPrompts(defaultsDir);
    } else {
      promptStore = undefined;
      runtimePrompts = undefined;
    }
  }

  const onStateChange = (ctx: ExtensionCommandContext): void => {
    selection.reconcile(ctx);
    checkpoints.persist();
  };

  /** Format a run outcome into the registered tool's host result shape. */
  function formatCompressOutcome(mode: CompressArgs["mode"], outcome: CompressionExecutionOutcome) {
    if (outcome.status === "rejected") {
      return {
        content: [{ type: "text" as const, text: outcome.message }],
        details: {},
        isError: true,
      };
    }
    return {
      content: [{ type: "text" as const, text: outcome.result.text }],
      details: createCompressionDisplayDetails(mode, outcome.result),
    };
  }

  function registerCompressTool(mode: DcpConfig["compress"]["mode"]): void {
    if (mode === "message") {
      pi.registerTool({
        name: "compress",
        label: "Compress",
        description: COMPRESS_MESSAGE_PROMPT,
        defaultActive: false,
        executionMode: "sequential",
        parameters: Type.Object({
          topic: Type.String({
            description: "Short label (3-5 words) for display",
          }),
          targets: Type.Array(
            Type.Object({
              messageId: Type.String({
                description:
                  "Message reference to compress (e.g. m1, @m1@, @m1:3@). Copy the marker shown in context or use its bare mN alias. Zero-padded legacy refs are also accepted.",
              }),
              summary: Type.String({
                description: "Complete technical summary replacing message content",
              }),
            }),
            { description: "Messages to compress" },
          ),
        }),
        renderCall: (args, theme) => renderCompressCall("message", args, theme),
        renderResult: renderCompressResult,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const outcome = await execution.execute(
            "message",
            _toolCallId,
            params as Record<string, unknown>,
            ctx,
            _signal,
          );
          return formatCompressOutcome("message", outcome);
        },
      });
    } else {
      pi.registerTool({
        name: "compress",
        label: "Compress",
        description:
          "Compress conversation ranges into summaries. Use the compact message markers (m1, @m1@) visible in context as boundaries.",
        defaultActive: false,
        executionMode: "sequential",
        parameters: Type.Object({
          topic: Type.String({ description: "Short label (3-5 words) for display" }),
          content: Type.Array(
            Type.Object({
              startId: Type.String({
                description: "Message or block ID marking range start (e.g. m1, @m1@, b2)",
              }),
              endId: Type.String({
                description: "Message or block ID marking range end (e.g. m12, @m12@, b5)",
              }),
              summary: Type.String({
                description: "Complete technical summary replacing all content in range",
              }),
            }),
            { description: "Ranges to compress, each with start/end boundaries and summary" },
          ),
        }),
        renderCall: (args, theme) => renderCompressCall("range", args, theme),
        renderResult: renderCompressResult,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const outcome = await execution.execute(
            "range",
            _toolCallId,
            params as Record<string, unknown>,
            ctx,
            _signal,
          );
          return formatCompressOutcome("range", outcome);
        },
      });
    }
  }

  // Register the provisional global-mode definition before the session loads so
  // Pi's reload path cannot reactivate a deselected tool. Session start refreshes
  // the schema from trusted project configuration.
  registerCompressTool(config.compress.mode);
  registerDcpCommands(pi, state, config, onStateChange);

  pi.on("model_select", async (event, _ctx) => {
    selection.reconcile({ model: event.model });
  });

  pi.on("before_agent_start", async (event, ctx) => {
    refreshRuntimePrompts();
    selection.reconcile(ctx);
    const capabilities = evaluateCapabilities(ctx);
    const guidance = capabilities.compressionEnabled && pi.getActiveTools().includes("compress");

    const sections = event.systemPromptOptions?.sections;
    if (sections) {
      if (guidance) {
        sections.dcp = runtimePrompts?.system ?? DCP_SYSTEM_PROMPT;
      } else {
        delete sections.dcp;
      }
    }
    return undefined;
  });

  pi.on("session_start", async (event, ctx) => {
    const logDir = path.join(ctx.sessionManager.getSessionDir(), "dcp", "logs");
    reloadConfig(ctx, logDir);

    latestMessages = [];
    checkpoints.restoreAndCheckpoint("session-start", ctx, () => {
      selection.refreshModel(ctx.model);
      state.isSubAgent = process.env.PI_SUBAGENT_CHILD === "1";

      setupPromptStore(ctx);

      // Refresh the definition from trusted project configuration, preserving the
      // inactive default so a user-deselected tool stays deselected.
      registerCompressTool(config.compress.mode);

      // Select the fresh-session default before policy suppression so an initially
      // denied session remembers it and can restore it when permission allows.
      selection.sessionStarted(event.reason, ctx);

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
  });

  pi.on("session_tree", async (_event, ctx) => {
    latestMessages = [];
    checkpoints.restoreAndCheckpoint("branch-navigation", ctx, () => {
      state.isSubAgent = process.env.PI_SUBAGENT_CHILD === "1";
      selection.branchRestored(ctx);
    });
  });

  pi.on("session_compact", async (_event, _ctx) => {
    state.prune.tools.clear();
    clearCompressionBlocks(state, "compaction");
    state.messageIds.byIndex.clear();
    // Retain byRawId and byRef — stable keys survive compaction.
    // Only clear index cache (rebuilt each pipeline pass).
    // Do NOT reset nextRefIndex — new messages continue the sequence.
    state.compressionTiming.startTimes.clear();
    state.subAgentResultCache.clear();
    state.lastCompaction = Date.now();
    logger.info("dcp", "compaction detected, pruning state reset");
    checkpoints.persist();
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    checkpoints.persist();
    logger.info("dcp", "session shutdown");
  });

  pi.on("message_end", async (event, ctx) => {
    if (!evaluateCapabilities(ctx).pipelineEnabled) return;
    if (event.message.role !== "assistant") return;

    const stripped = mapText(event.message, stripHallucinationsFromString);
    if (stripped !== event.message) {
      return { message: stripped };
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "compress") return undefined;
    selection.refreshModel(ctx.model);
    return execution.checkToolCall(ctx);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    // Compression completion is unconditional: a call that started under an
    // allowed policy must have its timing cleared even if policy changed. The
    // run owner also requests the deduplicated checkpoint.
    if (event.toolName === "compress") {
      execution.complete(event);
      return;
    }

    if (!evaluateCapabilities(ctx).pipelineEnabled) return;

    // Sub-agent result caching (Phase 9)
    if (event.toolName === "subagent" && !event.isError) {
      const details = event.result?.details as Record<string, unknown> | undefined;
      const childSessionPath = details?.childSessionPath;
      if (typeof childSessionPath === "string") {
        const resultText = await parseChildSessionResults(childSessionPath);
        if (resultText) {
          state.subAgentResultCache.set(event.toolCallId, resultText);
        }
      }
    }
  });

  pi.on("context", async (event, ctx) => {
    selection.reconcile(ctx);
    const capabilities = evaluateCapabilities(ctx);
    if (!capabilities.pipelineEnabled) return;

    const usage = ctx.getContextUsage();
    if (usage) state.modelContextWindow = usage.contextWindow;
    latestMessages = event.messages;

    const guidance = capabilities.compressionEnabled && pi.getActiveTools().includes("compress");

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
      runtimePrompts,
      guidance,
    );

    if (result.strategyResult.pruned > 0) {
      logger.info("strategies", "pruned tool calls", {
        count: result.strategyResult.pruned,
        tokens: result.strategyResult.tokensSaved,
      });
    }

    checkpoints.persist();

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
