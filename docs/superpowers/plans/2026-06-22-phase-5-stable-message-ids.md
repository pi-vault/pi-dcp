# Phase 5: Message ID by Raw ID (Stable Mapping)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace index-based message ID assignment with content-derived stable keys so that refs (m0001, m0002...) survive compaction and message reordering.

**Architecture:** Derive stable keys from message properties (`user:${timestamp}:${counter}`, `assistant:${timestamp}:${counter}`, `toolResult:${toolCallId}`). Refactor `MessageIdState` from `byIndex: Map<number, string>` to add `byRawId: Map<string, string>`. Update all consumers (injection, compression, pruning) to resolve via stable key rather than array index. Keep `byIndex` as a runtime cache rebuilt each pipeline pass.

**Key format:** `${role}:${timestamp}:${counter}` where counter is the 0-based occurrence index among messages sharing the same `role:timestamp` prefix. ToolResult messages use `toolResult:${toolCallId}` (no counter — toolCallId is unique).

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File                       | Responsibility                                                  |
| -------------------------- | --------------------------------------------------------------- |
| `src/utils/message-ids.ts` | Add `getMessageKey(msg, counter)` utility                       |
| `src/state/types.ts`       | Refactor `MessageIdState` to use `byRawId`/`byRef` maps        |
| `src/state/state.ts`       | Update factory/reset for new state shape                        |
| `src/messages/inject.ts`   | Refactor `assignMessageRefs` and `injectMessageIds`             |
| `src/compress/search.ts`   | Update `resolveBoundaryIndex` for new lookup                    |
| `src/compress/state.ts`    | Keep index-based `applyCompressionState` (resolve at call site) |
| `src/state/persistence.ts` | Serialize/deserialize new state shape                           |
| `src/pipeline.ts`          | Pass messages to sync (no signature change needed)              |
| `src/index.ts`             | Update `session_compact` and `session_start` handlers           |
| `tests/stable-ids.test.ts` | Unit tests for stable ID assignment                             |
| `tests/inject.test.ts`     | Update existing tests for new interface                         |
| `tests/compress-search.test.ts` | Update `byRef` setup for new type                          |
| `tests/compress-range.test.ts`  | Update `byRef` setup for new type                          |

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
  it("derives key for user message with counter", () => {
    const msg = {
      role: "user",
      content: [{ type: "text", text: "hi" }],
      timestamp: 1719100000000,
    } as AgentMessage;
    expect(getMessageKey(msg, 0)).toBe("user:1719100000000:0");
    expect(getMessageKey(msg, 1)).toBe("user:1719100000000:1");
  });

  it("derives key for assistant message with counter", () => {
    const msg = {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1719100001000,
      stopReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
    } as AgentMessage;
    expect(getMessageKey(msg, 0)).toBe("assistant:1719100001000:0");
  });

  it("derives key for toolResult message from toolCallId (ignores counter)", () => {
    const msg = {
      role: "toolResult",
      toolCallId: "call_abc123",
      content: [{ type: "text", text: "result" }],
      timestamp: 1719100002000,
    } as AgentMessage;
    expect(getMessageKey(msg, 0)).toBe("toolResult:call_abc123");
    expect(getMessageKey(msg, 5)).toBe("toolResult:call_abc123"); // counter ignored
  });

  it("falls back to role:timestamp:counter for unknown roles", () => {
    const msg = {
      role: "system",
      content: "sys",
      timestamp: 1719100003000,
    } as unknown as AgentMessage;
    expect(getMessageKey(msg, 0)).toBe("system:1719100003000:0");
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
 * Derive a stable key from a message's properties plus a collision counter.
 * Counter is the 0-based occurrence index among messages sharing the same role:timestamp.
 * ToolResult messages use toolCallId (unique) so counter is ignored for them.
 */
export function getMessageKey(msg: AgentMessage, counter: number): string {
  if (msg.role === "toolResult") {
    return `toolResult:${(msg as unknown as { toolCallId: string }).toolCallId}`;
  }
  return `${msg.role}:${(msg as unknown as { timestamp: number }).timestamp}:${counter}`;
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
  /** Content-derived key -> ref string (e.g. "user:1719100000000:0" -> "m0001"). */
  byRawId: Map<string, string>;
  /** Reverse lookup: ref string -> content-derived key. */
  byRef: Map<string, string>;
  /** Runtime index cache: rebuilt each pipeline pass. Maps message index -> ref. */
  byIndex: Map<number, string>;
  nextRefIndex: number;
}
```

Note: `byRef` changes from `Map<string, number>` to `Map<string, string>`. This is a breaking change — `resolveBoundaryIndex` must be updated in the same commit to resolve ref → index via `byIndex` reverse scan.

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

- [ ] **Step 3: Update `resolveBoundaryIndex` in `src/compress/search.ts`**

`byRef` now maps ref → rawId (string), not ref → index. Update the message branch to resolve via `byIndex`:

```typescript
if (parsed.type === "message") {
  const ref = boundaryId;
  // Reverse-lookup: find the index that maps to this ref in the runtime cache
  for (const [idx, r] of state.messageIds.byIndex) {
    if (r === ref) return idx;
  }
  return undefined;
}
```

This is O(N) on the `byIndex` map size (<1000 messages) — acceptable. A dedicated reverse map is not needed since this function is only called during compress operations (low frequency).

- [ ] **Step 4: Update `session_compact` handler in `src/index.ts`**

Replace:

```typescript
state.messageIds.byIndex.clear();
state.messageIds.byRef.clear();
state.messageIds.nextRefIndex = 1;
```

With:

```typescript
state.messageIds.byIndex.clear();
// Retain byRawId and byRef — stable keys survive compaction.
// Only clear index cache (rebuilt each pipeline pass).
// Do NOT reset nextRefIndex — new messages continue the sequence.
```

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx tsc --noEmit 2>&1 | head -50`

Fix any type errors from the interface change. Primary breakage will be in `src/messages/inject.ts` (addressed in Task 3).

- [ ] **Step 6: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/state/types.ts src/state/state.ts src/compress/search.ts src/index.ts
git commit -m "refactor(ids): add byRawId to MessageIdState, keep byIndex as runtime cache

BREAKING: byRef now maps ref->rawId (string) instead of ref->index (number).
resolveBoundaryIndex updated to resolve via byIndex scan."
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
import { assignMessageRefs } from "../src/messages/inject.ts";

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

    expect(state.messageIds.byRawId.get("user:1000:0")).toBe("m0001");
    expect(state.messageIds.byRawId.get("assistant:2000:0")).toBe("m0002");
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

  it("handles duplicate timestamps with counters", () => {
    const state = createSessionState();
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "A" }], timestamp: 1000 } as AgentMessage,
      { role: "user", content: [{ type: "text", text: "B" }], timestamp: 1000 } as AgentMessage,
    ];

    assignMessageRefs(state, messages);

    expect(state.messageIds.byRawId.get("user:1000:0")).toBe("m0001");
    expect(state.messageIds.byRawId.get("user:1000:1")).toBe("m0002");
    expect(state.messageIds.byIndex.get(0)).toBe("m0001");
    expect(state.messageIds.byIndex.get(1)).toBe("m0002");
  });

  it("toolResult uses toolCallId, not timestamp counter", () => {
    const state = createSessionState();
    const messages: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "call_1",
        content: [{ type: "text", text: "r1" }],
        timestamp: 1000,
      } as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "call_2",
        content: [{ type: "text", text: "r2" }],
        timestamp: 1000,
      } as AgentMessage,
    ];

    assignMessageRefs(state, messages);

    expect(state.messageIds.byRawId.get("toolResult:call_1")).toBe("m0001");
    expect(state.messageIds.byRawId.get("toolResult:call_2")).toBe("m0002");
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
 *
 * Counter logic: For messages sharing the same role:timestamp, a 0-based counter
 * disambiguates them based on their order in the array. ToolResult messages use
 * toolCallId (unique) and bypass the counter.
 */
