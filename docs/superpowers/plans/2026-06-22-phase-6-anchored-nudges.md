# Phase 6: Anchored Nudge System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current "append to last text message" nudge injection with a persistent, deduplicated, message-anchored system that uses stable message IDs.

**Architecture:** Nudge anchors are stored as sets of stable message keys (from Phase 5). When a nudge trigger fires, the target message's key is looked up via `state.messageIds` (index → ref → rawId) and added to the appropriate anchor set only if no recent anchor exists within `nudgeFrequency` messages. Nudge text is then injected at each anchored position during the application pass.

**Depends on:** Phase 5 (stable message IDs)

**Tech Stack:** TypeScript, Vitest

**Key constraint:** `getMessageKey(msg, counter)` requires a collision counter that is only computed during `assignMessageRefs`. All key lookups MUST go through `state.messageIds`:
```typescript
// To get the key for message at index i:
const ref = state.messageIds.byIndex.get(i);
const key = ref ? state.messageIds.byRef.get(ref) : undefined;
```

---

## File Structure

| File                            | Responsibility                                                    |
| ------------------------------- | ----------------------------------------------------------------- |
| `src/state/types.ts`            | Refactor `Nudges` to use string-based (message key) sets          |
| `src/state/state.ts`            | Update factory/reset (no code change needed — types handle it)    |
| `src/messages/inject.ts`        | Rewrite `injectCompressNudges` into decision + application stages |
| `src/state/persistence.ts`      | Serialize/deserialize anchor sets                                 |
| `tests/anchored-nudges.test.ts` | Unit tests for anchor logic                                       |
| `tests/inject.test.ts`          | Update existing tests to call `assignMessageRefs` first           |

---

### Task 1: Refactor `Nudges` state type

**Files:**

- Modify: `src/state/types.ts`
- Modify: `src/state/state.ts`

- [ ] **Step 1: Update `Nudges` interface**

In `src/state/types.ts`, replace:

```typescript
export interface Nudges {
  contextLimitAnchors: Set<number>;
  turnAnchors: Set<number>;
  iterationAnchors: Set<number>;
}
```

With:

```typescript
export interface Nudges {
  /** Message keys where context limit nudges are anchored. */
  contextLimitAnchors: Set<string>;
  /** Message keys where turn nudges are anchored. */
  turnAnchors: Set<string>;
  /** Message keys where iteration nudges are anchored. */
  iterationAnchors: Set<string>;
}
```

- [ ] **Step 2: Verify `createNudges` and `resetSessionState` need no changes**

No code change needed — `new Set()` works for both `Set<number>` and `Set<string>`. The `clear()` calls in `resetSessionState` are type-agnostic. Confirm with typecheck.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`

Fix any type errors (likely in tests that used numeric anchors — there should be none since anchors were unused before).

- [ ] **Step 4: Commit**

```bash
git add src/state/types.ts
git commit -m "refactor(nudges): change anchor sets from number (index) to string (message key)"
```

---

### Task 2: Update existing `injectCompressNudges` tests

**Why:** The new implementation requires `assignMessageRefs` to have populated `state.messageIds` before `injectCompressNudges` runs (to resolve keys). All existing tests skip this step. We fix them first so the test suite stays green through the refactor.

**Files:**

- Modify: `tests/inject.test.ts`
- Modify: `tests/helpers.ts`

- [ ] **Step 1: Add stable timestamps to helper functions**

The current `makeUserMessage` and `makeAssistantMessage` use `Date.now()` which produces non-deterministic keys. Add optional timestamp parameter:

In `tests/helpers.ts`, update both helpers to accept an optional `timestamp` param. Then add a `makeTimestampedMessages` helper for test convenience:

```typescript
let nextTestTimestamp = 1000;

export function resetTestTimestamp(): void {
  nextTestTimestamp = 1000;
}

export function makeUserMessage(text: string, timestamp?: number): AgentMessage {
  const ts = timestamp ?? nextTestTimestamp++;
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: ts,
  } as AgentMessage;
}

export function makeUserMessageString(text: string, timestamp?: number): AgentMessage {
  const ts = timestamp ?? nextTestTimestamp++;
  return {
    role: "user",
    content: text,
    timestamp: ts,
  } as AgentMessage;
}

