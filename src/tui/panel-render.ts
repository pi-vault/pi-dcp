import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { flattenDcpLabel } from "./formatters.ts";
import type { DcpPanelField, DcpPanelModel, DcpPanelRow } from "./panel-model.ts";
import type { DcpTheme } from "./theme.ts";

export interface DcpPanelView {
  selectedRowId?: string;
  offset: number;
  lastActionMessage?: string;
}

export interface DcpPanelRenderResult {
  lines: string[];
  offset: number;
  actionsVisible: boolean;
}

const FRAME = { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" } as const;
const PADDING_X = 2;
const INFO_LINE_BUDGET = 9;
const CHROME_ROWS = 8;
const MIN_WIDTH = 26;
const MIN_CAP = 9;
const KEY_HINTS = [
  "↑/↓ j/k navigate · Enter run · Esc/q close",
  "Enter run · Esc/q close",
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

function fieldValue(fields: DcpPanelField[], label: string): string {
  return fields.find((entry) => entry.label === label)?.value ?? "Unavailable";
}

function informationLines(model: DcpPanelModel): string[] {
  const status = (label: string) => fieldValue(model.status, label);
  const statistic = (label: string) => fieldValue(model.statistics, label);
  return [
    `Model ${status("Model")}`,
    `Context ${status("Context")}`,
    `Limits max ${status("Max limit")} / min ${status("Min limit")} · Mode ${status("Compression mode")}`,
    `Permission ${status("Permission")} · Manual ${status("Manual mode")}`,
    `Pipeline ${status("Pipeline")}`,
    `Tool ${status("Compress tool")}`,
    `Session saved ${statistic("Session tokens saved")} · pruned ${statistic("Session tools pruned")} · compressed ${statistic("Session messages compressed")}`,
    `Lifetime saved ${statistic("Lifetime tokens saved")} · sessions ${statistic("Lifetime sessions")}`,
    `Lifetime tools ${statistic("Lifetime tools pruned")} · messages ${statistic("Lifetime messages compressed")}`,
  ];
}

function renderRow(row: DcpPanelRow, selected: boolean, width: number, theme: DcpTheme): string {
  const marker = selected ? `${theme.fg("accent", "▸")} ` : "  ";
  const label = flattenDcpLabel(row.label);
  const detail = row.detail === undefined ? "" : ` · ${flattenDcpLabel(row.detail)}`;
  const reason =
    row.unavailableReason === undefined ? "" : ` [${flattenDcpLabel(row.unavailableReason)}]`;
  const availableWidth = Math.max(0, width - visibleWidth(marker));
  const minimumLabelWidth = Math.min(visibleWidth(label), Math.floor(availableWidth / 3));
  const suffixText = truncate(
    `${detail}${reason}`,
    Math.max(0, availableWidth - minimumLabelWidth),
  );
  const labelText = truncate(label, Math.max(0, availableWidth - visibleWidth(suffixText)));
  const labelColor = selected ? "accent" : row.action === undefined ? "dim" : "text";
  return `${marker}${theme.fg(labelColor, labelText)}${theme.fg("dim", suffixText)}`;
}

function chooseHint(width: number): string {
  return KEY_HINTS.find((hint) => visibleWidth(hint) <= width) ?? "q";
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

/** Pure frame/list renderer for the DCP panel. Never touches live state or actions. */
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
  const rows = [...model.actions, ...model.blocks];
  const target = Math.min(cap, CHROME_ROWS + INFO_LINE_BUDGET + Math.max(1, rows.length));
  const headerCount = Math.min(INFO_LINE_BUDGET, Math.max(0, target - CHROME_ROWS - 1));
  const listHeight = Math.max(0, target - CHROME_ROWS - headerCount);

  const selectedIndex = resolveSelection(rows, view.selectedRowId);
  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] : undefined;
  const viewport = fitRows(rows, selectedIndex, listHeight, view.offset);

  const information = informationLines(model)
    .slice(0, headerCount)
    .map((line) => truncate(line, contentWidth));
  const title = truncate(theme.bold(theme.fg("accent", "DCP Panel")), contentWidth);
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

  const listLines: string[] = [];
  for (let index = 0; index < listHeight; index++) {
    const row = viewport.visible[index];
    if (row === undefined) {
      listLines.push(" ".repeat(contentWidth));
      continue;
    }
    listLines.push(pad(renderRow(row, row === selectedRow, contentWidth, theme), contentWidth));
  }

  const content = [title, ...information, divider, ...listLines, feedback, hint];
  return {
    lines: frame(content, safeWidth, theme),
    offset: viewport.offset,
    actionsVisible: rows.length > 0,
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
