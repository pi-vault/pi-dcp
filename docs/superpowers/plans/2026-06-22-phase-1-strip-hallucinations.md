# Phase 1: Strip Hallucinations on `message_end`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate truncated/hallucinated DCP tags from persisted messages by stripping on output (`message_end`) and cleaning before injection.

**Architecture:** Belt-and-suspenders approach — strip tags both on output (so stored messages are clean) and before injection (so stale partial tags don't cause idempotency false-positives). The `message_end` handler uses Pi's event API to replace the finalized assistant message.

**Tech Stack:** TypeScript, Pi extension API (`message_end` event), Vitest

---

## File Structure

| File                           | Responsibility                                                                |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `src/messages/strip.ts`        | Regex definitions and `stripHallucinationsFromString` / `stripHallucinations` |
| `src/utils/message-content.ts` | `mapText` utility (already exists, no changes)                                |
| `src/messages/inject.ts`       | `injectMessageIds` — strip before injecting fresh tags                        |
| `src/index.ts`                 | Register `message_end` handler                                                |
| `tests/strip.test.ts`          | Unit tests for strip functions                                                |
| `tests/inject.test.ts`         | Unit tests for inject (strip-before-inject behavior)                          |

---

### Task 1: Add truncated-tag regex coverage to `stripHallucinationsFromString`

**Files:**

- Modify: `src/messages/strip.ts`
- Test: `tests/strip.test.ts`

- [ ] **Step 1: Write failing tests for truncated tag patterns**

Add these test cases to `tests/strip.test.ts` inside the existing `describe("stripHallucinationsFromString", ...)` block:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/strip.test.ts`

Expected: 5 new tests FAIL (partial tags not caught by current regex).

- [ ] **Step 3: Update regex in `strip.ts` to handle truncated tags**

Replace the entire content of `src/messages/strip.ts` with:

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { mapText } from "../utils/message-content.ts";

// 1. Complete paired tags: <dcp-foo attr="x">content</dcp-foo>
const DCP_COMPLETE_PAIR = /<dcp[-\w]*(?:\s[^>]*)?>[\s\S]*?<\/dcp[-\w]*>/gi;
// 2. Truncated pair (no final > on close): <dcp-foo>content</dcp-foo or </dcp
const DCP_TRUNCATED_PAIR = /<dcp[-\w]*(?:\s[^>]*)?>[\s\S]*?<\/dcp[-\w]*/gi;
// 3. Lone unpaired tags: </dcp-foo> or <dcp-foo>
const DCP_UNPAIRED_TAG = /<\/?dcp[-\w]*(?:\s[^>]*)?>/gi;
// 4. Partial tag at end of string: <dcp-message-id or </dcp or <dcp-foo priority="3
const DCP_PARTIAL_TAG = /<\/?dcp[-\w]*(?:\s[^>]*)?$/gim;

/**
 * Strip hallucinated DCP tags from a string.
 * Handles complete paired tags, truncated pairs, lone unpaired tags, and
 * partial tags at end of string. Order matters: complete pairs first (they
 * consume the closing >), then truncated pairs, then lone tags, then partials.
 */
export function stripHallucinationsFromString(text: string): string {
  return text
    .replace(DCP_COMPLETE_PAIR, "")
    .replace(DCP_TRUNCATED_PAIR, "")
    .replace(DCP_UNPAIRED_TAG, "")
    .replace(DCP_PARTIAL_TAG, "");
}

/**
 * Strip hallucinated DCP tags from assistant messages.
 * Returns a new array. Messages without changes are returned by reference.
 */
export function stripHallucinations(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    return mapText(msg, stripHallucinationsFromString);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/strip.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/messages/strip.ts tests/strip.test.ts
git commit -m "fix(strip): add regex coverage for truncated DCP tags"
```

---

### Task 2: Register `message_end` handler to strip hallucinations on output

**Files:**

- Modify: `src/index.ts`
- Test: `tests/message-end.test.ts` (create)

- [ ] **Step 1: Write failing test for message_end stripping**

Create `tests/message-end.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { stripHallucinationsFromString } from "../src/messages/strip.ts";
import { mapText } from "../src/utils/message-content.ts";

/**
 * Unit test for the message_end stripping logic.
 * The actual handler is registered in index.ts; here we test the core transform
 * that the handler applies (mapText + stripHallucinationsFromString).
 */
describe("message_end strip logic", () => {
  it("strips complete DCP tags from assistant message content", () => {
    const msg: AgentMessage = {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Here is the answer <dcp-message-id>m0012</dcp-message-id>",
        },
      ],
      stopReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
      timestamp: Date.now(),
    } as AgentMessage;

    const stripped = mapText(msg, stripHallucinationsFromString);
    const textPart = (
      stripped as unknown as { content: Array<{ text: string }> }
    ).content[0];
    expect(textPart.text).toBe("Here is the answer ");
  });

  it("strips truncated DCP tags from assistant message content", () => {
    const msg: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Result <dcp-message-id>m0093</dcp" }],
      stopReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
      timestamp: Date.now(),
    } as AgentMessage;

    const stripped = mapText(msg, stripHallucinationsFromString);
    const textPart = (
      stripped as unknown as { content: Array<{ text: string }> }
    ).content[0];
    expect(textPart.text).toBe("Result ");
  });

  it("returns original reference when no DCP tags present", () => {
    const msg: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Clean text" }],
      stopReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
      timestamp: Date.now(),
    } as AgentMessage;

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
    } as AgentMessage;

    const stripped = mapText(msg, stripHallucinationsFromString);
    const parts = (
      stripped as unknown as { content: Array<{ type: string; text?: string }> }
    ).content;
    expect(parts[0].text).toBe("Before ");
    expect(parts[1].type).toBe("toolCall");
    expect(parts[2].text).toBe("After ");
  });
});
```

- [ ] **Step 2: Run test to verify it passes (these test the transform logic, not the handler registration)**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/message-end.test.ts`

Expected: All PASS (this validates the transform; handler registration is integration-level).

- [ ] **Step 3: Register `message_end` handler in `index.ts`**

In `src/index.ts`, add the handler after the `turn_end` handler (before the `context` handler). Insert after line 179 (`state.currentTurn++; });`):

```typescript
pi.on("message_end", async (event, _ctx) => {
  if (!config.enabled) return;
  if (event.message.role !== "assistant") return;

  const stripped = mapText(event.message, stripHallucinationsFromString);
  if (stripped !== event.message) {
    return { message: stripped };
  }
});
```

Also add the required imports at the top of `src/index.ts`. Add to existing imports:

```typescript
import { stripHallucinationsFromString } from "./messages/strip.ts";
import { mapText } from "./utils/message-content.ts";
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run`

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/index.ts tests/message-end.test.ts
git commit -m "feat(strip): register message_end handler to strip DCP tags on output"
```

