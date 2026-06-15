import { describe, expect, it } from "vitest";
import {
  allocateBlockId,
  allocateRunId,
  wrapCompressedSummary,
  applyCompressionState,
} from "../src/compress/state.ts";
import { createSessionState } from "../src/state/state.ts";

describe("compress/state", () => {
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
        blockId,
        runId,
        topic: "Auth exploration",
        mode: "range",
        startIndex: 2,
        endIndex: 8,
        anchorIndex: 2,
        compressMessageIndex: 10,
        summary: "Summary text",
        summaryTokens: 50,
        consumedBlockIds: [],
      });

      const block = state.prune.messages.blocksById.get(blockId);
      expect(block).toBeDefined();
      expect(block!.active).toBe(true);
      expect(block!.startIndex).toBe(2);
      expect(block!.endIndex).toBe(8);
      expect(block!.summary).toBe("Summary text");

      expect(state.prune.messages.activeBlockIds.has(blockId)).toBe(true);
      expect(state.prune.messages.activeByAnchorIndex.get(2)).toBe(blockId);

      // Messages 2-8 should be marked
      for (let i = 2; i <= 8; i++) {
        const entry = state.prune.messages.byMessageIndex.get(i);
        expect(entry).toBeDefined();
        expect(entry!.activeBlockIds).toContain(blockId);
      }
    });
  });
});