export function assignMessageRefs(
  state: SessionState,
  messages: AgentMessage[],
): void {
  // Clear runtime index cache — rebuilt each pass
  state.messageIds.byIndex.clear();

  // Count occurrences of each role:timestamp prefix to assign counters
  const prefixCounters = new Map<string, number>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    let key: string;
    if (msg.role === "toolResult") {
      key = getMessageKey(msg, 0); // counter ignored for toolResult
    } else {
      const prefix = `${msg.role}:${(msg as unknown as { timestamp: number }).timestamp}`;
      const counter = prefixCounters.get(prefix) ?? 0;
      prefixCounters.set(prefix, counter + 1);
      key = getMessageKey(msg, counter);
    }

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

- [ ] **Step 5: Run full test suite and fix broken tests**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run`

Expected breakages in existing tests that manually set `byRef` with number values. See Task 4 for migration.

- [ ] **Step 6: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/messages/inject.ts tests/stable-ids.test.ts
git commit -m "feat(ids): refactor assignMessageRefs to use content-derived stable keys

Refs are now persistent across compactions and message reordering.
byIndex is rebuilt each pipeline pass as a runtime cache.
Counter disambiguates same-role same-timestamp messages."
```

---

### Task 4: Migrate existing tests to new `byRef` type

**Files:**

- Modify: `tests/inject.test.ts`
- Modify: `tests/compress-search.test.ts`
- Modify: `tests/compress-range.test.ts`

The `byRef` map changed from `Map<string, number>` (ref → index) to `Map<string, string>` (ref → rawId). Tests that manually set up message ID state need updating.

- [ ] **Step 1: Create a test helper for setting up message ID state**

Add to `tests/helpers.ts`:

```typescript
/**
 * Helper: set up message ID state with proper byRawId/byRef/byIndex maps.
 * Simulates what assignMessageRefs would produce for given messages.
 */
export function setupMessageIds(
  state: SessionState,
  messages: AgentMessage[],
): void {
  assignMessageRefs(state, messages);
}

/**
 * Helper: manually wire message refs for tests that need specific ref assignments
 * without running the full assignMessageRefs logic.
 */
export function wireMessageRef(
  state: SessionState,
  index: number,
  ref: string,
  rawId: string,
): void {
  state.messageIds.byIndex.set(index, ref);
  state.messageIds.byRawId.set(rawId, ref);
  state.messageIds.byRef.set(ref, rawId);
}
```

- [ ] **Step 2: Update `tests/compress-search.test.ts`**

Replace the manual `byRef.set("m0001", 0)` calls. The test needs `resolveBoundaryIndex` to work, which now resolves via `byIndex` scan. So we only need `byIndex` for these tests:

```typescript
// Before:
state.messageIds.byIndex.set(0, "m0001");
state.messageIds.byRef.set("m0001", 0);
state.messageIds.byIndex.set(5, "m0006");
state.messageIds.byRef.set("m0006", 5);

// After (byRef no longer maps to index — resolveBoundaryIndex uses byIndex):
state.messageIds.byIndex.set(0, "m0001");
state.messageIds.byIndex.set(5, "m0006");
// byRef and byRawId not needed for these tests — resolveBoundaryIndex scans byIndex
```

- [ ] **Step 3: Update `tests/compress-range.test.ts`**

All 16 `byRef.set(ref, index)` calls need replacing. Since `handleCompress` calls `resolveBoundaryIndex` which now scans `byIndex`, we only need `byIndex` set up:

```typescript
// Before (each test):
state.messageIds.byIndex.set(0, "m0001");
state.messageIds.byRef.set("m0001", 0);

// After:
state.messageIds.byIndex.set(0, "m0001");
// Remove byRef.set lines — no longer needed for compress handler tests
```

- [ ] **Step 4: Update `tests/inject.test.ts`**

The `assignMessageRefs` tests in this file test the OLD index-based behavior. They need rewriting to test the new stable-key behavior. Key changes:

1. "assigns sequential refs starting at m0001" — still valid, behavior matches
2. "reuses existing refs for already-assigned indices" — now tests that same message content → same ref. The test uses `Date.now()` which changes per call, but since the same `messages` array is passed both times (same objects, same timestamps), it still works.
3. "extends refs when messages grow" — works because new messages get new timestamps from `Date.now()`.

These tests should pass without changes because:
- `assignMessageRefs` clears `byIndex` each call (rebuilds it)
- Same messages with same timestamps → same keys → same refs from `byRawId`
- New messages → new keys → new refs allocated

Verify by running: `npx vitest run tests/inject.test.ts`

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run`

Expected: All PASS after the above changes.

- [ ] **Step 6: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add tests/helpers.ts tests/compress-search.test.ts tests/compress-range.test.ts tests/inject.test.ts
git commit -m "test(ids): migrate existing tests to new byRef type (ref->rawId)

resolveBoundaryIndex now resolves via byIndex scan, so tests only need
byIndex populated. Removed all byRef.set(ref, number) calls."
```

---

### Task 5: Update persistence for new state shape

**Files:**

- Modify: `src/state/persistence.ts`
- Modify: `src/index.ts`
- Test: `tests/persistence.test.ts`

- [ ] **Step 1: Update `SerializedState` and `saveSessionState`**

In `src/state/persistence.ts`, update the serialized interface and save function:

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
}
```

In `saveSessionState`, add message ID serialization:

```typescript
const serialized: SerializedState = {
  sessionId: state.sessionId,
  currentTurn: state.currentTurn,
  stats: { ...state.stats },
  lastCompaction: state.lastCompaction,
  messageIds: {
    byRawId: Object.fromEntries(state.messageIds.byRawId),
    byRef: Object.fromEntries(state.messageIds.byRef),
    nextRefIndex: state.messageIds.nextRefIndex,
  },
};
```

- [ ] **Step 2: Update `loadSessionState` to restore `byRawId`**

Update return type and parsing:

```typescript
export function loadSessionState(
  sessionDir: string,
): Pick<SessionState, "currentTurn" | "stats" | "lastCompaction" | "messageIds"> | undefined {
  // ...existing parsing...
  
  // Restore message IDs if present (backward-compatible: old state files lack this)
  let messageIds: SessionState["messageIds"] | undefined;
  if (parsed.messageIds && typeof parsed.messageIds === "object") {
    const m = parsed.messageIds;
    messageIds = {
      byRawId: new Map(Object.entries(m.byRawId ?? {})),
      byRef: new Map(Object.entries(m.byRef ?? {})),
      byIndex: new Map(), // runtime cache, not persisted
      nextRefIndex: typeof m.nextRefIndex === "number" ? m.nextRefIndex : 1,
    };
  }

  return {
    currentTurn: parsed.currentTurn ?? 0,
    stats: { /* ...existing... */ },
    lastCompaction: parsed.lastCompaction ?? 0,
    messageIds,
  };
}
```

Note: `byIndex` is NOT persisted — it's rebuilt every pipeline pass from the message array.

- [ ] **Step 3: Update `session_start` in `src/index.ts` to restore messageIds**

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

- [ ] **Step 4: Add persistence test for messageIds**

Add to `tests/persistence.test.ts`:

```typescript
it("saves and loads messageIds state", () => {
  const state = createSessionState();
  state.sessionId = "test-session";
  state.messageIds.byRawId.set("user:1000:0", "m0001");
  state.messageIds.byRawId.set("assistant:2000:0", "m0002");
  state.messageIds.byRef.set("m0001", "user:1000:0");
  state.messageIds.byRef.set("m0002", "assistant:2000:0");
  state.messageIds.nextRefIndex = 3;

  const stateDir = path.join(tempDir, "ids-test");
  fs.mkdirSync(stateDir, { recursive: true });
  saveSessionState(state, stateDir);

  const loaded = loadSessionState(stateDir);
  expect(loaded).toBeDefined();
  expect(loaded!.messageIds).toBeDefined();
  expect(loaded!.messageIds!.byRawId.get("user:1000:0")).toBe("m0001");
  expect(loaded!.messageIds!.byRef.get("m0001")).toBe("user:1000:0");
  expect(loaded!.messageIds!.nextRefIndex).toBe(3);
});