export function makeAssistantMessage(text: string, timestamp?: number): AgentMessage {
  const ts = timestamp ?? nextTestTimestamp++;
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
    timestamp: ts,
  } as unknown as AgentMessage;
}
```

- [ ] **Step 2: Add `assignMessageRefs` call to all `injectCompressNudges` tests**

In `tests/inject.test.ts`, update every test in the `describe("injectCompressNudges", ...)` block to call `assignMessageRefs(state, messages)` before calling `injectCompressNudges`. Also add `resetTestTimestamp()` in a `beforeEach` if timestamps must be predictable per test.

Add this import at the top:
```typescript
import { beforeEach } from "vitest";
import { resetTestTimestamp } from "./helpers.ts";
```

Add inside the `describe("injectCompressNudges", ...)`:
```typescript
beforeEach(() => resetTestTimestamp());
```

And in each test, after creating `messages`, add:
```typescript
assignMessageRefs(state, messages);
```

- [ ] **Step 3: Set `nudgeFrequency: 1` in existing tests**

The new anchored system respects `nudgeFrequency` for deduplication. Existing tests don't pre-populate anchors, so with `nudgeFrequency: 1` (always allow), they behave identically to before. Update `makeDefaultConfig` default or override in each existing nudge test:

```typescript
const config = makeDefaultConfig({ nudgeFrequency: 1 });
```

This ensures existing tests pass with the new frequency-aware logic.

- [ ] **Step 4: Run tests to verify they still pass**

Run: `npx vitest run tests/inject.test.ts`

Expected: All PASS (behavior unchanged for frequency=1 with no pre-existing anchors).

- [ ] **Step 5: Commit**

```bash
git add tests/inject.test.ts tests/helpers.ts
git commit -m "test(nudges): prepare existing tests for anchored nudge refactor

Add assignMessageRefs before injectCompressNudges calls.
Set nudgeFrequency: 1 to preserve existing pass-through behavior.
Add deterministic timestamps to test helpers."
```

---

### Task 3: Implement anchored nudge injection

**Files:**

- Modify: `src/messages/inject.ts`
- Create: `tests/anchored-nudges.test.ts`

- [ ] **Step 1: Write tests for anchored nudge behavior**

Create `tests/anchored-nudges.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createSessionState } from "../src/state/state.ts";
import {
  assignMessageRefs,
  injectCompressNudges,
} from "../src/messages/inject.ts";
import { makeDefaultConfig, resetTestTimestamp } from "./helpers.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

function userMsg(text: string, ts: number): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: ts,
  } as AgentMessage;
}

function assistantMsg(text: string, ts: number): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0 },
    timestamp: ts,
  } as AgentMessage;
}

