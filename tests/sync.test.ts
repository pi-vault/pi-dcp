import { describe, expect, it } from "vitest";
import { syncCompressionBlocks } from "../src/messages/sync.ts";
import { createSessionState } from "../src/state/state.ts";
import { applyCompressionState, allocateBlockId, allocateRunId } from "../src/compress/state.ts";

describe("syncCompressionBlocks", () => {
  it("keeps active blocks when compress message index is valid", () => {
    const state = createSessionState();
    const blockId = allocateBlockId(state);
    const runId = allocateRunId(state);

    applyCompressionState(state, {
      blockId,
      runId,
      topic: "test",
      mode: "range",
      startIndex: 0,
      endIndex: 3,
      anchorIndex: 0,
      compressMessageIndex: 5,
      summary: "summary",
      summaryTokens: 10,
      consumedBlockIds: [],
    });

    // 6 messages exist (indices 0-5), compress message at index 5 exists
    syncCompressionBlocks(state, 6);

    expect(state.prune.messages.blocksById.get(blockId)!.active).toBe(true);
    expect(state.prune.messages.activeBlockIds.has(blockId)).toBe(true);
  });

  it("deactivates blocks when compress message index exceeds message count", () => {
    const state = createSessionState();
    const blockId = allocateBlockId(state);
    const runId = allocateRunId(state);

    applyCompressionState(state, {
      blockId,
      runId,
      topic: "test",
      mode: "range",
      startIndex: 0,
      endIndex: 3,
      anchorIndex: 0,
      compressMessageIndex: 5,
      summary: "summary",
      summaryTokens: 10,
      consumedBlockIds: [],
    });

    // Only 3 messages exist, compress message at index 5 is gone
    syncCompressionBlocks(state, 3);

    expect(state.prune.messages.blocksById.get(blockId)!.active).toBe(false);
    expect(state.prune.messages.activeBlockIds.has(blockId)).toBe(false);
  });
});
