import { describe, expect, it } from "vitest";
import { stripHallucinations, stripHallucinationsFromString } from "../src/messages/strip.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("strip", () => {
  describe("stripHallucinationsFromString", () => {
    it("removes the observed transposed message-id suffix", () => {
      expect(
        stripHallucinationsFromString("**Creating the GitHub PR**m0112</dpc-message-id>"),
      ).toBe("**Creating the GitHub PR**");
    });

    it("removes bounded message-id suffixes and transposed pairs", () => {
      expect(stripHallucinationsFromString("hello m0001</dcp-message-id>")).toBe("hello ");
      expect(stripHallucinationsFromString("hello <dpc-message-id>m0002</dpc-message-id>")).toBe(
        "hello ",
      );
    });

    it("preserves identifier-like text before a message-id suffix", () => {
      expect(stripHallucinationsFromString("claim0001</dcp-message-id>")).toBe("claim0001");
      expect(stripHallucinationsFromString("room0001</dpc-message-id>")).toBe(
        "room0001</dpc-message-id>",
      );
      expect(stripHallucinationsFromString("文m0001</dcp-message-id>")).toBe("文m0001");
      expect(stripHallucinationsFromString("ém0001</dpc-message-id>")).toBe(
        "ém0001</dpc-message-id>",
      );
    });

    it("removes an orphan message-id opening tag and its bounded reference", () => {
      expect(stripHallucinationsFromString("hello <dcp-message-id>m0001")).toBe("hello ");
      expect(stripHallucinationsFromString("hello <dpc-message-id>m0002")).toBe("hello ");
    });

    it("preserves prose after an orphan message reference", () => {
      expect(stripHallucinationsFromString("hello <dcp-message-id>m0001 continued prose")).toBe(
        "hello  continued prose",
      );
    });

    it("preserves ambiguous message-like payloads", () => {
      expect(stripHallucinationsFromString("hello <dcp-message-id>discussion")).toBe(
        "hello discussion",
      );
      expect(stripHallucinationsFromString("hello <dcp-message-id>m0001abc")).toBe(
        "hello m0001abc",
      );
      expect(stripHallucinationsFromString("hello <dcp-message-id>m0001文")).toBe("hello m0001文");
    });

    it("is idempotent for malformed message references", () => {
      const once = stripHallucinationsFromString(
        "hello <dcp-message-id>m0001 prose m0002</dpc-message-id>",
      );
      expect(stripHallucinationsFromString(once)).toBe(once);
    });

    it("removes paired dcp tags", () => {
      const result = stripHallucinationsFromString(
        "hello <dcp-message-id>m0001</dcp-message-id> world",
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

    it("removes a complete compact marker line at the end of a string", () => {
      expect(stripHallucinationsFromString("done\n@m1@")).toBe("done\n");
      expect(stripHallucinationsFromString("done\n@m2:4@")).toBe("done\n");
    });

    it("removes a complete compact marker line between surrounding lines", () => {
      expect(stripHallucinationsFromString("first\n@m1@\nlast")).toBe("first\n\nlast");
    });

    it("removes truncated compact marker lines", () => {
      expect(stripHallucinationsFromString("first\n@m3\nlast")).toBe("first\n\nlast");
      expect(stripHallucinationsFromString("first\n@m3:\nlast")).toBe("first\n\nlast");
      expect(stripHallucinationsFromString("first\n@m3:2\nlast")).toBe("first\n\nlast");
    });

    it("removes compact marker lines with surrounding horizontal whitespace", () => {
      expect(stripHallucinationsFromString("first\n  @m1@  \nlast")).toBe("first\n\nlast");
      expect(stripHallucinationsFromString("first\n\t@m2:4@\t\nlast")).toBe("first\n\nlast");
    });

    it("removes compact marker lines separated by CRLF", () => {
      expect(stripHallucinationsFromString("first\r\n@m1@\r\nlast")).toBe("first\r\n\r\nlast");
    });

    it("removes consecutive compact marker lines", () => {
      expect(stripHallucinationsFromString("a\n@m1@\n@m2:3@\n@m4\nb")).toBe("a\n\n\n\nb");
    });

    it("removes structurally marker-like lines with invalid numeric values", () => {
      expect(stripHallucinationsFromString("a\n@m0@\nb")).toBe("a\n\nb");
      expect(stripHallucinationsFromString("a\n@m1:0@\nb")).toBe("a\n\nb");
      expect(stripHallucinationsFromString("a\n@m1:9@\nb")).toBe("a\n\nb");
      expect(stripHallucinationsFromString("a\n@m01@\nb")).toBe("a\n\nb");
    });

    it("does not concatenate surrounding prose when a marker line is removed", () => {
      expect(stripHallucinationsFromString("keep first\n@m1@\nkeep last")).toBe(
        "keep first\n\nkeep last",
      );
    });

    it("preserves emails, inline markers, mentions, and prefixed markers", () => {
      expect(stripHallucinationsFromString("email person@m1@example.com")).toBe(
        "email person@m1@example.com",
      );
      expect(stripHallucinationsFromString("The literal marker @m1@ appears inline here.")).toBe(
        "The literal marker @m1@ appears inline here.",
      );
      expect(stripHallucinationsFromString("@mention")).toBe("@mention");
      expect(stripHallucinationsFromString("prefix @m2:4@")).toBe("prefix @m2:4@");
    });

    it("preserves email-only lines and lines with additional content", () => {
      expect(stripHallucinationsFromString("person@m1@example.com")).toBe("person@m1@example.com");
      expect(stripHallucinationsFromString("@m1@ trailing words")).toBe("@m1@ trailing words");
      expect(stripHallucinationsFromString("words before @m1@")).toBe("words before @m1@");
    });

    it("still strips legacy xml markers after compact cleanup", () => {
      expect(
        stripHallucinationsFromString("a\n@m1@\nhello <dcp-message-id>m0001</dcp-message-id>"),
      ).toBe("a\n\nhello ");
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
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            totalTokens: 0,
          },
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
          content: [{ type: "text", text: "<dcp-message-id>m0001</dcp-message-id>" }],
          timestamp: Date.now(),
        } as AgentMessage,
      ];

      const result = stripHallucinations(messages);
      expect((result[0] as { content: Array<{ text: string }> }).content[0].text).toContain(
        "dcp-message-id",
      );
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
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            totalTokens: 0,
          },
          timestamp: Date.now(),
        } as unknown as AgentMessage,
      ];

      const result = stripHallucinations(messages);
      expect(result[0]).toBe(messages[0]);
    });
  });
});
