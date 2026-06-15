# Phase 3: Nudges + Message IDs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **IMPORTANT:** Read `plans/ERRATA.md` before implementing. It contains corrections to API signatures, type shapes, and import paths verified against Pi source.

**Prerequisite:** Phase 2 (Strategy-Based Pruning) completed and passing.

**Goal:** Add context-limit nudges and message reference IDs to the extension. After this phase, pi-dcp tags every message with a sequential reference ID (`<dcp-message-id>m0001</dcp-message-id>`) and injects nudge prompts when context usage exceeds configured thresholds — prompting the model to use the `compress` tool (which Phase 4 will register).

**Usable result after this phase:** The model sees message reference IDs in each message's content, receives a DCP system prompt explaining context management, and gets nudged (via `<dcp-system-reminder>` tags injected into messages) when context approaches limits. This prepares the model for compression even before the `compress` tool exists.

**Architecture:**
- `src/prompts/system.ts` — DCP system prompt text, injected via `before_agent_start`
- `src/prompts/nudges.ts` — Three nudge prompt templates (context-limit, turn, iteration)
- `src/messages/inject.ts` — `assignMessageRefs()` and `injectMessageIds()` for tagging messages; `injectCompressNudges()` for nudge injection based on `ctx.getContextUsage()`
- Context pipeline gains: `assignMessageRefs` → `injectCompressNudges` → `injectMessageIds` steps

**Key adaptation from OpenCode DCP:**
- DCP uses `isContextOverLimits()` with raw token counting from message parts. Pi provides `ctx.getContextUsage()` returning `{ tokens, contextWindow, percent }` — we use `percent` directly against `maxContextPercent`/`minContextPercent` config thresholds.
- DCP uses OpenCode message IDs (`.info.id`) for anchor tracking. Pi messages don't have stable IDs across context events (the array is re-created). We use array indices as anchor references instead.
- DCP injects nudges by mutating message part text in-place. Pi's context handler returns a new message array — we mutate the cloned messages (Pi provides `structuredClone`'d copies).

**Conventions:**
- Nudge injection is idempotent: if a nudge tag is already present in the message text, skip it.
- Message IDs are assigned sequentially from `m0001` and cached in `state.messageIds.byIndex`.
- The system prompt is appended to Pi's system prompt via the `before_agent_start` event's return value.

---

## File Structure (additions to Phase 2)

```
src/
  prompts/
    system.ts                    # DCP system prompt text
    nudges.ts                    # Three nudge prompt templates
  messages/
    inject.ts                   # Message ref assignment, nudge + ID injection
```

---

### Task 1: DCP System Prompt

**Files:**
- Create: `src/prompts/system.ts`
- Test: (no test — static string)

The DCP system prompt teaches the model about context management, the compress tool philosophy, and DCP tag semantics.

- [ ] **Step 1: Create system prompt**

Create `src/prompts/system.ts`:

```typescript
/**
 * DCP system prompt appended to Pi's system prompt via before_agent_start.
 * Teaches the model about context management and the compress tool.
 */
export const DCP_SYSTEM_PROMPT = `
You operate in a context-constrained environment. Manage context continuously to avoid buildup and preserve retrieval quality. Efficient context management is paramount for your agentic performance.

