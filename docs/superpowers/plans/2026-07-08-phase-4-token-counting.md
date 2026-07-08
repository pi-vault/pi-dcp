# Phase 4: Accurate Token Counting

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `Math.round(text.length / 4)` heuristic in `countTokens()` with the Anthropic tokenizer for accurate per-message token counts. Keep a fallback to the heuristic if the tokenizer throws.

**Architecture:** Add `@anthropic-ai/tokenizer` as a runtime dependency. Refactor `src/utils/tokens.ts` to use it with a try/catch fallback. The public API (`countTokens`, `countTokensBatch`, `countMessageTokens`, `extractMessageText`) stays the same — all callers continue working unchanged.

**Tech Stack:** TypeScript, Vitest, @anthropic-ai/tokenizer

---

### Task 1: Add dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install @anthropic-ai/tokenizer**

Run:

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp && pnpm add @anthropic-ai/tokenizer
```

Expected: `package.json` now has `@anthropic-ai/tokenizer` in `dependencies`.

- [ ] **Step 2: Verify it installed**

Run: `pnpm ls @anthropic-ai/tokenizer`
Expected: Shows the installed version.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "deps: add @anthropic-ai/tokenizer for accurate token counting"
```

---

### Task 2: Write tests

**Files:**
- Create: `tests/tokens.test.ts`

- [ ] **Step 1: Write test file**

Create `tests/tokens.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  countTokens,
  countTokensBatch,
  countMessageTokens,
  extractMessageText,
} from "../src/utils/tokens.ts";

describe("countTokens", () => {
  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  it("returns accurate token count for known text", () => {
    // "Hello, world!" is a simple test — the Anthropic tokenizer should
    // return a different value than Math.round(13/4) = 3
    const result = countTokens("Hello, world!");
    expect(result).toBeGreaterThan(0);
    // The Anthropic tokenizer uses Claude's vocabulary, so exact count
    // varies. Main assertion: it's not the heuristic value.
    const heuristic = Math.round("Hello, world!".length / 4);
    // They may coincidentally match for very short strings, so test
    // with something longer too.
    const longText = "The quick brown fox jumps over the lazy dog. ".repeat(10);
    const longResult = countTokens(longText);
    const longHeuristic = Math.round(longText.length / 4);
    // With 450 chars, heuristic = 113. Real tokenizer will differ.
    expect(longResult).not.toBe(longHeuristic);
  });

  it("returns positive number for non-empty string", () => {
    expect(countTokens("a")).toBeGreaterThan(0);
  });
});

describe("countTokensBatch", () => {
  it("returns 0 for empty array", () => {
    expect(countTokensBatch([])).toBe(0);
  });

  it("counts tokens for multiple texts", () => {
    const result = countTokensBatch(["hello", "world"]);
    expect(result).toBeGreaterThan(0);
  });
});

describe("extractMessageText", () => {
  it("extracts text from text content parts", () => {
    const msg = {
      role: "user",
      content: [{ type: "text", text: "hello world" }],
    };
    expect(extractMessageText(msg)).toBe("hello world");
  });

  it("extracts text from string content", () => {
    const msg = { role: "user", content: "hello world" };
    expect(extractMessageText(msg)).toBe("hello world");
  });

  it("returns empty for missing content", () => {
    const msg = { role: "user" };
    expect(extractMessageText(msg)).toBe("");
  });

  it("extracts tool call name and arguments", () => {
    const msg = {
      role: "assistant",
      content: [
        { type: "text", text: "Let me read that." },
        {
          type: "toolCall",
          name: "read",
          arguments: { filePath: "/tmp/a.ts" },
        },
      ],
    };
    const text = extractMessageText(msg);
    expect(text).toContain("Let me read that.");
    expect(text).toContain("read");
    expect(text).toContain("/tmp/a.ts");
  });
});

describe("countMessageTokens", () => {
  it("counts tokens from message content", () => {
    const msg = {
      role: "user",
      content: [{ type: "text", text: "Hello, world!" }],
    };
    expect(countMessageTokens(msg)).toBeGreaterThan(0);
  });
});

describe("countTokens fallback", () => {
  it("falls back to heuristic when tokenizer fails", async () => {
    // We can test fallback by mocking the module
    vi.doMock("@anthropic-ai/tokenizer", () => ({
      countTokens: () => {
        throw new Error("WASM init failed");
      },
    }));

    // Re-import to pick up mock
    const { countTokens: countTokensMocked } = await import(
      "../src/utils/tokens.ts"
    );

    const text = "test string here";
    const result = countTokensMocked(text);
    const heuristic = Math.max(1, Math.round(text.length / 4));
    expect(result).toBe(heuristic);

    vi.doUnmock("@anthropic-ai/tokenizer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tokens.test.ts`
Expected: FAIL — The heuristic-based `countTokens` will fail the "not equal to heuristic" assertion for long text.

---

### Task 3: Implement accurate token counting

**Files:**
- Modify: `src/utils/tokens.ts`

- [ ] **Step 1: Replace heuristic with Anthropic tokenizer**

Replace the entire content of `src/utils/tokens.ts` with:

```ts
import { countTokens as anthropicCountTokens } from "@anthropic-ai/tokenizer";

/**
 * Count tokens using the Anthropic tokenizer.
 * Falls back to character-based estimation (length/4) if the tokenizer
 * throws (e.g., invalid input or WASM initialization failure).
 */
export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  try {
    return anthropicCountTokens(text);
  } catch {
    return Math.max(1, Math.round(text.length / 4));
  }
}

export function countTokensBatch(texts: string[]): number {
  if (texts.length === 0) return 0;
  return countTokens(texts.join(" "));
}

/**
 * Extract all text content from a message-shaped object for token counting.
 * Handles UserMessage (string | TextContent[]), AssistantMessage (TextContent +
 * ToolCallContent), and ToolResultMessage.
 */
export function extractMessageText(message: {
  role: string;
  content?: unknown;
}): string {
  const content = message.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const p = part as Record<string, unknown>;
    if (p.type === "text" && typeof p.text === "string") {
      parts.push(p.text);
    } else if (p.type === "toolCall") {
      if (typeof p.name === "string") parts.push(p.name);
      if (p.arguments && typeof p.arguments === "object") {
        parts.push(JSON.stringify(p.arguments));
      }
    }
  }
  return parts.join(" ");
}

export function countMessageTokens(message: {
  role: string;
  content?: unknown;
}): number {
  return countTokens(extractMessageText(message));
}
```

- [ ] **Step 2: Run tests**

Run: `pnpm check`
Expected: All tests pass including new `tokens.test.ts` and all existing tests.

- [ ] **Step 3: Commit**

```bash
git add src/utils/tokens.ts tests/tokens.test.ts
git commit -m "feat: use Anthropic tokenizer for accurate token counting"
```
