import { describe, expect, it } from "vitest";
import { createSessionState } from "../src/state/state.ts";
import { handleCompress } from "../src/compress/handler.ts";
import { applyCompressionTiming } from "../src/index.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { makeDefaultConfig } from "./helpers.ts";

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
