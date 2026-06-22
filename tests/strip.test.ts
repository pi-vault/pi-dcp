import { describe, expect, it } from "vitest";
import { stripHallucinations, stripHallucinationsFromString } from "../src/messages/strip.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("strip", () => {
  describe("stripHallucinationsFromString", () => {
    it("removes paired dcp tags", () => {
      const result = stripHallucinationsFromString(
        "hello <dcp-message-id>m0001</dcp-message-id> world"
      );
      expect(result).toBe("hello  world");
    });

    it("removes unpaired dcp tags", () => {
      const result = stripHallucinationsFromString("text </dcp-foo> more");
      expect(result).toBe("text  more");
    });

    it("preserves text without dcp tags", () => {
      const result = stripHallucinationsFromString("no tags here");
      expect(result).toBe("no tags here");
    });

    it("removes partial dcp tag at end of string (no closing >)", () => {
      const input = "Some text <dcp-message-id>m0093</dcp";
      expect(stripHallucinationsFromString(input)).toBe("Some text ");
    });

    it("removes partial opening dcp tag at end of string", () => {
      const input = "Some text <dcp-message-id";
      expect(stripHallucinationsFromString(input)).toBe("Some text ");
    });

    it("removes paired dcp tag with missing final >", () => {
      const input = "Hello <dcp-message-id>m0042</dcp-message-id world";
      expect(stripHallucinationsFromString(input)).toBe("Hello  world");
    });

    it("removes multiple truncated patterns in one string", () => {
      const input = "A <dcp-foo>bar</dcp B <dcp-x";
      expect(stripHallucinationsFromString(input)).toBe("A  B ");
    });

    it("removes dcp tag with attributes but no closing >", () => {
      const input = 'Text <dcp-message-id priority="3"';
      expect(stripHallucinationsFromString(input)).toBe("Text ");
    });

    it("strips partial tag at end of line but preserves following lines", () => {
      const input = "line1\n<dcp-foo\nline2";
      expect(stripHallucinationsFromString(input)).toBe("line1\n\nline2");
    });
  });

  describe("stripHallucinations", () => {
    it("strips dcp tags from assistant text content", () => {
      const messages: AgentMessage[] = [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Answer <dcp-message-id>m0001</dcp-message-id> here",
            },
          ],
          api: "messages",
          provider: "test",
          model: "test-model",
          stopReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
          timestamp: Date.now(),
        } as unknown as AgentMessage,
      ];

      const result = stripHallucinations(messages);
      const text = (result[0] as { content: Array<{ text: string }> }).content[0].text;
      expect(text).not.toContain("dcp-message-id");
      expect(text).toContain("Answer");
    });

    it("does not modify user messages", () => {
      const messages: AgentMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "<dcp-message-id>m0001</dcp-message-id>" },
          ],
          timestamp: Date.now(),
        } as AgentMessage,
      ];

      const result = stripHallucinations(messages);
      expect((result[0] as { content: Array<{ text: string }> }).content[0].text).toContain("dcp-message-id");
    });

    it("returns same reference when no changes needed", () => {
      const messages: AgentMessage[] = [
        {
          role: "assistant",
          content: [{ type: "text", text: "clean text" }],
          api: "messages",
          provider: "test",
          model: "test-model",
          stopReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
          timestamp: Date.now(),
        } as unknown as AgentMessage,
      ];

      const result = stripHallucinations(messages);
      expect(result[0]).toBe(messages[0]);
    });
  });
});