it("handles legacy state files without messageIds", () => {
  const dcpDir = path.join(tempDir, "dcp");
  fs.mkdirSync(dcpDir, { recursive: true });
  fs.writeFileSync(
    path.join(dcpDir, "state.json"),
    JSON.stringify({ currentTurn: 3, stats: { pruneTokenCounter: 0, totalPruneTokens: 100, toolsPruned: 1, messagesCompressed: 0 }, lastCompaction: 0 }),
  );

  const loaded = loadSessionState(tempDir);
  expect(loaded).toBeDefined();
  expect(loaded!.messageIds).toBeUndefined(); // gracefully absent
});
```

- [ ] **Step 5: Run full check**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npm run check`

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/state/persistence.ts src/index.ts tests/persistence.test.ts
git commit -m "feat(ids): persist stable message ID mappings across sessions

Backward-compatible: old state files without messageIds are handled gracefully."
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `npm run check` passes (typecheck + lint + test)
- [ ] `getMessageKey` produces deterministic keys from message properties + counter
- [ ] Same message always gets same ref regardless of array position
- [ ] Duplicate timestamps produce distinct keys via counter (`user:1000:0`, `user:1000:1`)
- [ ] ToolResult messages use toolCallId (counter-independent)
- [ ] Refs survive session resume (persisted and restored)
- [ ] `resolveBoundaryIndex` still resolves refs to current indices (via byIndex scan)
- [ ] Compression blocks still work (they use indices resolved at runtime)
- [ ] `session_compact` retains stable mappings (only clears index cache, keeps nextRefIndex)
- [ ] All 18 `byRef.set(ref, number)` sites in tests are removed/updated
- [ ] Legacy state files without messageIds load without error

---

## Design Notes

### Counter stability caveat

The counter disambiguator (`user:1000:0`, `user:1000:1`) is position-dependent within a given `role:timestamp` group. If two user messages share the exact same timestamp AND their relative order changes, their keys swap and they'd get new refs.

This is acceptable because:
1. Same-role same-timestamp collisions are extremely rare in production (requires sub-millisecond message creation)
2. The primary goal is surviving compaction (prefix removal), not arbitrary reordering
3. ToolResult messages (the most reorderable type) use toolCallId and are immune

### Unbounded byRawId growth

Messages removed during compaction leave orphan entries in `byRawId`. This is intentional — refs must never be reused. For typical session lengths (<500 messages × 30 sessions), this is negligible memory.

### Performance

- `assignMessageRefs`: O(N) per pipeline pass (N = message count). Counter map is O(N) additional.
- `resolveBoundaryIndex`: O(N) linear scan of `byIndex`. Called during compress operations only (low frequency, max ~10 times per session).
