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
import { getDcpCapabilities, type DcpSuppressionReason } from "./capabilities.ts";
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
  handleCompress,
  recordCompressionDuration,
  type CompressArgs,
  type CompressResult,
} from "./compress/blocks.ts";
import { requestCompressionApproval } from "./compress/permission.ts";
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

/** Message shown when a `tool_call` handler blocks a suppressed compress call. */
function toolCallSuppressionReason(reason: DcpSuppressionReason): string {
  switch (reason) {
    case "config":
      return "Compression is disabled by configuration.";
    case "model":
      return "Compression is disabled for the current model";
    case "subagent":
      return "Compression is disabled in sub-agent sessions.";
    case "permission":
      return "Compression denied by configuration";
  }
}

/** Message returned when a direct `execute` is rejected by policy. */
function executeSuppressionMessage(reason: DcpSuppressionReason): string {
  switch (reason) {
    case "config":
      return "Compression is disabled by configuration.";
    case "model":
      return "Compression is disabled for the current model.";
    case "subagent":
      return "Compression is disabled in sub-agent sessions.";
    case "permission":
      return "Compression is denied by configuration.";
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

  recordCompressionDuration(state, event.toolCallId, now - startTime);
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
  let lastPersistedFingerprint: string | undefined;

  /** Policy capabilities for the current model identity. */
  function evaluateCapabilities(ctx?: ExtensionContext) {
    return getDcpCapabilities(
      config,
      state,
      ctx?.model?.provider ?? state.modelProvider,
      ctx?.model?.id ?? state.modelId,
    );
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

  function restoreActiveBranch(ctx: ExtensionContext): boolean {
    const branch = ctx.sessionManager.getBranch();
    const currentSessionId = ctx.sessionManager.getSessionId();
    let skippedInvalidSnapshot = false;
    for (let index = branch.length - 1; index >= 0; index--) {
      const entry = branch[index];
      if (entry.type !== "custom" || entry.customType !== "pi-dcp-state") continue;
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
    persistIfChanged();
  };

  async function executeCompressTool(
    mode: CompressArgs["mode"],
    toolCallId: string,
    params: Record<string, unknown>,
    ctx: ExtensionContext,
    signal: AbortSignal | undefined,
  ) {
    const reasons = evaluateCapabilities(ctx).reasons;
    if (reasons.length > 0) {
      return {
        content: [{ type: "text" as const, text: executeSuppressionMessage(reasons[0]) }],
        details: {},
        isError: true,
      };
    }

    const permission = state.compressPermission ?? config.compress.permission;
    if (permission === "ask") {
      const effectiveSignal = signal ?? ctx.signal;
      const denial = await requestCompressionApproval(mode, params, ctx, effectiveSignal);
      if (denial !== undefined) {
        return {
          content: [{ type: "text" as const, text: denial }],
          details: {},
          isError: true,
        };
      }
      // Recheck after the wait: an abort or a policy change must prevent work.
      if (effectiveSignal?.aborted) {
        return {
          content: [{ type: "text" as const, text: "Compression was not approved" }],
          details: {},
          isError: true,
        };
      }
      const suppressedReasons = evaluateCapabilities(ctx).reasons;
      if (suppressedReasons.length > 0) {
        return {
          content: [
            { type: "text" as const, text: executeSuppressionMessage(suppressedReasons[0]) },
          ],
          details: {},
          isError: true,
        };
      }
    }

    // Timing starts at actual compression work, after approval and a fresh policy check.
    state.compressionTiming.startTimes.set(toolCallId, Date.now());
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
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          return executeCompressTool(
            "message",
            _toolCallId,
            params as Record<string, unknown>,
            ctx,
            _signal,
          );
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
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          return executeCompressTool(
            "range",
            _toolCallId,
            params as Record<string, unknown>,
            ctx,
            _signal,
          );
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

    resetSessionState(state);
    lastPersistedFingerprint = undefined;
    latestMessages = [];
    state.manualMode = config.manualMode.default;
    state.compressPermission = config.compress.permission;

    const forcePersist = restoreActiveBranch(ctx);
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
    persistIfChanged(forcePersist);
  });

  pi.on("session_tree", async (_event, ctx) => {
    resetSessionState(state);
    latestMessages = [];
    state.manualMode = config.manualMode.default;
    state.compressPermission = config.compress.permission;
    const forcePersist = restoreActiveBranch(ctx);
    state.isSubAgent = process.env.PI_SUBAGENT_CHILD === "1";
    selection.branchRestored(ctx);
    persistIfChanged(forcePersist);
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
    persistIfChanged();
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    persistIfChanged();
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
    const reasons = evaluateCapabilities(ctx).reasons;
    if (reasons.length === 0) return undefined;
    return { block: true, reason: toolCallSuppressionReason(reasons[0]) };
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    // Compression timing completion is unconditional: a call that started under
    // an allowed policy must have its timing cleared even if policy changed.
    if (event.toolName === "compress") {
      applyCompressionTiming(state, event);
      persistIfChanged();
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
