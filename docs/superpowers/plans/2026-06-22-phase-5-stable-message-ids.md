# Phase 5: Message ID by Raw ID (Stable Mapping)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace index-based message ID assignment with content-derived stable keys so that refs (m0001, m0002...) survive compaction and message reordering.

**Architecture:** Derive stable keys from message properties (`user:${timestamp}`, `assistant:${timestamp}`, `toolResult:${toolCallId}`). Refactor `MessageIdState` from `byIndex: Map<number, string>` to `byRawId: Map<string, string>`. Update all consumers (injection, compression, pruning) to resolve via stable key rather than array index. Add runtime index resolution when needed for range operations.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File                       | Responsibility                                                  |
| -------------------------- | --------------------------------------------------------------- |
| `src/utils/message-ids.ts` | Add `getMessageKey(msg)` utility                                |
| `src/state/types.ts`       | Refactor `MessageIdState` to use `byRawId`/`byRef` maps         |
| `src/state/state.ts`       | Update factory/reset for new state shape                        |
| `src/messages/inject.ts`   | Refactor `assignMessageRefs` and `injectMessageIds`             |
| `src/compress/search.ts`   | Update `resolveBoundaryIndex` for new lookup                    |
| `src/compress/state.ts`    | Keep index-based `applyCompressionState` (resolve at call site) |
| `src/state/persistence.ts` | Serialize/deserialize new state shape                           |
| `src/pipeline.ts`          | Pass messages to sync (no signature change needed)              |
| `tests/stable-ids.test.ts` | Unit tests for stable ID assignment                             |
| `tests/inject.test.ts`     | Update existing tests for new interface                         |

---

### Task 1: Add `getMessageKey` utility

**Files:**

- Modify: `src/utils/message-ids.ts`
- Test: `tests/stable-ids.test.ts` (create)

- [ ] **Step 1: Write tests for `getMessageKey`**

Create `tests/stable-ids.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getMessageKey } from "../src/utils/message-ids.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("getMessageKey", () => {
  it("derives key for user message from timestamp", () => {
    const msg = {
      role: "user",
      content: [{ type: "text", text: "hi" }],
      timestamp: 1719100000000,
    } as AgentMessage;
    expect(getMessageKey(msg)).toBe("user:1719100000000");
  });

  it("derives key for assistant message from timestamp", () => {
    const msg = {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1719100001000,
      stopReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
    } as AgentMessage;
    expect(getMessageKey(msg)).toBe("assistant:1719100001000");
  });

  it("derives key for toolResult message from toolCallId", () => {
    const msg = {
      role: "toolResult",
      toolCallId: "call_abc123",
      content: [{ type: "text", text: "result" }],
      timestamp: 1719100002000,
    } as AgentMessage;
    expect(getMessageKey(msg)).toBe("toolResult:call_abc123");
  });

  it("falls back to role:timestamp for unknown roles", () => {
    const msg = {
      role: "system",
      content: "sys",
      timestamp: 1719100003000,
    } as unknown as AgentMessage;
    expect(getMessageKey(msg)).toBe("system:1719100003000");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/stable-ids.test.ts`

Expected: FAIL — `getMessageKey` not exported.

- [ ] **Step 3: Implement `getMessageKey`**

In `src/utils/message-ids.ts`, add:

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * Derive a stable key from a message's properties.
 * Keys are deterministic from message content alone — no external dependencies.
 */
