import type { AgentMessage } from "@earendil-works/pi-agent-core";

const DCP_PAIRED_TAG_REGEX = /<dcp[^>]*>[\s\S]*?<\/dcp[^>]*>/gi;
const DCP_UNPAIRED_TAG_REGEX = /<\/?dcp[^>]*>/gi;

/**
 * Strip hallucinated DCP tags from a string.
 */
export function stripHallucinationsFromString(text: string): string {
  return text.replace(DCP_PAIRED_TAG_REGEX, "").replace(DCP_UNPAIRED_TAG_REGEX, "");
}

/**
 * Strip hallucinated DCP tags from assistant messages.
 * Returns a new array. Messages without changes are returned by reference.
 */
export function stripHallucinations(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    if (!Array.isArray(msg.content)) return msg;

    let changed = false;
    const newContent = msg.content.map((part) => {
      if (typeof part !== "object" || part === null) return part;
      const p = part as unknown as Record<string, unknown>;
      if (p.type !== "text" || typeof p.text !== "string") return part;

      const cleaned = stripHallucinationsFromString(p.text as string);
      if (cleaned !== p.text) {
        changed = true;
        return { ...part, text: cleaned };
      }
      return part;
    });

    if (!changed) return msg;
    return { ...msg, content: newContent };
  });
}
