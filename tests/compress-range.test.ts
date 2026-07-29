import { describe, expect, it } from "vitest";
import { handleCompress } from "../src/compress/handler.ts";
import { createSessionState } from "../src/state/state.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { makeDefaultConfig } from "./helpers.ts";

function assignRefs(state: ReturnType<typeof createSessionState>, count: number): void {
  for (let index = 0; index < count; index++) {
    const ref = `m${String(index + 1).padStart(4, "0")}`;
    state.messageIds.byIndex.set(index, ref);
    state.messageIds.byRef.set(ref, `message:${index}`);
  }
}

function snapshotCompressionState(state: ReturnType<typeof createSessionState>) {
  return structuredClone({
    blocksById: [...state.prune.messages.blocksById],
    activeBlockIds: [...state.prune.messages.activeBlockIds],
    activeByAnchorIndex: [...state.prune.messages.activeByAnchorIndex],
    byMessageIndex: [...state.prune.messages.byMessageIndex],
    nextBlockId: state.prune.messages.nextBlockId,
    nextRunId: state.prune.messages.nextRunId,
    stats: state.stats,
  });
}

describe("handleCompress (range mode)", () => {
  it("compresses a valid range", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    // Assign message refs (byIndex is the runtime cache used by resolveBoundaryIndex)
    assignRefs(state, 4);
    state.messageIds.nextRefIndex = 5;

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: 0,
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        timestamp: 0,
      } as unknown as AgentMessage,
      {
        role: "user",
        content: [{ type: "text", text: "do stuff" }],
        timestamp: 0,
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        timestamp: 0,
      } as unknown as AgentMessage,
    ];

    const result = handleCompress(state, config, messages, "compress-call-1", {
      topic: "Initial greeting",
      content: [
        {
          startId: "m0001",
          endId: "m0002",
          summary: "User greeted, assistant responded",
        },
      ],
      mode: "range",
    });

    expect(result.text).toContain("Compressed");
    expect(state.prune.messages.blocksById.size).toBe(1);
    expect(state.prune.messages.activeBlockIds.size).toBe(1);
  });

  it("throws for invalid boundary IDs", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [];

    expect(() =>
      handleCompress(state, config, messages, "compress-call-1", {
        topic: "test",
        content: [{ startId: "invalid", endId: "m0001", summary: "text" }],
        mode: "range",
      }),
    ).toThrow();
  });

  it("throws when content array is empty", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [];

    expect(() =>
      handleCompress(state, config, messages, "compress-call-1", {
        topic: "test",
        content: [],
        mode: "range",
      }),
    ).toThrow();
  });

  it("does not write state if any entry is invalid (atomic failure)", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    // Only m0001..m0002 are valid; m9999 is not registered
    assignRefs(state, 2);
    state.messageIds.nextRefIndex = 3;

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: 0,
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        timestamp: 0,
      } as unknown as AgentMessage,
    ];

    const before = snapshotCompressionState(state);
    expect(() =>
      handleCompress(state, config, messages, "compress-call-1", {
        topic: "test",
        mode: "range",
        content: [
          { startId: "m0001", endId: "m0002", summary: "ok entry" },
          { startId: "m9999", endId: "m0002", summary: "bad entry" },
        ],
      }),
    ).toThrow("m9999 is not available");

    expect(snapshotCompressionState(state)).toEqual(before);
  });
});

