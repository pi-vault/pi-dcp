# Phase 2: Compression Timing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record how long each compress tool execution takes and attach the duration to the corresponding compression block.

**Architecture:** Use Pi's `tool_execution_start` and `tool_execution_end` event handlers to record timestamps. Store pending durations in state and apply them to compression blocks on the next `context` pass.

**Tech Stack:** TypeScript, Pi extension API (`tool_execution_start`, `tool_execution_end` events), Vitest

---

## File Structure

| File                               | Responsibility                                                          |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `src/state/types.ts`               | Add `CompressionTimingState` interface and field to `SessionState`      |
| `src/state/state.ts`               | Initialize timing state in `createSessionState` and `resetSessionState` |
| `src/compress/state.ts`            | Add `applyPendingCompressionDurations` function                         |
| `src/index.ts`                     | Register `tool_execution_start` and `tool_execution_end` handlers       |
| `src/pipeline.ts`                  | Call `applyPendingCompressionDurations` at start of pipeline            |
| `tests/compression-timing.test.ts` | Unit tests for timing state management                                  |

---

### Task 1: Add timing state types and initialization

**Files:**

- Modify: `src/state/types.ts`
- Modify: `src/state/state.ts`
- Test: `tests/compression-timing.test.ts` (create)

- [ ] **Step 1: Write failing test for timing state existence**

Create `tests/compression-timing.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createSessionState } from "../src/state/state.ts";

describe("CompressionTimingState", () => {
  it("initializes with empty maps", () => {
    const state = createSessionState();
    expect(state.compressionTiming).toBeDefined();
    expect(state.compressionTiming.startsByCallId.size).toBe(0);
    expect(state.compressionTiming.pendingDurations.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/compression-timing.test.ts`

Expected: FAIL — `compressionTiming` does not exist on `SessionState`.

- [ ] **Step 3: Add `CompressionTimingState` to types**

In `src/state/types.ts`, add the interface before the `ContextUsage` interface (near end of file):

```typescript
export interface CompressionTimingState {
  /** Timestamps when compress tool calls started, keyed by toolCallId. */
  startsByCallId: Map<string, number>;
  /** Computed durations awaiting application to blocks, keyed by toolCallId. */
  pendingDurations: Map<string, number>;
}
```

Add the field to `SessionState` (after `modelContextWindow`):

```typescript
/** Compression timing tracking. */
compressionTiming: CompressionTimingState;
```

- [ ] **Step 4: Initialize timing state in `createSessionState` and `resetSessionState`**

In `src/state/state.ts`:

Add `CompressionTimingState` to the import from `./types.ts`.

In `createSessionState()`, add after `modelContextWindow: undefined`:

```typescript
    compressionTiming: createCompressionTiming(),
```

Add the factory function:

```typescript
function createCompressionTiming(): CompressionTimingState {
  return {
    startsByCallId: new Map(),
    pendingDurations: new Map(),
  };
}
```

In `resetSessionState()`, add after `state.modelContextWindow = undefined`:

```typescript
state.compressionTiming.startsByCallId.clear();
state.compressionTiming.pendingDurations.clear();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/compression-timing.test.ts`

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/state/types.ts src/state/state.ts tests/compression-timing.test.ts
git commit -m "feat(timing): add CompressionTimingState to session state"
```

---

### Task 2: Implement `applyPendingCompressionDurations`

**Files:**

- Modify: `src/compress/state.ts`
- Test: `tests/compression-timing.test.ts`

- [ ] **Step 1: Write failing test for duration application**

Add to `tests/compression-timing.test.ts`:

```typescript
import { applyPendingCompressionDurations } from "../src/compress/state.ts";
import type { SessionState, CompressionBlock } from "../src/state/types.ts";

