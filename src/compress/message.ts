import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { resolveBoundaryIndex } from "./search.ts";
import {
  allocateBlockId,
  allocateRunId,
  applyCompressionState,
  wrapCompressedSummary,
  COMPRESSED_BLOCK_HEADER,
} from "./state.ts";
import { countTokens } from "../utils/tokens.ts";

export interface MessageCompressArgs {
  topic: string;
  targets: Array<{
    messageId: string;
    summary: string;
  }>;
}

/**
 * Handle a message-mode compress tool call.
 * Each target compresses a single message by its ref ID.
 */
export function handleMessageCompress(
  state: SessionState,
  _config: DcpConfig,
  messages: AgentMessage[],
  args: MessageCompressArgs,
): string {
  if (!args.targets || args.targets.length === 0) {
    throw new Error("targets array is required and must not be empty");
  }

  const runId = allocateRunId(state);
  let totalCompressed = 0;

  for (const target of args.targets) {
    if (!target.messageId || !target.summary) {
      throw new Error("Each target requires messageId and summary");
    }

    const index = resolveBoundaryIndex(state, target.messageId);
    if (index === undefined) {
      throw new Error(
        `messageId ${target.messageId} is not available. It may have been pruned or compressed. ` +
        `Choose a message ID (m0001) visible in the current context.`,
      );
    }

    const blockId = allocateBlockId(state);
    const wrappedSummary = wrapCompressedSummary(blockId, target.summary);
    const summaryTokens = countTokens(wrappedSummary);
    const compressMessageIndex = messages.length - 1;

    applyCompressionState(state, {
      blockId,
      runId,
      topic: args.topic,
      batchTopic: args.topic,
      mode: "message",
      startIndex: index,
      endIndex: index,
      anchorIndex: index,
      compressMessageIndex,
      summary: wrappedSummary,
      summaryTokens,
      consumedBlockIds: [],
    });

    totalCompressed++;
  }

  return `Compressed ${totalCompressed} messages into ${COMPRESSED_BLOCK_HEADER}.`;
}
