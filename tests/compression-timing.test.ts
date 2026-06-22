import { describe, it, expect } from "vitest";
import { createSessionState } from "../src/state/state.ts";
import { applyPendingCompressionDurations } from "../src/compress/state.ts";
import type { CompressionBlock } from "../src/state/types.ts";

describe("CompressionTimingState", () => {
  it("initializes with empty maps", () => {
    const state = createSessionState();
    expect(state.compressionTiming).toBeDefined();
    expect(state.compressionTiming.startTimes.size).toBe(0);
    expect(state.compressionTiming.callIdToBlockId.size).toBe(0);
    expect(state.compressionTiming.pendingDurations.size).toBe(0);
  });
});

function makeBlock(blockId: number, durationMs = 0): CompressionBlock {
  return {
    blockId,
    runId: 1,
    active: true,
    deactivatedByUser: false,
    compressedTokens: 1000,
    summaryTokens: 200,
    durationMs,
    mode: "range",
    topic: "test",
    batchTopic: undefined,
    startIndex: 0,
    endIndex: 5,
    anchorIndex: 5,
    compressMessageIndex: 7,
    includedBlockIds: [],
    consumedBlockIds: [],
    parentBlockIds: [],
    directMessageIndices: [0, 1, 2, 3, 4, 5],
    directToolIds: [],
    effectiveMessageIndices: [0, 1, 2, 3, 4, 5],
    effectiveToolIds: [],
    createdAt: Date.now(),
    deactivatedAt: undefined,
    deactivatedByBlockId: undefined,
    summary: "Test summary",
  };
}

describe("applyPendingCompressionDurations", () => {
  it("applies pending duration to the matching block", () => {
    const state = createSessionState();
    const block = makeBlock(1);
    state.prune.messages.blocksById.set(1, block);

    // Simulate state after tool_execution_end
    state.compressionTiming.callIdToBlockId.set("call-abc", 1);
    state.compressionTiming.pendingDurations.set("call-abc", 1500);

    applyPendingCompressionDurations(state);

    expect(block.durationMs).toBe(1500);
    expect(state.compressionTiming.pendingDurations.size).toBe(0);
    expect(state.compressionTiming.callIdToBlockId.size).toBe(0);
  });

  it("no-ops when no pending durations", () => {
    const state = createSessionState();
    applyPendingCompressionDurations(state);
    expect(state.compressionTiming.pendingDurations.size).toBe(0);
  });

  it("removes pending entry even if block not found", () => {
    const state = createSessionState();
    state.compressionTiming.callIdToBlockId.set("orphan-call", 999);
    state.compressionTiming.pendingDurations.set("orphan-call", 500);

    applyPendingCompressionDurations(state);

    expect(state.compressionTiming.pendingDurations.size).toBe(0);
    expect(state.compressionTiming.callIdToBlockId.size).toBe(0);
  });
});