describe("anchored nudge system", () => {
  beforeEach(() => resetTestTimestamp());

  it("anchors nudge to specific message and persists anchor", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      nudgeFrequency: 1,
    });

    const messages: AgentMessage[] = [
      userMsg("msg1", 1000),
      assistantMsg("msg2", 2000),
      userMsg("msg3", 3000),
    ];
    assignMessageRefs(state, messages);

    // Trigger turn nudge (last message is user, percent between min and max)
    injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    // Anchor should be stored using the key format "role:timestamp:counter"
    expect(state.nudges.turnAnchors.size).toBe(1);
    expect(state.nudges.turnAnchors.has("user:3000:0")).toBe(true);
  });

  it("does not add anchor within nudgeFrequency distance of existing anchor", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      nudgeFrequency: 5,
    });

    const messages: AgentMessage[] = [
      userMsg("msg1", 1000),
      assistantMsg("msg2", 2000),
      userMsg("msg3", 3000),
      assistantMsg("msg4", 4000),
      userMsg("msg5", 5000),
    ];
    assignMessageRefs(state, messages);

    // Pre-set an anchor at the 3rd message (index 2)
    state.nudges.turnAnchors.add("user:3000:0");

    // Last message (index 4) is only 2 messages from existing anchor (index 2).
    // nudgeFrequency=5 means no new anchor.
    injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    expect(state.nudges.turnAnchors.size).toBe(1); // Still just the original
  });

  it("adds new anchor when distance exceeds nudgeFrequency", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      nudgeFrequency: 2,
    });

    const messages: AgentMessage[] = [
      userMsg("msg1", 1000),
      assistantMsg("msg2", 2000),
      assistantMsg("msg3", 3000),
      userMsg("msg4", 4000),
    ];
    assignMessageRefs(state, messages);

    state.nudges.turnAnchors.add("user:1000:0");

    // Last message (index 3) is 3 messages from anchor at index 0. nudgeFrequency=2, so OK.
    injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    expect(state.nudges.turnAnchors.size).toBe(2);
    expect(state.nudges.turnAnchors.has("user:4000:0")).toBe(true);
  });

  it("injects nudge text at all anchored positions", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      nudgeFrequency: 1,
    });

    const messages: AgentMessage[] = [
      userMsg("msg1", 1000),
      assistantMsg("msg2", 2000),
      userMsg("msg3", 3000),
    ];
    assignMessageRefs(state, messages);

    // Pre-anchor at two positions
    state.nudges.turnAnchors.add("user:1000:0");
    state.nudges.turnAnchors.add("user:3000:0");

    const result = injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    // Both anchored messages should have nudge text
    const text0 = (result[0] as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    const text2 = (result[2] as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    expect(text0).toContain("dcp-system-reminder");
    expect(text2).toContain("dcp-system-reminder");
  });

  it("context limit nudge always anchors regardless of frequency", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      nudgeFrequency: 100,
    });

    const messages: AgentMessage[] = [userMsg("msg1", 1000)];
    assignMessageRefs(state, messages);

    injectCompressNudges(state, config, messages, {
      tokens: 90000,
      contextWindow: 100000,
      percent: 90,
    });

    // Context limit nudge ignores frequency — always anchors
    expect(state.nudges.contextLimitAnchors.size).toBe(1);
  });

  it("does not inject into messages that already have nudge text", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 });

    const messages: AgentMessage[] = [
      userMsg("already has <dcp-system-reminder>nudge</dcp-system-reminder>", 1000),
    ];
    assignMessageRefs(state, messages);
    state.nudges.turnAnchors.add("user:1000:0");

    const result = injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    // Should not double-inject
    const text = (result[0] as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    const matches = text.match(/<dcp-system-reminder>/g);
    expect(matches).toHaveLength(1);
  });

  it("removes stale anchors that no longer map to current messages", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 });

    // Simulate an anchor from a previous (now-compacted) message
    state.nudges.turnAnchors.add("user:9999:0");

    const messages: AgentMessage[] = [userMsg("msg1", 1000)];
    assignMessageRefs(state, messages);

    const result = injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    // Stale anchor should not crash anything; new anchor should be added
    expect(state.nudges.turnAnchors.has("user:1000:0")).toBe(true);
    // The text should have nudge on message at index 0
    const text = (result[0] as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    expect(text).toContain("dcp-system-reminder");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/anchored-nudges.test.ts`

Expected: FAIL — current implementation doesn't anchor or respect frequency.

- [ ] **Step 3: Add `getKeyForIndex` helper to `inject.ts`**

Add this helper near the top of `src/messages/inject.ts` (after imports):

```typescript
/**
 * Get the stable message key for a message at a given index.
 * Requires assignMessageRefs to have been called on this pass.
 * Returns undefined if the index has no assigned key.
 */
function getKeyForIndex(state: SessionState, index: number): string | undefined {
  const ref = state.messageIds.byIndex.get(index);
  if (!ref) return undefined;
  return state.messageIds.byRef.get(ref);
}

/**
 * Build a reverse map from message key to array index for the current messages.
 * Used by anchor distance calculations.
 */
function buildKeyToIndexMap(state: SessionState, messageCount: number): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < messageCount; i++) {
    const key = getKeyForIndex(state, i);
    if (key) map.set(key, i);
  }
  return map;
}
```

- [ ] **Step 4: Rewrite `injectCompressNudges` with decision + application stages**

Replace the `injectCompressNudges` function in `src/messages/inject.ts`:

```typescript
/**
 * Inject compress nudges using persistent anchored positions.
 * Two stages:
 *   1. Decision: determine nudge type, add anchor if frequency allows
 *   2. Application: inject nudge text at all anchored positions
 *
 * Requires assignMessageRefs to have been called for this pipeline pass.
 */
