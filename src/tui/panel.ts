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
  createDcpPanelNavigation,
  DCP_PANEL_TABS,
  type DcpPanelAction,
  type DcpPanelModel,
  type DcpPanelNavigation,
  type DcpPanelRow,
  type DcpPanelTab,
} from "./panel-model.ts";
import { renderDcpPanel, renderDcpPanelFallback } from "./panel-render.ts";
import { createDcpTheme } from "./theme.ts";

export interface DcpPanelComponentOptions {
  theme: Theme;
  getHeight: () => number;
  /** Terminal columns, used to invalidate activation when the view resizes. */
  getWidth: () => number;
  requestRender: () => void;
  /** Receives one action plus the complete navigation snapshot it was taken from. */
  onAction: (action: DcpPanelAction, navigation: DcpPanelNavigation) => void;
  initialNavigation?: DcpPanelNavigation;
  lastActionMessage?: string;
}

type DcpPanelCompletion = { action: DcpPanelAction; navigation: DcpPanelNavigation };

function cloneNavigation(navigation: DcpPanelNavigation): DcpPanelNavigation {
  const tabs = {} as Record<DcpPanelTab, { selectedRowId?: string; offset: number }>;
  for (const tab of DCP_PANEL_TABS) {
    const viewport = navigation.tabs[tab];
    tabs[tab] = {
      ...(viewport.selectedRowId === undefined ? {} : { selectedRowId: viewport.selectedRowId }),
      offset: viewport.offset,
    };
  }
  return { activeTab: navigation.activeTab, tabs };
}

/**
 * Normalize a supplied navigation snapshot against the current model. Missing or
 * stale stable IDs fall back to the first row, empty tabs hold no selection and
 * offset zero, and the input is never mutated.
 */
function normalizeNavigation(
  model: DcpPanelModel,
  input: DcpPanelNavigation | undefined,
): DcpPanelNavigation {
  const activeTab: DcpPanelTab =
    input !== undefined && DCP_PANEL_TABS.includes(input.activeTab) ? input.activeTab : "overview";
  const tabs = {} as Record<DcpPanelTab, { selectedRowId?: string; offset: number }>;
  for (const tab of DCP_PANEL_TABS) {
    const rows = model.tabs[tab].rows;
    const previous = input?.tabs[tab];
    let selectedRowId = previous?.selectedRowId;
    if (selectedRowId !== undefined && !rows.some((row) => row.id === selectedRowId)) {
      selectedRowId = undefined;
    }
    if (selectedRowId === undefined && rows.length > 0) selectedRowId = rows[0].id;
    const rawOffset = previous?.offset;
    const offset =
      rows.length === 0 || rawOffset === undefined || !Number.isFinite(rawOffset)
        ? 0
        : Math.max(0, Math.floor(rawOffset));
    tabs[tab] = { ...(selectedRowId === undefined ? {} : { selectedRowId }), offset };
  }
  return { activeTab, tabs };
}

/**
 * Bounded, scrolling terminal component for the DCP dashboard.
 *
 * Delegates layout to the pure renderer, keeps independent per-tab selection and
 * scroll state, and reports one action plus its navigation snapshot back to the
 * controller. It never mutates domain state, and it activates a row only after
 * rendering that row at the current terminal size.
 */
export class DcpPanelComponent {
  private readonly model: DcpPanelModel;
  private readonly options: DcpPanelComponentOptions;
  private navigation: DcpPanelNavigation;
  private completed = false;
  private actionsVisible = true;
  private renderedTab: DcpPanelTab | undefined;
  private renderedRowId: string | undefined;
  private renderedColumns: number | undefined;
  private renderedRows: number | undefined;

  constructor(model: DcpPanelModel, options: DcpPanelComponentOptions) {
    this.model = model;
    this.options = options;
    this.navigation = normalizeNavigation(model, options.initialNavigation);
  }

  invalidate(): void {
    this.renderedTab = undefined;
    this.renderedRowId = undefined;
    this.renderedColumns = undefined;
    this.renderedRows = undefined;
  }