The ONLY tool you have for context management is \`compress\`. It replaces older conversation content with technical summaries you produce.

\`<dcp-message-id>\` and \`<dcp-system-reminder>\` tags are environment-injected metadata. Do not output them.

THE PHILOSOPHY OF COMPRESS
\`compress\` transforms conversation content into dense, high-fidelity summaries. This is not cleanup - it is crystallization. Your summary becomes the authoritative record of what transpired.

Think of compression as phase transitions: raw exploration becomes refined understanding. The original context served its purpose; your summary now carries that understanding forward.

COMPRESS WHEN

A section is genuinely closed and the raw conversation has served its purpose:

- Research concluded and findings are clear
- Implementation finished and verified
- Exploration exhausted and patterns understood
- Dead-end noise can be discarded without waiting for a whole chapter to close

DO NOT COMPRESS IF

- Raw context is still relevant and needed for edits or precise references
- The target content is still actively in progress
- You may need exact code, error messages, or file contents in the immediate next steps

Before compressing, ask: _"Is this section closed enough to become summary-only right now?"_

Evaluate conversation signal-to-noise REGULARLY. Use \`compress\` deliberately with quality-first summaries. Prioritize stale content intelligently to maintain a high-signal context window that supports your agency.

It is of your responsibility to keep a sharp, high-quality context window for optimal performance.
`;
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/prompts/system.ts
git commit -m "feat: add DCP system prompt for context management"
```

---

### Task 2: Nudge Prompt Templates

**Files:**
- Create: `src/prompts/nudges.ts`
- Test: (no test — static strings)

Three nudge templates used at different severity levels. Each is wrapped in `<dcp-system-reminder>` tags.

- [ ] **Step 1: Create nudge prompts**

Create `src/prompts/nudges.ts`:

```typescript
/**
 * Nudge prompts injected into messages when context usage exceeds thresholds.
 * All wrapped in <dcp-system-reminder> tags — the model is trained to strip these.
 */

/** Injected when context exceeds maxContextPercent. Urgent. */
export const CONTEXT_LIMIT_NUDGE = `<dcp-system-reminder>
CRITICAL WARNING: MAX CONTEXT LIMIT REACHED

You are at or beyond the configured max context threshold. This is an emergency context-recovery moment.

You MUST use the \`compress\` tool now. Do not continue normal exploration until compression is handled.

If you are in the middle of a critical atomic operation, finish that atomic step first, then compress immediately.

SELECTION PROCESS
Start from older, resolved history and capture as much stale context as safely possible in one pass.
Avoid the newest active working messages unless it is clearly closed.

SUMMARY REQUIREMENTS
Your summary MUST cover all essential details from the selected messages so work can continue.
If the compressed range includes user messages, preserve user intent exactly. Prefer direct quotes for short user messages to avoid semantic drift.
</dcp-system-reminder>
`;

/** Injected on user turns when context is between minContextPercent and maxContextPercent. Moderate. */
export const TURN_NUDGE = `<dcp-system-reminder>
Evaluate the conversation for compressible ranges.

If any messages are cleanly closed and unlikely to be needed again, use the compress tool on them.
If direction has shifted, compress earlier ranges that are now less relevant.

The goal is to filter noise and distill key information so context accumulation stays under control.
Keep active context uncompressed.
</dcp-system-reminder>
`;

/** Injected after many assistant iterations without a user message. Moderate. */
export const ITERATION_NUDGE = `<dcp-system-reminder>
You've been iterating for a while after the last user message.

If there is a closed portion that is unlikely to be referenced immediately (for example, finished research before implementation), use the compress tool on it now.
</dcp-system-reminder>
`;
```

- [ ] **Step 2: Commit**

```bash
git add src/prompts/nudges.ts
git commit -m "feat: add nudge prompt templates for context management"
```

---

### Task 3: Message Ref Assignment and ID Injection

**Files:**
- Create: `src/messages/inject.ts`
- Test: `tests/inject.test.ts`

`assignMessageRefs()` assigns sequential references (m0001, m0002, ...) to each message. `injectMessageIds()` appends `<dcp-message-id>` tags to message content.

- [ ] **Step 1: Write tests**

Create `tests/inject.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { assignMessageRefs, injectMessageIds } from "../src/messages/inject.ts";
import { createSessionState } from "../src/state/state.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

function makeUserMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

function makeAssistantMessage(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
    timestamp: Date.now(),
  } as AgentMessage;
}