---

### Task 3: Strip existing DCP tags before injecting fresh ones

**Files:**

- Modify: `src/messages/inject.ts`
- Test: `tests/inject.test.ts`

- [ ] **Step 1: Write failing test for strip-before-inject behavior**

Add this test case to `tests/inject.test.ts` inside the existing `describe("injectMessageIds", ...)` block:

```typescript
it("strips existing DCP tags before injecting fresh ones", () => {
  const state = createSessionState();
  const messages: AgentMessage[] = [
    makeUserMessage("Hello <dcp-message-id>m0099</dcp-message-id>"),
    makeAssistantMessage("Response <dcp-message-id>m0100</dcp-message-id>"),
  ];

  assignMessageRefs(state, messages);
  const result = injectMessageIds(state, messages);

  // Should have fresh m0001/m0002 tags, not the stale m0099/m0100
  const userText = (
    result[0] as unknown as { content: Array<{ text: string }> }
  ).content[0].text;
  const assistantText = (
    result[1] as unknown as { content: Array<{ text: string }> }
  ).content[0].text;

  expect(userText).toContain("<dcp-message-id>m0001</dcp-message-id>");
  expect(userText).not.toContain("m0099");
  expect(assistantText).toContain("<dcp-message-id>m0002</dcp-message-id>");
  expect(assistantText).not.toContain("m0100");
});

it("strips truncated DCP tags before injecting", () => {
  const state = createSessionState();
  const messages: AgentMessage[] = [
    makeAssistantMessage("Response <dcp-message-id>m0050</dcp"),
  ];

  assignMessageRefs(state, messages);
  const result = injectMessageIds(state, messages);

  const text = (result[0] as unknown as { content: Array<{ text: string }> })
    .content[0].text;
  expect(text).toContain("<dcp-message-id>m0001</dcp-message-id>");
  expect(text).not.toContain("m0050");
  expect(text).not.toContain("</dcp");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/inject.test.ts`

