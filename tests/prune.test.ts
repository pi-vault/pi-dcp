import { describe, expect, it } from "vitest";
import { pruneToolOutputs, applyPruning } from "../src/messages/prune.ts";
import { allocateBlockId, allocateRunId, applyCompressionState } from "../src/compress/state.ts";
import { createSessionState } from "../src/state/state.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

function makeToolResult(
  toolCallId: string,
  toolName: string,
  text: string,
  isError = false,
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError,
    timestamp: Date.now(),
  } as AgentMessage;
}

function makeAssistantWithToolCall(
  id: string,
  name: string,
  arguments_: Record<string, unknown>,
): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name, arguments: arguments_ }],
    stopReason: "toolUse",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      totalTokens: 0,
    },
    timestamp: Date.now(),
  } as unknown as AgentMessage;
}

describe("prune", () => {
  describe("pruneToolOutputs", () => {
    it("replaces output of pruned tool calls", () => {
      const state = createSessionState();
      state.prune.tools.set("call1", 100);

      const messages: AgentMessage[] = [
        makeToolResult("call1", "glob", "lots of output here"),
      ];

      const result = pruneToolOutputs(state, messages);
      expect(result).toHaveLength(1);
      const content = (result[0] as { content: Array<{ text: string }> }).content;
      expect(content[0].text).toContain("[Output removed");
    });

    it("does not modify unpruned tool results", () => {
      const state = createSessionState();

      const messages: AgentMessage[] = [
        makeToolResult("call1", "glob", "output"),
      ];

      const result = pruneToolOutputs(state, messages);
      expect((result[0] as { content: Array<{ text: string }> }).content[0].text).toBe("output");
    });

    it("skips error tool results", () => {
      const state = createSessionState();
      state.prune.tools.set("call1", 100);

      const messages: AgentMessage[] = [
        makeToolResult("call1", "bash", "Error: not found", true),
      ];

      const result = pruneToolOutputs(state, messages);
      expect((result[0] as { content: Array<{ text: string }> }).content[0].text).toBe("Error: not found");
    });
  });

  describe("applyPruning", () => {
    it("applies output pruning", () => {
      const state = createSessionState();
      state.prune.tools.set("call1", 100);

      const messages: AgentMessage[] = [
        makeToolResult("call1", "glob", "big output"),
        makeToolResult("call2", "read", "untouched"),
      ];

      const result = applyPruning(state, messages);
      expect((result[0] as { content: Array<{ text: string }> }).content[0].text).toContain("[Output removed");
      expect((result[1] as { content: Array<{ text: string }> }).content[0].text).toBe("untouched");
    });

    it("purges failed arguments while preserving the diagnostic result", () => {
      const state = createSessionState();
      state.prune.tools.set("failed-1", 40);
      state.toolParameters.set("failed-1", {
        tool: "custom_tool",
        parameters: { command: "very long invalid command" },
        status: "error",
        error: "command not found",
        userTurn: 0,
        tokenCount: 40,
        assistantIndex: 0,
        resultIndex: 1,
      });
      const errorResult = makeToolResult(
        "failed-1",
        "custom_tool",
        "command not found",
        true,
      );
      const messages = [
        makeAssistantWithToolCall("failed-1", "custom_tool", {
          command: "very long invalid command",
        }),
        errorResult,
      ];

      const result = applyPruning(state, messages);
      const assistant = result[0] as Extract<
        AgentMessage,
        { role: "assistant" }
      >;
      const toolCall = assistant.content.find(
        (part) => part.type === "toolCall",
      );

      expect(toolCall?.arguments).toEqual({
        __purged: "input removed due to failed tool call",
      });
      expect(result[1]).toBe(errorResult);
    });
  });

  describe("filterCompressedRanges orphan safety net", () => {
    it("removes orphaned toolResult messages from filtered output", () => {
      const state = createSessionState();
      const blockId = allocateBlockId(state);
      const runId = allocateRunId(state);

      // Simulate a scenario where compression covers only the assistant (index 1)
      // but leaves its toolResult (index 2) as an orphan
      const messages: AgentMessage[] = [
        { role: "user", content: [{ type: "text", text: "read it" }], timestamp: Date.now() } as AgentMessage,
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
          stopReason: "toolUse",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
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
        { role: "user", content: [{ type: "text", text: "thanks" }], timestamp: Date.now() } as AgentMessage,
      ];

      // Manually create a block that covers only index 1 (the assistant with toolCall)
      // This simulates a stale/corrupt block state that Layer 1 should have prevented
      applyCompressionState(state, {
        blockId,
        runId,
        topic: "test",
        mode: "range",
        startIndex: 1,
        endIndex: 1,
        anchorIndex: 1,
        compressMessageIndex: 3,
        summary: "Summary of tool use",
        summaryTokens: 5,
        consumedBlockIds: [],
      });

      const result = applyPruning(state, messages);

      // The orphaned toolResult (c1) should NOT be in the output
      const hasOrphan = result.some(
        (m) => m.role === "toolResult" && (m as { toolCallId: string }).toolCallId === "c1",
      );
      expect(hasOrphan).toBe(false);

      // Should still have: user(0), summary, user(3) = 3 messages
      expect(result).toHaveLength(3);
    });

    it("keeps toolResult when its assistant is present in output", () => {
      const state = createSessionState();

      const messages: AgentMessage[] = [
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
          stopReason: "toolUse",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
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
      ];

      const result = applyPruning(state, messages);

      // Both should survive
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("assistant");
      expect(result[1].role).toBe("toolResult");
    });
  });

  describe("filterCompressedRanges", () => {
    it("replaces compressed messages with summary", () => {
      const state = createSessionState();
      const blockId = allocateBlockId(state);
      const runId = allocateRunId(state);

      const messages: AgentMessage[] = [
        { role: "user", content: [{ type: "text", text: "start" }], timestamp: Date.now() } as AgentMessage,
        { role: "assistant", content: [{ type: "text", text: "response 1" }], timestamp: Date.now() } as unknown as AgentMessage,
        { role: "user", content: [{ type: "text", text: "middle" }], timestamp: Date.now() } as AgentMessage,
        { role: "assistant", content: [{ type: "text", text: "response 2" }], timestamp: Date.now() } as unknown as AgentMessage,
        { role: "user", content: [{ type: "text", text: "end" }], timestamp: Date.now() } as AgentMessage,
      ];

      applyCompressionState(state, {
        blockId,
        runId,
        topic: "test",
        mode: "range",
        startIndex: 1,
        endIndex: 3,
        anchorIndex: 1,
        compressMessageIndex: 4,
        summary: "Summary of messages 1-3",
        summaryTokens: 10,
        consumedBlockIds: [],
      });

      const result = applyPruning(state, messages);
      // Should have 3 messages: original[0], summary, original[4]
      expect(result.length).toBeLessThan(messages.length);
      // Summary should be present
      const summaryMsg = result.find((m) => {
        // biome-ignore lint/suspicious/noExplicitAny: test helper
        const content = (m as any).content;
        // biome-ignore lint/suspicious/noExplicitAny: test helper
        return Array.isArray(content) && content.some((c: any) => c.type === "text" && c.text.includes("Summary of messages 1-3"));
      });
      expect(summaryMsg).toBeDefined();
    });

    it("passes messages unchanged when no active blocks", () => {
      const state = createSessionState();
      const messages: AgentMessage[] = [
        { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() } as AgentMessage,
      ];
      const result = applyPruning(state, messages);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(messages[0]);
    });
  });
});
