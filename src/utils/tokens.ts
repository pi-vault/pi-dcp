import { countTokens as anthropicCountTokens } from "@anthropic-ai/tokenizer";

/**
 * Count tokens using the Anthropic tokenizer (Claude's vocabulary).
 * Falls back to character-based estimation (length/4) if the tokenizer
 * throws (e.g., invalid input or WASM initialization failure).
 */
export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  try {
    return anthropicCountTokens(text);
  } catch {
    return Math.max(1, Math.round(text.length / 4));
  }
}

export function countTokensBatch(texts: string[]): number {
  if (texts.length === 0) return 0;
  return countTokens(texts.join(" "));
}

/**
 * Extract all text content from a message-shaped object for token counting.
 * Handles UserMessage (string | TextContent[]), AssistantMessage (TextContent +
 * ToolCallContent), and ToolResultMessage.
 */
export function extractMessageText(message: {
  role: string;
  content?: unknown;
}): string {
  const content = message.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const p = part as Record<string, unknown>;
    if (p.type === "text" && typeof p.text === "string") {
      parts.push(p.text);
    } else if (p.type === "toolCall") {
      if (typeof p.name === "string") parts.push(p.name);
      if (p.arguments && typeof p.arguments === "object") {
        parts.push(JSON.stringify(p.arguments));
      }
    }
  }
  return parts.join(" ");
}

export function countMessageTokens(message: {
  role: string;
  content?: unknown;
}): number {
  return countTokens(extractMessageText(message));
}