Expected: 2 new tests FAIL (current code skips injection due to idempotency marker `<dcp-message-id` being present in the stale tag).

- [ ] **Step 3: Modify `injectMessageIds` to strip before injecting**

In `src/messages/inject.ts`, add an import for `stripHallucinationsFromString`:

```typescript
import { stripHallucinationsFromString } from "./strip.ts";
```

Then replace the `injectMessageIds` function body. Change from:

```typescript
export function injectMessageIds(
  state: SessionState,
  messages: AgentMessage[],
  priorityMap?: PriorityMap,
): AgentMessage[] {
  return messages.map((msg, i) => {
    const ref = state.messageIds.byIndex.get(i);
    if (!ref) return msg;

    if (msg.role !== "user" && msg.role !== "assistant") return msg;

    const priorityEntry = priorityMap?.get(i);
    const tag = formatMessageIdTag(
      ref,
      priorityEntry ? { priority: priorityEntry.priority } : undefined,
    );

    // Idempotency marker uses "<dcp-message-id" (no closing >) to match both
    // plain and priority-attribute variants.
    return appendText(msg, `\n\n${tag}`, "<dcp-message-id");
  });
}
```

To:

```typescript
export function injectMessageIds(
  state: SessionState,
  messages: AgentMessage[],
  priorityMap?: PriorityMap,
): AgentMessage[] {
  return messages.map((msg, i) => {
    const ref = state.messageIds.byIndex.get(i);
    if (!ref) return msg;

    if (msg.role !== "user" && msg.role !== "assistant") return msg;

    const priorityEntry = priorityMap?.get(i);
    const tag = formatMessageIdTag(
      ref,
      priorityEntry ? { priority: priorityEntry.priority } : undefined,
    );

    // Strip any existing (stale/partial) DCP tags before injecting fresh ones.
    // This replaces marker-based idempotency — always inject clean.
    const cleaned = mapText(msg, stripHallucinationsFromString);
    return appendText(cleaned, `\n\n${tag}`);
  });
}
```

Also add the `mapText` import if not already present:

```typescript
import { appendText, mapText } from "../utils/message-content.ts";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/inject.test.ts`

Expected: All tests PASS (including existing idempotency tests — since strip+inject is equivalent to no-op when the existing tag is the correct one being freshly injected).

- [ ] **Step 5: Run full check**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npm run check`

Expected: Lint, typecheck, and all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/messages/inject.ts tests/inject.test.ts
git commit -m "feat(inject): strip existing DCP tags before injecting fresh ones

Replaces marker-based idempotency with strip-then-inject. This ensures
stale or truncated tags from hallucinations don't block fresh injection."
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `npm run check` passes (lint + typecheck + all tests)
- [ ] Existing `tests/strip.test.ts` tests still pass (backward compat)
- [ ] Existing `tests/inject.test.ts` idempotency tests still pass
- [ ] New truncated-tag tests cover: partial at end, no closing `>`, paired missing final `>`
- [ ] `message_end` handler registered and type-correct
- [ ] No other files touched beyond the 4 listed in the spec
