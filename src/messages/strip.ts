import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { mapText } from "../utils/message-content.ts";

// 1. Complete paired tags: <dcp-foo attr="x">content</dcp-foo>
const DCP_COMPLETE_PAIR = /<dcp[-\w]*(?:\s[^>]*)?>[\s\S]*?<\/dcp[-\w]*>/gi;
// 2. Truncated pair (no final > on close): <dcp-foo>content</dcp-foo or </dcp
const DCP_TRUNCATED_PAIR = /<dcp[-\w]*(?:\s[^>]*)?>[\s\S]*?<\/dcp[-\w]*/gi;
// 3. Bounded message-ID suffixes or pairs, including the observed dpc transposition.
const DCP_MESSAGE_ID_SUFFIX_OR_PAIR =
  /(?:<(?:dcp|dpc)-message-id(?:\s[^>]*)?>)?m\d{4,}<\/(?:dcp|dpc)-message-id>/gi;
// 4. Orphan message-ID opening tag followed by a valid bounded reference.
const DCP_ORPHANED_MESSAGE_ID = /<(?:dcp|dpc)-message-id(?:\s[^>]*)?>m\d{4,}\b/gi;
// 5. Lone unpaired tags: </dcp-foo> or <dcp-foo>
const DCP_UNPAIRED_TAG = /<\/?dcp[-\w]*(?:\s[^>]*)?>/gi;
// 6. Partial tag at end of line/string: <dcp-message-id or </dcp or <dcp-foo priority="3
// Uses [^\S\n] (non-newline whitespace) so attribute matching doesn't cross lines.
const DCP_PARTIAL_TAG = /<\/?dcp[-\w]*(?:[^\S\n][^>\n]*)?$/gim;

/**
 * Strip hallucinated DCP tags from a string.
 * Handles complete pairs, truncated pairs, bounded message-ID suffixes or
 * pairs, orphan message-ID openings, lone unpaired tags, and partial tags.
 * Order matters: each more-specific pattern runs before its broader fallback.
 */
export function stripHallucinationsFromString(text: string): string {
  return text
    .replace(DCP_COMPLETE_PAIR, "")
    .replace(DCP_TRUNCATED_PAIR, "")
    .replace(DCP_MESSAGE_ID_SUFFIX_OR_PAIR, "")
    .replace(DCP_ORPHANED_MESSAGE_ID, "")
    .replace(DCP_UNPAIRED_TAG, "")
    .replace(DCP_PARTIAL_TAG, "");
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