describe("applyPendingCompressionDurations", () => {
  it("applies pending duration to matching block by compressMessageIndex", () => {
    const state = createSessionState();

    // Simulate a block whose compress tool call has callId "call-abc"
    const block: CompressionBlock = {
      blockId: 1,
      runId: 1,
      active: true,
      deactivatedByUser: false,
      compressedTokens: 1000,
      summaryTokens: 200,
      durationMs: 0,
      mode: "range",
      topic: "test",
      batchTopic: undefined,
      startIndex: 0,
      endIndex: 5,
      anchorIndex: 5,
      compressMessageIndex: 7,
      includedBlockIds: [],
      consumedBlockIds: [],
      parentBlockIds: [],
      directMessageIndices: [0, 1, 2, 3, 4, 5],
      directToolIds: [],
      effectiveMessageIndices: [0, 1, 2, 3, 4, 5],
      effectiveToolIds: [],
      createdAt: Date.now(),
      deactivatedAt: undefined,
      deactivatedByBlockId: undefined,
      summary: "Test summary",
    };
    state.prune.messages.blocksById.set(1, block);

    // Add pending duration keyed by the toolCallId used during compression
    state.compressionTiming.pendingDurations.set("call-abc", 1500);

    // The handler stores compressCallId alongside the block
    // We use a lookup map approach: store callId -> blockId mapping
    state.compressionTiming.startsByCallId.set("call-abc", 1); // repurpose: stores blockId after completion

    applyPendingCompressionDurations(state);

    expect(block.durationMs).toBe(1500);
    expect(state.compressionTiming.pendingDurations.size).toBe(0);
  });

  it("no-ops when no pending durations", () => {
    const state = createSessionState();
    applyPendingCompressionDurations(state);
    expect(state.compressionTiming.pendingDurations.size).toBe(0);
  });

  it("removes pending durations even if block not found", () => {
    const state = createSessionState();
    state.compressionTiming.pendingDurations.set("orphan-call", 500);
    state.compressionTiming.startsByCallId.set("orphan-call", 999);

    applyPendingCompressionDurations(state);

    expect(state.compressionTiming.pendingDurations.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/compression-timing.test.ts`

Expected: FAIL — `applyPendingCompressionDurations` does not exist.

- [ ] **Step 3: Implement `applyPendingCompressionDurations`**

In `src/compress/state.ts`, add the function (after existing exports):

```typescript
/**
 * Apply pending compression durations to their corresponding blocks.
 * Called at the start of each pipeline pass.
 *
 * The mapping works via startsByCallId which is repurposed after tool_execution_end:
 * it maps toolCallId -> blockId so we can find the block to update.
 */
export function applyPendingCompressionDurations(state: SessionState): void {
  if (state.compressionTiming.pendingDurations.size === 0) return;

  for (const [callId, durationMs] of state.compressionTiming.pendingDurations) {
    const blockId = state.compressionTiming.startsByCallId.get(callId);
    if (blockId !== undefined) {
      const block = state.prune.messages.blocksById.get(blockId);
      if (block) {
        block.durationMs = durationMs;
      }
    }
    state.compressionTiming.startsByCallId.delete(callId);
  }

  state.compressionTiming.pendingDurations.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/compression-timing.test.ts`

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/compress/state.ts tests/compression-timing.test.ts
git commit -m "feat(timing): implement applyPendingCompressionDurations"
```

---

### Task 3: Register timing event handlers and wire into pipeline

**Files:**

- Modify: `src/index.ts`
- Modify: `src/pipeline.ts`

- [ ] **Step 1: Add `tool_execution_start` handler in `index.ts`**

In `src/index.ts`, add after the `message_end` handler:

```typescript
pi.on("tool_execution_start", async (event, _ctx) => {
  if (!config.enabled) return;
  if (event.toolName !== "compress") return;
  state.compressionTiming.startsByCallId.set(event.toolCallId, Date.now());
});
```

- [ ] **Step 2: Add `tool_execution_end` handler in `index.ts`**

Add after the `tool_execution_start` handler:

```typescript
pi.on("tool_execution_end", async (event, _ctx) => {
  if (!config.enabled) return;
  if (event.toolName !== "compress") return;

  const startTime = state.compressionTiming.startsByCallId.get(
    event.toolCallId,
  );
  if (startTime === undefined) return;

  const durationMs = Date.now() - startTime;

  // Find which block was just created by this call.
  // The most recently created block corresponds to this tool call.
  let latestBlockId: number | undefined;
  let latestCreatedAt = 0;
  for (const [blockId, block] of state.prune.messages.blocksById) {
    if (block.createdAt > latestCreatedAt) {
      latestCreatedAt = block.createdAt;
      latestBlockId = blockId;
    }
  }

  // Repurpose startsByCallId to store callId -> blockId for pipeline application
  if (latestBlockId !== undefined) {
    state.compressionTiming.startsByCallId.set(event.toolCallId, latestBlockId);
  }
  state.compressionTiming.pendingDurations.set(event.toolCallId, durationMs);
});
```

- [ ] **Step 3: Wire `applyPendingCompressionDurations` into the pipeline**

In `src/pipeline.ts`, add the import:

```typescript
import { applyPendingCompressionDurations } from "./compress/state.ts";
```

At the very start of `runPipeline` (before `syncCompressionBlocks`), add:

```typescript
// Apply any pending compression durations from completed tool calls
applyPendingCompressionDurations(state);
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 5: Run full check**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npm run check`

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/index.ts src/pipeline.ts
git commit -m "feat(timing): register tool_execution handlers and wire into pipeline"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `npm run check` passes
- [ ] `state.compressionTiming` initialized correctly in fresh state
- [ ] `resetSessionState` clears timing maps
- [ ] `tool_execution_start` records timestamp for compress calls only
- [ ] `tool_execution_end` computes duration and maps to block
- [ ] `applyPendingCompressionDurations` updates `block.durationMs` and clears pending state
- [ ] Non-compress tools are ignored by both handlers
