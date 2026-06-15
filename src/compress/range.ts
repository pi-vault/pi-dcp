import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { resolveBoundaryIndex, resolveSelection } from "./search.ts";
import {
  allocateBlockId,
  allocateRunId,
  applyCompressionState,
  wrapCompressedSummary,
  COMPRESSED_BLOCK_HEADER,
} from "./state.ts";
import { countTokens } from "../utils/tokens.ts";

export interface RangeCompressArgs {
  topic: string;
  content: Array<{
    startId: string;
    endId: string;
    summary: string;
  }>;
}

/**
 * Handle a range compress tool call.
 * Validates boundaries, resolves selection, applies compression state.
 * Returns a success message string.
 *
 * This is called from the tool handler registered via pi.registerTool().
 */
export function handleRangeCompress(
  state: SessionState,
  _config: DcpConfig,
  messages: AgentMessage[],
  args: RangeCompressArgs,
): string {
  if (!args.content || args.content.length === 0) {
    throw new Error("content array is required and must not be empty");
  }

  const runId = allocateRunId(state);
  let totalCompressed = 0;

  for (const entry of args.content) {
    if (!entry.startId || !entry.endId || !entry.summary) {
      throw new Error("Each content entry requires startId, endId, and summary");
    }

    const startIndex = resolveBoundaryIndex(state, entry.startId);
    if (startIndex === undefined) {
      throw new Error(
        `startId ${entry.startId} is not available. It may have been pruned or compressed. ` +
        `Choose a message ID (m0001) or block ref (b1) visible in the current context.`,
      );
    }

    const endIndex = resolveBoundaryIndex(state, entry.endId);
    if (endIndex === undefined) {
      throw new Error(
        `endId ${entry.endId} is not available. It may have been pruned or compressed. ` +
        `Choose a message ID (m0001) or block ref (b1) visible in the current context.`,
      );
    }

    const selection = resolveSelection(messages, startIndex, endIndex);
    const blockId = allocateBlockId(state);
    const wrappedSummary = wrapCompressedSummary(blockId, entry.summary);
    const summaryTokens = countTokens(wrappedSummary);

    // Find the compress tool call's message index (the current last message)
    const compressMessageIndex = messages.length - 1;

    applyCompressionState(state, {
      blockId,
      runId,
      topic: args.topic,
      batchTopic: args.topic,
      mode: "range",
      startIndex: selection.startIndex,
      endIndex: selection.endIndex,
      anchorIndex: selection.startIndex,
      compressMessageIndex,
      summary: wrappedSummary,
      summaryTokens,
      consumedBlockIds: [],
    });

    totalCompressed += selection.messageIndices.length;
  }

  return `Compressed ${totalCompressed} messages into ${COMPRESSED_BLOCK_HEADER}.`;
}
