import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CompressConfig } from "../config.ts";

/** Human-readable description of a pending compression request. */
export interface CompressionRequestDescription {
  topic: string;
  targetCount: number;
  targetLabel: "range" | "target";
}

const UNTITLED_TOPIC = "Untitled compression";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidRange(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.startId === "string" &&
    typeof value.endId === "string" &&
    typeof value.summary === "string"
  );
}

function isValidTarget(value: unknown): boolean {
  return (
    isRecord(value) && typeof value.messageId === "string" && typeof value.summary === "string"
  );
}

/**
 * Summarize a compress call for the confirmation dialog. Malformed or absent
 * arrays count as zero valid items; the array chosen follows the configured mode.
 */
export function describeCompressionRequest(
  mode: CompressConfig["mode"],
  input: Record<string, unknown>,
): CompressionRequestDescription {
  const rawTopic = typeof input.topic === "string" ? input.topic.trim() : "";
  const topic = rawTopic.length > 0 ? rawTopic : UNTITLED_TOPIC;

  if (mode === "message") {
    const targets = Array.isArray(input.targets) ? input.targets : [];
    return { topic, targetCount: targets.filter(isValidTarget).length, targetLabel: "target" };
  }

  const content = Array.isArray(input.content) ? input.content : [];
  return { topic, targetCount: content.filter(isValidRange).length, targetLabel: "range" };
}

/** Modes whose UI can render an extension confirmation dialog. */
function isDialogCapable(ctx: ExtensionContext): boolean {
  return (ctx.mode === "tui" || ctx.mode === "rpc") && ctx.hasUI;
}

/**
 * Request per-call approval for an `ask` compression.
 *
 * Returns `undefined` when approved; otherwise the error reason to surface.
 * Fails closed when the mode cannot render dialogs or dialog UI is unavailable.
 */
export async function requestCompressionApproval(
  mode: CompressConfig["mode"],
  input: Record<string, unknown>,
  ctx: ExtensionContext,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!isDialogCapable(ctx)) return "Compression requires interactive approval";

  const { topic, targetCount, targetLabel } = describeCompressionRequest(mode, input);
  const pluralized = `${targetCount} ${targetLabel}${targetCount === 1 ? "" : "s"}`;
  const message = `Compress "${topic}"?\n\nThis call will compress ${pluralized}.`;

  try {
    const approved = await ctx.ui.confirm("Allow DCP compression?", message, {
      signal: signal ?? ctx.signal,
    });
    return approved ? undefined : "Compression was not approved";
  } catch {
    return "Compression was not approved";
  }
}
