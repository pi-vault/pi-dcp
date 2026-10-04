import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * Derive a stable key from a message's properties plus a collision counter.
 * Counter is the 0-based occurrence index among messages sharing the same role:timestamp.
 * ToolResult messages use toolCallId (unique) so counter is ignored for them.
 */
export function getMessageKey(msg: AgentMessage, counter: number): string {
  if (msg.role === "toolResult") {
    return `toolResult:${(msg as unknown as { toolCallId: string }).toolCallId}`;
  }
  return `${msg.role}:${(msg as unknown as { timestamp: number }).timestamp}:${counter}`;
}

export function formatMessageRef(index: number): string {
  return `m${String(index).padStart(4, "0")}`;
}

export function formatBlockRef(blockId: number): string {
  return `b${blockId}`;
}

export function parseMessageRef(ref: string): number | undefined {
  const match = /^m(\d{4,})$/.exec(ref);
  if (!match) return undefined;
  const index = parseInt(match[1], 10);
  if (!Number.isSafeInteger(index) || index <= 0 || formatMessageRef(index) !== ref) {
    return undefined;
  }
  return index;
}

export function parseBlockRef(ref: string): number | undefined {
  const match = /^b(\d+)$/.exec(ref);
  if (!match) return undefined;
  const n = parseInt(match[1], 10);
  if (!Number.isSafeInteger(n) || n <= 0) return undefined;
  return n;
}

/**
 * Compact, model-facing message forms accepted as tool input.
 * Exact and whitespace-free: `m1` and `@m1@`, plus an optional 1-5 priority.
 * Partial padding (`m01`), wrapped padded refs (`@m0001@`), and zero are rejected.
 */
const COMPACT_MESSAGE = /^(?:m([1-9]\d*)|@m([1-9]\d*)(?::[1-5])?@)$/;

/** Parse a bare or wrapped compact message reference. Canonical-only refs never match. */
function parseCompactMessageRef(id: string): number | undefined {
  const match = COMPACT_MESSAGE.exec(id);
  if (!match) return undefined;
  const index = parseInt(match[1] ?? match[2], 10);
  if (!Number.isSafeInteger(index) || index <= 0) return undefined;
  return index;
}

export type ParsedBoundaryId =
  | { type: "message"; index: number }
  | { type: "block"; blockId: number };

export function parseBoundaryId(id: string): ParsedBoundaryId | undefined {
  const msgIndex = parseMessageRef(id) ?? parseCompactMessageRef(id);
  if (msgIndex !== undefined) return { type: "message", index: msgIndex };

  const blockId = parseBlockRef(id);
  if (blockId !== undefined) return { type: "block", blockId };

  return undefined;
}

/** Strict predicate for the canonical padded form (`m0001`) used in state and snapshots. */
export function isCanonicalMessageRef(ref: string): boolean {
  return parseMessageRef(ref) !== undefined;
}

const MAX_PRIORITY = 5;

/**
 * Render the compact marker shown to the model for a canonical ref: `@m1@`,
 * or `@m1:3@` when a priority is present. Compact markers are display-only —
 * stored and persisted refs stay canonical.
 */
export function formatMessageMarker(ref: string, priority?: number): string {
  const index = parseMessageRef(ref);
  if (index === undefined) {
    throw new RangeError(`formatMessageMarker requires a canonical message ref, got ${ref}`);
  }

  if (priority === undefined) return `@m${index}@`;

  if (!Number.isInteger(priority) || priority < 1 || priority > MAX_PRIORITY) {
    throw new RangeError(`formatMessageMarker priority must be an integer 1-${MAX_PRIORITY}`);
  }
  return `@m${index}:${priority}@`;
}