export function injectCompressNudges(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  contextUsage: ContextUsage | undefined,
): AgentMessage[] {
  if (!contextUsage) return messages;
  if (messages.length === 0) return messages;
  if (state.manualMode) return messages;
  if (state.compressPermission === "deny") return messages;

  // --- Decision Stage ---
  const { overMaxLimit: overMax, overMinLimit: overMin } = isContextOverLimits(
    config,
    state,
    contextUsage,
  );

  // Summary buffer adjustment (from Phase 3)
  let effectiveOverMax = overMax;
  if (
    effectiveOverMax &&
    config.compress.summaryBuffer &&
    contextUsage.tokens != null
  ) {
    const summaryTokens = getActiveSummaryTokenUsage(state);
    if (summaryTokens > 0) {
      const effectiveTokens = contextUsage.tokens - summaryTokens;
      const adjusted = isContextOverLimits(config, state, {
        ...contextUsage,
        tokens: effectiveTokens,
        percent:
          contextUsage.contextWindow > 0
            ? (effectiveTokens / contextUsage.contextWindow) * 100
            : contextUsage.percent,
      });
      effectiveOverMax = adjusted.overMaxLimit;
    }
  }

  if (!overMin) return messages;

  // Determine which nudge to add
  let nudgeType: "contextLimit" | "turn" | "iteration" | undefined;
  if (effectiveOverMax) {
    nudgeType = "contextLimit";
  } else {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === "user") {
      nudgeType = "turn";
    } else {
      let messagesSinceUser = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") break;
        if (messages[i].role === "assistant") messagesSinceUser++;
      }
      if (messagesSinceUser >= config.compress.iterationNudgeThreshold) {
        nudgeType = "iteration";
      }
    }
  }

  if (nudgeType) {
    const targetIndex = messages.length - 1;
    const targetKey = getKeyForIndex(state, targetIndex);

    if (targetKey) {
      const anchorSet =
        nudgeType === "contextLimit"
          ? state.nudges.contextLimitAnchors
          : nudgeType === "turn"
            ? state.nudges.turnAnchors
            : state.nudges.iterationAnchors;

      // Context limit nudges always anchor (ignore frequency)
      if (nudgeType === "contextLimit") {
        anchorSet.add(targetKey);
      } else {
        addAnchorIfAllowed(
          anchorSet,
          targetKey,
          targetIndex,
          state,
          messages.length,
          config.compress.nudgeFrequency,
        );
      }
    }
  }

  // --- Application Stage ---
  return applyAnchoredNudges(state, messages);
}

/**
 * Add anchor only if the nearest existing anchor in the set is >= frequency messages away.
 */
function addAnchorIfAllowed(
  anchorSet: Set<string>,
  targetKey: string,
  targetIndex: number,
  state: SessionState,
  messageCount: number,
  frequency: number,
): void {
  if (anchorSet.has(targetKey)) return;

  // Build key → index lookup for current messages
  const keyToIndex = buildKeyToIndexMap(state, messageCount);

  // Find the closest existing anchor by message distance
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const existingKey of anchorSet) {
    const existingIndex = keyToIndex.get(existingKey);
    if (existingIndex !== undefined) {
      closestDistance = Math.min(
        closestDistance,
        Math.abs(targetIndex - existingIndex),
      );
    }
    // Anchors not in current messages (stale) are ignored for distance calculation
  }

  if (closestDistance >= frequency) {
    anchorSet.add(targetKey);
  }
}

/**
 * Inject nudge text at all anchored message positions.
 */
function applyAnchoredNudges(
  state: SessionState,
  messages: AgentMessage[],
): AgentMessage[] {
  const result = [...messages];
  let changed = false;

  for (let i = 0; i < result.length; i++) {
    const key = getKeyForIndex(state, i);
    if (!key) continue;

    let nudgeText: string | undefined;

    if (state.nudges.contextLimitAnchors.has(key)) {
      nudgeText = CONTEXT_LIMIT_NUDGE;
    } else if (state.nudges.turnAnchors.has(key)) {
      nudgeText = TURN_NUDGE;
    } else if (state.nudges.iterationAnchors.has(key)) {
      nudgeText = ITERATION_NUDGE;
    }

    if (!nudgeText) continue;

    const msg = result[i];
    if (msg.role !== "user" && msg.role !== "assistant") continue;

    // Skip if already has nudge text
    if (hasExistingNudge(msg)) continue;

    result[i] = appendText(msg, `\n\n${nudgeText}`);
    changed = true;
  }

  return changed ? result : messages;
}

