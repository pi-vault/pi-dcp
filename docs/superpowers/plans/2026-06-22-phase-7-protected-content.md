# Phase 7: Protected Content in Summaries

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve critical information (protected user messages, `<protect>` tag content, and protected tool outputs) by appending them verbatim to compression summaries.

**Architecture:** After `handleCompress` receives the model-generated summary, run three append functions to enrich it with protected content from the compressed range. No size cap — the user's config (protectedTools, protectUserMessages, protectTags) is the control mechanism.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File                                | Responsibility                                                  |
| ----------------------------------- | --------------------------------------------------------------- |
| `src/compress/protected-content.ts` | New: three append functions + integration helper                |
| `src/compress/handler.ts`           | Call `enrichSummaryWithProtectedContent` after building summary |
| `tests/protected-content.test.ts`   | Unit tests for extraction/append logic                          |

---

### Task 1: Implement protected content extraction functions

**Files:**

- Create: `src/compress/protected-content.ts`
- Test: `tests/protected-content.test.ts` (create)

- [ ] **Step 1: Write tests for all three append functions**

Create `tests/protected-content.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  appendProtectedUserMessages,
  appendProtectedPromptInfo,
  appendProtectedToolOutputs,
  enrichSummaryWithProtectedContent,
} from "../src/compress/protected-content.ts";
import { makeDefaultConfig } from "./helpers.ts";

describe("appendProtectedUserMessages", () => {
  it("appends user message text verbatim when protectUserMessages is true", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Important instruction" }],
        timestamp: 1000,
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "response" }],
        timestamp: 2000,
        stopReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0 },
      } as AgentMessage,
    ];

    const result = appendProtectedUserMessages("Base summary", messages, true);
    expect(result).toContain("Base summary");
    expect(result).toContain("[Protected User Message]");
    expect(result).toContain("Important instruction");
  });

  it("returns summary unchanged when protectUserMessages is false", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Important" }],
        timestamp: 1000,
      } as AgentMessage,
    ];

    const result = appendProtectedUserMessages("Base summary", messages, false);
    expect(result).toBe("Base summary");
  });

  it("handles plain-string user message content", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: "String content",
        timestamp: 1000,
      } as AgentMessage,
    ];

    const result = appendProtectedUserMessages("Summary", messages, true);
    expect(result).toContain("String content");
  });
});

describe("appendProtectedPromptInfo", () => {
  it("extracts content within <protect> tags and appends", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Normal text <protect>Critical data: API_KEY=abc</protect> more text",
          },
        ],
        timestamp: 1000,
      } as AgentMessage,
    ];

    const result = appendProtectedPromptInfo("Base summary", messages, true);
    expect(result).toContain("[Protected Content]");
    expect(result).toContain("Critical data: API_KEY=abc");
    expect(result).not.toContain("<protect>");
  });

  it("handles multiple protect tags in one message", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "<protect>Item A</protect> gap <protect>Item B</protect>",
          },
        ],
        timestamp: 1000,
      } as AgentMessage,
    ];

    const result = appendProtectedPromptInfo("Summary", messages, true);
    expect(result).toContain("Item A");
    expect(result).toContain("Item B");
  });

  it("returns unchanged when protectTags is false", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "<protect>secret</protect>" }],
        timestamp: 1000,
      } as AgentMessage,
    ];

    const result = appendProtectedPromptInfo("Summary", messages, false);
    expect(result).toBe("Summary");
  });

  it("returns unchanged when no protect tags found", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "No tags here" }],
        timestamp: 1000,
      } as AgentMessage,
    ];

    const result = appendProtectedPromptInfo("Summary", messages, true);
    expect(result).toBe("Summary");
  });
});

describe("appendProtectedToolOutputs", () => {
  it("appends tool output when tool name matches protectedTools", () => {
    const messages: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "call1",
        toolName: "read",
        content: [{ type: "text", text: "file content here" }],
        isError: false,
        timestamp: 1000,
      } as unknown as AgentMessage,
    ];

    const result = appendProtectedToolOutputs("Summary", messages, ["read"]);
    expect(result).toContain("[Protected Tool Output: read]");
    expect(result).toContain("file content here");
  });

  it("does not append when tool name not in protectedTools", () => {
    const messages: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "call1",
        toolName: "grep",
        content: [{ type: "text", text: "grep output" }],
        isError: false,
        timestamp: 1000,
      } as unknown as AgentMessage,
    ];

    const result = appendProtectedToolOutputs("Summary", messages, ["read"]);
    expect(result).toBe("Summary");
  });

  it("skips error tool results", () => {
    const messages: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "call1",
        toolName: "read",
        content: [{ type: "text", text: "error: file not found" }],
        isError: true,
        timestamp: 1000,
      } as unknown as AgentMessage,
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
      {
        role: "user",
        content: [
          { type: "text", text: "Do <protect>critical</protect> task" },
        ],
        timestamp: 1000,
      } as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read",
        content: [{ type: "text", text: "file data" }],
        isError: false,
        timestamp: 2000,
      } as unknown as AgentMessage,
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/protected-content.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/compress/protected-content.ts`**

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { DcpConfig } from "../config.ts";

const PROTECT_TAG_REGEX = /<protect>([\s\S]*?)<\/protect>/gi;

/**
 * Extract text from a message's content (handles string and array forms).
 */