describe("inject", () => {
  describe("assignMessageRefs", () => {
    it("assigns sequential refs to messages", () => {
      const state = createSessionState();
      const messages = [makeUserMessage("hello"), makeAssistantMessage("hi")];

      assignMessageRefs(state, messages);

      expect(state.messageIds.byIndex.get(0)).toBe("m0001");
      expect(state.messageIds.byIndex.get(1)).toBe("m0002");
      expect(state.messageIds.nextRefIndex).toBe(3);
    });

    it("reuses existing refs for same indices", () => {
      const state = createSessionState();
      const messages = [makeUserMessage("hello")];

      assignMessageRefs(state, messages);
      const ref1 = state.messageIds.byIndex.get(0);

      assignMessageRefs(state, messages);
      const ref2 = state.messageIds.byIndex.get(0);

      expect(ref1).toBe(ref2);
    });
  });

  describe("injectMessageIds", () => {
    it("appends dcp-message-id tags to text content", () => {
      const state = createSessionState();
      const messages = [makeUserMessage("hello"), makeAssistantMessage("hi")];
      assignMessageRefs(state, messages);

      const result = injectMessageIds(state, messages);

      const userText = (result[0] as any).content[0].text;
      expect(userText).toContain("<dcp-message-id>m0001</dcp-message-id>");

      const assistantText = (result[1] as any).content[0].text;
      expect(assistantText).toContain("<dcp-message-id>m0002</dcp-message-id>");
    });

    it("is idempotent (does not double-inject)", () => {
      const state = createSessionState();
      const messages = [makeUserMessage("hello")];
      assignMessageRefs(state, messages);

      const first = injectMessageIds(state, messages);
      const second = injectMessageIds(state, first);

      const text = (second[0] as any).content[0].text;
      const matches = text.match(/<dcp-message-id>/g);
      expect(matches).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/inject.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement injection**

Create `src/messages/inject.ts`:

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { formatMessageRef, formatMessageIdTag } from "../utils/message-ids.ts";
import { CONTEXT_LIMIT_NUDGE, TURN_NUDGE, ITERATION_NUDGE } from "../prompts/nudges.ts";

/**
 * Assign sequential message refs (m0001, m0002, ...) to messages.
 * Refs are cached in state.messageIds.byIndex so re-runs don't reallocate.
 */
export function assignMessageRefs(
  state: SessionState,
  messages: AgentMessage[],
): void {
  for (let i = 0; i < messages.length; i++) {
    if (state.messageIds.byIndex.has(i)) continue;

    const ref = formatMessageRef(state.messageIds.nextRefIndex);
    state.messageIds.byIndex.set(i, ref);
    state.messageIds.nextRefIndex++;
  }
}

/**
 * Inject <dcp-message-id> tags into message text content.
 * Returns a new array. Idempotent: skips if tag is already present.
 */
export function injectMessageIds(
  state: SessionState,
  messages: AgentMessage[],
): AgentMessage[] {
  return messages.map((msg, i) => {
    const ref = state.messageIds.byIndex.get(i);
    if (!ref) return msg;

    if (msg.role !== "user" && msg.role !== "assistant") return msg;

    const tag = formatMessageIdTag(ref);
    if (!Array.isArray(msg.content)) return msg;

    // Find first text part
    const textPartIndex = msg.content.findIndex(
      (p) => typeof p === "object" && p !== null && (p as any).type === "text",
    );
    if (textPartIndex === -1) return msg;

    const textPart = msg.content[textPartIndex] as { type: "text"; text: string };
    if (textPart.text.includes("<dcp-message-id>")) return msg;

    const newContent = [...msg.content];
    newContent[textPartIndex] = {
      ...textPart,
      text: `${textPart.text}\n\n${tag}`,
    };

    return { ...msg, content: newContent };
  });
}

/**
 * Context usage info from Pi's ctx.getContextUsage().
 */
export interface ContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number;
}

/**
 * Inject compress nudges into messages based on context usage.
 * Three tiers:
 * - Context limit nudge: when percent >= maxContextPercent (urgent)
 * - Turn nudge: when percent >= minContextPercent and a new user message appeared
 * - Iteration nudge: when percent >= minContextPercent and many assistant iterations
 *
 * Nudges are injected as text appended to the last assistant or user message.
 * Returns a new array. Idempotent.
 */
export function injectCompressNudges(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  contextUsage: ContextUsage | undefined,
): AgentMessage[] {
  if (!contextUsage) return messages;

  const percent = contextUsage.percent;
  const overMax = percent >= config.compress.maxContextPercent;
  const overMin = percent >= config.compress.minContextPercent;

  if (!overMin) return messages;

  if (state.manualMode) return messages;
  if (state.compressPermission === "deny") return messages;

  // Find last message to inject into
  const lastIndex = messages.length - 1;
  if (lastIndex < 0) return messages;

  let nudgeText: string | undefined;

  if (overMax) {
    nudgeText = CONTEXT_LIMIT_NUDGE;
  } else {
    // Check if the last message is a user message (turn nudge)
    const lastMsg = messages[lastIndex];
    if (lastMsg.role === "user") {
      nudgeText = TURN_NUDGE;
    } else {
      // Check for iteration nudge: many assistant messages since last user
      let messagesSinceUser = 0;
      for (let i = lastIndex; i >= 0; i--) {
        if (messages[i].role === "user") break;
        messagesSinceUser++;
      }
      if (messagesSinceUser >= config.compress.iterationNudgeThreshold) {
        nudgeText = ITERATION_NUDGE;
      }
    }
  }

  if (!nudgeText) return messages;

  // Inject into the last message that has text content
  const result = [...messages];
  for (let i = result.length - 1; i >= 0; i--) {
    const msg = result[i];
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    if (!Array.isArray(msg.content)) continue;

    const textPartIndex = msg.content.findIndex(
      (p) => typeof p === "object" && p !== null && (p as any).type === "text",
    );
    if (textPartIndex === -1) continue;

    const textPart = msg.content[textPartIndex] as { type: "text"; text: string };
    if (textPart.text.includes("<dcp-system-reminder>")) break;

    const newContent = [...msg.content];
    newContent[textPartIndex] = {
      ...textPart,
      text: `${textPart.text}\n\n${nudgeText}`,
    };
    result[i] = { ...msg, content: newContent };
    break;
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm run typecheck
pnpm test -- tests/inject.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/messages/inject.ts tests/inject.test.ts
git commit -m "feat: add message ref assignment and ID/nudge injection"
```

---

### Task 4: Wire System Prompt into before_agent_start

**Files:**
- Modify: `src/index.ts`

Append the DCP system prompt to Pi's system prompt via the `before_agent_start` event.

- [ ] **Step 1: Update index.ts**

Add import and handler:

```typescript
// Add import:
import { DCP_SYSTEM_PROMPT } from "./prompts/system.ts";

// Add handler after session_start:
pi.on("before_agent_start", async (event, _ctx) => {
  if (!config.enabled) return;
  if (config.compress.permission === "deny") return;

  return {
    systemPrompt: (event.systemPrompt ?? "") + DCP_SYSTEM_PROMPT,
  };
});
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: inject DCP system prompt via before_agent_start"
```

---

### Task 5: Wire Nudges and Message IDs into Context Pipeline

**Files:**
- Modify: `src/index.ts`

Add message ref assignment, nudge injection, and message ID injection to the context pipeline after pruning.

- [ ] **Step 1: Update context handler**

Add imports and pipeline steps to `src/index.ts`:

```typescript
// Add import:
import { assignMessageRefs, injectCompressNudges, injectMessageIds } from "./messages/inject.ts";

// In the context handler, after applyPruning:

// Step 5: Assign message refs
assignMessageRefs(state, messages);

// Step 6: Inject nudges based on context usage
const usage2 = ctx.getContextUsage();
messages = injectCompressNudges(state, config, messages, usage2 ? {
  tokens: usage2.tokens,
  contextWindow: usage2.contextWindow,
  percent: usage2.percent,
} : undefined);

// Step 7: Inject message IDs
messages = injectMessageIds(state, messages);

return { messages };
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Run all tests**

```bash
pnpm test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire nudges and message IDs into context pipeline"
```
