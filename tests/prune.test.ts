import { describe, expect, it } from "vitest";
import { pruneToolOutputs, pruneToolErrors, applyPruning } from "../src/messages/prune.ts";
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

    it("skips error tool results (handled by pruneToolErrors)", () => {
      const state = createSessionState();
      state.prune.tools.set("call1", 100);

      const messages: AgentMessage[] = [
        makeToolResult("call1", "bash", "Error: not found", true),
      ];

      const result = pruneToolOutputs(state, messages);
      expect((result[0] as { content: Array<{ text: string }> }).content[0].text).toBe("Error: not found");
    });
  });

  describe("pruneToolErrors", () => {
    it("replaces content of pruned error tool results", () => {
      const state = createSessionState();
      state.prune.tools.set("call1", 100);

      const messages: AgentMessage[] = [
        makeToolResult("call1", "bash", "Error: command not found", true),
      ];

      const result = pruneToolErrors(state, messages);
      expect(result).toHaveLength(1);
      const content = (result[0] as { content: Array<{ text: string }> }).content;
      expect(content[0].text).toContain("[input removed");
    });
  });

  describe("applyPruning", () => {
    it("applies both output and error pruning", () => {
      const state = createSessionState();
      state.prune.tools.set("call1", 100);
      state.prune.tools.set("call2", 50);

      const messages: AgentMessage[] = [
        makeToolResult("call1", "glob", "big output"),
        makeToolResult("call2", "bash", "Error: fail", true),
        makeToolResult("call3", "read", "untouched"),
      ];

      const result = applyPruning(state, messages);
      expect((result[0] as { content: Array<{ text: string }> }).content[0].text).toContain("[Output removed");
      expect((result[1] as { content: Array<{ text: string }> }).content[0].text).toContain("[input removed");
      expect((result[2] as { content: Array<{ text: string }> }).content[0].text).toBe("untouched");
    });
  });
});
