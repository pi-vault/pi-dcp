import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  decompressBlock,
  recompressBlock,
  toggleBlock,
  handleCompress,
} from "../src/compress/blocks.ts";
import { createSessionState } from "../src/state/state.ts";
import type { CompressionBlock, SessionState } from "../src/state/types.ts";
import { runPipeline } from "../src/pipeline.ts";
import {
  makeAssistantMessage,
  makeDefaultConfig,
  makeToolResultMessage,
  makeUserMessage,
} from "./helpers.ts";

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

describe("decompressBlock", () => {
  it("deactivates an active block", () => {
    const state = createSessionState();
    const block = makeBlock(1, true);
    state.prune.messages.blocksById.set(1, block);
    state.prune.messages.activeBlockIds.add(1);

    const result = decompressBlock(state, "1");
    expect(result).toContain("deactivated");
    expect(block.active).toBe(false);
    expect(block.deactivatedByUser).toBe(true);
    expect(state.prune.messages.activeBlockIds.has(1)).toBe(false);
  });

  it("returns error for unknown block", () => {
    const state = createSessionState();
    expect(decompressBlock(state, "99")).toContain("not found");
  });

  it("returns error for missing argument", () => {
    const state = createSessionState();
    expect(decompressBlock(state, "")).toContain("Usage");
  });

  it("returns error for invalid block ID format", () => {
    const state = createSessionState();
    expect(decompressBlock(state, "abc")).toContain("Invalid block ID");
  });

  it("returns error for already-inactive block", () => {
    const state = createSessionState();
    state.prune.messages.blocksById.set(1, makeBlock(1, false));
    expect(decompressBlock(state, "1")).toContain("already inactive");
  });

  it("restores an eligible child when its parent is deactivated", () => {
    const { state, childId, parentId } = seedNestedBlocks();

    decompressBlock(state, String(parentId));

    expect(state.prune.messages.blocksById.get(childId)?.active).toBe(true);
  });

  it("keeps a user-deactivated child inactive when its parent is deactivated", () => {
    const { state, childId, parentId } = seedNestedBlocks();
    decompressBlock(state, String(parentId));
    decompressBlock(state, String(childId));
    recompressBlock(state, String(parentId));

    decompressBlock(state, String(parentId));

    expect(state.prune.messages.blocksById.get(childId)?.deactivatedByUser).toBe(true);
    expect(state.prune.messages.blocksById.get(childId)?.active).toBe(false);
  });
});

describe("recompressBlock", () => {
  it("reactivates a user-deactivated block", () => {
    const state = createSessionState();
    const block = makeBlock(1, false);
    block.deactivatedByUser = true;
    state.prune.messages.blocksById.set(1, block);

    const result = recompressBlock(state, "1");
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
    expect(recompressBlock(state, "1")).toContain("not deactivated by user");
  });

  it("returns error for invalid block ID format", () => {
    const state = createSessionState();
    expect(recompressBlock(state, "xyz")).toContain("Invalid block ID");
  });

  it("returns error for missing argument", () => {
    const state = createSessionState();
    expect(recompressBlock(state, "")).toContain("Usage");
  });

  it("returns error for missing block", () => {
    const state = createSessionState();
    expect(recompressBlock(state, "7")).toContain("not found");
  });
});

