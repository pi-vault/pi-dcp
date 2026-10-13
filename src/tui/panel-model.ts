import type { DcpConfig } from "../config.ts";
import { getDcpCapabilities, getDcpPipelineDisabledMessage } from "../capabilities.ts";
import type { DcpAction } from "../commands/actions.ts";
import type { CompressionBlock, ContextUsage, SessionState } from "../state/types.ts";
import type { LifetimeStats } from "../state/persistence.ts";
import { resolveContextLimits } from "../utils/context-limits.ts";
import { formatDcpTokens } from "./formatters.ts";

/** Selectable panel action with a type discriminant. */
export type DcpPanelAction =
  | Extract<DcpAction, { type: "toggle-manual" | "cycle-permission" | "sweep" | "toggle-block" }>
  | { type: "close" };

export interface DcpPanelModelInput {
  state: SessionState;
  config: DcpConfig;
  model:
    | { provider: string | undefined; id: string | undefined; contextWindow: number | undefined }
    | undefined;
  contextUsage: ContextUsage | undefined;
  lifetimeStats: LifetimeStats | undefined;
  compressToolActive: boolean;
}

export interface DcpPanelField {
  label: string;
  value: string;
}

export interface DcpPanelRow {
  /** Stable row identity: action type or `block:<id>`. */
  id: string;
  label: string;
  detail?: string;
  /** Present only when the row can be activated. */
  action?: DcpPanelAction;
  /** Why the row is present but unavailable, or absent when it is eligible. */
  unavailableReason?: string;
}

export interface DcpPanelModel {
  status: DcpPanelField[];
  statistics: DcpPanelField[];
  /** Global actions in display order. */
  actions: DcpPanelRow[];
  /** Compression blocks sorted numerically. */
  blocks: DcpPanelRow[];
}

function formatContext(usage: ContextUsage | undefined): string {
  if (usage === undefined || usage.tokens === null) return "Unavailable";
  const percent = usage.percent === null ? "unknown" : `${usage.percent}%`;
  return `${formatDcpTokens(usage.tokens, true)} / ${formatDcpTokens(usage.contextWindow)} (${percent})`;
}

function formatLimit(value: number | undefined): string {
  return value === undefined ? "Unavailable" : formatDcpTokens(value);
}

function formatLifetime(
  stats: LifetimeStats | undefined,
  select: (stats: LifetimeStats) => number,
  estimated = false,
): string {
  if (stats === undefined) return "Unavailable";
  const value = select(stats);
  return estimated ? formatDcpTokens(value, true) : String(value);
}

function buildBlockRow(block: CompressionBlock, policyMessage: string | undefined): DcpPanelRow {
  const label = `Block b${block.blockId}: ${block.topic}`;
  const detail = `${block.mode ?? "unknown"} · ${formatDcpTokens(block.compressedTokens, true)} tokens`;
  if (block.active) {
    return {
      id: `block:${block.blockId}`,
      label,
      detail: `${detail} · Deactivate`,
      action: { type: "toggle-block", blockId: block.blockId },
      ...(policyMessage === undefined ? {} : { unavailableReason: policyMessage }),
    };
  }
  if (block.deactivatedByUser) {
    return {
      id: `block:${block.blockId}`,
      label,
      detail: `${detail} · Reactivate`,
      action: { type: "toggle-block", blockId: block.blockId },
      ...(policyMessage === undefined ? {} : { unavailableReason: policyMessage }),
    };
  }
  return {
    id: `block:${block.blockId}`,
    label,
    detail,
    unavailableReason: "Inactive",
  };
}

/**
 * Build the read-only panel view model. Uses the supplied current model view for
 * identity/threshold resolution without mutating cached session state.
 */
export function buildDcpPanelModel(input: DcpPanelModelInput): DcpPanelModel {
  const { state, config, model, contextUsage, lifetimeStats, compressToolActive } = input;
  const provider = model?.provider;
  const modelId = model?.id;
  const capabilities = getDcpCapabilities(
    config,
    state,
    provider ?? state.modelProvider,
    modelId ?? state.modelId,
  );
  const policyMessage = getDcpPipelineDisabledMessage(capabilities);

  const viewState: SessionState = {
    ...state,
    modelProvider: provider,
    modelId,
    modelContextWindow: model?.contextWindow,
  };
  const resolved = resolveContextLimits(config, viewState, contextUsage);
  const effectivePermission = state.compressPermission ?? config.compress.permission;

  const status: DcpPanelField[] = [
    { label: "Model", value: provider && modelId ? `${provider}/${modelId}` : "Unavailable" },
    { label: "Context", value: formatContext(contextUsage) },
    { label: "Max limit", value: formatLimit(resolved.max) },
    { label: "Min limit", value: formatLimit(resolved.min) },
    { label: "Compression mode", value: config.compress.mode },
    { label: "Permission", value: effectivePermission },
    { label: "Manual mode", value: state.manualMode === "active" ? "on" : "off" },
    {
      label: "Pipeline",
      value: capabilities.pipelineEnabled ? "enabled" : (policyMessage ?? "disabled"),
    },
    { label: "Compress tool", value: compressToolActive ? "active" : "inactive" },
  ];

  const statistics: DcpPanelField[] = [
    { label: "Session tokens saved", value: formatDcpTokens(state.stats.totalPruneTokens, true) },
    { label: "Session tools pruned", value: String(state.stats.toolsPruned) },
    { label: "Session messages compressed", value: String(state.stats.messagesCompressed) },
    {
      label: "Lifetime tokens saved",
      value: formatLifetime(lifetimeStats, (stats) => stats.totalTokensSaved, true),
    },
    {
      label: "Lifetime tools pruned",
      value: formatLifetime(lifetimeStats, (stats) => stats.totalToolsPruned),
    },
    {
      label: "Lifetime messages compressed",
      value: formatLifetime(lifetimeStats, (stats) => stats.totalMessagesCompressed),
    },
    {
      label: "Lifetime sessions",
      value: formatLifetime(lifetimeStats, (stats) => stats.sessionCount),
    },
  ];

  const actions: DcpPanelRow[] = [
    {
      id: "toggle-manual",
      label: `Manual mode: ${state.manualMode === "active" ? "on" : "off"}`,
      detail: state.manualMode === "active" ? "Turn off" : "Turn on",
      action: { type: "toggle-manual" },
      ...(policyMessage === undefined ? {} : { unavailableReason: policyMessage }),
    },
    {
      id: "cycle-permission",
      label: `Compress permission: ${effectivePermission}`,
      detail: "Cycle permission",
      action: { type: "cycle-permission" },
      ...(policyMessage === undefined ? {} : { unavailableReason: policyMessage }),
    },
    {
      id: "sweep",
      label: "Sweep eligible outputs",
      action: { type: "sweep" },
      ...(policyMessage === undefined ? {} : { unavailableReason: policyMessage }),
    },
    { id: "close", label: "Close panel", action: { type: "close" } },
  ];

  const blocks = [...state.prune.messages.blocksById.values()]
    .sort((a, b) => a.blockId - b.blockId)
    .map((block) => buildBlockRow(block, policyMessage));

  return { status, statistics, actions, blocks };
}
