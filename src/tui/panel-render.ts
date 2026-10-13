import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { flattenDcpLabel } from "./formatters.ts";
import {
  DCP_PANEL_TABS,
  type DcpPanelModel,
  type DcpPanelRow,
  type DcpPanelTab,
} from "./panel-model.ts";
import type { DcpTheme } from "./theme.ts";

export interface DcpPanelView {
  navigation: {
    activeTab: DcpPanelTab;
    tabs: Record<DcpPanelTab, { selectedRowId?: string; offset: number }>;
  };
  lastActionMessage?: string;
}

export interface DcpPanelRenderResult {
  lines: string[];
  /** Fitted offset of the active tab. */
  offset: number;
  /** True whenever a normal body viewport rendered, including read-only/empty tabs. */
  actionsVisible: boolean;
}

const FRAME = { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" } as const;
const PADDING_X = 2;
const CHROME_ROWS = 9;
const MIN_WIDTH = 26;
const MIN_CAP = 10;
const HINTS = [
  "Tab/Shift-Tab tabs · ↑/↓ j/k rows · Enter/Space run · Esc/q close",
  "↑/↓ j/k rows · Enter/Space run · Esc/q close",
  "↑/↓ j/k rows · Esc/q close",
  "Esc/q close",
  "q",
];

function maxOverlayRows(terminalRows: number): number {
  return Math.max(1, Math.floor(terminalRows * 0.85));
}

function truncate(text: string, width: number): string {
  return truncateToWidth(text, Math.max(0, width), "");
}

function pad(text: string, width: number): string {
  if (width <= 0) return "";
  const clipped = truncate(text, width);
  return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}

function renderTabBar(
  model: DcpPanelModel,
  activeTab: DcpPanelTab,
  width: number,
  theme: DcpTheme,
): string {
  const safeWidth = Math.max(1, Math.floor(width));
  const tabs = DCP_PANEL_TABS.map((id) => ({ id, label: model.tabs[id].title }));
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeTab),
  );
  const widths = tabs.map((tab) => visibleWidth(tab.label) + 2);
  const sliceWidth = (start: number, end: number): number => {
    let total = widths.slice(start, end).reduce((sum, cell) => sum + cell, 0);
    total += Math.max(0, end - start - 1);
    total += start > 0 ? 2 : 0;
    total += end < tabs.length ? 2 : 0;
    return total;
  };

  let start = activeIndex;
  let end = activeIndex + 1;
  // The caller guarantees contentWidth >= 20, so the active label plus both
  // indicators always fits; the loop below only ever grows the window.
  let preferRight = true;
  while (start > 0 || end < tabs.length) {
    let progressed = false;
    const tryRight = (): boolean => {
      if (end < tabs.length && sliceWidth(start, end + 1) <= safeWidth) {
        end += 1;
        return true;
      }
      return false;
    };
    const tryLeft = (): boolean => {
      if (start > 0 && sliceWidth(start - 1, end) <= safeWidth) {
        start -= 1;
        return true;
      }
      return false;
    };

    if (preferRight) {
      if (tryRight()) progressed = true;
      if (tryLeft()) progressed = true;
    } else {
      if (tryLeft()) progressed = true;
      if (tryRight()) progressed = true;
    }
    if (!progressed) break;
    preferRight = !preferRight;
  }

  const cells = tabs.slice(start, end).map((tab) => {
    const label = ` ${tab.label} `;
    return tab.id === activeTab ? theme.inverse(theme.bold(label)) : theme.fg("accent", label);
  });
  let remaining = safeWidth - visibleWidth(cells.join(" "));
  if (start > 0 && remaining >= 2) {
    cells.unshift(theme.fg("dim", "‹"));
    remaining -= 2;
  }
  if (end < tabs.length && remaining >= 2) cells.push(theme.fg("dim", "›"));
  return pad(cells.join(" "), safeWidth);
}

