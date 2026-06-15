import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { appendText, mapText } from "../src/utils/message-content.ts";
import {
  makeUserMessage,
  makeUserMessageString,
  makeAssistantMessage,
} from "./helpers.ts";

type WithContent = { content: unknown };

function getContent(msg: AgentMessage): unknown {
  return (msg as unknown as WithContent).content;
}

describe("appendText", () => {
  it("appends text to array content message", () => {
    const msg = makeUserMessage("Hello");
    const result = appendText(msg, "\n\n<tag>id</tag>");
    const text = (getContent(result) as Array<{ type: string; text: string }>)[0].text;
    expect(text).toBe("Hello\n\n<tag>id</tag>");
  });

  it("converts E9 string content to array and appends", () => {
    const msg = makeUserMessageString("Hello");
    const result = appendText(msg, "\n\n<tag>id</tag>");
    expect(Array.isArray(getContent(result))).toBe(true);
    const text = (getContent(result) as Array<{ type: string; text: string }>)[0].text;
    expect(text).toBe("Hello\n\n<tag>id</tag>");
  });

  it("skips if marker is already present (array content)", () => {
    const msg = makeUserMessage("Hello\n\n<tag>id</tag>");
    const result = appendText(msg, "\n\n<tag>another</tag>", "<tag>");
    expect(result).toBe(msg); // same reference
  });

  it("skips if marker is already present (E9 string content)", () => {
    const msg = makeUserMessageString("Hello\n\n<tag>id</tag>");
    const result = appendText(msg, "\n\n<tag>another</tag>", "<tag>");
    expect(result).toBe(msg); // same reference
  });

  it("returns original message if no text part found", () => {
    const msg = {
      role: "user",
      content: [{ type: "image", data: "..." }],
      timestamp: Date.now(),
    } as unknown as AgentMessage;
    const result = appendText(msg, "\n\ntag");
    expect(result).toBe(msg);
  });

  it("does not mutate the original message", () => {
    const msg = makeUserMessage("Hello");
    const originalContent = getContent(msg);
    appendText(msg, "\n\n<tag>id</tag>");
    expect(getContent(msg)).toBe(originalContent);
  });

  it("returns original message if content property is missing (BashExecutionMessage)", () => {
    const msg = {
      role: "bashExecution",
      command: "ls",
      output: "file.ts",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: Date.now(),
    } as unknown as AgentMessage;
    const result = appendText(msg, "\n\ntag");
    expect(result).toBe(msg);
  });
});

describe("mapText", () => {
  it("transforms text parts via mapping function", () => {
    const msg = makeAssistantMessage("Hello <dcp>world</dcp>");
    const result = mapText(msg, (t) => t.replace(/<dcp>.*?<\/dcp>/g, ""));
    const text = (getContent(result) as Array<{ type: string; text: string }>)[0].text;
    expect(text).toBe("Hello ");
  });

  it("returns original message if fn returns identical strings", () => {
    const msg = makeAssistantMessage("Hello world");
    const result = mapText(msg, (t) => t);
    expect(result).toBe(msg);
  });

  it("skips non-text parts", () => {
    const msg = {
      role: "assistant",
      content: [
        { type: "text", text: "Hello" },
        { type: "tool_use", id: "t1", name: "test", input: {} },
      ],
      stopReason: "stop",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        totalTokens: 0,
      },
      timestamp: Date.now(),
    } as unknown as AgentMessage;
    const result = mapText(msg, (t) => t.toUpperCase());
    const parts = getContent(result) as Array<Record<string, unknown>>;
    expect(parts[0].text).toBe("HELLO");
    expect(parts[1].type).toBe("tool_use"); // unchanged
  });

  it("returns original message if content is not an array", () => {
    const msg = makeUserMessageString("Hello");
    const result = mapText(msg, (t) => t.toUpperCase());
    expect(result).toBe(msg); // string content, mapText skips
  });

  it("returns original message if content property is missing (BashExecutionMessage)", () => {
    const msg = {
      role: "bashExecution",
      command: "ls",
      output: "file.ts",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: Date.now(),
    } as unknown as AgentMessage;
    const result = mapText(msg, (t) => t.toUpperCase());
    expect(result).toBe(msg);
  });
});
