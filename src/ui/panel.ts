import * as path from "node:path";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { DcpConfig } from "../config.ts";
import type { SessionState } from "../state/types.ts";
import { getDcpCapabilities } from "../capabilities.ts";
import { loadAllSessionStats, type LifetimeStats } from "../state/persistence.ts";
import {
  applyDcpPanelAction,
  buildDcpPanelModel,
  type DcpPanelAction,
  type DcpPanelModel,
  type DcpPanelRow,
} from "./panel-model.ts";

export interface DcpPanelComponentOptions {
  theme: Theme;
  getHeight: () => number;
  requestRender: () => void;
  onAction: (action: DcpPanelAction) => void;
  initialRowId?: string;
  lastActionMessage?: string;
}

function flattenLabel(value: string): string {
  return value.replace(/\s*\n\s*/g, " ").trim();
}

/**
 * Bounded, scrolling terminal component for the DCP panel.
 *
 * Renders a compact status/statistics header, a scrolling action/block list, and
 * a close-key footer. Performs no domain mutations; it only tracks selection and
 * reports one action back to the controller.
 */
export class DcpPanelComponent {
  private readonly model: DcpPanelModel;
  private readonly options: DcpPanelComponentOptions;
  private readonly rows: DcpPanelRow[];
  private readonly selectableIndices: number[];
  private selectedPosition = 0;
  private scrollOffset = 0;
  private completed = false;

  constructor(model: DcpPanelModel, options: DcpPanelComponentOptions) {
    this.model = model;
    this.options = options;
    this.rows = [...model.actions, ...model.blocks];
    this.selectableIndices = this.rows.flatMap((row, index) => (row.action ? [index] : []));
    if (options.initialRowId !== undefined) {
      const index = this.rows.findIndex((row) => row.id === options.initialRowId);
      if (index >= 0 && this.rows[index]?.action) {
        this.selectedPosition = Math.max(0, this.selectableIndices.indexOf(index));
      }
    }
  }

  invalidate(): void {
    // No cached render state; every render is recomputed from the model.
  }

  handleInput(data: string): void {
    if (this.completed) return;
    if (matchesKey(data, Key.escape) || data === "q") {
      this.complete({ type: "close" });
      return;
    }
    if (matchesKey(data, Key.up) || data === "k") {
      this.move(-1);
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.move(1);
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
      const row = this.rows[this.selectableIndices[this.selectedPosition] ?? -1];
      if (row?.action) this.complete(row.action);
    }
  }

  render(width: number): string[] {
    try {
      return this.renderThemed(width);
    } catch {
      return this.renderFallback(width);
    }
  }

  private move(delta: number): void {
    if (this.selectableIndices.length === 0) return;
    const next = Math.min(
      Math.max(this.selectedPosition + delta, 0),
      this.selectableIndices.length - 1,
    );
    if (next === this.selectedPosition) return;
    this.selectedPosition = next;
    this.options.requestRender();
  }

  private complete(action: DcpPanelAction): void {
    if (this.completed) return;
    this.completed = true;
    this.options.onAction(action);
  }

  private statusValue(label: string): string {
    return this.model.status.find((entry) => entry.label === label)?.value ?? "Unavailable";
  }

  private statisticValue(label: string): string {
    return this.model.statistics.find((entry) => entry.label === label)?.value ?? "Unavailable";
  }

