import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { mapText } from "../utils/message-content.ts";

// 1. Complete paired tags: <dcp-foo attr="x">content</dcp-foo>
const DCP_COMPLETE_PAIR = /<dcp[-\w]*(?:\s[^>]*)?>[\s\S]*?<\/dcp[-\w]*>/gi;
// 2. Truncated pair (no final > on close): <dcp-foo>content</dcp-foo or </dcp
const DCP_TRUNCATED_PAIR = /<dcp[-\w]*(?:\s[^>]*)?>[\s\S]*?<\/dcp[-\w]*/gi;
// 3. Lone unpaired tags: </dcp-foo> or <dcp-foo>
const DCP_UNPAIRED_TAG = /<\/?dcp[-\w]*(?:\s[^>]*)?>/gi;
// 4. Partial tag at end of line/string: <dcp-message-id or </dcp or <dcp-foo priority="3
// Uses [^\S\n] (non-newline whitespace) so attribute matching doesn't cross lines.
const DCP_PARTIAL_TAG = /<\/?dcp[-\w]*(?:[^\S\n][^>\n]*)?$/gim;
// 5. Inline residual: prefix-less dcp-* fragment with closing `>`.
// Anchored on (^|[^\w-]) so it doesn't match inside identifiers like
// "m0103-dcp-message-id>". Requires `>` so prose that merely mentions
// the namespace is not swallowed.
const DCP_RESIDUAL_INLINE =
  /(^|[^\w-])-?dcp-(?:message-id|system-reminder)\b[^<>\n]*>/gi;

/**
 * Strip hallucinated DCP tags from a string.
 * Handles complete paired tags, truncated pairs, lone unpaired tags, and
 * partial tags at end of string. Order matters: complete pairs first (they
 * consume the closing >), then truncated pairs, then lone tags, then partials.
 */
export function stripHallucinationsFromString(text: string): string {
  return text
    .replace(DCP_COMPLETE_PAIR, "")
    .replace(DCP_TRUNCATED_PAIR, "")
    .replace(DCP_UNPAIRED_TAG, "")
    .replace(DCP_PARTIAL_TAG, "")
    .replace(DCP_RESIDUAL_INLINE, "");
}

/**
 * Strip hallucinated DCP tags from assistant messages.
 * Returns a new array. Messages without changes are returned by reference.
 */
export function stripHallucinations(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    return mapText(msg, stripHallucinationsFromString);
  });
}
