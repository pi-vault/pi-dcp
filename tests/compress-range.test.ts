import { describe, expect, it } from "vitest";
import { handleCompress } from "../src/compress/handler.ts";
import { createSessionState } from "../src/state/state.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { makeDefaultConfig } from "./helpers.ts";

describe("handleCompress (range mode)", () => {
  it("compresses a valid range", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    // Assign message refs (byIndex is the runtime cache used by resolveBoundaryIndex)
    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(1, "m0002");
    state.messageIds.byIndex.set(2, "m0003");
    state.messageIds.byIndex.set(3, "m0004");
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

    const result = handleCompress(state, config, messages, {
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
      handleCompress(state, config, messages, {
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
      handleCompress(state, config, messages, {
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
    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(1, "m0002");
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

    expect(() =>
      handleCompress(state, config, messages, {
        topic: "test",
        mode: "range",
        content: [
          { startId: "m0001", endId: "m0002", summary: "ok entry" },
          { startId: "m9999", endId: "m0002", summary: "bad entry" },
        ],
      }),
    ).toThrow("m9999 is not available");

    // No partial write — state should be untouched
    expect(state.prune.messages.blocksById.size).toBe(0);
  });
});

describe("handleCompress tool chain protection", () => {
  it("auto-expands range to include orphaned toolResult", () => {
    const state = createSessionState();
    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(1, "m0002");

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
    const result = handleCompress(state, config, messages, {
      topic: "test",
      mode: "range",
      content: [{ startId: "m0001", endId: "m0002", summary: "read a file" }],
    });

    // Should auto-expand to include index 2 (toolResult), so 3 messages compressed
    expect(result.text).toContain("Compressed 3 messages");
  });
});

describe("CompressResult struct", () => {
  it("returns structured fields (blockIds, topic, messagesCompressed)", () => {
    const state = createSessionState();
    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(1, "m0002");

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

    const result = handleCompress(state, makeDefaultConfig(), messages, {
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
    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(2, "m0003");

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
    const result = handleCompress(state, config, messages, {
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
    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(1, "m0002");

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
    const result = handleCompress(state, config, messages, {
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
    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(1, "m0002");
    state.messageIds.byIndex.set(2, "m0003");
    state.messageIds.byIndex.set(3, "m0004");

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

    const result = handleCompress(state, makeDefaultConfig(), messages, {
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