describe("numeric argument compatibility", () => {
  it.each([
    { input: "1", expected: "deactivated" },
    { input: " 1 ", expected: "deactivated" },
    { input: "1suffix", expected: "deactivated" },
    { input: "1.9", expected: "deactivated" },
  ])("parses $input like Number.parseInt", ({ input, expected }) => {
    const state = createSessionState();
    state.prune.messages.blocksById.set(1, makeBlock(1, true));
    state.prune.messages.activeBlockIds.add(1);
    expect(decompressBlock(state, input)).toContain(expected);
  });

  it.each(["b1", "m1", "abc"])("rejects non-numeric id %s", (input) => {
    const state = createSessionState();
    expect(decompressBlock(state, input)).toBe(`Invalid block ID: ${input}`);
    expect(recompressBlock(state, input)).toBe(`Invalid block ID: ${input}`);
  });

  it("does not change counters, summaries, tokens, or statistics", () => {
    const state = createSessionState();
    const block = makeBlock(1, true);
    state.prune.messages.blocksById.set(1, block);
    state.prune.messages.activeBlockIds.add(1);
    state.prune.messages.nextBlockId = 2;
    state.prune.messages.nextRunId = 2;
    state.stats.messagesCompressed = 7;
    const snapshot = {
      nextBlockId: state.prune.messages.nextBlockId,
      nextRunId: state.prune.messages.nextRunId,
      stats: { ...state.stats },
      summary: block.summary,
      summaryTokens: block.summaryTokens,
      compressedTokens: block.compressedTokens,
    };

    decompressBlock(state, "1");
    recompressBlock(state, "1");

    expect(state.prune.messages.nextBlockId).toBe(snapshot.nextBlockId);
    expect(state.prune.messages.nextRunId).toBe(snapshot.nextRunId);
    expect(state.stats).toEqual(snapshot.stats);
    expect(block.summary).toBe(snapshot.summary);
    expect(block.summaryTokens).toBe(snapshot.summaryTokens);
    expect(block.compressedTokens).toBe(snapshot.compressedTokens);
  });
});

describe("toggleBlock", () => {
  it("deactivates an active block", () => {
    const state = createSessionState();
    state.prune.messages.blocksById.set(1, makeBlock(1, true));
    state.prune.messages.activeBlockIds.add(1);
    expect(toggleBlock(state, 1)).toContain("deactivated");
    expect(state.prune.messages.blocksById.get(1)?.active).toBe(false);
  });

  it("reactivates a user-deactivated block", () => {
    const state = createSessionState();
    const block = makeBlock(1, false);
    block.deactivatedByUser = true;
    state.prune.messages.blocksById.set(1, block);
    expect(toggleBlock(state, 1)).toContain("reactivated");
    expect(block.active).toBe(true);
  });

  it("reports a consumed block that no user deactivated", () => {
    const { state, childId } = seedNestedBlocks();

    expect(toggleBlock(state, childId)).toBe(
      `Block ${childId} was not deactivated by user. Cannot reactivate.`,
    );
  });

  it("reports a missing block", () => {
    const state = createSessionState();
    expect(toggleBlock(state, 99)).toBe("Block 99 not found.");
  });
});

/**
 * Seed a real child block b1 over m1..m2 and a consuming parent b2 over b1,
 * through the public compression operation and the production pipeline.
 */
function seedNestedBlocks(): { state: SessionState; childId: number; parentId: number } {
  const state = createSessionState();
  state.sessionId = "controls-test";
  const config = makeDefaultConfig();
  config.strategies = {
    deduplication: { enabled: false, protectedTools: [], turnProtection: 0 },
    purgeErrors: { enabled: false, turns: 4, protectedTools: [] },
  };
  let raw: AgentMessage[] = [
    makeUserMessage("child user", 1),
    makeAssistantMessage("child reply", 2),
    makeUserMessage("tail user", 3),
  ];
  const owner = (id: string, timestamp: number): AgentMessage =>
    ({
      role: "assistant",
      content: [{ type: "toolCall", id, name: "compress", arguments: {} }],
      stopReason: "toolUse",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        totalTokens: 0,
      },
      timestamp,
    }) as unknown as AgentMessage;

  runPipeline(state, config, raw, undefined);
  handleCompress(state, config, raw, "child-call", {
    topic: "child",
    mode: "range",
    content: [{ startId: "m1", endId: "m2", summary: "child summary" }],
  });
  raw = [
    ...raw,
    owner("child-call", 4),
    makeToolResultMessage("child-call", "compress", "ok", false, 5),
  ];
  runPipeline(state, config, raw, undefined);
  handleCompress(state, config, raw, "parent-call", {
    topic: "parent",
    mode: "range",
    content: [{ startId: "b1", endId: "b1", summary: "parent summary" }],
  });
  raw = [
    ...raw,
    owner("parent-call", 6),
    makeToolResultMessage("parent-call", "compress", "ok", false, 7),
  ];
  runPipeline(state, config, raw, undefined);

  return { state, childId: 1, parentId: 2 };
}
