import type { DcpConfig } from "../config.ts";
import { getDcpCapabilities, getDcpPipelineDisabledMessage } from "../capabilities.ts";
import type { DcpAction } from "../commands/actions.ts";
import { DCP_COMMAND_HELP } from "../commands/help.ts";
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

/** Tabs in approved left-to-right order. */
export const DCP_PANEL_TABS = ["overview", "controls", "blocks", "statistics", "help"] as const;

export type DcpPanelTab = (typeof DCP_PANEL_TABS)[number];

/** Ephemeral per-tab viewport state. */
export interface DcpPanelTabViewport {
  /** Stable row identity selected in this tab, when it has rows. */
  selectedRowId?: string;
  /** Scroll offset restored when the tab is revisited. */
  offset: number;
}

/** Complete ephemeral navigation snapshot carried through panel rebuilds. */
export interface DcpPanelNavigation {
  activeTab: DcpPanelTab;
  tabs: Record<DcpPanelTab, DcpPanelTabViewport>;
}

/** Structured block facts used to render lifecycle independently of policy. */
export interface DcpPanelBlockDisplay {
  blockId: number;
  lifecycle: "User-deactivated" | "Active" | "Consumed" | "Inactive";
  /** Present only when the block can currently be toggled. */
  toggleLabel?: "Deactivate" | "Reactivate";
}

export interface DcpPanelRow {
  /** Stable row identity in the tab. */
  id: string;
  /** Field name, heading, action label, or block topic. */
  label: string;
  /** Formatted value or secondary copy. */
  detail?: string;
  /** Present only when the row can be activated. */
  action?: DcpPanelAction;
  /** Why the row is present but has no action, when it is suppressed by policy. */
  unavailableReason?: string;
  /** Structured block facts, present on every Blocks row. */
  block?: DcpPanelBlockDisplay;
}

export interface DcpPanelTabModel {
  title: string;
  rows: DcpPanelRow[];
}

export interface DcpPanelModel {
  tabs: Record<DcpPanelTab, DcpPanelTabModel>;
}

const TAB_TITLES: Record<DcpPanelTab, string> = {
  overview: "Overview",
  controls: "Controls",
  blocks: "Blocks",
  statistics: "Statistics",
  help: "Help",
};

/** Build a fresh navigation snapshot with every tab at offset zero. */
export function createDcpPanelNavigation(activeTab: DcpPanelTab = "overview"): DcpPanelNavigation {
  const tabs = {} as Record<DcpPanelTab, DcpPanelTabViewport>;
  for (const tab of DCP_PANEL_TABS) tabs[tab] = { offset: 0 };
  return { activeTab, tabs };
}

