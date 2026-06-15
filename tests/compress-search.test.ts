import { describe, expect, it } from "vitest";
import { resolveBoundaryIndex, resolveSelection } from "../src/compress/search.ts";
import { createSessionState } from "../src/state/state.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

function makeUserMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

function makeAssistantMessage(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
    timestamp: Date.now(),
  } as unknown as AgentMessage;
}

describe("compress/search", () => {
  describe("resolveBoundaryIndex", () => {
    it("resolves message ref to index", () => {
      const state = createSessionState();
      state.messageIds.byIndex.set(0, "m0001");
      state.messageIds.byIndex.set(5, "m0006");

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
