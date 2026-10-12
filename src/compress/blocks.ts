import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { getProtectedTurnStart, resolveBoundaryIndex, resolveSelection } from "./search.ts";
import {
  allocateBlockId,
  allocateRunId,
  getEligibleCompressionBlockIds,
  rebuildCompressionState,
  storeCompressionState,
  wrapCompressedSummary,
  COMPRESSED_BLOCK_HEADER,
} from "./block-graph.ts";
import { countMessageTokens, countTokens } from "../utils/tokens.ts";
import { enrichSummaryWithProtectedContent } from "./protected-content.ts";

export interface CompressResult {
  /** Text returned to the model as tool output. */
  text: string;
  /** Total messages compressed in this call. */
  messagesCompressed: number;
  /** Tokens removed by compression. */
  compressedTokens: number;
  /** Tokens in the replacement summaries. */
  summaryTokens: number;
  /** Block IDs created by this call. */
  blockIds: number[];
  /** Topic label provided by the model. */
  topic: string;
}

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

interface PreparedCompression {
  startIndex: number;
  endIndex: number;
  startKey: string;
  endKey: string;
  summary: string;
  summaryTokens: number;
  compressedTokens: number;
  directMessageIndices: number[];
  directToolIds: string[];
  effectiveMessageIndices: number[];
  effectiveToolIds: string[];
  consumedBlockIds: number[];
}

/**
 * Handle any compress tool call regardless of mode.
 * Normalizes input, resolves boundaries, applies compression state.
 */
export function handleCompress(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  compressToolCallId: string,
  args: CompressArgs,
): CompressResult {
  const entries = prepareCompressions(state, config, messages, args);
  const protectedStart = getProtectedTurnStart(messages, config.turnProtection);
  if (protectedStart !== undefined && entries.some((entry) => entry.endIndex >= protectedStart)) {
    throw new Error(
      "Compression overlaps the turnProtection protected window; choose only older messages.",
    );
  }
  const entriesByStart = [...entries].sort((a, b) => a.startIndex - b.startIndex);
  for (let i = 1; i < entriesByStart.length; i++) {
    if (entriesByStart[i].startIndex <= entriesByStart[i - 1].endIndex) {
      throw new Error("Overlapping compression selections are not allowed.");
    }
  }
  const runId = allocateRunId(state);
  let totalCompressed = 0;
  let totalCompressedTokens = 0;
  let totalSummaryTokens = 0;
  const blockIds: number[] = [];
  const eligibleBlockIds = getEligibleCompressionBlockIds(state);

  for (const entry of entries) {
    const blockId = allocateBlockId(state);
    blockIds.push(blockId);
    const block = storeCompressionState(state, {
      blockId,
      runId,
      topic: args.topic,
      batchTopic: args.topic,
      mode: args.mode,
      startIndex: entry.startIndex,
      endIndex: entry.endIndex,
      anchorIndex: entry.startIndex,
      compressToolCallId,
      startKey: entry.startKey,
      endKey: entry.endKey,
      anchorKey: entry.startKey,
      summary: entry.summary,
      summaryTokens: entry.summaryTokens,
      consumedBlockIds: entry.consumedBlockIds,
    });
    eligibleBlockIds.add(blockId);

    totalCompressed += entry.effectiveMessageIndices.length;

    block.compressedTokens = entry.compressedTokens;
    block.directMessageIndices = entry.directMessageIndices;
    block.directToolIds = entry.directToolIds;
    block.effectiveMessageIndices = entry.effectiveMessageIndices;
    block.effectiveToolIds = entry.effectiveToolIds;
    totalCompressedTokens += entry.compressedTokens;
    totalSummaryTokens += entry.summaryTokens;
  }

  rebuildCompressionState(state, eligibleBlockIds);

  // Fix: messagesCompressed stat was defined but never incremented
  state.stats.messagesCompressed += totalCompressed;

  const savings =
    totalCompressedTokens > 0
      ? ` (~${totalCompressedTokens - totalSummaryTokens} tokens saved from ~${totalCompressedTokens} tokens; ~${totalSummaryTokens} token summary)`
      : "";

  return {
    text: `Compressed ${totalCompressed} messages into ${COMPRESSED_BLOCK_HEADER}${savings}.`,
    messagesCompressed: totalCompressed,
    compressedTokens: totalCompressedTokens,
    summaryTokens: totalSummaryTokens,
    blockIds,
    topic: args.topic,
  };
}

/**
 * Normalize range or message args into a common form.
 * Validates input and resolves boundary IDs to indices.
 */
