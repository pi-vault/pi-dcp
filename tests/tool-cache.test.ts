import { describe, expect, it } from "vitest";
import { syncToolCache, buildToolIdList } from "../src/state/tool-cache.ts";
import { getFilePathsFromNestedCalls } from "../src/strategies/protected-patterns.ts";
import { createSessionState } from "../src/state/state.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { requireDefined } from "./helpers.ts";

function makeAssistantWithToolCall(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: toolCallId, name: toolName, arguments: args }],
    api: "messages",
    provider: "test",
    model: "test-model",
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

function makeToolResult(toolCallId: string, toolName: string, isError = false): AgentMessage {
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
    it("derives tool ages from user messages", () => {
      const state = createSessionState();
      const messages: AgentMessage[] = [
        {
          role: "user",
          content: [{ type: "text", text: "first" }],
          timestamp: Date.now(),
        } as AgentMessage,
        makeAssistantWithToolCall("call1", "read", {}),
        makeAssistantWithToolCall("call2", "write", {}),
        {
          role: "user",
          content: [{ type: "text", text: "second" }],
          timestamp: Date.now(),
        } as AgentMessage,
        makeAssistantWithToolCall("call3", "bash", {}),
      ];

      syncToolCache(state, messages);

      expect(state.toolParameters.get("call1")?.userTurn).toBe(1);
      expect(state.toolParameters.get("call2")?.userTurn).toBe(1);
      expect(state.toolParameters.get("call3")?.userTurn).toBe(2);
      expect(state.currentUserTurn).toBe(2);
    });

    it("rebuilds entries when a pending call receives a result", () => {
      const state = createSessionState();
      const pending = [makeAssistantWithToolCall("call1", "read", {})];

      syncToolCache(state, pending);
      expect(state.toolParameters.get("call1")?.status).toBe("pending");

      syncToolCache(state, [...pending, makeToolResult("call1", "read")]);
      expect(state.toolParameters.get("call1")?.status).toBe("completed");
      expect(state.toolParameters.get("call1")?.tokenCount).toBeDefined();
      expect(state.toolParameters.get("call1")?.assistantIndex).toBe(0);
      expect(state.toolParameters.get("call1")?.resultIndex).toBe(1);
    });

    it("populates toolParameters from messages", () => {
      const state = createSessionState();

      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("call1", "read", { filePath: "/tmp/foo.ts" }),
        makeToolResult("call1", "read"),
      ];

      syncToolCache(state, messages);

      expect(state.toolParameters.has("call1")).toBe(true);
      const entry = requireDefined(state.toolParameters.get("call1"), "call1 entry");
      expect(entry.tool).toBe("read");
      expect(entry.status).toBe("completed");
    });

    it("detects error status from tool result", () => {
      const state = createSessionState();

      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("call1", "bash", { command: "fail" }),
        makeToolResult("call1", "bash", true),
      ];

      syncToolCache(state, messages);
      expect(requireDefined(state.toolParameters.get("call1"), "call1 entry").status).toBe("error");
    });

    it("populates tokenCount from toolResult message content", () => {
      const state = createSessionState();

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

      const entry = requireDefined(state.toolParameters.get("call1"), "call1 entry");
      // "a".repeat(400) uses the length/4 estimate.
      expect(entry.tokenCount).toBe(100);
    });

    it("sets tokenCount undefined when toolResult not yet received", () => {
      const state = createSessionState();

      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("call1", "read", { filePath: "/tmp/foo.ts" }),
        // No toolResult for call1
      ];

      syncToolCache(state, messages);

      const entry = requireDefined(state.toolParameters.get("call1"), "call1 entry");
      expect(entry.tokenCount).toBeUndefined();
    });

    it("rebuilds existing entries", () => {
      const state = createSessionState();
      state.toolParameters.set("call1", {
        tool: "read",
        parameters: { filePath: "/old" },
        status: "completed",
        error: undefined,
        userTurn: 1,
        tokenCount: 50,
        filePaths: [],
        assistantIndex: undefined,
        resultIndex: undefined,
      });

      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("call1", "read", { filePath: "/new" }),
        makeToolResult("call1", "read"),
      ];

      syncToolCache(state, messages);
      // Current raw messages replace stale cache entries.
      expect(
        (
          requireDefined(state.toolParameters.get("call1"), "call1 entry").parameters as Record<
            string,
            unknown
          >
        ).filePath,
      ).toBe("/new");
    });

    it("records assistantIndex and resultIndex", () => {
      const state = createSessionState();

      const messages: AgentMessage[] = [
        {
          role: "user",
          content: [{ type: "text", text: "do it" }],
          timestamp: Date.now(),
        } as AgentMessage,
        makeAssistantWithToolCall("call1", "read", { filePath: "/tmp/foo.ts" }),
        {
          role: "toolResult",
          toolCallId: "call1",
          toolName: "read",
          content: [{ type: "text", text: "result" }],
          isError: false,
          timestamp: Date.now(),
        } as AgentMessage,
      ];

      syncToolCache(state, messages);

      const entry = requireDefined(state.toolParameters.get("call1"), "call1 entry");
      expect(entry.assistantIndex).toBe(1);
      expect(entry.resultIndex).toBe(2);
    });

    it("sets resultIndex undefined when no toolResult present", () => {
      const state = createSessionState();

      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("call1", "read", { filePath: "/tmp/foo.ts" }),
      ];

      syncToolCache(state, messages);

      const entry = requireDefined(state.toolParameters.get("call1"), "call1 entry");
      expect(entry.assistantIndex).toBe(0);
      expect(entry.resultIndex).toBeUndefined();
    });

    it("aggregates normalized direct and nested file paths", () => {
      const state = createSessionState();
      const nestedResult = {
        role: "toolResult",
        toolCallId: "parent",
        toolName: "codemode",
        content: [{ type: "text" as const, text: "done" }],
        isError: false,
        nestedCalls: {
          complete: false,
          calls: [
            { id: "n1", name: "read", arguments: { path: "secrets/token.txt" }, status: "ok" },
            { id: "n2", name: "edit", arguments: { path: "src\\config.ts" }, status: "ok" },
            { id: "n3", name: "read", arguments: { path: "secrets/token.txt" }, status: "ok" },
            { id: "n4", name: "write", argumentsBytes: 42, status: "unfinished" },
          ],
        },
        timestamp: Date.now(),
      } satisfies AgentMessage;

      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("parent", "codemode", { script: "..." }),
        nestedResult,
      ];

      syncToolCache(state, messages);

      const entry = requireDefined(state.toolParameters.get("parent"), "parent entry");
      expect(entry.filePaths).toEqual(["secrets/token.txt", "src/config.ts"]);
    });

    it("orders direct parent paths before nested result paths", () => {
      const state = createSessionState();
      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("parent", "read", { path: "src/parent.ts" }),
        {
          role: "toolResult",
          toolCallId: "parent",
          toolName: "read",
          content: [{ type: "text", text: "done" }],
          isError: false,
          nestedCalls: {
            complete: true,
            calls: [{ id: "n1", name: "read", arguments: { path: "src/child.ts" }, status: "ok" }],
          },
          timestamp: Date.now(),
        } satisfies AgentMessage,
      ];

      syncToolCache(state, messages);

      const entry = requireDefined(state.toolParameters.get("parent"), "parent entry");
      expect(entry.filePaths).toEqual(["src/parent.ts", "src/child.ts"]);
    });
  });

  describe("getFilePathsFromNestedCalls", () => {
    it("returns [] for undefined, arrays, non-objects, and records without calls", () => {
      expect(getFilePathsFromNestedCalls(undefined)).toEqual([]);
      expect(getFilePathsFromNestedCalls(null)).toEqual([]);
      expect(getFilePathsFromNestedCalls([])).toEqual([]);
      expect(getFilePathsFromNestedCalls("nope")).toEqual([]);
      expect(getFilePathsFromNestedCalls({})).toEqual([]);
      expect(getFilePathsFromNestedCalls({ calls: "nope" })).toEqual([]);
    });

    it("keeps well-formed siblings and ignores malformed call elements", () => {
      expect(
        getFilePathsFromNestedCalls({
          complete: false,
          calls: [
            null,
            [],
            { name: "read" },
            { name: "read", arguments: null },
            { name: "read", arguments: [] },
            { name: "write", arguments: { path: "a.ts" } },
          ],
        }),
      ).toEqual(["a.ts"]);
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
