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
  compressToolCallId: string;
  startKey: string;
  endKey: string;
  anchorKey: string;
  summary: string;
  summaryTokens: number;
  consumedBlockIds: number[];
}

export function applyCompressionState(state: SessionState, params: ApplyCompressionParams): void {
  storeCompressionState(state, params);
  rebuildCompressionState(state, getEligibleCompressionBlockIds(state));
}

/** Store a block and its stable memberships; rebuild derived visibility separately. */
export function storeCompressionState(
  state: SessionState,
  params: ApplyCompressionParams,
): CompressionBlock {
  const now = Date.now();
  const messageIndices = Array.from(
    { length: params.endIndex - params.startIndex + 1 },
    (_, offset) => params.startIndex + offset,
  );

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
    compressToolCallId: params.compressToolCallId,
    startKey: params.startKey,
    endKey: params.endKey,
    anchorKey: params.anchorKey,
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

  block.directMessageIndices = messageIndices;
  block.effectiveMessageIndices = messageIndices;

  // Store the parent before associating it with consumed children.
  state.prune.messages.blocksById.set(params.blockId, block);

  for (const consumedId of params.consumedBlockIds) {
    const consumed = state.prune.messages.blocksById.get(consumedId);
    if (consumed && !consumed.parentBlockIds.includes(params.blockId)) {
      consumed.parentBlockIds.push(params.blockId);
    }
  }

  return block;
}

/** Candidates retained across rebuilds, including blocks hidden by a parent. */
export function getEligibleCompressionBlockIds(state: SessionState): Set<number> {
  return new Set(
    [...state.prune.messages.blocksById.values()]
      .filter((block) => block.active || block.deactivatedByBlockId !== undefined)
      .map((block) => block.blockId),
  );
}

/** Recompute all derived compression visibility from ownership eligibility. */
export function rebuildCompressionState(
  state: SessionState,
  eligibleBlockIds: ReadonlySet<number>,
): void {
  const messagesState = state.prune.messages;
  const blocks = [...messagesState.blocksById.values()].sort(
    (a, b) => a.createdAt - b.createdAt || a.blockId - b.blockId,
  );
  const candidates = new Set(
    blocks
      .filter((block) => eligibleBlockIds.has(block.blockId) && !block.deactivatedByUser)
      .map((block) => block.blockId),
  );
  const byId = messagesState.blocksById;
  const now = Date.now();

  const findActiveAncestor = (
    block: CompressionBlock,
    seen = new Set<number>(),
  ): CompressionBlock | undefined => {
    for (const parentId of block.parentBlockIds) {
      if (seen.has(parentId)) continue;
      const parent = byId.get(parentId);
      if (!parent) continue;
      seen.add(parentId);
      const ancestor = findActiveAncestor(parent, seen);
      if (ancestor) return ancestor;
      if (candidates.has(parentId)) return parent;
    }
    return undefined;
  };

  for (const block of blocks) {
    const parent = candidates.has(block.blockId) ? findActiveAncestor(block) : undefined;
    block.active = candidates.has(block.blockId) && parent === undefined;
    block.deactivatedByBlockId = parent?.blockId;
    block.deactivatedAt = block.active ? undefined : (block.deactivatedAt ?? now);
  }

  messagesState.activeBlockIds.clear();
  messagesState.activeByAnchorIndex.clear();
  for (const entry of messagesState.byMessageIndex.values()) {
    entry.blockIds = [];
    entry.activeBlockIds = [];
  }

  for (const block of blocks) {
    if (block.active) {
      messagesState.activeBlockIds.add(block.blockId);
      messagesState.activeByAnchorIndex.set(block.anchorIndex, block.blockId);
    }
    for (const index of block.effectiveMessageIndices) {
      let entry = messagesState.byMessageIndex.get(index);
      if (!entry) {
        entry = { tokenCount: 0, blockIds: [], activeBlockIds: [] };
        messagesState.byMessageIndex.set(index, entry);
      }
      entry.blockIds.push(block.blockId);
      if (block.active) entry.activeBlockIds.push(block.blockId);
    }
  }
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
