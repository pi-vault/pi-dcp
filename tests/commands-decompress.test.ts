import { describe, expect, it } from "vitest";
import { decompressCommand } from "../src/commands/decompress.ts";
import { recompressCommand } from "../src/commands/recompress.ts";
import { createSessionState } from "../src/state/state.ts";
import type { CompressionBlock } from "../src/state/types.ts";
import { applyCompressionState, allocateBlockId } from "../src/compress/state.ts";

function makeBlock(id: number, active: boolean): CompressionBlock {
  return {
    blockId: id,
    runId: 1,
    active,
    deactivatedByUser: false,
    compressedTokens: 100,
    summaryTokens: 20,
    durationMs: 50,
    mode: "range",
    topic: "test",
    batchTopic: undefined,
    startIndex: 0,
    endIndex: 5,
    anchorIndex: 0,
    compressToolCallId: "compress-call-1",
    startKey: "user:1000:0",
    endKey: "assistant:1001:0",
    anchorKey: "user:1000:0",
    consumedBlockIds: [],
    parentBlockIds: [],
    directMessageIndices: [0, 1, 2, 3, 4, 5],
    directToolIds: [],
    effectiveMessageIndices: [0, 1, 2, 3, 4, 5],
    effectiveToolIds: [],
    createdAt: Date.now(),
    deactivatedAt: undefined,
    deactivatedByBlockId: undefined,
    summary: "test summary",
  };
}

describe("decompress command", () => {
  it("deactivates an active block", () => {
    const state = createSessionState();
    const block = makeBlock(1, true);
    state.prune.messages.blocksById.set(1, block);
    state.prune.messages.activeBlockIds.add(1);

    const result = decompressCommand(state, "1");
    expect(result).toContain("deactivated");
    expect(block.active).toBe(false);
    expect(block.deactivatedByUser).toBe(true);
    expect(state.prune.messages.activeBlockIds.has(1)).toBe(false);
  });

  it("returns error for unknown block", () => {
    const state = createSessionState();
    const result = decompressCommand(state, "99");
    expect(result).toContain("not found");
  });

  it("returns error for missing argument", () => {
    const state = createSessionState();
    const result = decompressCommand(state, "");
    expect(result).toContain("Usage");
  });

  it("returns error for invalid block ID format", () => {
    const state = createSessionState();
    const result = decompressCommand(state, "abc");
    expect(result).toContain("Invalid block ID");
  });

  it("returns error for already-inactive block", () => {
    const state = createSessionState();
    const block = makeBlock(1, false);
    state.prune.messages.blocksById.set(1, block);

    const result = decompressCommand(state, "1");
    expect(result).toContain("already inactive");
  });

  it("restores an eligible child when its parent is deactivated", () => {
    const state = createSessionState();
    const childId = allocateBlockId(state);
    applyCompressionState(state, makeApplyParams(childId, []));
    const parentId = allocateBlockId(state);
    applyCompressionState(state, makeApplyParams(parentId, [childId]));

    decompressCommand(state, String(parentId));

    expect(state.prune.messages.blocksById.get(childId)?.active).toBe(true);
  });

  it("keeps a user-deactivated child inactive when its parent is deactivated", () => {
    const state = createSessionState();
    const childId = allocateBlockId(state);
    applyCompressionState(state, makeApplyParams(childId, []));
    decompressCommand(state, String(childId));
    const parentId = allocateBlockId(state);
    applyCompressionState(state, makeApplyParams(parentId, [childId]));

    decompressCommand(state, String(parentId));

    expect(state.prune.messages.blocksById.get(childId)?.active).toBe(false);
  });
});

describe("recompress command", () => {
  it("reactivates a user-deactivated block", () => {
    const state = createSessionState();
    const block = makeBlock(1, false);
    block.deactivatedByUser = true;
    state.prune.messages.blocksById.set(1, block);

    const result = recompressCommand(state, "1");
    expect(result).toContain("reactivated");
    expect(block.active).toBe(true);
    expect(block.deactivatedByUser).toBe(false);
    expect(state.prune.messages.activeBlockIds.has(1)).toBe(true);
  });

  it("returns error for block not deactivated by user", () => {
    const state = createSessionState();
    const block = makeBlock(1, false);
    block.deactivatedByUser = false;
    state.prune.messages.blocksById.set(1, block);

    const result = recompressCommand(state, "1");
    expect(result).toContain("not deactivated by user");
  });

  it("returns error for invalid block ID format", () => {
    const state = createSessionState();
    const result = recompressCommand(state, "xyz");
    expect(result).toContain("Invalid block ID");
  });
});

function makeApplyParams(blockId: number, consumedBlockIds: number[]) {
  return {
    blockId,
    runId: 1,
    topic: "test",
    mode: "range" as const,
    startIndex: 0,
    endIndex: 0,
    anchorIndex: blockId,
    compressToolCallId: `compress-call-${blockId}`,
    startKey: "user:1000:0",
    endKey: "user:1000:0",
    anchorKey: "user:1000:0",
    summary: "summary",
    summaryTokens: 1,
    consumedBlockIds,
  };
}
