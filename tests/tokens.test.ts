import { describe, expect, it } from "vitest";
import {
  countTokens,
  countTokensBatch,
  extractMessageText,
  countMessageTokens,
} from "../src/utils/tokens.ts";

describe("tokens", () => {
  describe("countTokens", () => {
    it("estimates tokens for text", () => {
      const result = countTokens("hello world");
      expect(result).toBeGreaterThan(0);
      expect(typeof result).toBe("number");
    });

    it("returns 0 for empty string", () => {
      expect(countTokens("")).toBe(0);
    });

    it("scales roughly with text length", () => {
      const short = countTokens("hello");
      const long = countTokens("hello ".repeat(100));
      expect(long).toBeGreaterThan(short);
    });

    it("uses tokenizer (not heuristic) for non-trivial text", () => {
      const text = "The quick brown fox jumps over the lazy dog. ".repeat(10);
      const result = countTokens(text);
      const heuristic = Math.round(text.length / 4);
      // 450 chars → heuristic = 113. The Anthropic tokenizer will differ.
      expect(result).not.toBe(heuristic);
      expect(result).toBeGreaterThan(0);
    });
  });

  describe("countTokensBatch", () => {
    it("counts tokens for array of texts", () => {
      const result = countTokensBatch(["hello", "world"]);
      expect(result).toBeGreaterThan(0);
    });

    it("returns 0 for empty array", () => {
      expect(countTokensBatch([])).toBe(0);
    });
  });

  describe("extractMessageText", () => {
    it("extracts text from text content array", () => {
      const text = extractMessageText({
        role: "user",
        content: [{ type: "text", text: "hello" }],
      });
      expect(text).toBe("hello");
    });

    it("extracts text from string content", () => {
      const text = extractMessageText({
        role: "user",
        content: "hello world",
      });
      expect(text).toBe("hello world");
    });

    it("extracts tool call info", () => {
      const text = extractMessageText({
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "c1",
            name: "read",
            arguments: { filePath: "/tmp/a" },
          },
        ],
      });
      expect(text).toContain("read");
      expect(text).toContain("/tmp/a");
    });

    it("returns empty for missing content", () => {
      expect(extractMessageText({ role: "user" })).toBe("");
    });
  });

  describe("countMessageTokens", () => {
    it("counts tokens for a message", () => {
      const count = countMessageTokens({
        role: "user",
        content: [{ type: "text", text: "hello world" }],
      });
      expect(count).toBeGreaterThan(0);
    });
  });
});
