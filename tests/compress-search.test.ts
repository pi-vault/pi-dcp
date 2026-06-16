import { describe, expect, it } from "vitest";
import { resolveBoundaryIndex, resolveSelection, expandRangeForToolChains } from "../src/compress/search.ts";
import { createSessionState } from "../src/state/state.ts";
import { syncToolCache } from "../src/state/tool-cache.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { makeUserMessage, makeAssistantMessage } from "./helpers.ts";

describe("compress/search", () => {
  describe("resolveBoundaryIndex", () => {
    it("resolves message ref to index", () => {
      const state = createSessionState();
      state.messageIds.byIndex.set(0, "m0001");
      state.messageIds.byRef.set("m0001", 0);
      state.messageIds.byIndex.set(5, "m0006");
      state.messageIds.byRef.set("m0006", 5);

      expect(resolveBoundaryIndex(state, "m0001")).toBe(0);
      expect(resolveBoundaryIndex(state, "m0006")).toBe(5);
    });

    it("resolves block ref to anchor index", () => {
      const state = createSessionState();
      state.prune.messages.activeByAnchorIndex.set(3, 1);

      expect(resolveBoundaryIndex(state, "b1")).toBe(3);
    });

    it("returns undefined for unknown refs", () => {
      const state = createSessionState();
      expect(resolveBoundaryIndex(state, "m9999")).toBeUndefined();
      expect(resolveBoundaryIndex(state, "b999")).toBeUndefined();
    });
  });

  describe("resolveSelection", () => {
    it("collects message indices in range", () => {
      const messages = [
        makeUserMessage("hello"),
        makeAssistantMessage("hi"),
        makeUserMessage("bye"),
        makeAssistantMessage("goodbye"),
      ];

      const selection = resolveSelection(messages, 1, 3);
      expect(selection.messageIndices).toEqual([1, 2, 3]);
    });

    it("throws for invalid range", () => {
      const messages = [makeUserMessage("hello")];
      expect(() => resolveSelection(messages, 2, 1)).toThrow();
    });
  });
});

describe("expandRangeForToolChains", () => {
  function makeAssistantToolCall(callId: string, name: string): AgentMessage {
    return {
      role: "assistant",
      content: [{ type: "toolCall", id: callId, name, arguments: {} }],
      stopReason: "toolUse",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
      timestamp: Date.now(),
    } as unknown as AgentMessage;
  }

  function makeToolResultMsg(callId: string): AgentMessage {
    return {
      role: "toolResult",
      toolCallId: callId,
      toolName: "read",
      content: [{ type: "text", text: "result" }],
      isError: false,
      timestamp: Date.now(),
    } as AgentMessage;
  }

  it("expands endIndex to include orphaned toolResult", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "do it" }], timestamp: Date.now() } as AgentMessage,
      makeAssistantToolCall("c1", "read"),    // index 1
      makeToolResultMsg("c1"),                 // index 2
      { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() } as unknown as AgentMessage,
    ];

    // Range [0,1] includes the assistant toolCall but not its toolResult at index 2
    const result = expandRangeForToolChains(messages, 0, 1);
    expect(result.endIndex).toBe(2);
  });

  it("expands startIndex to include orphaned assistant toolCall", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "do it" }], timestamp: Date.now() } as AgentMessage,
      makeAssistantToolCall("c1", "read"),    // index 1
      makeToolResultMsg("c1"),                 // index 2
      { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() } as unknown as AgentMessage,
    ];

    // Range [2,3] includes the toolResult but not its assistant at index 1
    const result = expandRangeForToolChains(messages, 2, 3);
    expect(result.startIndex).toBe(1);
  });

  it("does not expand when range already contains both halves", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "do it" }], timestamp: Date.now() } as AgentMessage,
      makeAssistantToolCall("c1", "read"),    // index 1
      makeToolResultMsg("c1"),                 // index 2
      { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() } as unknown as AgentMessage,
    ];

    // Range [1,2] already contains both
    const result = expandRangeForToolChains(messages, 1, 2);
    expect(result.startIndex).toBe(1);
    expect(result.endIndex).toBe(2);
  });

  it("handles multiple tool calls in one assistant message", () => {
    const multiCallAssistant: AgentMessage = {
      role: "assistant",
      content: [
        { type: "toolCall", id: "c1", name: "read", arguments: {} },
        { type: "toolCall", id: "c2", name: "write", arguments: {} },
      ],
      stopReason: "toolUse",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
      timestamp: Date.now(),
    } as unknown as AgentMessage;

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "do both" }], timestamp: Date.now() } as AgentMessage,
      multiCallAssistant,           // index 1
      makeToolResultMsg("c1"),      // index 2
      makeToolResultMsg("c2"),      // index 3
      { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() } as unknown as AgentMessage,
    ];

    // Range [0,1] - includes the assistant with two tool calls, must expand to include both results
    const result = expandRangeForToolChains(messages, 0, 1);
    expect(result.endIndex).toBe(3);
  });

  it("cascading expansion: pulling in assistant brings its other toolCall results", () => {
    // assistant@1 has two toolCalls (c1, c2), results at 2 and 3.
    // Range [2,4] includes toolResult(c1)@2 but not assistant@1.
    // Iteration 1: pulls assistant@1 for c1 → now c2 is in scope.
    // Iteration 2: confirms toolResult(c2)@3 is already in [1,4] → stable.
    const multiCallAssistant: AgentMessage = {
      role: "assistant",
      content: [
        { type: "toolCall", id: "c1", name: "read", arguments: {} },
        { type: "toolCall", id: "c2", name: "write", arguments: {} },
      ],
      stopReason: "toolUse",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
      timestamp: Date.now(),
    } as unknown as AgentMessage;

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "start" }], timestamp: Date.now() } as AgentMessage,
      multiCallAssistant,           // index 1
      makeToolResultMsg("c1"),      // index 2
      makeToolResultMsg("c2"),      // index 3
      { role: "user", content: [{ type: "text", text: "end" }], timestamp: Date.now() } as AgentMessage,
    ];

    // Range [2,4] — only includes toolResult(c1), not the assistant or toolResult(c2)
    const result = expandRangeForToolChains(messages, 2, 4);
    expect(result.startIndex).toBe(1); // pulled in assistant
    expect(result.endIndex).toBe(4);   // toolResult(c2)@3 already within [1,4]
  });

  it("returns unchanged range when no tool calls present", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() } as AgentMessage,
      { role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: Date.now() } as unknown as AgentMessage,
    ];

    const result = expandRangeForToolChains(messages, 0, 1);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(1);
  });
});