  handleInput(data: string): void {
    if (this.completed) return;
    if (matchesKey(data, Key.escape) || matchesKey(data, "q")) {
      this.complete({ type: "close" });
      return;
    }
    if (!this.actionsVisible) return;
    if (matchesKey(data, Key.shift(Key.tab))) {
      this.cycleTab(-1);
      return;
    }
    if (matchesKey(data, Key.tab)) {
      this.cycleTab(1);
      return;
    }
    if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
      this.move(-1);
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
      this.move(1);
      return;
    }
    if (
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.return) ||
      matchesKey(data, Key.space)
    ) {
      this.activate();
    }
  }

  render(width: number): string[] {
    let terminalColumns = 0;
    let terminalRows = 1;
    try {
      terminalColumns = this.options.getWidth();
      terminalRows = this.options.getHeight();
      const result = renderDcpPanel(
        this.model,
        {
          navigation: this.navigation,
          ...(this.options.lastActionMessage === undefined
            ? {}
            : { lastActionMessage: this.options.lastActionMessage }),
        },
        createDcpTheme(this.options.theme),
        width,
        terminalRows,
      );
      this.actionsVisible = result.actionsVisible;
      if (result.actionsVisible) {
        const activeTab = this.navigation.activeTab;
        this.navigation = {
          ...this.navigation,
          tabs: {
            ...this.navigation.tabs,
            [activeTab]: { ...this.navigation.tabs[activeTab], offset: result.offset },
          },
        };
        this.renderedTab = activeTab;
        this.renderedRowId = this.selectedRow(activeTab)?.id;
      } else {
        this.renderedTab = undefined;
        this.renderedRowId = undefined;
      }
      this.renderedColumns = terminalColumns;
      this.renderedRows = terminalRows;
      return result.lines;
    } catch {
      this.actionsVisible = false;
      this.renderedTab = undefined;
      this.renderedRowId = undefined;
      this.renderedColumns = undefined;
      this.renderedRows = undefined;
      return renderDcpPanelFallback(width, terminalRows).lines;
    }
  }

  private rows(tab: DcpPanelTab): DcpPanelRow[] {
    return this.model.tabs[tab].rows;
  }

  private selectedRow(tab: DcpPanelTab): DcpPanelRow | undefined {
    const id = this.navigation.tabs[tab].selectedRowId;
    if (id === undefined) return undefined;
    return this.rows(tab).find((row) => row.id === id);
  }

  private cycleTab(delta: number): void {
    const index = DCP_PANEL_TABS.indexOf(this.navigation.activeTab);
    const next = DCP_PANEL_TABS[(index + delta + DCP_PANEL_TABS.length) % DCP_PANEL_TABS.length];
    this.navigation = { ...this.navigation, activeTab: next };
    this.renderedTab = undefined;
    this.renderedRowId = undefined;
    this.options.requestRender();
  }

  private move(delta: number): void {
    const tab = this.navigation.activeTab;
    const rows = this.rows(tab);
    if (rows.length === 0) return;
    const currentId = this.navigation.tabs[tab].selectedRowId;
    const currentIndex =
      currentId === undefined ? -1 : rows.findIndex((row) => row.id === currentId);
    const from = currentIndex >= 0 ? currentIndex : 0;
    const next = Math.min(Math.max(from + delta, 0), rows.length - 1);
    if (next === currentIndex) return;
    const nextId = rows[next]?.id;
    this.navigation = {
      ...this.navigation,
      tabs: {
        ...this.navigation.tabs,
        [tab]: {
          ...this.navigation.tabs[tab],
          ...(nextId === undefined ? {} : { selectedRowId: nextId }),
        },
      },
    };
    this.renderedTab = undefined;
    this.renderedRowId = undefined;
    this.options.requestRender();
  }

  private activate(): void {
    const tab = this.navigation.activeTab;
    const row = this.selectedRow(tab);
    if (row?.action === undefined) return;
    if (this.renderedTab !== tab || this.renderedRowId !== row.id) return;
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
    this.options.onAction(action, cloneNavigation(this.navigation));
  }
}

/** Open the interactive DCP dashboard until the user closes it. */
export async function openDcpPanel(
  state: SessionState,
  config: DcpConfig,
  ctx: ExtensionCommandContext,
  onStateChange: (ctx: ExtensionCommandContext) => void,
  getActiveTools: () => string[],
  initialTab: DcpPanelTab = "overview",
): Promise<void> {
  if (ctx.mode !== "tui" || !ctx.hasUI) {
    ctx.ui.notify(
      "DCP panel requires interactive TUI mode. Use dcp:help for available commands.",
      "error",
    );
    return;
  }

  let lifetimeStats: LifetimeStats | undefined;
  try {
    const parentDir = path.resolve(ctx.sessionManager.getSessionDir(), "..");
    lifetimeStats = await loadAllSessionStats(parentDir);
  } catch {
    lifetimeStats = undefined;
  }

  let lastActionMessage: string | undefined;
  let navigation = createDcpPanelNavigation(initialTab);

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

    let completion: DcpPanelCompletion | undefined;
    try {
      completion = await ctx.ui.custom<DcpPanelCompletion | undefined>(
        (tui, theme, _keybindings, done) =>
          new DcpPanelComponent(model, {
            theme,
            getHeight: () => tui.terminal.rows,
            getWidth: () => tui.terminal.columns,
            requestRender: () => tui.requestRender(),
            onAction: (action, next) => done({ action, navigation: next }),
            initialNavigation: navigation,
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

    if (completion === undefined) return;
    navigation = completion.navigation;
    const action = completion.action;
    if (action.type === "close") return;

    const result = executeDcpAction(action, ctx, { state, config, onStateChange });
    lastActionMessage = result.message;
  }
}
