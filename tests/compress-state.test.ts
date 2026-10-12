import { describe, expect, it } from "vitest";
import {
  allocateBlockId,
  allocateRunId,
  wrapCompressedSummary,
  applyCompressionState,
  rebuildCompressionState,
  storeCompressionState,
  type ApplyCompressionParams,
} from "../src/compress/block-graph.ts";
import { createSessionState } from "../src/state/state.ts";

const compressionParams: ApplyCompressionParams = {
  blockId: 1,
  runId: 1,
  topic: "Auth exploration",
  mode: "range",
  startIndex: 2,
  endIndex: 8,
  anchorIndex: 2,
  compressToolCallId: "compress-call-1",
  startKey: "user:1000:0",
  endKey: "assistant:1001:0",
  anchorKey: "user:1000:0",
  summary: "Summary text",
  summaryTokens: 50,
  consumedBlockIds: [],
};

describe("compress/block-graph", () => {
  describe("allocateBlockId", () => {
    it("returns sequential block IDs", () => {
      const state = createSessionState();
      expect(allocateBlockId(state)).toBe(1);
      expect(allocateBlockId(state)).toBe(2);
      expect(allocateBlockId(state)).toBe(3);
    });
  });

  describe("allocateRunId", () => {
    it("returns sequential run IDs", () => {
      const state = createSessionState();
      expect(allocateRunId(state)).toBe(1);
      expect(allocateRunId(state)).toBe(2);
    });
  });

  describe("wrapCompressedSummary", () => {
    it("wraps summary with block header and footer", () => {
      const wrapped = wrapCompressedSummary(1, "Summary of exploration");
      expect(wrapped).toContain("[Compressed Block b1]");
      expect(wrapped).toContain("Summary of exploration");
      expect(wrapped).toContain("[End Block b1]");
    });
  });

  describe("applyCompressionState", () => {
    it("creates block and marks message indices", () => {
      const state = createSessionState();
      const blockId = allocateBlockId(state);
      const runId = allocateRunId(state);

      applyCompressionState(state, {
        ...compressionParams,
        blockId,
        runId,
      });

      const block = state.prune.messages.blocksById.get(blockId);
      expect(block).toBeDefined();
      if (!block) throw new Error("Expected compression block");
      expect(block.active).toBe(true);
      expect(block.startIndex).toBe(2);
      expect(block.endIndex).toBe(8);
      expect(block.compressToolCallId).toBe("compress-call-1");
      expect(block.startKey).toBe("user:1000:0");
      expect(block.endKey).toBe("assistant:1001:0");
      expect(block.anchorKey).toBe("user:1000:0");
      expect(block.summary).toBe("Summary text");

      expect(state.prune.messages.activeBlockIds.has(blockId)).toBe(true);
      expect(state.prune.messages.activeByAnchorIndex.get(2)).toBe(blockId);

      // Messages 2-8 should be marked
      for (let i = 2; i <= 8; i++) {
        const entry = state.prune.messages.byMessageIndex.get(i);
        expect(entry).toBeDefined();
        if (!entry) throw new Error("Expected message entry");
        expect(entry.activeBlockIds).toContain(blockId);
      }
    });
  });

  it("stores stable membership without mutating derived message state", () => {
    const state = createSessionState();

    storeCompressionState(state, {
      ...compressionParams,
      endIndex: 3,
      summary: "summary",
      summaryTokens: 1,
    });

    expect(state.prune.messages.byMessageIndex.size).toBe(0);
    expect(state.prune.messages.blocksById.get(1)?.effectiveMessageIndices).toEqual([2, 3]);
  });

  it("keeps a child hidden until every active parent is absent", () => {
    const state = createSessionState();
    const childId = allocateBlockId(state);
    const runId = allocateRunId(state);
    applyCompressionState(state, {
      ...compressionParams,
      blockId: childId,
      runId,
      startIndex: 0,
      endIndex: 0,
      anchorIndex: 0,
      compressToolCallId: "child-call",
      startKey: "user:1000:0",
      endKey: "user:1000:0",
      anchorKey: "user:1000:0",
      summary: "child",
      summaryTokens: 1,
      consumedBlockIds: [],
    });
    const parentIds: number[] = [];
    for (const ownerId of ["parent-1-call", "parent-2-call"]) {
      const blockId = allocateBlockId(state);
      parentIds.push(blockId);
      applyCompressionState(state, {
        ...compressionParams,
        blockId,
        runId,
        startIndex: 0,
        endIndex: 0,
        anchorIndex: blockId,
        compressToolCallId: ownerId,
        startKey: "user:1000:0",
        endKey: "user:1000:0",
        anchorKey: "user:1000:0",
        summary: "parent",
        summaryTokens: 1,
        consumedBlockIds: [childId],
      });
    }

    rebuildCompressionState(state, new Set([childId, ...parentIds]));
    expect(state.prune.messages.blocksById.get(childId)?.active).toBe(false);

    rebuildCompressionState(state, new Set([childId, parentIds[1]]));
    expect(state.prune.messages.blocksById.get(childId)?.active).toBe(false);

    rebuildCompressionState(state, new Set([childId]));
    expect(state.prune.messages.blocksById.get(childId)?.active).toBe(true);
  });

  it("keeps a child hidden when an active grandparent outlives its missing parent", () => {
    const state = createSessionState();
    const runId = allocateRunId(state);
    const addBlock = (topic: string, owner: string, consumedBlockIds: number[]) => {
      const blockId = allocateBlockId(state);
      applyCompressionState(state, {
        ...compressionParams,
        blockId,
        runId,
        startIndex: 0,
        endIndex: 0,
        anchorIndex: blockId,
        compressToolCallId: owner,
        startKey: "user:1000:0",
        endKey: "user:1000:0",
        anchorKey: "user:1000:0",
        summary: topic,
        summaryTokens: 1,
        consumedBlockIds,
      });
      return blockId;
    };
    const childId = addBlock("child", "child-call", []);
    const parentId = addBlock("parent", "parent-call", [childId]);
    const grandparentId = addBlock("grandparent", "grandparent-call", [parentId]);

    rebuildCompressionState(state, new Set([childId, grandparentId]));

    expect(state.prune.messages.blocksById.get(childId)?.active).toBe(false);
    expect(state.prune.messages.blocksById.get(childId)?.deactivatedByBlockId).toBe(grandparentId);
    expect(state.prune.messages.blocksById.get(parentId)?.active).toBe(false);
  });
});
