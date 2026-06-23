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
| `tests/helpers.ts`                  | Add `makeToolResultMessage` shared helper                       |
| `tests/protected-content.test.ts`   | Unit tests for extraction/append logic                          |

---

### Task 1: Implement protected content extraction functions

**Files:**

- Create: `src/compress/protected-content.ts`
- Modify: `tests/helpers.ts` (add `makeToolResultMessage`)
- Create: `tests/protected-content.test.ts`

- [ ] **Step 1: Add `makeToolResultMessage` helper to `tests/helpers.ts`**

Append to `tests/helpers.ts`:

```typescript
export function makeToolResultMessage(
  toolCallId: string,
  toolName: string,
  text: string,
  isError = false,
  timestamp?: number,
): AgentMessage {
  const ts = timestamp ?? nextTestTimestamp++;
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError,
    timestamp: ts,
  } as AgentMessage;
}
```

- [ ] **Step 2: Write tests for all three append functions**

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
});

describe("appendProtectedPromptInfo", () => {
  it("extracts content within <protect> tags and appends", () => {
    const messages: AgentMessage[] = [
      makeUserMessage(
        "Normal text <protect>Critical data: API_KEY=abc</protect> more text",
      ),
    ];

    const result = appendProtectedPromptInfo("Base summary", messages, true);
    expect(result).toContain("[Protected Content]");
    expect(result).toContain("Critical data: API_KEY=abc");
    expect(result).not.toContain("<protect>");
  });

  it("handles multiple protect tags in one message", () => {
    const messages: AgentMessage[] = [
      makeUserMessage(
        "<protect>Item A</protect> gap <protect>Item B</protect>",
      ),
    ];

    const result = appendProtectedPromptInfo("Summary", messages, true);
    expect(result).toContain("Item A");
    expect(result).toContain("Item B");
  });

  it("returns unchanged when protectTags is false", () => {
    const messages: AgentMessage[] = [
      makeUserMessage("<protect>secret</protect>"),
    ];

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
    const messages: AgentMessage[] = [
      makeToolResultMessage("call1", "read", "file content here"),
    ];

    const result = appendProtectedToolOutputs("Summary", messages, ["read"]);
    expect(result).toContain("[Protected Tool Output: read]");
    expect(result).toContain("file content here");
  });

  it("does not append when tool name not in protectedTools", () => {
    const messages: AgentMessage[] = [
      makeToolResultMessage("call1", "grep", "grep output"),
    ];

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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/protected-content.test.ts`

Expected: FAIL — module `../src/compress/protected-content.ts` does not exist.

- [ ] **Step 4: Implement `src/compress/protected-content.ts`**

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
    if (msg.isError) continue;
    if (!protectedTools.includes(msg.toolName)) continue;

    const text = getMessageText(msg);
    if (text.trim()) {
      outputs.push(`[Protected Tool Output: ${msg.toolName}]\n${text}`);
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

Note on `appendProtectedToolOutputs`: After a `msg.role !== "toolResult"` guard, TypeScript narrows `msg` to `ToolResultMessage` which has `toolName`, `toolCallId`, and `isError` as direct properties. The codebase accesses these without casts in `search.ts` and `tool-cache.ts`. Follow that pattern — no `as unknown as` cast needed.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/protected-content.test.ts`

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers.ts src/compress/protected-content.ts tests/protected-content.test.ts
git commit -m "feat(protect): implement protected content extraction for summaries"
```

---

### Task 2: Integrate into `handleCompress`

**Files:**

- Modify: `src/compress/handler.ts`
- Create: `tests/protected-content-integration.test.ts`

- [ ] **Step 1: Rename `_config` to `config` and add enrichment call**

In `src/compress/handler.ts`:

1. Add the import at the top:

```typescript
import { enrichSummaryWithProtectedContent } from "./protected-content.ts";
```

2. In the `handleCompress` signature, rename `_config` to `config`:

```typescript
export function handleCompress(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  args: CompressArgs,
): string {
```

3. Inside the `for (const entry of entries)` loop, insert enrichment between `allocateBlockId` and `wrapCompressedSummary`. The current code (lines 51-53) is:

```typescript
const blockId = allocateBlockId(state);
const wrappedSummary = wrapCompressedSummary(blockId, entry.summary);
```

Change to:

```typescript
const blockId = allocateBlockId(state);
const rangeMessages = messages.slice(entry.startIndex, entry.endIndex + 1);
const enrichedSummary = enrichSummaryWithProtectedContent(
  entry.summary,
  rangeMessages,
  config,
);
const wrappedSummary = wrapCompressedSummary(blockId, enrichedSummary);
```

- [ ] **Step 2: Write integration test**

Create `tests/protected-content-integration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { handleCompress } from "../src/compress/handler.ts";
import { createSessionState } from "../src/state/state.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  makeDefaultConfig,
  makeUserMessage,
  makeAssistantMessage,
} from "./helpers.ts";

describe("handleCompress with protected content", () => {
  it("enriches summary with protected user messages when enabled", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ protectUserMessages: true });

    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(1, "m0002");
    state.messageIds.nextRefIndex = 3;

    const messages: AgentMessage[] = [
      makeUserMessage("Remember this instruction"),
      makeAssistantMessage("Got it"),
    ];

    handleCompress(state, config, messages, {
      topic: "test",
      content: [
        {
          startId: "m0001",
          endId: "m0002",
          summary: "User gave instruction",
        },
      ],
      mode: "range",
    });

    const block = [...state.prune.messages.blocksById.values()][0];
    expect(block.summary).toContain("[Protected User Message]");
    expect(block.summary).toContain("Remember this instruction");
  });

  it("enriches summary with protect-tag content when enabled", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ protectTags: true });

    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(1, "m0002");
    state.messageIds.nextRefIndex = 3;

    const messages: AgentMessage[] = [
      makeUserMessage("Normal <protect>critical secret</protect> text"),
      makeAssistantMessage("Noted"),
    ];

    handleCompress(state, config, messages, {
      topic: "test",
      content: [
        { startId: "m0001", endId: "m0002", summary: "Exchange summary" },
      ],
      mode: "range",
    });

    const block = [...state.prune.messages.blocksById.values()][0];
    expect(block.summary).toContain("[Protected Content]");
    expect(block.summary).toContain("critical secret");
  });

  it("does not enrich when protection flags are off (default)", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(1, "m0002");
    state.messageIds.nextRefIndex = 3;

    const messages: AgentMessage[] = [
      makeUserMessage("Regular message"),
      makeAssistantMessage("Reply"),
    ];

    handleCompress(state, config, messages, {
      topic: "test",
      content: [{ startId: "m0001", endId: "m0002", summary: "Basic summary" }],
      mode: "range",
    });

    const block = [...state.prune.messages.blocksById.values()][0];
    expect(block.summary).not.toContain("[Protected");
  });
});
```

- [ ] **Step 3: Run full check**

Run: `npm run check`

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/compress/handler.ts tests/protected-content-integration.test.ts
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
- [ ] Integration test confirms enriched content appears in compression block summary
