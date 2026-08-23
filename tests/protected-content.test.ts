import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  appendProtectedUserMessages,
  appendProtectedPromptInfo,
  appendProtectedToolOutputs,
  enrichSummaryWithProtectedContent,
} from "../src/compress/protected-content.ts";
import {
  makeDefaultConfig,
  makeUserMessage,
  makeUserMessageString,
  makeAssistantMessage,
  makeToolResultMessage,
} from "./helpers.ts";

describe("appendProtectedUserMessages", () => {
  it("appends user message text verbatim when protectUserMessages is true", () => {
    const messages: AgentMessage[] = [
      makeUserMessage("Important instruction"),
      makeAssistantMessage("response"),
    ];

    const result = appendProtectedUserMessages("Base summary", messages, true);
    expect(result).toContain("Base summary");
    expect(result).toContain("[Protected User Message]");
    expect(result).toContain("Important instruction");
  });

  it("returns summary unchanged when protectUserMessages is false", () => {
    const messages: AgentMessage[] = [makeUserMessage("Important")];

    const result = appendProtectedUserMessages("Base summary", messages, false);
    expect(result).toBe("Base summary");
  });

  it("handles plain-string user message content", () => {
    const messages: AgentMessage[] = [makeUserMessageString("String content")];

    const result = appendProtectedUserMessages("Summary", messages, true);
    expect(result).toContain("String content");
  });

  it("strips <protect> tags from user message text", () => {
    const messages: AgentMessage[] = [makeUserMessage("Do <protect>important</protect> thing")];

    const result = appendProtectedUserMessages("Summary", messages, true);
    expect(result).toContain("Do important thing");
    expect(result).not.toContain("<protect>");
    expect(result).not.toContain("</protect>");
  });
});

describe("appendProtectedPromptInfo", () => {
  it("extracts content within <protect> tags and appends", () => {
    const messages: AgentMessage[] = [
      makeUserMessage("Normal text <protect>Critical data: API_KEY=abc</protect> more text"),
    ];

    const result = appendProtectedPromptInfo("Base summary", messages, true);
    expect(result).toContain("[Protected Content]");
    expect(result).toContain("Critical data: API_KEY=abc");
    expect(result).not.toContain("<protect>");
  });

  it("handles multiple protect tags in one message", () => {
    const messages: AgentMessage[] = [
      makeUserMessage("<protect>Item A</protect> gap <protect>Item B</protect>"),
    ];

    const result = appendProtectedPromptInfo("Summary", messages, true);
    expect(result).toContain("Item A");
    expect(result).toContain("Item B");
  });

  it("returns unchanged when protectTags is false", () => {
    const messages: AgentMessage[] = [makeUserMessage("<protect>secret</protect>")];

    const result = appendProtectedPromptInfo("Summary", messages, false);
    expect(result).toBe("Summary");
  });

  it("returns unchanged when no protect tags found", () => {
    const messages: AgentMessage[] = [makeUserMessage("No tags here")];

    const result = appendProtectedPromptInfo("Summary", messages, true);
    expect(result).toBe("Summary");
  });
});

describe("appendProtectedToolOutputs", () => {
  it("appends tool output when tool name matches protectedTools", () => {
    const messages: AgentMessage[] = [makeToolResultMessage("call1", "read", "file content here")];

    const result = appendProtectedToolOutputs("Summary", messages, ["read"]);
    expect(result).toContain("[Protected Tool Output: read]");
    expect(result).toContain("file content here");
  });

  it("preserves output when a protected-tool glob matches the name", () => {
    const messages: AgentMessage[] = [makeToolResultMessage("call1", "read", "file content here")];

    const result = appendProtectedToolOutputs("Summary", messages, ["r[ea]ad"]);
    expect(result).toContain("[Protected Tool Output: read]");
    expect(result).toContain("file content here");
  });

  it("does not append when tool name not in protectedTools", () => {
    const messages: AgentMessage[] = [makeToolResultMessage("call1", "grep", "grep output")];

    const result = appendProtectedToolOutputs("Summary", messages, ["read"]);
    expect(result).toBe("Summary");
  });

  it("skips error tool results", () => {
    const messages: AgentMessage[] = [
      makeToolResultMessage("call1", "read", "error: file not found", true),
    ];

    const result = appendProtectedToolOutputs("Summary", messages, ["read"]);
    expect(result).toBe("Summary");
  });
});

describe("enrichSummaryWithProtectedContent", () => {
  it("applies all three enrichments in sequence", () => {
    const config = makeDefaultConfig({
      protectUserMessages: true,
      protectTags: true,
      protectedTools: ["read"],
    });
    const messages: AgentMessage[] = [
      makeUserMessage("Do <protect>critical</protect> task"),
      makeToolResultMessage("c1", "read", "file data"),
    ];

    const result = enrichSummaryWithProtectedContent("Base", messages, config);
    expect(result).toContain("Base");
    expect(result).toContain("[Protected User Message]");
    expect(result).toContain("[Protected Content]");
    expect(result).toContain("critical");
    expect(result).toContain("[Protected Tool Output: read]");
    expect(result).toContain("file data");
  });
});