function hasExistingNudge(msg: AgentMessage): boolean {
  if (!("content" in msg)) return false;
  if (typeof msg.content === "string")
    return msg.content.includes("<dcp-system-reminder>");
  if (!Array.isArray(msg.content)) return false;
  return msg.content.some((p) => {
    if (typeof p !== "object" || p === null) return false;
    const part = p as unknown as Record<string, unknown>;
    return (
      part.type === "text" &&
      typeof part.text === "string" &&
      (part.text as string).includes("<dcp-system-reminder>")
    );
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/anchored-nudges.test.ts`

Expected: All PASS.

- [ ] **Step 6: Run full check (ensure existing tests still pass)**

Run: `npm run check`

Expected: All pass. If any existing nudge tests fail, check that `assignMessageRefs` was added and `nudgeFrequency: 1` is set.

- [ ] **Step 7: Commit**

```bash
git add src/messages/inject.ts tests/anchored-nudges.test.ts
git commit -m "feat(nudges): implement anchored nudge system with frequency throttling

Nudges are now anchored to specific messages via stable keys (from Phase 5).
Uses state.messageIds (index→ref→rawId) for key resolution.
Deduplication prevents nudge spam via nudgeFrequency config.
Context limit nudges always anchor (ignore frequency)."
```

---

### Task 4: Persist anchor sets

**Files:**

- Modify: `src/state/persistence.ts`

- [ ] **Step 1: Add `nudges` to `SerializedState` interface**

```typescript
interface SerializedState {
  sessionId: string | null;
  currentTurn: number;
  stats: SessionStats;
  lastCompaction: number;
  messageIds?: {
    byRawId: Record<string, string>;
    byRef: Record<string, string>;
    nextRefIndex: number;
  };
  nudges?: {
    contextLimitAnchors: string[];
    turnAnchors: string[];
    iterationAnchors: string[];
  };
}
```

- [ ] **Step 2: Add anchor serialization to `saveSessionState`**

After the `messageIds` field in the serialized object, add:

```typescript
nudges: {
  contextLimitAnchors: [...state.nudges.contextLimitAnchors],
  turnAnchors: [...state.nudges.turnAnchors],
  iterationAnchors: [...state.nudges.iterationAnchors],
},
```

- [ ] **Step 3: Add anchor restoration to `loadSessionState`**

Update the return type to include `nudges`:
```typescript
export function loadSessionState(
  sessionDir: string,
): (Pick<SessionState, "currentTurn" | "stats" | "lastCompaction"> & {
  messageIds?: SessionState["messageIds"];
  nudges?: SessionState["nudges"];
}) | undefined {
```

Add restoration logic after the `messageIds` restoration block:

```typescript
let nudges: SessionState["nudges"] | undefined;
if (parsed.nudges && typeof parsed.nudges === "object") {
  const n = parsed.nudges;
  nudges = {
    contextLimitAnchors: new Set(
      Array.isArray(n.contextLimitAnchors)
        ? n.contextLimitAnchors.filter((x): x is string => typeof x === "string")
        : [],
    ),
    turnAnchors: new Set(
      Array.isArray(n.turnAnchors)
        ? n.turnAnchors.filter((x): x is string => typeof x === "string")
        : [],
    ),
    iterationAnchors: new Set(
      Array.isArray(n.iterationAnchors)
        ? n.iterationAnchors.filter((x): x is string => typeof x === "string")
        : [],
    ),
  };
}
```

And include `nudges` in the return object.

- [ ] **Step 4: Run full check**

Run: `npm run check`

Expected: All pass. Verify typecheck catches the return type update in any callers of `loadSessionState`.

- [ ] **Step 5: Commit**

```bash
git add src/state/persistence.ts
git commit -m "feat(nudges): persist anchor sets across sessions"
```

---

## Verification Checklist

- [ ] `npm run check` passes
- [ ] Anchors stored as stable message keys (format `"role:timestamp:counter"`, not indices)
- [ ] `nudgeFrequency` throttles anchor additions (except context limit)
- [ ] Nudge text injected at all anchored positions
- [ ] Anchors survive session resume
- [ ] Existing nudge behavior preserved for frequency=1 configs
- [ ] Stale anchors (from compacted messages) don't crash — they're silently skipped during application