function prepareCompressions(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  args: CompressArgs,
): PreparedCompression[] {
  const entries = normalizeEntries(state, messages, args);
  return entries.map((entry, offset) => {
    const startKey = getRawMessageKey(state, entry.startIndex);
    const endKey = getRawMessageKey(state, entry.endIndex);
    const blockId = state.prune.messages.nextBlockId + offset;
    const summary = wrapCompressedSummary(
      blockId,
      enrichSummaryWithProtectedContent(
        entry.summary,
        messages.slice(entry.startIndex, entry.endIndex + 1),
        config,
        state.subAgentResultCache,
      ),
    );
    const coveredMessageIndices = new Set(
      entry.selection.consumedBlockIds.flatMap(
        (blockId) => state.prune.messages.blocksById.get(blockId)?.effectiveMessageIndices ?? [],
      ),
    );
    const directMessageIndices = entry.selection.directMessageIndices.filter(
      (index) => !coveredMessageIndices.has(index),
    );
    const compressedTokens =
      entry.selection.consumedBlockIds.reduce(
        (total, blockId) =>
          total + (state.prune.messages.blocksById.get(blockId)?.summaryTokens ?? 0),
        0,
      ) +
      directMessageIndices.reduce((total, index) => {
        const tokenCount = state.prune.messages.byMessageIndex.get(index)?.tokenCount;
        return (
          total +
          (tokenCount !== undefined && tokenCount > 0
            ? tokenCount
            : countMessageTokens(messages[index]))
        );
      }, 0);

    return {
      startIndex: entry.startIndex,
      endIndex: entry.endIndex,
      startKey,
      endKey,
      summary,
      summaryTokens: countTokens(summary),
      compressedTokens,
      directMessageIndices,
      directToolIds: entry.selection.directToolIds,
      effectiveMessageIndices: entry.selection.messageIndices,
      effectiveToolIds: entry.selection.toolIds,
      consumedBlockIds: entry.selection.consumedBlockIds,
    };
  });
}

function getRawMessageKey(state: SessionState, index: number): string {
  const ref = state.messageIds.byIndex.get(index);
  const key = ref && state.messageIds.byRef.get(ref);
  if (!key) throw new Error(`Message at index ${index} has no stable message key.`);
  return key;
}

function normalizeEntries(
  state: SessionState,
  messages: AgentMessage[],
  args: CompressArgs,
): Array<{
  startIndex: number;
  endIndex: number;
  summary: string;
  selection: ReturnType<typeof resolveSelection>;
}> {
  if (args.mode === "range") {
    if (!args.content || args.content.length === 0) {
      throw new Error("content array is required and must not be empty");
    }

    return args.content.map((entry) => {
      if (!entry.startId || !entry.endId || !entry.summary) {
        throw new Error("Each content entry requires startId, endId, and summary");
      }

      const startIndex = resolveBoundaryIndex(state, entry.startId);
      if (startIndex === undefined) {
        throw new Error(
          `startId ${entry.startId} is not available. It may have been pruned or compressed. ` +
            `Choose a message marker (m1 or @m1@) or block ref (b1) visible in the current context.`,
        );
      }

      const endIndex = resolveBoundaryIndex(state, entry.endId);
      if (endIndex === undefined) {
        throw new Error(
          `endId ${entry.endId} is not available. It may have been pruned or compressed. ` +
            `Choose a message marker (m1 or @m1@) or block ref (b1) visible in the current context.`,
        );
      }

      const selection = resolveSelection(messages, startIndex, endIndex, state);
      return {
        startIndex: selection.startIndex,
        endIndex: selection.endIndex,
        summary: entry.summary,
        selection,
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
          `Choose a message marker (m1 or @m1@) visible in the current context.`,
      );
    }

    const selection = resolveSelection(messages, index, index, state);
    return {
      startIndex: selection.startIndex,
      endIndex: selection.endIndex,
      summary: target.summary,
      selection,
    };
  });
}

/**
 * Deactivate an active compression block so its original content is restored.
 * Returns the same domain messages as the historic decompress command.
 */
export function decompressBlock(state: SessionState, args: string): string {
  const blockIdStr = args.trim();
  if (!blockIdStr) return "Usage: dcp:decompress <blockId>";

  const blockId = Number.parseInt(blockIdStr, 10);
  if (Number.isNaN(blockId)) return `Invalid block ID: ${blockIdStr}`;

  const block = state.prune.messages.blocksById.get(blockId);
  if (!block) return `Block ${blockId} not found.`;
  if (!block.active) return `Block ${blockId} is already inactive.`;

  const eligibleBlockIds = getEligibleCompressionBlockIds(state);
  block.active = false;
  block.deactivatedByUser = true;
  block.deactivatedAt = Date.now();
  rebuildCompressionState(state, eligibleBlockIds);

  return `Block ${blockId} deactivated. Original messages will be restored on next context pass.`;
}

