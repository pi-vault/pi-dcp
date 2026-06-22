import { describe, it, expect } from "vitest";
import { createSessionState } from "../src/state/state.ts";
import { getActiveSummaryTokenUsage } from "../src/compress/state.ts";
import type { CompressionBlock } from "../src/state/types.ts";

function makeBlock(overrides: Partial<CompressionBlock>): CompressionBlock {
  return {
    blockId: 1,
    runId: 1,
    active: true,
    deactivatedByUser: false,
    compressedTokens: 1000,
    summaryTokens: 200,
    durationMs: 0,
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
    directMessageIndices: [],
    directToolIds: [],
    effectiveMessageIndices: [],
    effectiveToolIds: [],
    createdAt: Date.now(),
    deactivatedAt: undefined,
    deactivatedByBlockId: undefined,
    summary: "Summary",
    ...overrides,
  };
}

describe("getActiveSummaryTokenUsage", () => {
  it("returns 0 when no blocks exist", () => {
    const state = createSessionState();
    expect(getActiveSummaryTokenUsage(state)).toBe(0);
  });

  it("sums summaryTokens across active blocks", () => {
    const state = createSessionState();
    state.prune.messages.blocksById.set(
      1,
      makeBlock({ blockId: 1, active: true, summaryTokens: 200 }),
    );
    state.prune.messages.blocksById.set(
      2,
      makeBlock({ blockId: 2, active: true, summaryTokens: 350 }),
    );
    state.prune.messages.activeBlockIds.add(1);
    state.prune.messages.activeBlockIds.add(2);

    expect(getActiveSummaryTokenUsage(state)).toBe(550);
  });

  it("excludes inactive blocks", () => {
    const state = createSessionState();
    state.prune.messages.blocksById.set(
      1,
      makeBlock({ blockId: 1, active: true, summaryTokens: 200 }),
    );
    state.prune.messages.blocksById.set(
      2,
      makeBlock({ blockId: 2, active: false, summaryTokens: 350 }),
    );
    state.prune.messages.activeBlockIds.add(1);

    expect(getActiveSummaryTokenUsage(state)).toBe(200);
  });
});