function renderBlockRow(
  row: DcpPanelRow,
  selected: boolean,
  width: number,
  theme: DcpTheme,
): string | undefined {
  const block = row.block;
  if (block === undefined) return undefined;
  const marker = selected ? `${theme.fg("accent", "▸")} ` : "  ";
  const availableWidth = Math.max(0, width - visibleWidth(marker));
  const lifecycle = block.lifecycle;

  const identity = [`Block b${block.blockId}:`, `b${block.blockId}`].find(
    (candidate) => visibleWidth(candidate) + 1 + visibleWidth(lifecycle) <= availableWidth,
  );
  if (identity === undefined) return undefined;

  let remaining = availableWidth - visibleWidth(identity) - 1 - visibleWidth(lifecycle);
  const parts: string[] = [];
  const pushPart = (text: string): void => {
    const part = ` · ${text}`;
    if (visibleWidth(part) <= remaining) {
      parts.push(part);
      remaining -= visibleWidth(part);
    }
  };

  if (block.toggleLabel !== undefined) pushPart(block.toggleLabel);
  else if (row.unavailableReason !== undefined)
    pushPart(`[${flattenDcpLabel(row.unavailableReason)}]`);

  const topic = flattenDcpLabel(row.label);
  const detail = row.detail === undefined ? "" : flattenDcpLabel(row.detail);
  // Reserve the mode/token detail before fitting the topic so a long topic cannot
  // starve the one metric users need to judge a block.
  const detailReserve = detail === "" ? 0 : visibleWidth(` · ${detail}`);
  if (topic !== "") {
    const fitted = truncate(` · ${topic}`, Math.max(0, remaining - detailReserve));
    if (fitted !== "") {
      parts.push(fitted);
      remaining -= visibleWidth(fitted);
    }
  }
  if (detail !== "") pushPart(detail);

  const labelColor = selected ? "accent" : row.action === undefined ? "dim" : "text";
  return `${marker}${theme.fg(labelColor, identity)} ${theme.fg("dim", lifecycle)}${theme.fg("dim", parts.join(""))}`;
}

function renderRow(
  row: DcpPanelRow,
  selected: boolean,
  width: number,
  theme: DcpTheme,
): string | undefined {
  if (row.block !== undefined) return renderBlockRow(row, selected, width, theme);

  const marker = selected ? `${theme.fg("accent", "▸")} ` : "  ";
  const availableWidth = Math.max(0, width - visibleWidth(marker));
  const label = flattenDcpLabel(row.label);
  const isHeading =
    row.detail === undefined && row.action === undefined && row.unavailableReason === undefined;
  if (isHeading) {
    return `${marker}${truncate(theme.bold(theme.fg(selected ? "accent" : "text", label)), availableWidth)}`;
  }

  const detail = row.detail === undefined ? "" : ` ${flattenDcpLabel(row.detail)}`;
  const reason =
    row.unavailableReason === undefined ? "" : ` [${flattenDcpLabel(row.unavailableReason)}]`;
  const labelText = truncate(label, availableWidth);
  const suffix = truncate(
    `${detail}${reason}`,
    Math.max(0, availableWidth - visibleWidth(labelText)),
  );
  const labelColor = row.action === undefined ? "dim" : selected ? "accent" : "text";
  return `${marker}${theme.fg(labelColor, labelText)}${theme.fg("dim", suffix)}`;
}

function chooseHint(width: number): string {
  return HINTS.find((hint) => visibleWidth(hint) <= width) ?? "q";
}

function frame(content: string[], width: number, theme: DcpTheme): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  const inner = Math.max(0, safeWidth - 2);
  const contentWidth = Math.max(0, safeWidth - 2 - PADDING_X * 2);
  const border = (text: string) => theme.fg("borderAccent", text);
  const blank = `${border(FRAME.v)}${" ".repeat(inner)}${border(FRAME.v)}`;
  const lines = [`${border(FRAME.tl)}${border(FRAME.h.repeat(inner))}${border(FRAME.tr)}`, blank];
  for (const line of content) {
    lines.push(
      `${border(FRAME.v)}${" ".repeat(PADDING_X)}${pad(line, contentWidth)}${" ".repeat(PADDING_X)}${border(FRAME.v)}`,
    );
  }
  lines.push(blank, `${border(FRAME.bl)}${border(FRAME.h.repeat(inner))}${border(FRAME.br)}`);
  return lines.map((line) => truncateToWidth(line, safeWidth, ""));
}

function resolveSelection(rows: DcpPanelRow[], selectedRowId: string | undefined): number {
  if (rows.length === 0) return -1;
  if (selectedRowId === undefined) return 0;
  const index = rows.findIndex((row) => row.id === selectedRowId);
  return index >= 0 ? index : 0;
}