describe("handleCompress fixed-point batch validation", () => {
  it("rejects ranges that overlap after active-block expansion atomically", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    assignRefs(state, 3);
    const messages = [
      { role: "user", content: [{ type: "text", text: "one" }], timestamp: 0 },
      { role: "assistant", content: [{ type: "text", text: "two" }], timestamp: 0 },
      { role: "user", content: [{ type: "text", text: "three" }], timestamp: 0 },
    ] as AgentMessage[];
    const activeBlock = {
      blockId: 7,
      runId: 1,
      active: true,
      deactivatedByUser: false,
      compressedTokens: 0,
      summaryTokens: 0,
      durationMs: 0,
      mode: "range" as const,
      topic: "existing",
      batchTopic: "existing",
      startIndex: 0,
      endIndex: 1,
      anchorIndex: 0,
      compressToolCallId: "old-call",
      startKey: "message:0",
      endKey: "message:1",
      anchorKey: "message:0",
      consumedBlockIds: [],
      parentBlockIds: [],
      directMessageIndices: [0, 1],
      directToolIds: [],
      effectiveMessageIndices: [0, 1],
      effectiveToolIds: [],
      createdAt: 0,
      deactivatedAt: undefined,
      deactivatedByBlockId: undefined,
      summary: "existing",
    };
    state.prune.messages.blocksById.set(7, activeBlock);
    state.prune.messages.activeBlockIds.add(7);
    state.prune.messages.activeByAnchorIndex.set(0, 7);
    const before = snapshotCompressionState(state);

    expect(() =>
      handleCompress(state, config, messages, "compress-call-1", {
        topic: "batch",
        mode: "range",
        content: [
          { startId: "m0001", endId: "m0001", summary: "first" },
          { startId: "m0002", endId: "m0002", summary: "second" },
        ],
      }),
    ).toThrow(/overlapping compression selections/i);

    expect(snapshotCompressionState(state)).toEqual(before);
  });

  it("keeps direct membership separate from active-block-expanded membership", () => {
    const state = createSessionState();
    assignRefs(state, 4);
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "a", name: "read", arguments: {} }],
        stopReason: "toolUse",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
        timestamp: 0,
      } as unknown as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "a",
        toolName: "read",
        content: [],
        isError: false,
        timestamp: 0,
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "b", name: "write", arguments: {} }],
        stopReason: "toolUse",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
        timestamp: 0,
      } as unknown as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "b",
        toolName: "write",
        content: [],
        isError: false,
        timestamp: 0,
      } as AgentMessage,
    ];
    const activeBlock = {
      blockId: 7,
      runId: 1,
      active: true,
      deactivatedByUser: false,
      compressedTokens: 0,
      summaryTokens: 0,
      durationMs: 0,
      mode: "range" as const,
      topic: "existing",
      batchTopic: "existing",
      startIndex: 0,
      endIndex: 3,
      anchorIndex: 0,
      compressToolCallId: "old-call",
      startKey: "message:0",
      endKey: "message:3",
      anchorKey: "message:0",
      consumedBlockIds: [],
      parentBlockIds: [],
      directMessageIndices: [0, 1, 2, 3],
      directToolIds: ["a", "b"],
      effectiveMessageIndices: [0, 1, 2, 3],
      effectiveToolIds: ["a", "b"],
      createdAt: 0,
      deactivatedAt: undefined,
      deactivatedByBlockId: undefined,
      summary: "existing",
    };
    state.prune.messages.blocksById.set(7, activeBlock);
    state.prune.messages.activeBlockIds.add(7);
    state.prune.messages.activeByAnchorIndex.set(0, 7);

    const result = handleCompress(state, makeDefaultConfig(), messages, "compress-call-1", {
      topic: "nested",
      mode: "range",
      content: [{ startId: "m0004", endId: "m0004", summary: "write result" }],
    });
    const block = state.prune.messages.blocksById.get(result.blockIds[0]);

    expect(block?.directMessageIndices).toEqual([2, 3]);
    expect(block?.directToolIds).toEqual(["b"]);
    expect(block?.effectiveMessageIndices).toEqual([0, 1, 2, 3]);
    expect(block?.effectiveToolIds).toEqual(["a", "b"]);
  });
});

describe("handleCompress tool chain protection", () => {
  it("auto-expands range to include orphaned toolResult", () => {
    const state = createSessionState();
    assignRefs(state, 4);

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "read it" }],
        timestamp: Date.now(),
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
        stopReason: "toolUse",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
        timestamp: Date.now(),
      } as unknown as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read",
        content: [{ type: "text", text: "file contents" }],
        isError: false,
        timestamp: Date.now(),
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "here it is" }],
        timestamp: Date.now(),
      } as unknown as AgentMessage,
    ];

    const config = makeDefaultConfig();
    // Compress range m0001..m0002 = indices 0..1 (assistant toolCall without its result)
    const result = handleCompress(state, config, messages, "compress-call-1", {
      topic: "test",
      mode: "range",
      content: [{ startId: "m0001", endId: "m0002", summary: "read a file" }],
    });

    // Should auto-expand to include index 2 (toolResult), so 3 messages compressed
    expect(result.text).toContain("Compressed 3 messages");
  });
});

describe("handleCompress protected range safety", () => {
  it("rejects a range that starts older but ends in the protected window", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.turnProtection = 1;
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "older" }], timestamp: 0 } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "older reply" }],
        timestamp: 0,
      } as unknown as AgentMessage,
      {
        role: "user",
        content: [{ type: "text", text: "protected" }],
        timestamp: 0,
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "protected reply" }],
        timestamp: 0,
      } as unknown as AgentMessage,
    ];
    assignRefs(state, 4);

    expect(() =>
      handleCompress(state, config, messages, "compress-call-1", {
        topic: "test",
        mode: "range",
        content: [{ startId: "m0001", endId: "m0003", summary: "mixed turns" }],
      }),
    ).toThrow(/turnProtection.*protected window/i);
  });

  it("rejects an entire protected batch before block or run allocation", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.turnProtection = 1;
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "older" }], timestamp: 0 } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "older reply" }],
        timestamp: 0,
      } as unknown as AgentMessage,
      {
        role: "user",
        content: [{ type: "text", text: "protected" }],
        timestamp: 0,
      } as AgentMessage,
    ];
    assignRefs(state, 3);

    expect(() =>
      handleCompress(state, config, messages, "compress-call-1", {
        topic: "test",
        mode: "range",
        content: [
          { startId: "m0001", endId: "m0002", summary: "older turn" },
          { startId: "m0003", endId: "m0003", summary: "protected turn" },
        ],
      }),
    ).toThrow(/turnProtection.*protected window/i);

    expect(state.prune.messages.blocksById.size).toBe(0);
    expect(state.prune.messages.nextBlockId).toBe(1);
    expect(state.prune.messages.nextRunId).toBe(1);
    expect(state.stats.messagesCompressed).toBe(0);
  });
});

