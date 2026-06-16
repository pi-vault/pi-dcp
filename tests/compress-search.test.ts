import { describe, expect, it } from "vitest";
import { resolveBoundaryIndex, resolveSelection, expandRangeForToolChains } from "../src/compress/search.ts";
import { createSessionState } from "../src/state/state.ts";
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
