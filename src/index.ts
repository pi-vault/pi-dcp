import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isDcpEnabledForModel, loadConfig, type DcpConfig } from "./config.ts";
import { PromptStore, writeDefaultPrompts } from "./prompts/store.ts";
import type { RuntimePrompts } from "./prompts/store.ts";
import {
  buildMinimalMessage,
  buildDetailedMessage,
  buildCompressNotificationMinimal,
  buildCompressNotificationDetailed,
} from "./ui/notification.ts";
import { handleCompress, type CompressArgs, type CompressResult } from "./compress/handler.ts";
import { stripHallucinationsFromString } from "./messages/strip.ts";
import { mapText } from "./utils/message-content.ts";
import { COMPRESS_MESSAGE_PROMPT } from "./prompts/compress-message.ts";
import { Logger } from "./logger.ts";
import { DCP_SYSTEM_PROMPT } from "./prompts/system.ts";
import { createSessionState, resetSessionState } from "./state/state.ts";
import type { SessionState } from "./state/types.ts";
import { registerDcpCommands } from "./commands/register.ts";
import {
  parseDcpSnapshot,
  restoreDcpSnapshot,
  serializeDcpSnapshot,
  durableStateFingerprint,
} from "./state/persistence.ts";
import { runPipeline } from "./pipeline.ts";
import { parseChildSessionResults } from "./subagents/subagent-results.ts";

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
    config.nudgeNotification === "detailed"
      ? buildCompressNotificationDetailed(notifParams)
      : buildCompressNotificationMinimal(notifParams);
  if (config.nudgeNotificationType === "toast") {
    ctx.ui.notify(message, "info");
  } else {
    ctx.ui.setStatus("dcp", message);
  }
}

export function applyCompressionTiming(
  state: SessionState,
  event: { toolCallId: string; toolName: string; isError?: boolean },
  now = Date.now(),
): void {
  if (event.toolName !== "compress") return;
  const startTime = state.compressionTiming.startTimes.get(event.toolCallId);
  if (startTime === undefined) return;

  state.compressionTiming.startTimes.delete(event.toolCallId);
  if (event.isError) return;

  const durationMs = now - startTime;
  for (const block of state.prune.messages.blocksById.values()) {
    if (block.compressToolCallId === event.toolCallId) block.durationMs = durationMs;
  }
}

