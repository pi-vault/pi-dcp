import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { mapText } from "../utils/message-content.ts";

// 1. A line whose entire content is a compact marker: `@m1@`, `@m1:3@`, or a
// truncated `@m1` / `@m1:` / `@m1:2`. Line-bounded on purpose so inline markers,
// email addresses, and mentions are never touched. The line boundary itself is
// preserved (only the content is removed) so surrounding prose is not concatenated.
// Tolerant by design: marker-like but invalid numeric values are removed too,
// because this protects stored assistant output. The tool-input parser stays strict.
const DCP_COMPACT_MARKER_LINE = /^[^\S\n\r]*@m\d+(?::\d*)?@?[^\S\n\r]*$/gm;
// 2. Complete paired tags: <dcp-foo attr="x">content</dcp-foo>
const DCP_COMPLETE_PAIR = /<dcp[-\w]*(?:\s[^>]*)?>[\s\S]*?<\/dcp[-\w]*>/gi;
// 2. Truncated pair (no final > on close): <dcp-foo>content</dcp-foo or </dcp
const DCP_TRUNCATED_PAIR = /<dcp[-\w]*(?:\s[^>]*)?>[\s\S]*?<\/dcp[-\w]*/gi;
// 3. Bounded message-ID suffixes or pairs, including the observed dpc transposition.
const DCP_MESSAGE_ID_SUFFIX_OR_PAIR =
  /(?:<(?:dcp|dpc)-message-id(?:\s[^>]*)?>)?(?<!\p{ID_Continue})m\d{4,}<\/(?:dcp|dpc)-message-id>/giu;
// 4. Orphan message-ID opening tag followed by a valid bounded reference.
const DCP_ORPHANED_MESSAGE_ID = /<(?:dcp|dpc)-message-id(?:\s[^>]*)?>m\d{4,}(?!\p{ID_Continue})/giu;
// 5. Lone unpaired tags: </dcp-foo> or <dcp-foo>
const DCP_UNPAIRED_TAG = /<\/?dcp[-\w]*(?:\s[^>]*)?>/gi;
// 6. Partial tag at end of line/string: <dcp-message-id or </dcp or <dcp-foo priority="3
// Uses [^\S\n] (non-newline whitespace) so attribute matching doesn't cross lines.
const DCP_PARTIAL_TAG = /<\/?dcp[-\w]*(?:[^\S\n][^>\n]*)?$/gim;

/**
 * Strip hallucinated DCP metadata from a string.
 * Removes standalone compact marker lines first, then handles complete pairs,
 * truncated pairs, bounded message-ID suffixes or pairs, orphan message-ID
 * openings, lone unpaired tags, and partial tags.
 * Order matters: each more-specific pattern runs before its broader fallback.
 */
export function stripHallucinationsFromString(text: string): string {
  return text
    .replace(DCP_COMPACT_MARKER_LINE, "")
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