  private renderThemed(width: number): string[] {
    const theme = this.options.theme;
    const height = Math.max(1, this.options.getHeight());

    const footer: string[] = [];
    if (this.options.lastActionMessage) {
      footer.push(
        theme.fg(
          "accent",
          truncateToWidth(
            `Last action: ${flattenLabel(this.options.lastActionMessage)}`,
            width,
            "…",
          ),
        ),
      );
    }
    footer.push(
      theme.fg("dim", truncateToWidth("↑/↓ j/k navigate · Enter run · Esc/q close", width, "…")),
    );

    const header: string[] = [
      theme.bold(theme.fg("accent", "DCP Panel")),
      theme.fg(
        "text",
        `Model ${this.statusValue("Model")} · Context ${this.statusValue("Context")}`,
      ),
      theme.fg(
        "text",
        `Limits max ${this.statusValue("Max limit")} / min ${this.statusValue("Min limit")} · Mode ${this.statusValue("Compression mode")}`,
      ),
      theme.fg(
        "text",
        `Permission ${this.statusValue("Permission")} · Manual ${this.statusValue("Manual mode")} · Pipeline ${this.statusValue("Pipeline")} · Tool ${this.statusValue("Compress tool")}`,
      ),
      theme.fg(
        "text",
        `Session saved ${this.statisticValue("Session tokens saved")} · pruned ${this.statisticValue("Session tools pruned")} · compressed ${this.statisticValue("Session messages compressed")}`,
      ),
      theme.fg(
        "text",
        `Lifetime saved ${this.statisticValue("Lifetime tokens saved")} · sessions ${this.statisticValue("Lifetime sessions")}`,
      ),
    ];

    const maxHeaderLines = Math.max(0, height - footer.length - 1 - (this.rows.length > 0 ? 1 : 0));
    const headerLines = header
      .slice(0, maxHeaderLines)
      .map((line) => truncateToWidth(line, width, "…"));
    const listHeight = Math.max(0, height - headerLines.length - footer.length - 1);
    const divider = theme.fg("borderMuted", truncateToWidth("─".repeat(Math.max(0, width)), width));

    const selectedRowIndex = this.selectableIndices[this.selectedPosition] ?? -1;
    const maxScroll = Math.max(0, this.rows.length - listHeight);
    this.scrollOffset = Math.min(this.scrollOffset, maxScroll);
    if (selectedRowIndex >= 0 && listHeight > 0) {
      if (selectedRowIndex < this.scrollOffset) this.scrollOffset = selectedRowIndex;
      if (selectedRowIndex >= this.scrollOffset + listHeight) {
        this.scrollOffset = selectedRowIndex - listHeight + 1;
      }
    }

    const listLines = this.rows
      .slice(this.scrollOffset, this.scrollOffset + listHeight)
      .map((row, index) =>
        this.renderRow(row, this.scrollOffset + index === selectedRowIndex, width),
      );

    return [...headerLines, divider, ...listLines, ...footer];
  }

  private renderRow(row: DcpPanelRow, selected: boolean, width: number): string {
    const theme = this.options.theme;
    const marker = selected ? "> " : "  ";
    const detail = row.detail === undefined ? "" : ` · ${flattenLabel(row.detail)}`;
    const reason =
      row.unavailableReason === undefined ? "" : ` [${flattenLabel(row.unavailableReason)}]`;
    const text = `${marker}${flattenLabel(row.label)}${detail}${reason}`;
    if (selected) return theme.inverse(truncateToWidth(text, width, "…"));
    if (row.action === undefined) return theme.fg("dim", truncateToWidth(text, width, "…"));
    return truncateToWidth(text, width, "…");
  }

  private renderFallback(width: number): string[] {
    const height = Math.max(1, this.options.getHeight());
    return [
      truncateToWidth("DCP panel (rendering unavailable)", width, "…"),
      "",
      truncateToWidth("Esc/q close", width, "…"),
    ].slice(0, height);
  }
}

/** Open the interactive DCP panel until the user closes it. */
export async function openDcpPanel(
  state: SessionState,
  config: DcpConfig,
  ctx: ExtensionCommandContext,
  onStateChange: (ctx: ExtensionCommandContext) => void,
  getActiveTools: () => string[],
): Promise<void> {
  if (ctx.mode !== "tui" || !ctx.hasUI) {
    ctx.ui.notify(
      "DCP panel requires interactive TUI mode. Use dcp:help for available commands.",
      "error",
    );
    return;
  }

  const parentDir = path.resolve(ctx.sessionManager.getSessionDir(), "..");
  let lifetimeStats: LifetimeStats | undefined;
  try {
    lifetimeStats = await loadAllSessionStats(parentDir);
  } catch {
    lifetimeStats = undefined;
  }

  let lastActionMessage: string | undefined;
  let initialRowId: string | undefined;

  for (;;) {
    const model = buildDcpPanelModel({
      state,
      config,
      model: ctx.model
        ? {
            provider: ctx.model.provider,
            id: ctx.model.id,
            contextWindow: ctx.model.contextWindow,
          }
        : undefined,
      contextUsage: ctx.getContextUsage() ?? undefined,
      lifetimeStats,
      compressToolActive: getActiveTools().includes("compress"),
    });

    let action: DcpPanelAction | undefined;
    try {
      action = await ctx.ui.custom<DcpPanelAction | undefined>((tui, theme, _keybindings, done) => {
        return new DcpPanelComponent(model, {
          theme,
          getHeight: () => tui.terminal.rows,
          requestRender: () => tui.requestRender(),
          onAction: (next) => done(next),
          initialRowId,
          lastActionMessage,
        });
      });
    } catch {
      ctx.ui.notify("DCP panel closed: interactive UI failed.", "error");
      return;
    }

    if (action === undefined || action.type === "close") return;

    initialRowId = action.type === "toggle-block" ? `block:${action.blockId}` : action.type;
    const capabilities = getDcpCapabilities(config, state, ctx.model?.provider, ctx.model?.id);
    const result = applyDcpPanelAction(action, state, config, capabilities);
    lastActionMessage = result.message;
    if (result.permitted) onStateChange(ctx);
  }
}
