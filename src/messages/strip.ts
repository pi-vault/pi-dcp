import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { mapText } from "../utils/message-content.ts";

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
    return mapText(msg, stripHallucinationsFromString);
  });
}
