import { describe, expect, it } from "vitest";
import { syncToolCache, buildToolIdList } from "../src/state/tool-cache.ts";
import { createSessionState } from "../src/state/state.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

function makeAssistantWithToolCall(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): AgentMessage {
  return {
    role: "assistant",
    content: [
      { type: "toolCall", id: toolCallId, name: toolName, arguments: args },
    ],
    api: "messages",
    provider: "test",
    model: "test-model",
    stopReason: "toolUse",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
    timestamp: Date.now(),
  } as unknown as AgentMessage;
}

function makeToolResult(
  toolCallId: string,
  toolName: string,
  isError = false,
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text: "result" }],
    isError,
    timestamp: Date.now(),
  } as AgentMessage;
}

describe("tool-cache", () => {
  describe("syncToolCache", () => {
    it("populates toolParameters from messages", () => {
      const state = createSessionState();
      state.currentTurn = 1;

      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("call1", "read", { filePath: "/tmp/foo.ts" }),
        makeToolResult("call1", "read"),
      ];

      syncToolCache(state, messages);

      expect(state.toolParameters.has("call1")).toBe(true);
      const entry = state.toolParameters.get("call1")!;
      expect(entry.tool).toBe("read");
      expect(entry.status).toBe("completed");
    });

    it("detects error status from tool result", () => {
      const state = createSessionState();
      state.currentTurn = 2;

      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("call1", "bash", { command: "fail" }),
        makeToolResult("call1", "bash", true),
      ];

      syncToolCache(state, messages);
      expect(state.toolParameters.get("call1")!.status).toBe("error");
    });

    it("populates tokenCount from toolResult message content", () => {
      const state = createSessionState();
      state.currentTurn = 1;

      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("call1", "read", { filePath: "/tmp/foo.ts" }),
        {
          role: "toolResult",
          toolCallId: "call1",
          toolName: "read",
          content: [{ type: "text", text: "a".repeat(400) }],
          isError: false,
          timestamp: Date.now(),
        } as AgentMessage,
      ];

      syncToolCache(state, messages);

      const entry = state.toolParameters.get("call1")!;
      // 400 chars / 4 = 100 tokens
      expect(entry.tokenCount).toBe(100);
    });

    it("sets tokenCount undefined when toolResult not yet received", () => {
      const state = createSessionState();
      state.currentTurn = 1;

      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("call1", "read", { filePath: "/tmp/foo.ts" }),
        // No toolResult for call1
      ];

      syncToolCache(state, messages);

      const entry = state.toolParameters.get("call1")!;
      expect(entry.tokenCount).toBeUndefined();
    });

    it("does not overwrite existing entries", () => {
      const state = createSessionState();
      state.currentTurn = 3;
      state.toolParameters.set("call1", {
        tool: "read",
        parameters: { filePath: "/old" },
        status: "completed",
        error: undefined,
        turn: 1,
        tokenCount: 50,
      });

      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("call1", "read", { filePath: "/new" }),
        makeToolResult("call1", "read"),
      ];

      syncToolCache(state, messages);
      // Original entry preserved
      expect((state.toolParameters.get("call1")!.parameters as Record<string, unknown>).filePath).toBe("/old");
    });
  });

  describe("buildToolIdList", () => {
    it("collects tool call IDs in order", () => {
      const state = createSessionState();
      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("c1", "read", {}),
        makeToolResult("c1", "read"),
        makeAssistantWithToolCall("c2", "write", {}),
        makeToolResult("c2", "write"),
      ];

      buildToolIdList(state, messages);
      expect(state.toolIdList).toEqual(["c1", "c2"]);
    });

    it("handles empty messages", () => {
      const state = createSessionState();
      buildToolIdList(state, []);
      expect(state.toolIdList).toEqual([]);
    });
  });
});
