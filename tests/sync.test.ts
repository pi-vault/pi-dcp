import { describe, expect, it } from "vitest";
import { syncCompressionBlocks } from "../src/messages/sync.ts";
import { createSessionState } from "../src/state/state.ts";
import {
  applyCompressionState,
  allocateBlockId,
  allocateRunId,
  rebuildCompressionState,
} from "../src/compress/state.ts";
import { assignMessageRefs } from "../src/messages/inject.ts";
import { syncToolCache } from "../src/state/tool-cache.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("syncCompressionBlocks", () => {
  it("rehydrates durable keys and discards blocks missing current boundaries", () => {
    const state = createSessionState();
    const messages = [
      { role: "user", content: [{ type: "text", text: "one" }], timestamp: 1 },
      { role: "assistant", content: [{ type: "toolCall", id: "compress-call-1" }], timestamp: 2 },
    ] as unknown as AgentMessage[];
    assignMessageRefs(state, messages);
    syncToolCache(state, messages);
    const blockId = allocateBlockId(state);
    const runId = allocateRunId(state);
    applyCompressionState(state, {
      blockId, runId, topic: "test", mode: "range", startIndex: 0, endIndex: 1, anchorIndex: 1,
      compressToolCallId: "compress-call-1", startKey: "user:1:0", endKey: "assistant:2:0", anchorKey: "assistant:2:0",
      summary: "summary", summaryTokens: 1, consumedBlockIds: [],
    });
    const block = state.prune.messages.blocksById.get(blockId);
    if (!block) throw new Error("expected block");
    block.startIndex = -1;
    const staleId = allocateBlockId(state);
    state.prune.messages.blocksById.set(staleId, {
      ...block, blockId: staleId, startKey: "missing", endKey: "missing", anchorKey: "missing",
    });

    syncCompressionBlocks(state, messages);

    expect(state.prune.messages.blocksById.get(blockId)?.startIndex).toBe(0);
    expect(state.prune.messages.activeBlockIds).toEqual(new Set([blockId]));
    expect(state.prune.messages.blocksById.has(staleId)).toBe(false);
  });

  it("rebuilds direct membership by excluding consumed child ranges", () => {
    const state = createSessionState();
    const messages = [
      { role: "user", content: [{ type: "text", text: "one" }], timestamp: 1 },
      { role: "user", content: [{ type: "text", text: "two" }], timestamp: 2 },
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "child-owner" },
          { type: "toolCall", id: "parent-owner" },
        ],
        timestamp: 3,
      },
    ] as unknown as AgentMessage[];
    assignMessageRefs(state, messages);
    syncToolCache(state, messages);
    const runId = allocateRunId(state);
    const childId = allocateBlockId(state);
    applyCompressionState(state, {
      blockId: childId,
      runId,
      topic: "child",
      mode: "range",
      startIndex: 0,
      endIndex: 1,
      anchorIndex: 0,
      compressToolCallId: "child-owner",
      startKey: "user:1:0",
      endKey: "user:2:0",
      anchorKey: "user:1:0",
      summary: "child",
      summaryTokens: 1,
      consumedBlockIds: [],
    });
    const parentId = allocateBlockId(state);
    applyCompressionState(state, {
      blockId: parentId,
      runId,
      topic: "parent",
      mode: "range",
      startIndex: 0,
      endIndex: 2,
      anchorIndex: 0,
      compressToolCallId: "parent-owner",
      startKey: "user:1:0",
      endKey: "assistant:3:0",
      anchorKey: "user:1:0",
      summary: "parent",
      summaryTokens: 1,
      consumedBlockIds: [childId],
    });

    syncCompressionBlocks(state, messages);

    expect(state.prune.messages.blocksById.get(parentId)?.effectiveMessageIndices).toEqual([0, 1, 2]);
    expect(state.prune.messages.blocksById.get(parentId)?.directMessageIndices).toEqual([2]);
    expect(state.prune.messages.blocksById.get(childId)?.parentBlockIds).toEqual([parentId]);
  });

  it("discards restored blocks when the current context is empty", () => {
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

    expect(state.prune.messages.blocksById.has(blockId)).toBe(false);
    expect(state.prune.messages.activeBlockIds.has(blockId)).toBe(false);
  });

  it("keeps a child hidden until every active parent is absent", () => {
    const state = createSessionState();
    const childId = allocateBlockId(state);
    const runId = allocateRunId(state);
    applyCompressionState(state, {
      blockId: childId,
      runId,
      topic: "child",
      mode: "range",
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
        blockId,
        runId,
        topic: "parent",
        mode: "range",
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
        blockId,
        runId,
        topic,
        mode: "range",
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
  });
});
