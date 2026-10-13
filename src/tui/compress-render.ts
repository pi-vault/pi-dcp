import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Text, TruncatedText } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { CompressArgs, CompressResult } from "../compress/blocks.ts";
import { flattenDcpLabel, formatDcpTokens } from "./formatters.ts";
import { createDcpTheme, type DcpTheme } from "./theme.ts";

/**
 * Display-only facts attached to a successful compression result. Deliberately
 * excludes the submitted summaries and the combined summary text.
 */
export interface CompressionDisplayMetadata {
  mode: CompressArgs["mode"];
  topic: string;
  messagesCompressed: number;
  compressedTokens: number;
  summaryTokens: number;
  blockIds: number[];
}

/** Structured result details carrying optional DCP display metadata. */
export interface CompressionDisplayDetails {
  dcpCompression?: CompressionDisplayMetadata;
}

/** Build summary-free display metadata from a completed compression result. */
export function createCompressionDisplayDetails(
  mode: CompressArgs["mode"],
  result: CompressResult,
): CompressionDisplayDetails {
  return {
    dcpCompression: {
      mode,
      topic: result.topic,
      messagesCompressed: result.messagesCompressed,
      compressedTokens: result.compressedTokens,
      summaryTokens: result.summaryTokens,
      // Copy so later state mutation cannot change a completed tool result.
      blockIds: [...result.blockIds],
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCompressionDisplayMetadata(value: unknown): value is CompressionDisplayMetadata {
  const record = asRecord(value);
  if (!record) return false;
  if (record.mode !== "range" && record.mode !== "message") return false;
  if (typeof record.topic !== "string") return false;
  if (!isFiniteNonNegative(record.messagesCompressed)) return false;
  if (!isFiniteNonNegative(record.compressedTokens)) return false;
  if (!isFiniteNonNegative(record.summaryTokens)) return false;
  if (!Array.isArray(record.blockIds)) return false;
  return record.blockIds.every(
    (id) => typeof id === "number" && Number.isFinite(id) && Number.isInteger(id) && id >= 0,
  );
}

/** Join every text content item in source order; ignore non-text parts. */
function extractOriginalText(result: AgentToolResult<unknown>): string {
  const content = result.content;
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  for (const item of content) {
    if (
      typeof item === "object" &&
      item !== null &&
      item.type === "text" &&
      typeof item.text === "string"
    ) {
      texts.push(item.text);
    }
  }
  return texts.join("\n");
}

function pluralMessages(count: number): string {
  return count === 1 ? "message" : "messages";
}

function buildHeader(theme: DcpTheme, meta: CompressionDisplayMetadata): string {
  const modeLabel = meta.mode === "range" ? "Range compression" : "Message compression";
  const parts = [theme.fg("toolTitle", modeLabel)];
  const topic = flattenDcpLabel(meta.topic);
  if (topic) parts.push(theme.fg("accent", topic));
  parts.push(
    theme.fg("text", `${meta.messagesCompressed} ${pluralMessages(meta.messagesCompressed)}`),
  );
  parts.push(theme.fg("text", `${formatDcpTokens(meta.compressedTokens, true)} input`));
  parts.push(theme.fg("text", `${formatDcpTokens(meta.summaryTokens, true)} summary`));
  return parts.join(theme.fg("muted", " · "));
}

function buildBlocksLine(theme: DcpTheme, blockIds: number[]): string {
  const ids = blockIds
    .map((blockId) => theme.fg("accent", `b${blockId}`))
    .join(theme.fg("muted", ", "));
  return `${theme.fg("muted", "Blocks: ")}${ids}`;
}

/** Render a compact, bounded call line for the registered mode. */
export function renderCompressCall(
  mode: CompressArgs["mode"],
  args: unknown,
  theme: Theme,
): Component {
  const dcpTheme = createDcpTheme(theme);
  const record = asRecord(args);
  const rawTopic = record?.topic;
  const topic = typeof rawTopic === "string" ? flattenDcpLabel(rawTopic) : "";
  const selected = mode === "range" ? record?.content : record?.targets;

  let line = `${dcpTheme.bold(dcpTheme.fg("toolTitle", "compress"))} ${dcpTheme.fg("accent", mode)}`;
  if (topic) {
    line += `${dcpTheme.fg("muted", " · ")}${dcpTheme.fg("text", topic)}`;
  }
  if (Array.isArray(selected)) {
    const unit =
      mode === "range"
        ? selected.length === 1
          ? "range"
          : "ranges"
        : pluralMessages(selected.length);
    line += `${dcpTheme.fg("muted", " · ")}${dcpTheme.fg("muted", `${selected.length} ${unit}`)}`;
  }
  return new TruncatedText(line);
}

/** Render a compression result, falling back to original text on any doubt. */
export function renderCompressResult(
  result: AgentToolResult<unknown>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: { isError: boolean },
): Component {
  const dcpTheme = createDcpTheme(theme);

  if (options.isPartial) {
    return new TruncatedText(dcpTheme.fg("warning", "Compression in progress"));
  }

  const originalText = extractOriginalText(result);

  if (context.isError) {
    const text = dcpTheme.fg("error", originalText || "Compression failed");
    return options.expanded ? new Text(text, 0, 0) : new TruncatedText(text);
  }

  const details = asRecord(result.details);
  const meta = details?.dcpCompression;
  if (isCompressionDisplayMetadata(meta)) {
    const header = buildHeader(dcpTheme, meta);
    if (!options.expanded) return new TruncatedText(header);
    const lines = [header];
    if (originalText) lines.push(dcpTheme.fg("toolOutput", originalText));
    if (meta.blockIds.length > 0) lines.push(buildBlocksLine(dcpTheme, meta.blockIds));
    return new Text(lines.join("\n"), 0, 0);
  }

  const text = dcpTheme.fg("toolOutput", originalText || "Compression result unavailable");
  return options.expanded ? new Text(text, 0, 0) : new TruncatedText(text);
}