describe("expandRangeForToolChains with cached indices", () => {
  function makeAssistantToolCall(callId: string, name: string): AgentMessage {
    return {
      role: "assistant",
      content: [{ type: "toolCall", id: callId, name, arguments: {} }],
      stopReason: "toolUse",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
      timestamp: Date.now(),
    } as unknown as AgentMessage;
  }

  function makeToolResultMsg(callId: string): AgentMessage {
    return {
      role: "toolResult",
      toolCallId: callId,
      toolName: "read",
      content: [{ type: "text", text: "result" }],
      isError: false,
      timestamp: Date.now(),
    } as AgentMessage;
  }

  it("uses cached indices to expand endIndex when state is provided", () => {
    const state = createSessionState();
    state.currentTurn = 1;

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "do it" }], timestamp: Date.now() } as AgentMessage,
      makeAssistantToolCall("c1", "read"),
      makeToolResultMsg("c1"),
      { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() } as unknown as AgentMessage,
    ];

    syncToolCache(state, messages);

    // Range [0,1] includes assistant toolCall at index 1 but not its toolResult at index 2
    const result = expandRangeForToolChains(messages, 0, 1, state);
    expect(result.endIndex).toBe(2);
  });

  it("uses cached indices to expand startIndex when result is in range but assistant is not", () => {
    const state = createSessionState();
    state.currentTurn = 1;

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "do it" }], timestamp: Date.now() } as AgentMessage,
      makeAssistantToolCall("c1", "read"),
      makeToolResultMsg("c1"),
      { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() } as unknown as AgentMessage,
    ];

    syncToolCache(state, messages);

    // Range [2,3] includes toolResult at index 2 but not its assistant at index 1
    const result = expandRangeForToolChains(messages, 2, 3, state);
    expect(result.startIndex).toBe(1);
  });

  it("falls back to scan when state has no cached tool parameters", () => {
    const state = createSessionState();

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "do it" }], timestamp: Date.now() } as AgentMessage,
      makeAssistantToolCall("c1", "read"),
      makeToolResultMsg("c1"),
    ];

    // Empty toolParameters — should fall back to scan and still expand correctly
    const result = expandRangeForToolChains(messages, 0, 1, state);
    expect(result.endIndex).toBe(2);
  });

  it("cascading expansion: pulling in assistant brings its other toolCall results", () => {
    const state = createSessionState();
    state.currentTurn = 1;

    const multiCallAssistant: AgentMessage = {
      role: "assistant",
      content: [
        { type: "toolCall", id: "c1", name: "read", arguments: {} },
        { type: "toolCall", id: "c2", name: "write", arguments: {} },
      ],
      stopReason: "toolUse",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
      timestamp: Date.now(),
    } as unknown as AgentMessage;

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "start" }], timestamp: Date.now() } as AgentMessage,
      multiCallAssistant,           // index 1
      makeToolResultMsg("c1"),      // index 2
      makeToolResultMsg("c2"),      // index 3
      { role: "user", content: [{ type: "text", text: "end" }], timestamp: Date.now() } as AgentMessage,
    ];

    syncToolCache(state, messages);

    // Range [2,4] includes only toolResult(c1), not the assistant or toolResult(c2)
    // Iteration 1: pulls assistant@1 for c1 → now c2 is in scope
    // Iteration 2: confirms toolResult(c2)@3 is already in [1,4] → stable
    const result = expandRangeForToolChains(messages, 2, 4, state);
    expect(result.startIndex).toBe(1);
    expect(result.endIndex).toBe(4);
  });

  it("skips entries with stale indices beyond messages array", () => {
    const state = createSessionState();
    state.currentTurn = 1;

    // Simulate stale entry with indices pointing beyond the current messages array
    state.toolParameters.set("stale1", {
      tool: "read",
      parameters: {},
      status: "completed",
      error: undefined,
      turn: 1,
      tokenCount: 100,
      assistantIndex: 10,  // beyond messages length
      resultIndex: 11,
    });

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() } as AgentMessage,
      makeAssistantToolCall("c1", "read"),
      makeToolResultMsg("c1"),
    ];

    syncToolCache(state, messages);

    // Stale entry should be skipped, only fresh c1 entry matters
    const result = expandRangeForToolChains(messages, 0, 1, state);
    expect(result.endIndex).toBe(2);
    expect(result.startIndex).toBe(0);
  });
});
