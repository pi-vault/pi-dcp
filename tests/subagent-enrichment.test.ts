import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { appendSubAgentResults } from "../src/compress/protected-content.ts";

describe("appendSubAgentResults", () => {
  it("appends cached child session content for subagent tool results in range", () => {
    const messages: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "call-sub-1",
        toolName: "subagent",
        content: [{ type: "text", text: "Subagent completed successfully" }],
        isError: false,
        timestamp: 1000,
      } as AgentMessage,
    ];
    const cache = new Map([
      [
        "call-sub-1",
        "Child assistant: I refactored the module.\n\nChild assistant: All tests pass.",
      ],
    ]);

    const result = appendSubAgentResults("Original summary", messages, cache);
    expect(result).toContain("Original summary");
    expect(result).toContain("I refactored the module");
    expect(result).toContain("All tests pass");
    expect(result).toContain("[Sub-Agent Results: call-sub-1]");
  });

  it("returns summary unchanged when no subagent results in range", () => {
    const messages: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "call-read-1",
        toolName: "read",
        content: [{ type: "text", text: "file contents" }],
        isError: false,
        timestamp: 1000,
      } as AgentMessage,
    ];
    const cache = new Map<string, string>();

    const result = appendSubAgentResults("Summary", messages, cache);
    expect(result).toBe("Summary");
  });

  it("skips error subagent results", () => {
    const messages: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "call-sub-err",
        toolName: "subagent",
        content: [{ type: "text", text: "Error" }],
        isError: true,
        timestamp: 1000,
      } as AgentMessage,
    ];
    const cache = new Map([["call-sub-err", "Some cached text"]]);

    const result = appendSubAgentResults("Summary", messages, cache);
    expect(result).toBe("Summary");
  });

  it("returns summary unchanged when cache is empty", () => {
    const messages: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "call-sub-1",
        toolName: "subagent",
        content: [{ type: "text", text: "Done" }],
        isError: false,
        timestamp: 1000,
      } as AgentMessage,
    ];
    const cache = new Map<string, string>();

    const result = appendSubAgentResults("Summary", messages, cache);
    expect(result).toBe("Summary");
  });
});
