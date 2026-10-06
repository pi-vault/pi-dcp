import type { DcpConfig } from "../config.ts";
import {
  getDcpCapabilities,
  getDcpPipelineDisabledMessage,
  type DcpCapabilities,
} from "../capabilities.ts";
import type { CompressionBlock, ContextUsage, SessionState } from "../state/types.ts";
import type { LifetimeStats } from "../state/persistence.ts";
import { resolveContextLimits } from "../utils/context-limits.ts";
import { manualCommand } from "../commands/manual.ts";
import { permissionCommand } from "../commands/permission.ts";
import { sweepCommand } from "../commands/sweep.ts";
import { decompressCommand } from "../commands/decompress.ts";
import { recompressCommand } from "../commands/recompress.ts";

/** Selectable panel action with a type discriminant. */
export type DcpPanelAction =
  | { type: "toggle-manual" }
  | { type: "cycle-permission" }
  | { type: "sweep" }
  | { type: "toggle-block"; blockId: number }
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
  return `${usage.tokens} / ${usage.contextWindow} (${percent})`;
}

function formatLimit(value: number | undefined): string {
  return value === undefined ? "Unavailable" : String(value);
}

function formatLifetime(
  stats: LifetimeStats | undefined,
  select: (stats: LifetimeStats) => number,
): string {
  return stats === undefined ? "Unavailable" : String(select(stats));
}

function buildBlockRow(block: CompressionBlock, policyMessage: string | undefined): DcpPanelRow {
  const label = `Block b${block.blockId}: ${block.topic}`;
  const detail = `${block.mode ?? "unknown"} · ${block.compressedTokens} tokens`;
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
  const capabilities = getDcpCapabilities(config, state, provider, modelId);
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
    { label: "Session tokens saved", value: String(state.stats.totalPruneTokens) },
    { label: "Session tools pruned", value: String(state.stats.toolsPruned) },
    { label: "Session messages compressed", value: String(state.stats.messagesCompressed) },
    {
      label: "Lifetime tokens saved",
      value: formatLifetime(lifetimeStats, (stats) => stats.totalTokensSaved),
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

/**
 * Apply a panel action through the existing domain commands. Performs no UI work
 * and rejects policy-disabled mutations before any domain command runs.
 */
export function applyDcpPanelAction(
  action: DcpPanelAction,
  state: SessionState,
  config: DcpConfig,
  capabilities: DcpCapabilities,
): { permitted: boolean; message?: string } {
  if (action.type === "close") return { permitted: false };

  const disabled = getDcpPipelineDisabledMessage(capabilities);
  if (disabled !== undefined) return { permitted: false, message: disabled };

  switch (action.type) {
    case "toggle-manual":
      return {
        permitted: true,
        message: manualCommand(state, state.manualMode === "active" ? "off" : "on"),
      };
    case "cycle-permission":
      return {
        permitted: true,
        message: permissionCommand(state, config.compress.permission),
      };
    case "sweep":
      return { permitted: true, message: sweepCommand(state, config) };
    case "toggle-block": {
      const block = state.prune.messages.blocksById.get(action.blockId);
      const message = block?.active
        ? decompressCommand(state, String(action.blockId))
        : recompressCommand(state, String(action.blockId));
      return { permitted: true, message };
    }
  }
}