function formatContext(usage: ContextUsage | undefined): string {
  if (usage === undefined) return "Unavailable";
  if (usage.tokens === null) {
    return usage.contextWindow > 0
      ? `Unavailable (context window: ${formatDcpTokens(usage.contextWindow)})`
      : "Unavailable";
  }
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

function blockLifecycle(
  block: CompressionBlock,
  blocksById: Map<number, CompressionBlock>,
): DcpPanelBlockDisplay["lifecycle"] {
  if (block.deactivatedByUser) return "User-deactivated";
  if (block.active) return "Active";
  if (block.deactivatedByBlockId !== undefined && blocksById.has(block.deactivatedByBlockId)) {
    return "Consumed";
  }
  return "Inactive";
}

function buildBlockRow(
  block: CompressionBlock,
  blocksById: Map<number, CompressionBlock>,
  policyMessage: string | undefined,
): DcpPanelRow {
  const lifecycle = blockLifecycle(block, blocksById);
  const policyBlocked = policyMessage !== undefined;
  const canToggle = !policyBlocked && (lifecycle === "Active" || lifecycle === "User-deactivated");
  const toggleLabel: DcpPanelBlockDisplay["toggleLabel"] =
    lifecycle === "Active"
      ? "Deactivate"
      : lifecycle === "User-deactivated"
        ? "Reactivate"
        : undefined;
  const mode = block.mode ?? "unknown";
  return {
    id: `block:${block.blockId}`,
    label: block.topic,
    detail: `${mode} · ${formatDcpTokens(block.compressedTokens, true)} tokens`,
    block: {
      blockId: block.blockId,
      lifecycle,
      ...(canToggle && toggleLabel !== undefined ? { toggleLabel } : {}),
    },
    ...(canToggle ? { action: { type: "toggle-block" as const, blockId: block.blockId } } : {}),
    ...(policyBlocked ? { unavailableReason: policyMessage } : {}),
  };
}

/**
 * Build the read-only five-tab panel view model. Uses the supplied current model
 * view for identity/threshold resolution without mutating cached session state.
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
  const policyBlocked = policyMessage !== undefined;
  const withPolicy = policyBlocked ? { unavailableReason: policyMessage } : {};

  const overviewRows: DcpPanelRow[] = [
    {
      id: "overview:model",
      label: "Model",
      detail: provider && modelId ? `${provider}/${modelId}` : "Unavailable",
    },
    { id: "overview:context", label: "Context", detail: formatContext(contextUsage) },
    { id: "overview:max-limit", label: "Max limit", detail: formatLimit(resolved.max) },
    { id: "overview:min-limit", label: "Min limit", detail: formatLimit(resolved.min) },
    { id: "overview:compression-mode", label: "Compression mode", detail: config.compress.mode },
    {
      id: "overview:manual-mode",
      label: "Manual mode",
      detail: state.manualMode === "active" ? "on" : "off",
    },
    { id: "overview:permission", label: "Permission", detail: effectivePermission },
    {
      id: "overview:pipeline",
      label: "Pipeline",
      detail: capabilities.pipelineEnabled ? "enabled" : (policyMessage ?? "disabled"),
    },
    {
      id: "overview:compress-tool",
      label: "Compress tool",
      detail: compressToolActive ? "active" : "inactive",
    },
    {
      id: "overview:pruned-tools",
      label: "Pruned tool calls",
      detail: String(state.prune.tools.size),
    },
    {
      id: "overview:active-blocks",
      label: "Active blocks",
      detail: String(state.prune.messages.activeBlockIds.size),
    },
    {
      id: "overview:total-blocks",
      label: "Total blocks",
      detail: String(state.prune.messages.blocksById.size),
    },
    {
      id: "overview:tool-cache",
      label: "Tool cache entries",
      detail: String(state.toolParameters.size),
    },
    {
      id: "overview:user-turn",
      label: "Current user turn",
      detail: String(state.currentUserTurn),
    },
  ];

  const controlsRows: DcpPanelRow[] = [
    {
      id: "toggle-manual",
      label: `Manual mode: ${state.manualMode === "active" ? "on" : "off"}`,
      detail: state.manualMode === "active" ? "Turn off" : "Turn on",
      ...(policyBlocked ? {} : { action: { type: "toggle-manual" as const } }),
      ...withPolicy,
    },
    {
      id: "cycle-permission",
      label: `Compress permission: ${effectivePermission}`,
      detail: "Cycle permission",
      ...(policyBlocked ? {} : { action: { type: "cycle-permission" as const } }),
      ...withPolicy,
    },
    {
      id: "sweep",
      label: "Sweep eligible outputs",
      ...(policyBlocked ? {} : { action: { type: "sweep" as const } }),
      ...withPolicy,
    },
  ];

  const statisticsRows: DcpPanelRow[] = [
    { id: "statistics:session", label: "Session" },
    {
      id: "statistics:tools-pruned",
      label: "Tools pruned",
      detail: String(state.stats.toolsPruned),
    },
    {
      id: "statistics:pruning-tokens-saved",
      label: "Cumulative pruning tokens saved",
      detail: formatDcpTokens(state.stats.totalPruneTokens, true),
    },
    {
      id: "statistics:messages-compressed",
      label: "Messages compressed",
      detail: String(state.stats.messagesCompressed),
    },
    {
      id: "statistics:prune-token-counter",
      label: "Prune token counter",
      detail: formatDcpTokens(state.stats.pruneTokenCounter, true),
    },
    { id: "statistics:lifetime", label: "Lifetime" },
    {
      id: "statistics:lifetime-sessions",
      label: "Sessions tracked",
      detail: formatLifetime(lifetimeStats, (stats) => stats.sessionCount),
    },
    {
      id: "statistics:lifetime-pruning-tokens-saved",
      label: "Total tokens saved",
      detail: formatLifetime(lifetimeStats, (stats) => stats.totalTokensSaved, true),
    },
    {
      id: "statistics:lifetime-tools-pruned",
      label: "Total tools pruned",
      detail: formatLifetime(lifetimeStats, (stats) => stats.totalToolsPruned),
    },
    {
      id: "statistics:lifetime-messages-compressed",
      label: "Total messages compressed",
      detail: formatLifetime(lifetimeStats, (stats) => stats.totalMessagesCompressed),
    },
  ];

  const helpRows: DcpPanelRow[] = [
    ...DCP_COMMAND_HELP.map((entry) => ({
      id: `help:command:${entry.id}`,
      label: entry.syntax,
      detail: entry.description,
    })),
    { id: "help:navigation:tabs", label: "Switch tabs", detail: "Tab / Shift-Tab" },
    { id: "help:navigation:rows", label: "Move between rows", detail: "Up/Down or j/k" },
    { id: "help:navigation:activate", label: "Run the selected row", detail: "Enter or Space" },
    { id: "help:navigation:close", label: "Close the panel", detail: "Esc or q" },
  ];

  const blocksRows = [...state.prune.messages.blocksById.values()]
    .sort((a, b) => a.blockId - b.blockId)
    .map((block) => buildBlockRow(block, state.prune.messages.blocksById, policyMessage));

  return {
    tabs: {
      overview: { title: TAB_TITLES.overview, rows: overviewRows },
      controls: { title: TAB_TITLES.controls, rows: controlsRows },
      blocks: { title: TAB_TITLES.blocks, rows: blocksRows },
      statistics: { title: TAB_TITLES.statistics, rows: statisticsRows },
      help: { title: TAB_TITLES.help, rows: helpRows },
    },
  };
}
