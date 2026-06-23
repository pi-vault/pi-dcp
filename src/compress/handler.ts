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
import { enrichSummaryWithProtectedContent } from "./protected-content.ts";

export interface CompressArgs {
  topic: string;
  mode: "range" | "message";
  content?: Array<{
    startId: string;
    endId: string;
    summary: string;
  }>;
  targets?: Array<{
    messageId: string;
    summary: string;
  }>;
}

interface NormalizedEntry {
  startIndex: number;
  endIndex: number;
  summary: string;
  messageCount: number;
}

/**
 * Handle any compress tool call regardless of mode.
 * Normalizes input, resolves boundaries, applies compression state.
 */
export function handleCompress(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  args: CompressArgs,
): string {
  const entries = normalizeEntries(state, messages, args);
  const runId = allocateRunId(state);
  let totalCompressed = 0;
  let totalCompressedTokens = 0;
  let totalSummaryTokens = 0;

  for (const entry of entries) {
    const blockId = allocateBlockId(state);
    const rangeMessages = messages.slice(entry.startIndex, entry.endIndex + 1);
    const enrichedSummary = enrichSummaryWithProtectedContent(
      entry.summary,
      rangeMessages,
      config,
      state.subAgentResultCache,
    );
    const wrappedSummary = wrapCompressedSummary(blockId, enrichedSummary);
    const summaryTokens = countTokens(wrappedSummary);
    const compressMessageIndex = messages.length - 1;

    applyCompressionState(state, {
      blockId,
      runId,
      topic: args.topic,
      batchTopic: args.topic,
      mode: args.mode,
      startIndex: entry.startIndex,
      endIndex: entry.endIndex,
      anchorIndex: entry.startIndex,
      compressMessageIndex,
      summary: wrappedSummary,
      summaryTokens,
      consumedBlockIds: [],
    });

    totalCompressed += entry.messageCount;

    // Read back compressedTokens and summaryTokens (populated by applyCompressionState)
    const block = state.prune.messages.blocksById.get(blockId);
    if (block) {
      totalCompressedTokens += block.compressedTokens;
      totalSummaryTokens += block.summaryTokens;
    }
  }

  const savings =
    totalCompressedTokens > 0
      ? ` (~${totalCompressedTokens} tokens replaced by ~${totalSummaryTokens} token summary)`
      : "";
  return `Compressed ${totalCompressed} messages into ${COMPRESSED_BLOCK_HEADER}${savings}.`;
}

/**
 * Normalize range or message args into a common form.
 * Validates input and resolves boundary IDs to indices.
 */
function normalizeEntries(
  state: SessionState,
  messages: AgentMessage[],
  args: CompressArgs,
): NormalizedEntry[] {
  if (args.mode === "range") {
    if (!args.content || args.content.length === 0) {
      throw new Error("content array is required and must not be empty");
    }

    return args.content.map((entry) => {
      if (!entry.startId || !entry.endId || !entry.summary) {
        throw new Error(
          "Each content entry requires startId, endId, and summary",
        );
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

      const selection = resolveSelection(messages, startIndex, endIndex, state);
      return {
        startIndex: selection.startIndex,
        endIndex: selection.endIndex,
        summary: entry.summary,
        messageCount: selection.messageIndices.length,
      };
    });
  }

  // mode === "message"
  if (!args.targets || args.targets.length === 0) {
    throw new Error("targets array is required and must not be empty");
  }

  return args.targets.map((target) => {
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

    return {
      startIndex: index,
      endIndex: index,
      summary: target.summary,
      messageCount: 1,
    };
  });
}
