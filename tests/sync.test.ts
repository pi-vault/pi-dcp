import { describe, expect, it } from "vitest";
import { syncCompressionBlocks } from "../src/messages/sync.ts";
import { createSessionState } from "../src/state/state.ts";
import { applyCompressionState, allocateBlockId, allocateRunId } from "../src/compress/state.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("syncCompressionBlocks", () => {
  it("keeps blocks owned by an assistant tool call active", () => {
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
      compressToolCallId: "compress-call-1",
      startKey: "user:1000:0",
      endKey: "assistant:1001:0",
      anchorKey: "user:1000:0",
      summary: "summary",
      summaryTokens: 10,
      consumedBlockIds: [],
    });

    syncCompressionBlocks(state, [
      { role: "assistant", content: [{ type: "toolCall", id: "compress-call-1" }] },
    ] as unknown as AgentMessage[]);

    expect(state.prune.messages.blocksById.get(blockId)!.active).toBe(true);
    expect(state.prune.messages.activeBlockIds.has(blockId)).toBe(true);
  });

  it("deactivates blocks whose owning tool call is absent", () => {
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
      compressToolCallId: "compress-call-1",
      startKey: "user:1000:0",
      endKey: "assistant:1001:0",
      anchorKey: "user:1000:0",
      summary: "summary",
      summaryTokens: 10,
      consumedBlockIds: [],
    });

    syncCompressionBlocks(state, []);

    expect(state.prune.messages.blocksById.get(blockId)!.active).toBe(false);
    expect(state.prune.messages.activeBlockIds.has(blockId)).toBe(false);
  });
});
