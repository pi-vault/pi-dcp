import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * Find the index of the first text part in a content array.
 * Returns -1 if no text part exists.
 */
function findTextPartIndex(content: unknown[]): number {
  return content.findIndex(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      (p as unknown as Record<string, unknown>).type === "text",
  );
}

/**
 * Append text to the first text part of a message.
 * Idempotent: skips if marker string is already present in the text part.
 * Handles E9 string content, array content, and missing text parts.
 * Returns the original message by reference if no change was made.
 */
export function appendText(
  msg: AgentMessage,
  text: string,
  marker?: string,
): AgentMessage {
  if (!("content" in msg)) return msg;

  // E9: UserMessage.content can be a plain string
  if (typeof msg.content === "string") {
    if (marker && msg.content.includes(marker)) return msg;
    return {
      ...msg,
      content: [{ type: "text" as const, text: `${msg.content}${text}` }],
    } as AgentMessage;
  }

  if (!Array.isArray(msg.content)) return msg;

  const idx = findTextPartIndex(msg.content);
  if (idx === -1) return msg;

  const textPart = msg.content[idx] as unknown as {
    type: string;
    text: string;
  };
  if (marker && textPart.text.includes(marker)) return msg;

  const newContent = [...msg.content];
  newContent[idx] = {
    ...textPart,
    text: `${textPart.text}${text}`,
  } as (typeof newContent)[number];

  return { ...msg, content: newContent } as AgentMessage;
}

/**
 * Transform all text parts in a message via a mapping function.
 * Returns the original message by reference if fn returns identical strings.
 */
export function mapText(
  msg: AgentMessage,
  fn: (text: string) => string,
): AgentMessage {
  if (!("content" in msg)) return msg;
  if (!Array.isArray(msg.content)) return msg;

  let changed = false;
  const newContent = msg.content.map((part) => {
    if (typeof part !== "object" || part === null) return part;
    const p = part as unknown as Record<string, unknown>;
    if (p.type !== "text" || typeof p.text !== "string") return part;

    const mapped = fn(p.text as string);
    if (mapped !== p.text) {
      changed = true;
      return { ...part, text: mapped };
    }
    return part;
  });

  if (!changed) return msg;
  return { ...msg, content: newContent } as AgentMessage;
}