export default function createExtension(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const configFilePath = path.join(agentDir, "extensions", "dcp.json");

  const { config } = loadConfig(configFilePath);
  let logger: Logger = new Logger(config.debug);
  const state: SessionState = createSessionState();
  let latestMessages: AgentMessage[] = [];
  let promptStore: PromptStore | undefined;
  let runtimePrompts: RuntimePrompts | undefined;
  let lastPersistedFingerprint: string | undefined;
  let compressWasActiveBeforeModelDisable: boolean | undefined;

  function reconcileCompressTool(provider: string | undefined, modelId: string | undefined): void {
    const activeTools = pi.getActiveTools();
    const compressActive = activeTools.includes("compress");
    if (!isDcpEnabledForModel(config, provider, modelId)) {
      if (compressWasActiveBeforeModelDisable === undefined) {
        compressWasActiveBeforeModelDisable = compressActive;
      }
      if (compressActive) {
        pi.setActiveTools(activeTools.filter((name) => name !== "compress"));
      }
      return;
    }

    if (compressWasActiveBeforeModelDisable === true && !compressActive) {
      pi.setActiveTools([...activeTools, "compress"]);
    }
    compressWasActiveBeforeModelDisable = undefined;
  }

  function persistIfChanged(force = false): void {
    const snapshot = serializeDcpSnapshot(state);
    if (!snapshot) return;
    const fingerprint = durableStateFingerprint(state);
    if (!fingerprint) return;
    if (!force && fingerprint === lastPersistedFingerprint) return;
    try {
      pi.appendEntry("pi-dcp-state", snapshot);
      lastPersistedFingerprint = fingerprint;
    } catch (error) {
      logger.warn("dcp", "failed to persist native session state", { error: String(error) });
    }
  }

  function getSessionId(ctx: ExtensionContext): string {
    const manager = ctx.sessionManager as unknown as {
      getSessionId?: () => string;
      getSessionDir: () => string;
    };
    return manager.getSessionId?.() ?? manager.getSessionDir();
  }

  function restoreActiveBranch(ctx: ExtensionContext): boolean {
    const manager = ctx.sessionManager as unknown as {
      getBranch?: () => unknown[];
    };
    const branch = manager.getBranch?.() ?? [];
    const currentSessionId = getSessionId(ctx);
    let skippedInvalidSnapshot = false;
    for (let index = branch.length - 1; index >= 0; index--) {
      const entry = branch[index] as Record<string, unknown>;
      if (entry?.type !== "custom" || entry.customType !== "pi-dcp-state") continue;
      const snapshot = parseDcpSnapshot(entry.data, (message) => logger.warn("dcp", message));
      if (!snapshot) {
        skippedInvalidSnapshot = true;
        continue;
      }
      const restored = restoreDcpSnapshot(snapshot, state, currentSessionId, (message) =>
        logger.warn("dcp", message),
      );
      const inheritedOwner = snapshot.ownerSessionId !== currentSessionId;
      if (restored && !inheritedOwner && !skippedInvalidSnapshot) {
        lastPersistedFingerprint = durableStateFingerprint(state);
      }
      return !restored || inheritedOwner || skippedInvalidSnapshot;
    }
    state.sessionId = currentSessionId;
    return true;
  }

  function reloadConfig(ctx: ExtensionContext, logDir?: string): void {
    const projectConfigPath = ctx.isProjectTrusted?.()
      ? path.join(ctx.cwd, ".pi", "dcp.json")
      : undefined;
    const result = loadConfig(configFilePath, projectConfigPath);
    Object.assign(config, result.config);
    logger = new Logger(config.debug, logDir);
    for (const w of result.warnings) {
      logger.info("config", w);
    }
  }

  registerDcpCommands(pi, state, config, persistIfChanged);

  function executeCompressTool(
    mode: CompressArgs["mode"],
    toolCallId: string,
    params: Record<string, unknown>,
    ctx: ExtensionContext,
  ) {
    if (!isDcpEnabledForModel(config, ctx.model?.provider, ctx.model?.id)) {
      const text = config.enabled
        ? "Compression is disabled for the current model."
        : "Compression is disabled by configuration.";
      return {
        content: [{ type: "text" as const, text }],
        details: {},
        isError: true,
      };
    }
    const result = handleCompress(state, config, latestMessages, toolCallId, {
      ...params,
      mode,
    } as CompressArgs);
    sendCompressNotification(result, state, config, ctx);
    return {
      content: [{ type: "text" as const, text: result.text }],
      details: {},
    };
  }

  function registerCompressTool(): void {
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
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          return executeCompressTool(
            "message",
            _toolCallId,
            params as Record<string, unknown>,
            ctx,
          );
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
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          return executeCompressTool("range", _toolCallId, params as Record<string, unknown>, ctx);
        },
      });
    }
  }

  pi.on("model_select", async (event, _ctx) => {
    state.modelProvider = event.model.provider;
    state.modelId = event.model.id;
    if (!config.enabled) return;
    reconcileCompressTool(event.model.provider, event.model.id);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!isDcpEnabledForModel(config, ctx.model?.provider, ctx.model?.id)) return;
    if ((state.compressPermission ?? config.compress.permission) === "deny") return;
    if (state.isSubAgent && !config.experimental.allowSubAgents) return;

    const systemPromptText = runtimePrompts?.system ?? DCP_SYSTEM_PROMPT;
    return {
      systemPrompt: (event.systemPrompt ?? "") + systemPromptText,
    };
  });

  pi.on("session_start", async (event, ctx) => {
    const logDir = path.join(ctx.sessionManager.getSessionDir(), "dcp", "logs");
    reloadConfig(ctx, logDir);
    if (!config.enabled) return;
    registerCompressTool();
    reconcileCompressTool(ctx.model?.provider, ctx.model?.id);

    resetSessionState(state);
    lastPersistedFingerprint = undefined;
    state.manualMode = config.manualMode.default;
    state.compressPermission = config.compress.permission;

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

    const forcePersist = restoreActiveBranch(ctx);
    state.isSubAgent = process.env.PI_SUBAGENT_CHILD === "1";

    const usage = ctx.getContextUsage();
    if (usage) {
      state.modelContextWindow = usage.contextWindow;
    }

    logger.info("dcp", "session started", {
      sessionId: state.sessionId,
      reason: event.reason,
      mode: config.compress.mode,
    });
    persistIfChanged(forcePersist);
  });

  pi.on("session_tree", async (_event, ctx) => {
    resetSessionState(state);
    state.manualMode = config.manualMode.default;
    state.compressPermission = config.compress.permission;
    const forcePersist = restoreActiveBranch(ctx);
    state.isSubAgent = process.env.PI_SUBAGENT_CHILD === "1";
    persistIfChanged(forcePersist);
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
    state.subAgentResultCache.clear();
    state.lastCompaction = Date.now();
    logger.info("dcp", "compaction detected, pruning state reset");
    persistIfChanged();
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    persistIfChanged();
    logger.info("dcp", "session shutdown");
  });

  pi.on("message_end", async (event, ctx) => {
    if (!isDcpEnabledForModel(config, ctx.model?.provider, ctx.model?.id)) return;
    if (event.message.role !== "assistant") return;

    const stripped = mapText(event.message, stripHallucinationsFromString);
    if (stripped !== event.message) {
      return { message: stripped };
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!config.enabled) return undefined;
    if (event.toolName !== "compress") return undefined;
    if (!isDcpEnabledForModel(config, ctx.model?.provider, ctx.model?.id)) {
      return { block: true, reason: "Compression is disabled for the current model" };
    }

    const permission = state.compressPermission ?? config.compress.permission;
    if (permission === "deny") {
      return { block: true, reason: "Compression denied by configuration" };
    }
    return undefined;
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    if (!isDcpEnabledForModel(config, ctx.model?.provider, ctx.model?.id)) return;
    if (event.toolName !== "compress") return;
    state.compressionTiming.startTimes.set(event.toolCallId, Date.now());
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (!isDcpEnabledForModel(config, ctx.model?.provider, ctx.model?.id)) return;

    // Compression timing (Phase 2)
    if (event.toolName === "compress") {
      applyCompressionTiming(state, event);
      persistIfChanged();
      return;
    }

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
    if (!config.enabled) return;
    if (ctx.model) {
      state.modelId = ctx.model.id;
      state.modelProvider = ctx.model.provider;
    }
    reconcileCompressTool(ctx.model?.provider, ctx.model?.id);
    if (!isDcpEnabledForModel(config, ctx.model?.provider, ctx.model?.id)) return;
    if (state.isSubAgent && !config.experimental.allowSubAgents) return;

    const usage = ctx.getContextUsage();
    if (usage) state.modelContextWindow = usage.contextWindow;
    latestMessages = event.messages;

    if (promptStore) {
      promptStore.reload();
      runtimePrompts = promptStore.getRuntimePrompts();
    }

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
    );

    if (result.strategyResult.pruned > 0) {
      logger.info("strategies", "pruned tool calls", {
        count: result.strategyResult.pruned,
        tokens: result.strategyResult.tokensSaved,
      });
    }

    persistIfChanged();

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
