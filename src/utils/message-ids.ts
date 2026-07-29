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
  if (n <= 0) return undefined;
  return n;
}

export type ParsedBoundaryId =
  | { type: "message"; index: number }
  | { type: "block"; blockId: number };

export function parseBoundaryId(id: string): ParsedBoundaryId | undefined {
  const msgIndex = parseMessageRef(id);
  if (msgIndex !== undefined) return { type: "message", index: msgIndex };

  const blockId = parseBlockRef(id);
  if (blockId !== undefined) return { type: "block", blockId };

  return undefined;
}

export function formatMessageIdTag(
  ref: string,
  attrs?: { priority?: number },
): string {
  if (attrs?.priority !== undefined) {
    return `<dcp-message-id priority="${attrs.priority}">${ref}</dcp-message-id>`;
  }
  return `<dcp-message-id>${ref}</dcp-message-id>`;
}