/**
 * Restore a user-deactivated block's eligibility using its existing summary.
 * A consuming parent can still keep the block hidden.
 */
export function recompressBlock(state: SessionState, args: string): string {
  const blockIdStr = args.trim();
  if (!blockIdStr) return "Usage: dcp:recompress <blockId>";

  const blockId = Number.parseInt(blockIdStr, 10);
  if (Number.isNaN(blockId)) return `Invalid block ID: ${blockIdStr}`;

  const block = state.prune.messages.blocksById.get(blockId);
  if (!block) return `Block ${blockId} not found.`;
  if (block.active) return `Block ${blockId} is already active.`;
  if (!block.deactivatedByUser)
    return `Block ${blockId} was not deactivated by user. Cannot reactivate.`;

  const eligibleBlockIds = getEligibleCompressionBlockIds(state);
  eligibleBlockIds.add(blockId);
  block.deactivatedByUser = false;
  block.deactivatedAt = undefined;
  rebuildCompressionState(state, eligibleBlockIds);

  return `Block ${blockId} reactivated. Compression will apply on next context pass.`;
}

/**
 * Toggle a block from its current runtime state, as the panel dispatches it.
 * Missing/stale IDs fall through to recompression's domain error.
 */
export function toggleBlock(state: SessionState, blockId: number): string {
  const block = state.prune.messages.blocksById.get(blockId);
  return block?.active
    ? decompressBlock(state, String(blockId))
    : recompressBlock(state, String(blockId));
}

/**
 * Reconcile compression blocks with their owning assistant tool calls.
 */
export function syncCompressionBlocks(state: SessionState, messages: AgentMessage[]): void {
  const messagesState = state.prune.messages;
  if (messagesState.blocksById.size === 0) return;

  const keyToIndex = new Map<string, number>();
  for (const [index, ref] of state.messageIds.byIndex) {
    const key = state.messageIds.byRef.get(ref);
    if (key) keyToIndex.set(key, index);
  }

  state.prune.messages.byMessageIndex.clear();
  for (const [blockId, block] of messagesState.blocksById) {
    const startIndex = keyToIndex.get(block.startKey);
    const endIndex = keyToIndex.get(block.endKey);
    const anchorIndex = keyToIndex.get(block.anchorKey);
    if (
      startIndex === undefined ||
      endIndex === undefined ||
      anchorIndex === undefined ||
      startIndex > endIndex ||
      !state.toolParameters.has(block.compressToolCallId)
    ) {
      messagesState.blocksById.delete(blockId);
      continue;
    }

    block.startIndex = startIndex;
    block.endIndex = endIndex;
    block.anchorIndex = anchorIndex;
    block.parentBlockIds = [];
    block.effectiveMessageIndices = Array.from(
      { length: endIndex - startIndex + 1 },
      (_, offset) => startIndex + offset,
    );
    block.effectiveToolIds = collectToolIds(messages, block.effectiveMessageIndices);
  }

  const blockIds = new Set(messagesState.blocksById.keys());
  for (const block of messagesState.blocksById.values()) {
    block.consumedBlockIds = block.consumedBlockIds.filter((id) => blockIds.has(id));
    for (const childId of block.consumedBlockIds) {
      const child = messagesState.blocksById.get(childId);
      if (child && !child.parentBlockIds.includes(block.blockId)) {
        child.parentBlockIds.push(block.blockId);
      }
    }
    const coveredIndices = new Set(
      block.consumedBlockIds.flatMap(
        (id) => messagesState.blocksById.get(id)?.effectiveMessageIndices ?? [],
      ),
    );
    block.directMessageIndices = block.effectiveMessageIndices.filter(
      (index) => !coveredIndices.has(index),
    );
    block.directToolIds = collectToolIds(messages, block.directMessageIndices);
  }

  rebuildCompressionState(state, new Set(messagesState.blocksById.keys()));
}

function collectToolIds(messages: AgentMessage[], indices: number[]): string[] {
  const toolIds = new Set<string>();
  for (const index of indices) {
    const message = messages[index];
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "toolCall" && typeof part.id === "string") toolIds.add(part.id);
    }
  }
  return [...toolIds].sort();
}

/**
 * Sum the summaryTokens of all active compression blocks.
 * Used by the summary buffer feature to extend the effective threshold.
 */
export function getActiveSummaryTokenUsage(state: SessionState): number {
  let total = 0;
  for (const blockId of state.prune.messages.activeBlockIds) {
    const block = state.prune.messages.blocksById.get(blockId);
    if (block?.active) {
      total += block.summaryTokens;
    }
  }
  return total;
}
