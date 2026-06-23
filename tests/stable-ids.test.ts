import { describe, it, expect } from "vitest";
import { getMessageKey } from "../src/utils/message-ids.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("getMessageKey", () => {
  it("derives key for user message with counter", () => {
    const msg = {
      role: "user",
      content: [{ type: "text", text: "hi" }],
      timestamp: 1719100000000,
    } as AgentMessage;
    expect(getMessageKey(msg, 0)).toBe("user:1719100000000:0");
    expect(getMessageKey(msg, 1)).toBe("user:1719100000000:1");
  });

  it("derives key for assistant message with counter", () => {
    const msg = {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1719100001000,
      stopReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
    } as unknown as AgentMessage;
    expect(getMessageKey(msg, 0)).toBe("assistant:1719100001000:0");
  });

  it("derives key for toolResult message from toolCallId (ignores counter)", () => {
    const msg = {
      role: "toolResult",
      toolCallId: "call_abc123",
      content: [{ type: "text", text: "result" }],
      timestamp: 1719100002000,
    } as AgentMessage;
    expect(getMessageKey(msg, 0)).toBe("toolResult:call_abc123");
    expect(getMessageKey(msg, 5)).toBe("toolResult:call_abc123"); // counter ignored
  });

  it("falls back to role:timestamp:counter for unknown roles", () => {
    const msg = {
      role: "system",
      content: "sys",
      timestamp: 1719100003000,
    } as unknown as AgentMessage;
    expect(getMessageKey(msg, 0)).toBe("system:1719100003000:0");
  });
});
