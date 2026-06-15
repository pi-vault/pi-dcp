# Phase 2: Extract Message Content Editor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/utils/message-content.ts` with `appendText` and `mapText` functions that centralize E9-aware message content manipulation, then refactor callers to use them.

**Architecture:** A new ~30-line utility module owns all E9 string-vs-array normalization, text-part discovery, idempotency marker checking, and immutable cloning. Three call sites in `inject.ts` and `strip.ts` collapse to one-liners. TDD: write tests for the new module first, then implement, then refactor callers.

**Tech Stack:** TypeScript (strict mode), vitest, biome (lint)

**Behavior change:** None. Same tags appended, same hallucinations stripped.

**Prerequisite:** Phase 1 complete (ContextUsage consolidated).

---

## File Map

| Action | File                            | Responsibility                                    |
| ------ | ------------------------------- | ------------------------------------------------- |
| Create | `src/utils/message-content.ts`  | `appendText` and `mapText` functions              |
| Create | `tests/message-content.test.ts` | Unit tests for the new module                     |
| Modify | `src/messages/inject.ts`        | Replace E9 content blocks with `appendText` calls |
| Modify | `src/messages/strip.ts`         | Replace manual iteration with `mapText` call      |

---

### Task 1: Write failing tests for appendText

**Files:**

- Create: `tests/message-content.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { appendText, mapText } from "../src/utils/message-content.ts";
import {
  makeUserMessage,
  makeUserMessageString,
  makeAssistantMessage,
} from "./helpers.ts";

describe("appendText", () => {
  it("appends text to array content message", () => {
    const msg = makeUserMessage("Hello");
    const result = appendText(msg, "\n\n<tag>id</tag>");
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toBe("Hello\n\n<tag>id</tag>");
  });

  it("converts E9 string content to array and appends", () => {
    const msg = makeUserMessageString("Hello");
    const result = appendText(msg, "\n\n<tag>id</tag>");
    expect(Array.isArray(result.content)).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
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
    const originalContent = msg.content;
    appendText(msg, "\n\n<tag>id</tag>");
    expect(msg.content).toBe(originalContent);
  });
});

describe("mapText", () => {
  it("transforms text parts via mapping function", () => {
    const msg = makeAssistantMessage("Hello <dcp>world</dcp>");
    const result = mapText(msg, (t) => t.replace(/<dcp>.*?<\/dcp>/g, ""));
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
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
    const parts = result.content as Array<Record<string, unknown>>;
    expect(parts[0].text).toBe("HELLO");
    expect(parts[1].type).toBe("tool_use"); // unchanged
  });

  it("returns original message if content is not an array", () => {
    const msg = makeUserMessageString("Hello");
    const result = mapText(msg, (t) => t.toUpperCase());
    expect(result).toBe(msg); // string content, mapText skips
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/message-content.test.ts`
Expected: FAIL — module `../src/utils/message-content.ts` does not exist

---

### Task 2: Implement appendText and mapText

**Files:**

- Create: `src/utils/message-content.ts`

- [ ] **Step 1: Write the implementation**

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * Find the index of the first text part in a content array.
 * Returns -1 if no text part exists.
 */
function findTextPartIndex(content: unknown[]): number {
  return content.findIndex(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      (p as unknown as Record<string, unknown>).type === "text",
  );
}

/**
 * Append text to the first text part of a message.
 * Idempotent: skips if marker string is already present in the text part.
 * Handles E9 string content, array content, and missing text parts.
 * Returns the original message by reference if no change was made.
 */
export function appendText(
  msg: AgentMessage,
  text: string,
  marker?: string,
): AgentMessage {
  // E9: UserMessage.content can be a plain string
  if (typeof msg.content === "string") {
    if (marker && msg.content.includes(marker)) return msg;
    return {
      ...msg,
      content: [{ type: "text" as const, text: `${msg.content}${text}` }],
    } as AgentMessage;
  }

  if (!Array.isArray(msg.content)) return msg;

  const idx = findTextPartIndex(msg.content);
  if (idx === -1) return msg;

  const textPart = msg.content[idx] as unknown as {
    type: string;
    text: string;
  };
  if (marker && textPart.text.includes(marker)) return msg;

  const newContent = [...msg.content];
  newContent[idx] = {
    ...textPart,
    text: `${textPart.text}${text}`,
  } as (typeof newContent)[number];

  return { ...msg, content: newContent } as AgentMessage;
}

/**
 * Transform all text parts in a message via a mapping function.
 * Returns the original message by reference if fn returns identical strings.
 */
