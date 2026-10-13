import { describe, expect, it } from "vitest";
import { createSessionState } from "../src/state/state.ts";
import { handleCompress } from "../src/compress/blocks.ts";
import { applyCompressionTiming } from "../src/index.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { CompressionBlock, SessionState } from "../src/state/types.ts";
import { makeDefaultConfig } from "./helpers.ts";

function installBlock(
  state: SessionState,
  blockId: number,
  compressToolCallId: string,
  durationMs: number,
  overrides: Partial<CompressionBlock> = {},
): CompressionBlock {
  const block: CompressionBlock = {
    blockId,
    runId: 1,
    active: true,
    deactivatedByUser: false,
    compressedTokens: 10,
    summaryTokens: 2,
    durationMs,
    mode: "range",
    topic: "topic",
    batchTopic: undefined,
    startIndex: 0,
    endIndex: 0,
    anchorIndex: 0,
    compressToolCallId,
    startKey: `start-${blockId}`,
    endKey: `end-${blockId}`,
    anchorKey: `anchor-${blockId}`,
    consumedBlockIds: [],
    parentBlockIds: [],
    directMessageIndices: [],
    directToolIds: [],
    effectiveMessageIndices: [],
    effectiveToolIds: [],
    createdAt: blockId,
    deactivatedAt: undefined,
    deactivatedByBlockId: undefined,
    summary: "summary",
    ...overrides,
  };
  state.prune.messages.blocksById.set(blockId, block);
  return block;
}

describe("CompressionTimingState", () => {
  it("initializes with only in-flight start timestamps", () => {
    const state = createSessionState();
    expect(state.compressionTiming).toEqual({ startTimes: new Map() });
  });

  it("records one successful Pi end duration on every block in a compression batch", () => {
    const state = createSessionState();
    const messages = [
      { role: "user", content: [{ type: "text", text: "first" }], timestamp: 0 },
      { role: "assistant", content: [{ type: "text", text: "second" }], timestamp: 0 },
    ] as AgentMessage[];
    for (let index = 0; index < messages.length; index++) {
      const ref = `m${String(index + 1).padStart(4, "0")}`;
      state.messageIds.byIndex.set(index, ref);
      state.messageIds.byRef.set(ref, `message:${index}`);
    }
    const result = handleCompress(state, makeDefaultConfig(), messages, "batch-call", {
      topic: "batch",
      mode: "range",
      content: [
        { startId: "m0001", endId: "m0001", summary: "first summary" },
        { startId: "m0002", endId: "m0002", summary: "second summary" },
      ],
    });
    state.compressionTiming.startTimes.set("batch-call", 1_000);

    applyCompressionTiming(
      state,
      { toolCallId: "batch-call", toolName: "compress", isError: false },
      2_500,
    );

    expect(
      result.blockIds.map((id) => state.prune.messages.blocksById.get(id)?.durationMs),
    ).toEqual([1_500, 1_500]);
    expect(state.compressionTiming.startTimes.has("batch-call")).toBe(false);

    state.compressionTiming.startTimes.set("batch-call", 2_500);
    for (const blockId of result.blockIds) {
      const block = state.prune.messages.blocksById.get(blockId);
      expect(block).toBeDefined();
      if (!block) throw new Error("Expected compression block");
      block.durationMs = 0;
    }
    applyCompressionTiming(
      state,
      { toolCallId: "batch-call", toolName: "compress", isError: true },
      4_000,
    );

    expect(
      result.blockIds.map((id) => state.prune.messages.blocksById.get(id)?.durationMs),
    ).toEqual([0, 0]);
    expect(state.compressionTiming.startTimes.has("batch-call")).toBe(false);
  });
});

describe("applyCompressionTiming adapter", () => {
  it("writes the elapsed duration to every matching block including inactive blocks", () => {
    const state = createSessionState();
    const active = installBlock(state, 1, "call-a", 75);
    const inactive = installBlock(state, 2, "call-a", 75, {
      active: false,
      deactivatedByUser: true,
      deactivatedAt: 5,
      deactivatedByBlockId: 9,
    });
    const control = installBlock(state, 3, "call-b", 75);
    state.compressionTiming.startTimes.set("call-a", 0);

    applyCompressionTiming(
      state,
      { toolCallId: "call-a", toolName: "compress", isError: false },
      100,
    );

    expect(active.durationMs).toBe(100);
    expect(inactive.durationMs).toBe(100);
    expect(control.durationMs).toBe(75);
    expect(state.compressionTiming.startTimes.has("call-a")).toBe(false);
  });

  it("treats an omitted isError as a successful completion", () => {
    const state = createSessionState();
    const block = installBlock(state, 1, "call-a", 75);
    state.compressionTiming.startTimes.set("call-a", 0);

    applyCompressionTiming(state, { toolCallId: "call-a", toolName: "compress" }, 100);

    expect(block.durationMs).toBe(100);
    expect(state.compressionTiming.startTimes.has("call-a")).toBe(false);
  });

  it("does nothing when no start time is recorded", () => {
    const state = createSessionState();
    const block = installBlock(state, 1, "call-a", 75);

    applyCompressionTiming(
      state,
      { toolCallId: "call-a", toolName: "compress", isError: false },
      100,
    );

    expect(block.durationMs).toBe(75);
    expect(state.compressionTiming.startTimes.size).toBe(0);
  });

  it("retains the start entry for a non-compression event", () => {
    const state = createSessionState();
    const block = installBlock(state, 1, "call-a", 75);
    state.compressionTiming.startTimes.set("call-a", 0);

    applyCompressionTiming(state, { toolCallId: "call-a", toolName: "read", isError: false }, 100);

    expect(block.durationMs).toBe(75);
    expect(state.compressionTiming.startTimes.get("call-a")).toBe(0);
  });

  it("clears the matching start without writing duration on error", () => {
    const state = createSessionState();
    const block = installBlock(state, 1, "call-a", 75);
    state.compressionTiming.startTimes.set("call-a", 0);
    state.compressionTiming.startTimes.set("unrelated", 5);

    applyCompressionTiming(
      state,
      { toolCallId: "call-a", toolName: "compress", isError: true },
      100,
    );

    expect(block.durationMs).toBe(75);
    expect(state.compressionTiming.startTimes.has("call-a")).toBe(false);
    expect(state.compressionTiming.startTimes.get("unrelated")).toBe(5);
  });

  it("clears the matching start without modifying any block when none match", () => {
    const state = createSessionState();
    const control = installBlock(state, 1, "call-b", 75);
    state.compressionTiming.startTimes.set("call-a", 0);

    applyCompressionTiming(
      state,
      { toolCallId: "call-a", toolName: "compress", isError: false },
      100,
    );

    expect(control.durationMs).toBe(75);
    expect(state.compressionTiming.startTimes.has("call-a")).toBe(false);
  });

  it("does not write a second duration after the start was removed", () => {
    const state = createSessionState();
    const block = installBlock(state, 1, "call-a", 75);
    state.compressionTiming.startTimes.set("call-a", 0);

    applyCompressionTiming(
      state,
      { toolCallId: "call-a", toolName: "compress", isError: false },
      100,
    );
    block.durationMs = 999;

    applyCompressionTiming(
      state,
      { toolCallId: "call-a", toolName: "compress", isError: false },
      200,
    );

    expect(block.durationMs).toBe(999);
  });
});
