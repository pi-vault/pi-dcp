import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { stripHallucinationsFromString } from "../src/messages/strip.ts";
import { mapText } from "../src/utils/message-content.ts";
import { makeAssistantMessage } from "./helpers.ts";

/**
 * Unit test for the message_end stripping logic.
 * The actual handler is registered in index.ts; here we test the core transform
 * that the handler applies (mapText + stripHallucinationsFromString).
 */
describe("message_end strip logic", () => {
  it("strips complete DCP tags from assistant message content", () => {
    const msg = makeAssistantMessage("Here is the answer <dcp-message-id>m0012</dcp-message-id>");

    const stripped = mapText(msg, stripHallucinationsFromString);
    const textPart = (stripped as unknown as { content: Array<{ text: string }> }).content[0];
    expect(textPart.text).toBe("Here is the answer ");
  });

  it("strips truncated DCP tags from assistant message content", () => {
    const msg = makeAssistantMessage("Result <dcp-message-id>m0093</dcp");

    const stripped = mapText(msg, stripHallucinationsFromString);
    const textPart = (stripped as unknown as { content: Array<{ text: string }> }).content[0];
    expect(textPart.text).toBe("Result ");
  });

  it("returns original reference when no DCP tags present", () => {
    const msg = makeAssistantMessage("Clean text");

    const stripped = mapText(msg, stripHallucinationsFromString);
    expect(stripped).toBe(msg);
  });

  it("handles multi-part content with mixed text and tool calls", () => {
    const msg: AgentMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "Before <dcp-message-id>m0001</dcp-message-id>" },
        {
          type: "toolCall",
          id: "call1",
          name: "read",
          arguments: { path: "/foo" },
        },
        { type: "text", text: "After <dcp-foo" },
      ],
      stopReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
      timestamp: Date.now(),
    } as unknown as AgentMessage;

    const stripped = mapText(msg, stripHallucinationsFromString);
    const parts = (stripped as unknown as { content: Array<{ type: string; text?: string }> })
      .content;
    expect(parts[0].text).toBe("Before ");
    expect(parts[1].type).toBe("toolCall");
    expect(parts[2].text).toBe("After ");
  });
});