describe("CompressResult struct", () => {
  it("returns structured fields (blockIds, topic, messagesCompressed)", () => {
    const state = createSessionState();
    assignRefs(state, 2);

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: 0,
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        timestamp: 0,
      } as unknown as AgentMessage,
    ];

    const result = handleCompress(state, makeDefaultConfig(), messages, "compress-call-1", {
      topic: "Setup",
      mode: "range",
      content: [{ startId: "m0001", endId: "m0002", summary: "greeting" }],
    });

    expect(result.messagesCompressed).toBe(2);
    expect(result.blockIds).toHaveLength(1);
    expect(result.topic).toBe("Setup");
    expect(result.text).toContain("Compressed 2 messages");
    expect(state.stats.messagesCompressed).toBe(2);
  });
});

describe("handleCompress token reporting", () => {
  it("includes token savings in response when tokens are known", () => {
    const state = createSessionState();
    assignRefs(state, 3);

    // Pre-populate byMessageIndex with token counts (simulating Phase 1 sync having run)
    state.prune.messages.byMessageIndex.set(0, {
      tokenCount: 150,
      blockIds: [],
      activeBlockIds: [],
    });
    state.prune.messages.byMessageIndex.set(1, {
      tokenCount: 200,
      blockIds: [],
      activeBlockIds: [],
    });
    state.prune.messages.byMessageIndex.set(2, {
      tokenCount: 100,
      blockIds: [],
      activeBlockIds: [],
    });

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "msg 0" }],
        timestamp: Date.now(),
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "msg 1" }],
        timestamp: Date.now(),
      } as unknown as AgentMessage,
      {
        role: "user",
        content: [{ type: "text", text: "msg 2" }],
        timestamp: Date.now(),
      } as AgentMessage,
    ];

    const config = makeDefaultConfig();
    const result = handleCompress(state, config, messages, "compress-call-1", {
      topic: "test",
      mode: "range",
      content: [{ startId: "m0001", endId: "m0003", summary: "short summary" }],
    });

    // Total original = 150 + 200 + 100 = 450
    // Wrapped summary "[Compressed Block b1]\nshort summary\n[End Block b1]" = 50 chars → 13 tokens
    expect(result.text).toMatch(/~450 tokens replaced by ~13 token summary/);
    expect(result.text).toContain("Compressed 3 messages");
  });

  it("omits token savings when token counts are zero", () => {
    const state = createSessionState();
    assignRefs(state, 2);

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "msg" }],
        timestamp: Date.now(),
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "response" }],
        timestamp: Date.now(),
      } as unknown as AgentMessage,
    ];

    const config = makeDefaultConfig();
    const result = handleCompress(state, config, messages, "compress-call-1", {
      topic: "test",
      mode: "range",
      content: [{ startId: "m0001", endId: "m0002", summary: "summary" }],
    });

    // No token info when byMessageIndex has no entries (all tokenCount default to 0)
    expect(result.text).not.toContain("tokens");
    expect(result.text).toContain("Compressed 2 messages");
  });

  it("accumulates token savings across multiple ranges", () => {
    const state = createSessionState();
    assignRefs(state, 4);

    state.prune.messages.byMessageIndex.set(0, {
      tokenCount: 100,
      blockIds: [],
      activeBlockIds: [],
    });
    state.prune.messages.byMessageIndex.set(1, {
      tokenCount: 200,
      blockIds: [],
      activeBlockIds: [],
    });
    state.prune.messages.byMessageIndex.set(2, {
      tokenCount: 150,
      blockIds: [],
      activeBlockIds: [],
    });
    state.prune.messages.byMessageIndex.set(3, {
      tokenCount: 50,
      blockIds: [],
      activeBlockIds: [],
    });

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "msg 0" }],
        timestamp: Date.now(),
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "msg 1" }],
        timestamp: Date.now(),
      } as unknown as AgentMessage,
      {
        role: "user",
        content: [{ type: "text", text: "msg 2" }],
        timestamp: Date.now(),
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "msg 3" }],
        timestamp: Date.now(),
      } as unknown as AgentMessage,
    ];

    const result = handleCompress(state, makeDefaultConfig(), messages, "compress-call-1", {
      topic: "test",
      mode: "range",
      content: [
        { startId: "m0001", endId: "m0002", summary: "first" },
        { startId: "m0003", endId: "m0004", summary: "second" },
      ],
    });

    // Total = 100 + 200 + 150 + 50 = 500
    expect(result.text).toContain("~500 tokens");
    expect(result.text).toContain("Compressed 4 messages");
  });
});
