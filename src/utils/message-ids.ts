export function formatMessageRef(index: number): string {
  return `m${String(index).padStart(4, "0")}`;
}

export function formatBlockRef(blockId: number): string {
  return `b${blockId}`;
}

export function parseMessageRef(ref: string): number | undefined {
  const match = /^m(\d{4})$/.exec(ref);
  if (!match) return undefined;
  return parseInt(match[1], 10);
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