function getMessageText(msg: AgentMessage): string {
  if (!("content" in msg)) return "";
  if (typeof msg.content === "string") return msg.content;
  if (!Array.isArray(msg.content)) return "";
  return msg.content
    .filter(
      (p): p is { type: "text"; text: string } =>
        typeof p === "object" &&
        p !== null &&
        (p as Record<string, unknown>).type === "text",
    )
    .map((p) => (p as unknown as { text: string }).text)
    .join("\n");
}

/**
 * Append protected user messages verbatim to the summary.
 */
export function appendProtectedUserMessages(
  summary: string,
  messages: AgentMessage[],
  protectUserMessages: boolean,
): string {
  if (!protectUserMessages) return summary;

  const userTexts: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const text = getMessageText(msg);
    if (text.trim()) userTexts.push(text);
  }

  if (userTexts.length === 0) return summary;

  const section = userTexts
    .map((t) => `[Protected User Message]\n${t}`)
    .join("\n\n");

  return `${summary}\n\n---\n${section}`;
}

/**
 * Extract content within <protect> tags from user messages and append to summary.
 */
export function appendProtectedPromptInfo(
  summary: string,
  messages: AgentMessage[],
  protectTags: boolean,
): string {
  if (!protectTags) return summary;

  const extracted: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const text = getMessageText(msg);
    let match: RegExpExecArray | null;
    PROTECT_TAG_REGEX.lastIndex = 0;
    while ((match = PROTECT_TAG_REGEX.exec(text)) !== null) {
      const content = match[1].trim();
      if (content) extracted.push(content);
    }
  }

  if (extracted.length === 0) return summary;

  const section = extracted
    .map((t) => `[Protected Content]\n${t}`)
    .join("\n\n");

  return `${summary}\n\n---\n${section}`;
}

/**
 * Append outputs of protected tools verbatim to the summary.
 */
export function appendProtectedToolOutputs(
  summary: string,
  messages: AgentMessage[],
  protectedTools: string[],
): string {
  if (protectedTools.length === 0) return summary;

  const outputs: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "toolResult") continue;
    const toolMsg = msg as unknown as {
      toolCallId: string;
      toolName?: string;
      isError?: boolean;
    };
    if (toolMsg.isError) continue;
    if (!toolMsg.toolName || !protectedTools.includes(toolMsg.toolName))
      continue;

    const text = getMessageText(msg);
    if (text.trim()) {
      outputs.push(`[Protected Tool Output: ${toolMsg.toolName}]\n${text}`);
    }
  }

  if (outputs.length === 0) return summary;

  return `${summary}\n\n---\n${outputs.join("\n\n")}`;
}

/**
 * Enrich a compression summary with all configured protected content.
 */
export function enrichSummaryWithProtectedContent(
  summary: string,
  messages: AgentMessage[],
  config: DcpConfig,
): string {
  let enriched = summary;
  enriched = appendProtectedUserMessages(
    enriched,
    messages,
    config.compress.protectUserMessages,
  );
  enriched = appendProtectedPromptInfo(
    enriched,
    messages,
    config.compress.protectTags,
  );
  enriched = appendProtectedToolOutputs(
    enriched,
    messages,
    config.compress.protectedTools,
  );
  return enriched;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/protected-content.test.ts`

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/compress/protected-content.ts tests/protected-content.test.ts
git commit -m "feat(protect): implement protected content extraction for summaries"
```

---

### Task 2: Integrate into `handleCompress`

**Files:**

- Modify: `src/compress/handler.ts`

- [ ] **Step 1: Import and call `enrichSummaryWithProtectedContent`**

In `src/compress/handler.ts`, add the import:

```typescript
import { enrichSummaryWithProtectedContent } from "./protected-content.ts";
```

In `handleCompress`, after the summary is built for each entry (inside the normalization loop where `summary` is available), enrich it before passing to `applyCompressionState`. Find where summary is used and wrap:

```typescript
// Before calling wrapCompressedSummary or passing to applyCompressionState:
const rangeMessages = messages.slice(startIndex, endIndex + 1);
const enrichedSummary = enrichSummaryWithProtectedContent(
  entry.summary,
  rangeMessages,
  config,
);
```

Use `enrichedSummary` instead of `entry.summary` for the subsequent `wrapCompressedSummary` call and token counting.

Note: The exact integration point depends on the loop structure in `handleCompress`. Read the current code and insert at the point where each entry's summary is finalized before state application.

- [ ] **Step 2: Update the `handleCompress` signature to accept config**

The current signature is `handleCompress(state, _config, messages, args)`. The `_config` parameter is already there but unused (prefixed with `_`). Remove the underscore:

```typescript
function handleCompress(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  args: CompressArgs,
): string;
```

- [ ] **Step 3: Run full check**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npm run check`

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/compress/handler.ts
git commit -m "feat(protect): enrich compression summaries with protected content"
```

---

## Verification Checklist

- [ ] `npm run check` passes
- [ ] Protected user messages appended verbatim when `protectUserMessages: true`
- [ ] `<protect>` tag content extracted and appended when `protectTags: true`
- [ ] Protected tool outputs appended when tool name matches `protectedTools`
- [ ] Error tool results skipped
- [ ] No size cap on appended content
- [ ] Config defaults unchanged (`protectUserMessages: false`, `protectTags: false`)