function fitRows(
  rows: DcpPanelRow[],
  selectedIndex: number,
  listHeight: number,
  offset: number,
): { offset: number; visible: DcpPanelRow[] } {
  if (listHeight <= 0) return { offset: 0, visible: [] };
  const maxOffset = Math.max(0, rows.length - listHeight);
  let next = Math.min(Math.max(0, Math.floor(offset)), maxOffset);
  if (selectedIndex >= 0) {
    if (selectedIndex < next) next = selectedIndex;
    else if (selectedIndex >= next + listHeight) next = selectedIndex - listHeight + 1;
  }
  return { offset: next, visible: rows.slice(next, next + listHeight) };
}

/** Pure frame/tab renderer for the DCP dashboard. Never touches live state or actions. */
export function renderDcpPanel(
  model: DcpPanelModel,
  view: DcpPanelView,
  theme: DcpTheme,
  width: number,
  terminalRows: number,
): DcpPanelRenderResult {
  const safeWidth = Math.max(0, Math.floor(width));
  const cap = maxOverlayRows(terminalRows);
  if (safeWidth < MIN_WIDTH || cap < MIN_CAP) {
    return renderDcpPanelFallback(width, terminalRows);
  }

  const contentWidth = Math.max(0, safeWidth - 2 - PADDING_X * 2);
  const activeTab = view.navigation.activeTab;
  const rows = model.tabs[activeTab].rows;
  const activeViewport = view.navigation.tabs[activeTab];
  const longestBody = Math.max(1, ...DCP_PANEL_TABS.map((tab) => model.tabs[tab].rows.length));
  const target = Math.min(cap, CHROME_ROWS + longestBody);
  const bodyHeight = Math.max(0, target - CHROME_ROWS);

  const selectedIndex = resolveSelection(rows, activeViewport.selectedRowId);
  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] : undefined;
  const viewport = fitRows(rows, selectedIndex, bodyHeight, activeViewport.offset);

  const title = truncate(theme.bold(theme.fg("accent", "DCP Panel")), contentWidth);
  const tabBar = renderTabBar(model, activeTab, contentWidth, theme);
  const divider = truncate(theme.fg("borderMuted", "─".repeat(contentWidth)), contentWidth);
  const feedbackText =
    view.lastActionMessage === undefined || view.lastActionMessage === ""
      ? ""
      : `Last action: ${flattenDcpLabel(view.lastActionMessage)}`;
  const feedback =
    feedbackText === ""
      ? " ".repeat(contentWidth)
      : truncate(theme.fg("accent", feedbackText), contentWidth);
  const hint = truncate(theme.fg("dim", chooseHint(contentWidth)), contentWidth);

  const bodyLines: string[] = [];
  if (rows.length === 0) {
    const emptyText = activeTab === "blocks" ? "No compression blocks." : "";
    bodyLines.push(truncate(theme.fg("dim", emptyText), contentWidth));
  } else {
    for (const row of viewport.visible) {
      const line = renderRow(row, row === selectedRow, contentWidth, theme);
      if (line === undefined) return renderDcpPanelFallback(width, terminalRows);
      bodyLines.push(pad(line, contentWidth));
    }
  }
  while (bodyLines.length < bodyHeight) bodyLines.push(" ".repeat(contentWidth));

  const content = [title, tabBar, divider, ...bodyLines, feedback, hint];
  return {
    lines: frame(content, safeWidth, theme),
    offset: viewport.offset,
    actionsVisible: true,
  };
}

/** Bounded, plain close-only output for tiny terminals and renderer failures. */
export function renderDcpPanelFallback(width: number, terminalRows: number): DcpPanelRenderResult {
  const safeWidth = Math.max(0, Math.floor(width));
  if (safeWidth === 0) return { lines: [""], offset: 0, actionsVisible: false };

  const cap = maxOverlayRows(terminalRows);
  const close = safeWidth >= 11 ? "Esc/q close" : "q";
  const note = "DCP panel (rendering unavailable)";
  const lines = safeWidth >= 20 && cap >= 2 ? [truncate(note, safeWidth), close] : [close];
  return { lines, offset: 0, actionsVisible: false };
}
