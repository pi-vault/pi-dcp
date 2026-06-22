import type { SessionState, CompressionBlock } from "../state/types.ts";
import { formatBlockRef } from "../utils/message-ids.ts";

/**
 * Prefix used in wrapped summary headers/footers.
 * Format: `[Compressed Block b{id}]\n{summary}\n[End Block b{id}]`
 *
 * The block ref (e.g. "b1") serves as the model-visible anchor for
 * referencing compressed content in subsequent compress calls.
 */
export const COMPRESSED_BLOCK_HEADER = "Compressed Block";

export function allocateBlockId(state: SessionState): number {
  const id = state.prune.messages.nextBlockId;
  state.prune.messages.nextBlockId = id + 1;
  return id;
}

export function allocateRunId(state: SessionState): number {
  const id = state.prune.messages.nextRunId;
  state.prune.messages.nextRunId = id + 1;
  return id;
}

/**
 * Wrap a summary with block delimiters visible to the model.
 * The delimiters let the model reference this block by its ref (e.g. "b1")
 * as a boundary in future compress calls.
 */
export function wrapCompressedSummary(blockId: number, summary: string): string {
  const ref = formatBlockRef(blockId);
  return `[${COMPRESSED_BLOCK_HEADER} ${ref}]\n${summary}\n[End Block ${ref}]`;
}

export interface ApplyCompressionParams {
  blockId: number;
  runId: number;
  topic: string;
  batchTopic?: string;
  mode: "range" | "message";
  startIndex: number;
  endIndex: number;
  anchorIndex: number;
  compressMessageIndex: number;
  summary: string;
  summaryTokens: number;
  consumedBlockIds: number[];
}

export function applyCompressionState(
  state: SessionState,
  params: ApplyCompressionParams,
): { messageIndices: number[] } {
  const now = Date.now();
  const messageIndices: number[] = [];

  // Create the block
  const block: CompressionBlock = {
    blockId: params.blockId,
    runId: params.runId,
    active: true,
    deactivatedByUser: false,
    compressedTokens: 0,
    summaryTokens: params.summaryTokens,
    durationMs: 0,
    mode: params.mode,
    topic: params.topic,
    batchTopic: params.batchTopic,
    startIndex: params.startIndex,
    endIndex: params.endIndex,
    anchorIndex: params.anchorIndex,
    compressMessageIndex: params.compressMessageIndex,
    includedBlockIds: [],
    consumedBlockIds: params.consumedBlockIds,
    parentBlockIds: [],
    directMessageIndices: [],
    directToolIds: [],
    effectiveMessageIndices: [],
    effectiveToolIds: [],
    createdAt: now,
    deactivatedAt: undefined,
    deactivatedByBlockId: undefined,
    summary: params.summary,
  };

  // Mark messages in range
  let totalTokens = 0;
  for (let i = params.startIndex; i <= params.endIndex; i++) {
    messageIndices.push(i);

    let entry = state.prune.messages.byMessageIndex.get(i);
    if (!entry) {
      entry = {
        tokenCount: 0,
        blockIds: [],
        activeBlockIds: [],
      };
      state.prune.messages.byMessageIndex.set(i, entry);
    }

    if (!entry.blockIds.includes(params.blockId)) {
      entry.blockIds.push(params.blockId);
    }
    if (!entry.activeBlockIds.includes(params.blockId)) {
      entry.activeBlockIds.push(params.blockId);
    }

    totalTokens += entry.tokenCount;
  }

  block.compressedTokens = totalTokens;
  block.directMessageIndices = messageIndices;
  block.effectiveMessageIndices = messageIndices;

  // Deactivate consumed blocks
  for (const consumedId of params.consumedBlockIds) {
    const consumed = state.prune.messages.blocksById.get(consumedId);
    if (consumed) {
      consumed.active = false;
      consumed.deactivatedAt = now;
      consumed.deactivatedByBlockId = params.blockId;
      state.prune.messages.activeBlockIds.delete(consumedId);

      // Find and remove anchor mapping
      for (const [anchorIdx, bId] of state.prune.messages.activeByAnchorIndex) {
        if (bId === consumedId) {
          state.prune.messages.activeByAnchorIndex.delete(anchorIdx);
        }
      }
    }
    block.includedBlockIds.push(consumedId);
  }

  // Store the block
  state.prune.messages.blocksById.set(params.blockId, block);
  state.prune.messages.activeBlockIds.add(params.blockId);
  state.prune.messages.activeByAnchorIndex.set(params.anchorIndex, params.blockId);

  return { messageIndices };
}

/**
 * Apply pending compression durations to their corresponding blocks.
 * Called at the start of each pipeline pass.
 *
 * Reads callIdToBlockId to find the target block, applies the duration from
 * pendingDurations, then clears both maps.
 */
export function applyPendingCompressionDurations(state: SessionState): void {
  if (state.compressionTiming.pendingDurations.size === 0) return;

  for (const [callId, durationMs] of state.compressionTiming.pendingDurations) {
    const blockId = state.compressionTiming.callIdToBlockId.get(callId);
    if (blockId !== undefined) {
      const block = state.prune.messages.blocksById.get(blockId);
      if (block) {
        block.durationMs = durationMs;
      }
    }
  }

  state.compressionTiming.callIdToBlockId.clear();
  state.compressionTiming.pendingDurations.clear();
}
