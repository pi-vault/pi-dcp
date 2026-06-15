import { describe, expect, it } from "vitest";
import { decompressCommand } from "../src/commands/decompress.ts";
import { recompressCommand } from "../src/commands/recompress.ts";
import { createSessionState } from "../src/state/state.ts";
import type { CompressionBlock } from "../src/state/types.ts";

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
    compressMessageIndex: 0,
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
