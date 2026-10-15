import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getDcpCapabilities, type DcpSuppressionReason } from "../capabilities.ts";
import type { DcpConfig } from "../config.ts";
import type { SessionState } from "../state/types.ts";
import {
  handleCompress,
  recordCompressionDuration,
  type CompressArgs,
  type CompressResult,
} from "./blocks.ts";
import { requestCompressionApproval } from "./permission.ts";

/** Result of a direct `compress` execution: rejected by policy or compressed. */
export type CompressionExecutionOutcome =
  | { status: "rejected"; message: string }
  | { status: "compressed"; result: CompressResult };

/** The host completion facts the run owner needs; only compression events matter. */
export interface CompressionCompletion {
  toolCallId: string;
  toolName: string;
  isError?: boolean;
}

/** Live collaborators and host operations the run owner coordinates. */
export interface CompressionExecutionDependencies {
  state: SessionState;
  config: DcpConfig;
  getMessages: () => AgentMessage[];
  onCompressed: (result: CompressResult, ctx: ExtensionContext) => void;
  persist: () => void;
  now?: () => number;
}

export interface CompressionExecution {
  checkToolCall(ctx: Pick<ExtensionContext, "model">): { block: true; reason: string } | undefined;
  execute(
    mode: CompressArgs["mode"],
    toolCallId: string,
    params: Record<string, unknown>,
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ): Promise<CompressionExecutionOutcome>;
  complete(event: CompressionCompletion): void;
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

/**
 * Own per-call compression policy, approval coordination, timing, and completion.
 *
 * Both registered tool modes delegate here. Root state and configuration are read
 * at operation time so approvals cannot pin stale nested state, messages, or model
 * identity. Timing lives in the existing session timing map; no competing run state
 * is created, and the completion path always requests the same deduplicated checkpoint.
 */
export function createCompressionExecution(
  dependencies: CompressionExecutionDependencies,
): CompressionExecution {
  const { state, config, getMessages, onCompressed, persist } = dependencies;
  // Resolve the clock on every operation so later spies/fake timers still apply.
  const clock = () => (dependencies.now ?? Date.now)();

  function suppressionReasons(model: ExtensionContext["model"]): DcpSuppressionReason[] {
    return getDcpCapabilities(
      config,
      state,
      model?.provider ?? state.modelProvider,
      model?.id ?? state.modelId,
    ).reasons;
  }

  return {
    checkToolCall(ctx) {
      const reasons = suppressionReasons(ctx.model);
      if (reasons.length === 0) return undefined;
      return { block: true, reason: toolCallSuppressionReason(reasons[0]) };
    },

    async execute(mode, toolCallId, params, ctx, signal) {
      const reasons = suppressionReasons(ctx.model);
      if (reasons.length > 0) {
        return { status: "rejected", message: executeSuppressionMessage(reasons[0]) };
      }

      const permission = state.compressPermission ?? config.compress.permission;
      if (permission === "ask") {
        const effectiveSignal = signal ?? ctx.signal;
        const denial = await requestCompressionApproval(mode, params, ctx, effectiveSignal);
        if (denial !== undefined) return { status: "rejected", message: denial };
        // Recheck after the wait: an abort or a policy change must prevent work.
        if (effectiveSignal?.aborted) {
          return { status: "rejected", message: "Compression was not approved" };
        }
        const suppressed = suppressionReasons(ctx.model);
        if (suppressed.length > 0) {
          return { status: "rejected", message: executeSuppressionMessage(suppressed[0]) };
        }
      }

      // Timing starts at actual compression work, after approval and a fresh policy check.
      state.compressionTiming.startTimes.set(toolCallId, clock());
      const result = handleCompress(state, config, getMessages(), toolCallId, {
        ...params,
        mode,
      } as CompressArgs);
      onCompressed(result, ctx);
      return { status: "compressed", result };
    },

    complete(event) {
      if (event.toolName !== "compress") return;
      const startTime = state.compressionTiming.startTimes.get(event.toolCallId);
      if (startTime !== undefined) {
        state.compressionTiming.startTimes.delete(event.toolCallId);
        if (!event.isError) {
          recordCompressionDuration(state, event.toolCallId, clock() - startTime);
        }
      }
      persist();
    },
  };
}