export function getMessageKey(msg: AgentMessage): string {
  if (msg.role === "toolResult") {
    return `toolResult:${(msg as unknown as { toolCallId: string }).toolCallId}`;
  }
  return `${msg.role}:${(msg as unknown as { timestamp: number }).timestamp}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/stable-ids.test.ts`

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/utils/message-ids.ts tests/stable-ids.test.ts
git commit -m "feat(ids): add getMessageKey for content-derived stable keys"
```

---

### Task 2: Refactor `MessageIdState` to use `byRawId`

**Files:**

- Modify: `src/state/types.ts`
- Modify: `src/state/state.ts`

- [ ] **Step 1: Update `MessageIdState` interface**

In `src/state/types.ts`, replace the `MessageIdState` interface:

```typescript
export interface MessageIdState {
  /** Content-derived key -> ref string (e.g. "user:1719100000000" -> "m0001"). */
  byRawId: Map<string, string>;
  /** Reverse lookup: ref string -> content-derived key. */
  byRef: Map<string, string>;
  /** Runtime index cache: rebuilt each pipeline pass. Maps message index -> ref. */
  byIndex: Map<number, string>;
  nextRefIndex: number;
}
```

- [ ] **Step 2: Update `createMessageIdState` and `resetSessionState`**

In `src/state/state.ts`, update:

```typescript
function createMessageIdState(): MessageIdState {
  return {
    byRawId: new Map(),
    byRef: new Map(),
    byIndex: new Map(),
    nextRefIndex: 1,
  };
}
```

In `resetSessionState`, replace the messageIds clearing:

```typescript
state.messageIds.byRawId.clear();
state.messageIds.byRef.clear();
state.messageIds.byIndex.clear();
state.messageIds.nextRefIndex = 1;
```

- [ ] **Step 3: Update `session_compact` handler in `index.ts`**

In `src/index.ts`, in the `session_compact` handler, replace:

```typescript
state.messageIds.byIndex.clear();
state.messageIds.byRef.clear();
state.messageIds.nextRefIndex = 1;
```

With:

```typescript
state.messageIds.byIndex.clear();
// Retain byRawId and byRef — stable keys survive compaction.
// Only clear index cache (rebuilt each pass).
```

- [ ] **Step 4: Run typecheck to find all broken references**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx tsc --noEmit 2>&1 | head -50`

Fix any type errors that arise from the interface change. The `byIndex` map remains for runtime lookups (rebuilt each pass), so most consumers should still compile.

- [ ] **Step 5: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/state/types.ts src/state/state.ts src/index.ts
git commit -m "refactor(ids): add byRawId to MessageIdState, keep byIndex as runtime cache"
```

---

### Task 3: Refactor `assignMessageRefs` to use stable keys

**Files:**

- Modify: `src/messages/inject.ts`
- Test: `tests/stable-ids.test.ts`

- [ ] **Step 1: Write test for stable assignment across reordering**

Add to `tests/stable-ids.test.ts`:

```typescript
import { createSessionState } from "../src/state/state.ts";
import { assignMessageRefs, injectMessageIds } from "../src/messages/inject.ts";
import { makeUserMessage, makeAssistantMessage } from "./helpers.ts";

describe("assignMessageRefs (stable)", () => {
  it("assigns refs using content-derived keys", () => {
    const state = createSessionState();
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "hi" }],
        timestamp: 1000,
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
        timestamp: 2000,
        stopReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0 },
      } as AgentMessage,
    ];

    assignMessageRefs(state, messages);

    expect(state.messageIds.byRawId.get("user:1000")).toBe("m0001");
    expect(state.messageIds.byRawId.get("assistant:2000")).toBe("m0002");
    expect(state.messageIds.byIndex.get(0)).toBe("m0001");
    expect(state.messageIds.byIndex.get(1)).toBe("m0002");
  });

  it("preserves refs when messages reorder", () => {
    const state = createSessionState();
    const msg1 = {
      role: "user",
      content: [{ type: "text", text: "first" }],
      timestamp: 1000,
    } as AgentMessage;
    const msg2 = {
      role: "assistant",
      content: [{ type: "text", text: "second" }],
      timestamp: 2000,
      stopReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
    } as AgentMessage;

    // First pass: [msg1, msg2]
    assignMessageRefs(state, [msg1, msg2]);
    expect(state.messageIds.byIndex.get(0)).toBe("m0001");
    expect(state.messageIds.byIndex.get(1)).toBe("m0002");

    // Second pass: [msg2, msg1] (reordered)
    assignMessageRefs(state, [msg2, msg1]);
    expect(state.messageIds.byIndex.get(0)).toBe("m0002"); // msg2 keeps its ref
    expect(state.messageIds.byIndex.get(1)).toBe("m0001"); // msg1 keeps its ref
  });

  it("handles new messages added between existing ones", () => {
    const state = createSessionState();
    const msg1 = {
      role: "user",
      content: [{ type: "text", text: "A" }],
      timestamp: 1000,
    } as AgentMessage;
    const msg2 = {
      role: "user",
      content: [{ type: "text", text: "B" }],
      timestamp: 3000,
    } as AgentMessage;

    assignMessageRefs(state, [msg1, msg2]);
    expect(state.messageIds.nextRefIndex).toBe(3);

    const msgNew = {
      role: "assistant",
      content: [{ type: "text", text: "new" }],
      timestamp: 2000,
      stopReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
    } as AgentMessage;
    assignMessageRefs(state, [msg1, msgNew, msg2]);

    expect(state.messageIds.byIndex.get(0)).toBe("m0001");
    expect(state.messageIds.byIndex.get(1)).toBe("m0003"); // new message gets next ref
    expect(state.messageIds.byIndex.get(2)).toBe("m0002"); // msg2 keeps its ref
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/stable-ids.test.ts`

Expected: FAIL — current `assignMessageRefs` uses index-based assignment.

- [ ] **Step 3: Rewrite `assignMessageRefs`**

In `src/messages/inject.ts`, add import:

```typescript
import { getMessageKey } from "../utils/message-ids.ts";
```

Replace `assignMessageRefs`:

```typescript
/**
 * Assign sequential message refs (m0001, m0002, ...) using content-derived stable keys.
 * Refs are stored in state.messageIds.byRawId (persistent) and byIndex (runtime cache).
 * A message always gets the same ref regardless of its position in the array.
 */
export function assignMessageRefs(
  state: SessionState,
  messages: AgentMessage[],
): void {
  // Clear runtime index cache — rebuilt each pass
  state.messageIds.byIndex.clear();

  for (let i = 0; i < messages.length; i++) {
    const key = getMessageKey(messages[i]);
    let ref = state.messageIds.byRawId.get(key);

    if (!ref) {
      ref = formatMessageRef(state.messageIds.nextRefIndex);
      state.messageIds.byRawId.set(key, ref);
      state.messageIds.byRef.set(ref, key);
      state.messageIds.nextRefIndex++;
    }

    state.messageIds.byIndex.set(i, ref);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/stable-ids.test.ts`

Expected: All PASS.

- [ ] **Step 5: Run full test suite and fix any broken tests**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run`

Existing tests may need minor updates:

- Tests that check `state.messageIds.byIndex` should still work (it's rebuilt each pass).
- Tests that previously relied on `state.messageIds.byRef` mapping ref -> index now get ref -> key. Update `resolveBoundaryIndex` if needed.

- [ ] **Step 6: Update `resolveBoundaryIndex` in `compress/search.ts`**

The current code uses `state.messageIds.byRef.get(ref)` expecting it to return a message index. Now `byRef` maps ref -> rawId (content key). We need to resolve via the `byIndex` map instead.

In `src/compress/search.ts`, update the message ref resolution branch:

```typescript
// For message refs (m0001), find the current index from byIndex (reverse lookup)
if (parsed.type === "message") {
  const ref = boundaryId;
  // Find index where byIndex maps to this ref
  for (const [idx, r] of state.messageIds.byIndex) {
    if (r === ref) return idx;
  }
  return undefined;
}
```

Or more efficiently, add a reverse index map. Since `byIndex` is rebuilt each pass, the simplest approach is to search it. For the scale of conversations this handles (<1000 messages), linear scan is fine.

- [ ] **Step 7: Run full check**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npm run check`

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/messages/inject.ts src/compress/search.ts tests/stable-ids.test.ts
git commit -m "feat(ids): refactor assignMessageRefs to use content-derived stable keys

Refs are now persistent across compactions and message reordering.
byIndex is rebuilt each pipeline pass as a runtime cache."
```

---

### Task 4: Update persistence for new state shape

**Files:**

- Modify: `src/state/persistence.ts`
- Test: `tests/persistence.test.ts`

- [ ] **Step 1: Update `saveSessionState` to serialize `byRawId`**

In `src/state/persistence.ts`, update the serialization to include message ID mappings:

```typescript
// In the serialized object, add:
messageIds: {
  byRawId: Object.fromEntries(state.messageIds.byRawId),
  byRef: Object.fromEntries(state.messageIds.byRef),
  nextRefIndex: state.messageIds.nextRefIndex,
},
```

- [ ] **Step 2: Update `loadSessionState` to restore `byRawId`**

Add message ID restoration to `loadSessionState`:

```typescript
// After restoring other fields:
if (parsed.messageIds && typeof parsed.messageIds === "object") {
  const m = parsed.messageIds as Record<string, unknown>;
  if (m.byRawId && typeof m.byRawId === "object") {
    result.messageIds = {
      byRawId: new Map(Object.entries(m.byRawId as Record<string, string>)),
      byRef: new Map(Object.entries((m.byRef ?? {}) as Record<string, string>)),
      byIndex: new Map(),
      nextRefIndex: typeof m.nextRefIndex === "number" ? m.nextRefIndex : 1,
    };
  }
}
```

Update the return type of `loadSessionState` to include `messageIds`:

```typescript
export function loadSessionState(
  sessionDir: string,
):
  | Pick<
      SessionState,
      "currentTurn" | "stats" | "lastCompaction" | "messageIds"
    >
  | undefined;
```

- [ ] **Step 3: Update `session_start` in `index.ts` to restore messageIds**

In the resume branch of `session_start`:

```typescript
if (persisted) {
  state.currentTurn = persisted.currentTurn;
  state.stats = persisted.stats;
  state.lastCompaction = persisted.lastCompaction;
  if (persisted.messageIds) {
    state.messageIds.byRawId = persisted.messageIds.byRawId;
    state.messageIds.byRef = persisted.messageIds.byRef;
    state.messageIds.nextRefIndex = persisted.messageIds.nextRefIndex;
  }
  logger.info("dcp", "resumed persisted state", { turn: state.currentTurn });
}
```

- [ ] **Step 4: Run full check**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npm run check`

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/state/persistence.ts src/index.ts
git commit -m "feat(ids): persist stable message ID mappings across sessions"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `npm run check` passes
- [ ] `getMessageKey` produces deterministic keys from message properties
- [ ] Same message always gets same ref regardless of array position
- [ ] Refs survive session resume (persisted and restored)
- [ ] `resolveBoundaryIndex` still resolves refs to current indices
- [ ] Compression blocks still work (they use indices resolved at runtime)
- [ ] `session_compact` retains stable mappings (only clears index cache)
