import * as path from "node:path";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { DcpConfig } from "../config.ts";
import type { SessionState } from "../state/types.ts";
import { executeDcpAction } from "../commands/actions.ts";
import { loadAllSessionStats, type LifetimeStats } from "../state/persistence.ts";
import {
  buildDcpPanelModel,
  type DcpPanelAction,
  type DcpPanelModel,
  type DcpPanelRow,
} from "./panel-model.ts";
import { renderDcpPanel, renderDcpPanelFallback, type DcpPanelView } from "./panel-render.ts";
import { createDcpTheme } from "./theme.ts";

export interface DcpPanelComponentOptions {
  theme: Theme;
  getHeight: () => number;
  /** Terminal columns, used to invalidate activation when the view resizes. */
  getWidth: () => number;
  requestRender: () => void;
  onAction: (action: DcpPanelAction) => void;
  initialRowId?: string;
  lastActionMessage?: string;
}

/**
 * Bounded, scrolling terminal component for the DCP panel.
 *
 * Delegates layout to the pure renderer, tracks selection and scroll offset, and
 * reports one action back to the controller. It never mutates domain state, and
 * it activates a row only after rendering that selection at the current terminal
 * size.
 */
export class DcpPanelComponent {
  private readonly model: DcpPanelModel;
  private readonly options: DcpPanelComponentOptions;
  private readonly rows: DcpPanelRow[];
  private selectedPosition = 0;
  private scrollOffset = 0;
  private completed = false;
  private actionsVisible = true;
  private renderedRowId: string | undefined;
  private renderedColumns: number | undefined;
  private renderedRows: number | undefined;

  constructor(model: DcpPanelModel, options: DcpPanelComponentOptions) {
    this.model = model;
    this.options = options;
    this.rows = [...model.actions, ...model.blocks];
    if (options.initialRowId !== undefined) {
      const index = this.rows.findIndex((row) => row.id === options.initialRowId);
      if (index >= 0) this.selectedPosition = index;
    }
  }

  invalidate(): void {
    this.renderedRowId = undefined;
  }

  handleInput(data: string): void {
    if (this.completed) return;
    if (matchesKey(data, Key.escape) || data === "q") {
      this.complete({ type: "close" });
      return;
    }
    if (!this.actionsVisible) return;
    if (matchesKey(data, Key.up) || data === "k") {
      this.move(-1);
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.move(1);
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
      this.activate();
    }
  }

  render(width: number): string[] {
    let terminalColumns = 0;
    let terminalRows = 1;
    try {
      terminalColumns = this.options.getWidth();
      terminalRows = this.options.getHeight();
      const view: DcpPanelView = {
        selectedRowId: this.rows[this.selectedPosition]?.id,
        offset: this.scrollOffset,
        ...(this.options.lastActionMessage === undefined
          ? {}
          : { lastActionMessage: this.options.lastActionMessage }),
      };
      const result = renderDcpPanel(
        this.model,
        view,
        createDcpTheme(this.options.theme),
        width,
        terminalRows,
      );
      this.actionsVisible = result.actionsVisible;
      this.scrollOffset = result.offset;
      this.renderedColumns = terminalColumns;
      this.renderedRows = terminalRows;
      this.renderedRowId = result.actionsVisible ? this.rows[this.selectedPosition]?.id : undefined;
      return result.lines;
    } catch {
      this.actionsVisible = false;
      this.renderedRowId = undefined;
      this.renderedColumns = undefined;
      this.renderedRows = undefined;
      return renderDcpPanelFallback(width, terminalRows).lines;
    }
  }

  private move(delta: number): void {
    if (this.rows.length === 0) return;
    const next = Math.min(Math.max(this.selectedPosition + delta, 0), this.rows.length - 1);
    if (next === this.selectedPosition) return;
    this.selectedPosition = next;
    this.renderedRowId = undefined;
    this.options.requestRender();
  }

  private activate(): void {
    const row = this.rows[this.selectedPosition];
    if (row?.action === undefined) return;
    if (this.renderedRowId !== row.id) return;
    let columns: number;
    let rows: number;
    try {
      columns = this.options.getWidth();
      rows = this.options.getHeight();
    } catch {
      return;
    }
    if (columns !== this.renderedColumns || rows !== this.renderedRows) return;
    this.complete(row.action);
  }

  private complete(action: DcpPanelAction): void {
    if (this.completed) return;
    this.completed = true;
    this.options.onAction(action);
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
      action = await ctx.ui.custom<DcpPanelAction | undefined>(
        (tui, theme, _keybindings, done) =>
          new DcpPanelComponent(model, {
            theme,
            getHeight: () => tui.terminal.rows,
            getWidth: () => tui.terminal.columns,
            requestRender: () => tui.requestRender(),
            onAction: (next) => done(next),
            initialRowId,
            lastActionMessage,
          }),
        {
          overlay: true,
          overlayOptions: { anchor: "center", width: "92%", maxHeight: "85%" },
        },
      );
    } catch {
      ctx.ui.notify("DCP panel closed: interactive UI failed.", "error");
      return;
    }

    if (action === undefined || action.type === "close") return;

    initialRowId = action.type === "toggle-block" ? `block:${action.blockId}` : action.type;
    const result = executeDcpAction(action, ctx, { state, config, onStateChange });
    lastActionMessage = result.message;
  }
}
