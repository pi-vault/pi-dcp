import { isDcpEnabledForModel, type DcpConfig } from "./config.ts";
import type { SessionState } from "./state/types.ts";

/**
 * Reasons DCP policy suppresses model-driven compression.
 * Evaluated independently and reported in this fixed order.
 */
export type DcpSuppressionReason = "config" | "model" | "subagent" | "permission";

export interface DcpCapabilities {
  /** Whether the pruning/compression pipeline may run at all. */
  pipelineEnabled: boolean;
  /** Whether model-driven compression is available. */
  compressionEnabled: boolean;
  /** Applicable suppression reasons in deterministic order. */
  reasons: DcpSuppressionReason[];
}

/**
 * Compute DCP's policy capabilities for the current session.
 *
 * Active-tool selection and manual mode are intentionally excluded: they are
 * presentation/behavioral concerns, not policy suppression.
 */
export function getDcpCapabilities(
  config: DcpConfig,
  state: SessionState,
  provider: string | undefined,
  modelId: string | undefined,
): DcpCapabilities {
  const reasons: DcpSuppressionReason[] = [];

  if (!config.enabled) reasons.push("config");
  // Use an enabled view so global disablement does not mask an explicit model reason.
  if (
    !isDcpEnabledForModel(
      { enabled: true, disabledModels: config.disabledModels },
      provider,
      modelId,
    )
  ) {
    reasons.push("model");
  }
  if (state.isSubAgent && !config.experimental.allowSubAgents) reasons.push("subagent");
  if ((state.compressPermission ?? config.compress.permission) === "deny") {
    reasons.push("permission");
  }

  const pipelineSuppressed = reasons.some((reason) => reason !== "permission");
  return {
    pipelineEnabled: !pipelineSuppressed,
    compressionEnabled: !pipelineSuppressed && !reasons.includes("permission"),
    reasons,
  };
}

/**
 * User-facing message for why the pipeline cannot run, or undefined when it can.
 * Preserves the existing command-message precedence: config, then sub-agent, then model.
 */
export function getDcpPipelineDisabledMessage(capabilities: DcpCapabilities): string | undefined {
  if (capabilities.pipelineEnabled) return undefined;
  if (capabilities.reasons.includes("config")) return "DCP is disabled by configuration.";
  if (capabilities.reasons.includes("subagent")) return "DCP is disabled in sub-agent sessions.";
  return "DCP is disabled for the current model.";
}