export function mapText(
  msg: AgentMessage,
  fn: (text: string) => string,
): AgentMessage {
  if (!Array.isArray(msg.content)) return msg;

  let changed = false;
  const newContent = msg.content.map((part) => {
    if (typeof part !== "object" || part === null) return part;
    const p = part as unknown as Record<string, unknown>;
    if (p.type !== "text" || typeof p.text !== "string") return part;

    const mapped = fn(p.text as string);
    if (mapped !== p.text) {
      changed = true;
      return { ...part, text: mapped };
    }
    return part;
  });

  if (!changed) return msg;
  return { ...msg, content: newContent } as AgentMessage;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm vitest run tests/message-content.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/utils/message-content.ts tests/message-content.test.ts
git commit -m "feat: add message-content utility with appendText and mapText

Centralize E9-aware message content manipulation into a single module.
appendText handles string-vs-array content, text-part discovery,
idempotency markers, and immutable cloning. mapText transforms all
text parts via a mapping function.

Generated with [Devin](https://cli.devin.ai/docs)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 3: Refactor injectMessageIds to use appendText

**Files:**

- Modify: `src/messages/inject.ts:38-87` (the `injectMessageIds` function)

- [ ] **Step 1: Add import**

In `src/messages/inject.ts`, add to the imports:

```typescript
import { appendText } from "../utils/message-content.ts";
```

- [ ] **Step 2: Replace the E9 content manipulation block**

The current inner function body in `injectMessageIds` (the `.map` callback, lines 47-86) handles E9 string content, text part discovery, idempotency, and cloning manually. Replace the entire callback body.

Current code inside the `.map((msg, rawIndex) => { ... })` callback (lines 48-86):

```typescript
const ref = state.messageIds.byIndex.get(rawIndex);
if (!ref) return msg;
if (msg.role !== "user") return msg;

const attrs = priorityMap?.get(rawIndex);
const tag = formatMessageIdTag(ref, attrs);

// E9: UserMessage.content can be a plain string
// Idempotency check uses "<dcp-message-id" (no closing >) to match both
// plain and priority-attribute variants.
if (typeof msg.content === "string") {
  if (msg.content.includes("<dcp-message-id")) return msg;
  return {
    ...msg,
    content: [{ type: "text" as const, text: `${msg.content}\n\n${tag}` }],
  } as AgentMessage;
}

if (!Array.isArray(msg.content)) return msg;

const textPartIndex = msg.content.findIndex(
  (p) =>
    typeof p === "object" &&
    p !== null &&
    (p as unknown as Record<string, unknown>).type === "text",
);
if (textPartIndex === -1) return msg;

const textPart = msg.content[textPartIndex] as unknown as {
  type: string;
  text: string;
};

if (textPart.text.includes("<dcp-message-id")) return msg;

const newContent = [...msg.content];
newContent[textPartIndex] = {
  ...textPart,
  text: `${textPart.text}\n\n${tag}`,
} as (typeof newContent)[number];

return { ...msg, content: newContent } as AgentMessage;
```

Replace with:

```typescript
const ref = state.messageIds.byIndex.get(rawIndex);
if (!ref) return msg;
if (msg.role !== "user") return msg;

const attrs = priorityMap?.get(rawIndex);
const tag = formatMessageIdTag(ref, attrs);

return appendText(msg, `\n\n${tag}`, "<dcp-message-id");
```

- [ ] **Step 3: Run existing inject tests**

Run: `pnpm vitest run tests/inject.test.ts`
Expected: All tests PASS (behavior unchanged)

---

### Task 4: Refactor injectCompressNudges to use appendText

**Files:**

- Modify: `src/messages/inject.ts:114-200` (the `injectCompressNudges` function)

- [ ] **Step 1: Replace the reverse-search nudge injection block**

The current nudge injection loop (starting around line 155) iterates backward through messages looking for a user message to append the nudge to. The E9 content manipulation block inside the loop needs to be replaced.

Current code in the reverse loop (the block handling string content and array content, approximately lines 163-196):

```typescript
// E9: handle plain-string content
if (typeof msg.content === "string") {
  if (msg.content.includes("<dcp-system-reminder>")) break;
  result[i] = {
    ...msg,
    content: [
      { type: "text" as const, text: `${msg.content}\n\n${nudgeText}` },
    ],
  } as AgentMessage;
  break;
}

if (!Array.isArray(msg.content)) continue;

const textPartIndex = msg.content.findIndex(
  (p) =>
    typeof p === "object" &&
    p !== null &&
    (p as unknown as Record<string, unknown>).type === "text",
);
if (textPartIndex === -1) continue;

const textPart = msg.content[textPartIndex] as unknown as {
  type: string;
  text: string;
};

if (textPart.text.includes("<dcp-system-reminder>")) break;

const newContent = [...msg.content];
newContent[textPartIndex] = {
  ...textPart,
  text: `${textPart.text}\n\n${nudgeText}`,
} as (typeof newContent)[number];
result[i] = { ...msg, content: newContent } as AgentMessage;
break;
```

Replace with:

```typescript
const updated = appendText(msg, `\n\n${nudgeText}`, "<dcp-system-reminder>");
if (updated !== msg) {
  result[i] = updated;
  break;
}
// If appendText returned same ref, marker was already present — stop searching
if (
  typeof msg.content === "string"
    ? msg.content.includes("<dcp-system-reminder>")
    : Array.isArray(msg.content) &&
      msg.content.some(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          (p as unknown as Record<string, unknown>).type === "text" &&
          ((p as unknown as Record<string, unknown>).text as string).includes(
            "<dcp-system-reminder>",
          ),
      )
) {
  break;
}
```

Wait — this is getting more complex than the original. The issue is that `appendText` returning the same reference can mean either "marker found" (should break) or "no text part found" (should continue). Let me reconsider.

A cleaner approach: keep the role check and use `appendText` only for the content manipulation part. The reverse-search loop logic (finding the right message to inject into) stays.

Revised replacement for the inner block:

```typescript
const updated = appendText(msg, `\n\n${nudgeText}`, "<dcp-system-reminder>");
if (updated === msg) {
  // appendText returned same ref — either marker exists (break) or no text part (continue)
  const hasMarker =
    typeof msg.content === "string"
      ? msg.content.includes("<dcp-system-reminder>")
      : false; // array case: appendText skips if marker found OR no text part
  // For array content, check if a text part exists with the marker
  if (!hasMarker && Array.isArray(msg.content)) {
    const textPart = msg.content.find(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        (p as unknown as Record<string, unknown>).type === "text",
    ) as unknown as { text: string } | undefined;
    if (textPart?.text.includes("<dcp-system-reminder>")) break;
    continue; // no text part found, try previous message
  }
  if (hasMarker) break;
  continue;
}
result[i] = updated;
break;
```

This is still messier than needed. The problem is that `appendText`'s return value conflates two "no-op" cases. The simplest approach: keep the idempotency/break check inline and use `appendText` without a marker for the actual mutation.

**Final revised approach:**

```typescript
// Check for existing marker — stop searching if found
if (typeof msg.content === "string") {
  if (msg.content.includes("<dcp-system-reminder>")) break;
} else if (Array.isArray(msg.content)) {
  const tp = msg.content.find(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      (p as unknown as Record<string, unknown>).type === "text",
  ) as unknown as { text: string } | undefined;
  if (!tp) continue;
  if (tp.text.includes("<dcp-system-reminder>")) break;
} else {
  continue;
}

result[i] = appendText(msg, `\n\n${nudgeText}`);
break;
```

This is cleaner: the loop logic (break on marker, continue on no text part) stays explicit, and the actual content manipulation is delegated to `appendText`. The check-then-mutate pattern is ~14 lines vs the original ~30 lines, and the mutation itself is a one-liner.

- [ ] **Step 2: Run existing tests**

Run: `pnpm vitest run tests/inject.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Run full check**

Run: `pnpm check`
Expected: PASS

---

### Task 5: Refactor stripHallucinations to use mapText

**Files:**

- Modify: `src/messages/strip.ts`

- [ ] **Step 1: Add import**

In `src/messages/strip.ts`, add:

```typescript
import { mapText } from "../utils/message-content.ts";
```

- [ ] **Step 2: Simplify stripHallucinations**

Current implementation (lines 17-39):

```typescript
export function stripHallucinations(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    if (!Array.isArray(msg.content)) return msg;

    let changed = false;
    const newContent = msg.content.map((part) => {
      if (typeof part !== "object" || part === null) return part;
      const p = part as unknown as Record<string, unknown>;
      if (p.type !== "text" || typeof p.text !== "string") return part;

      const cleaned = stripHallucinationsFromString(p.text as string);
      if (cleaned !== p.text) {
        changed = true;
        return { ...part, text: cleaned };
      }
      return part;
    });

    if (!changed) return msg;
    return { ...msg, content: newContent };
  });
}
```

Replace with:

```typescript
export function stripHallucinations(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    return mapText(msg, stripHallucinationsFromString);
  });
}
```

`mapText` already handles: non-array content (returns original), text-part filtering, identity check (returns original if unchanged), and immutable cloning.

- [ ] **Step 3: Run existing strip tests**

Run: `pnpm vitest run tests/strip.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/message-content.ts src/messages/inject.ts src/messages/strip.ts
git commit -m "refactor: use message-content utilities in inject.ts and strip.ts

Replace inline E9 content manipulation in injectMessageIds,
injectCompressNudges, and stripHallucinations with appendText/mapText
from the new message-content module. Eliminates duplicated text-part
discovery and immutable cloning logic.

No behavior change.

Generated with [Devin](https://cli.devin.ai/docs)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```
