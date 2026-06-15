# Phase 4: Range Compression

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **IMPORTANT:** Read `plans/ERRATA.md` before implementing. It contains corrections to API signatures, type shapes, and import paths verified against Pi source.

**Prerequisite:** Phase 3 (Nudges + Message IDs) completed and passing.

**Goal:** Register a `compress` tool via `pi.registerTool()` that lets the model compress conversation ranges into summaries. After this phase, the model can select a range of messages by reference ID (`m0001`..`m0015`), write a summary, and the extension replaces those messages with the summary on subsequent context events.

**Usable result after this phase:** The full DCP compression loop works. The model sees nudges, uses the `compress` tool with `startId`/`endId`/`summary`, the extension stores compression blocks, and on the next context event, compressed messages are replaced with summary custom messages. This is the core DCP feature.

**Architecture:**
- `src/compress/state.ts` — Block allocation, state application, summary wrapping
- `src/compress/search.ts` — Boundary resolution (message refs + block refs), selection collection
- `src/compress/range.ts` — Range-mode compress tool handler
- `src/messages/sync.ts` — Compression block reconciliation on each context event
- `src/messages/prune.ts` — Extended with `filterCompressedRanges()` to replace message ranges with summaries

**Key adaptation from OpenCode DCP:**
- OpenCode's compress tool uses the OpenCode plugin SDK's `tool()` builder with Zod schemas. Pi uses `pi.registerTool()` with TypeBox schemas.
- OpenCode fetches messages from the session API (`client.session.messages()`). Pi's compress tool receives the current messages via tool context or we build search context from the latest `context` event's message array cached in state.
- OpenCode mutates `WithParts[]` in-place for range filtering. Pi's `context` handler returns a new message array.
- OpenCode uses `message.info.id` (string UUIDs) for identity. Pi uses array indices — the compress tool accepts `m0001`-style refs that map to indices via `state.messageIds.byIndex`.

**Conventions:**
- TypeBox schema for tool parameters (from `"typebox"`)
- The compress tool is registered once in the extension entry point
- Compression blocks are stored in `state.prune.messages.blocksById`
- `syncCompressionBlocks()` runs early in the context pipeline before pruning

---

## File Structure (additions to Phase 3)

```
src/
  compress/
    state.ts                    # Block allocation, state application
    search.ts                   # Boundary resolution, selection collection
    range.ts                    # Range-mode compress tool handler
  messages/
    sync.ts                     # Compression block reconciliation
```

---

### Task 1: Compression Block State Management

**Files:**
- Create: `src/compress/state.ts`
- Test: `tests/compress-state.test.ts`

Block ID allocation, run ID allocation, applying compression state (storing blocks, marking messages), and summary wrapping with block headers.

- [ ] **Step 1: Write tests**

Create `tests/compress-state.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  allocateBlockId,
  allocateRunId,
  wrapCompressedSummary,
  applyCompressionState,
} from "../src/compress/state.ts";
import { createSessionState } from "../src/state/state.ts";

describe("compress/state", () => {
  describe("allocateBlockId", () => {
    it("returns sequential block IDs", () => {
      const state = createSessionState();
      expect(allocateBlockId(state)).toBe(1);
      expect(allocateBlockId(state)).toBe(2);
      expect(allocateBlockId(state)).toBe(3);
    });
  });

  describe("allocateRunId", () => {
    it("returns sequential run IDs", () => {
      const state = createSessionState();
      expect(allocateRunId(state)).toBe(1);
      expect(allocateRunId(state)).toBe(2);
    });
  });

  describe("wrapCompressedSummary", () => {
    it("wraps summary with block header and footer", () => {
      const wrapped = wrapCompressedSummary(1, "Summary of exploration");
      expect(wrapped).toContain("[Compressed Block b1]");
      expect(wrapped).toContain("Summary of exploration");
      expect(wrapped).toContain("[End Block b1]");
    });
  });

  describe("applyCompressionState", () => {
    it("creates block and marks message indices", () => {
      const state = createSessionState();
      const blockId = allocateBlockId(state);
      const runId = allocateRunId(state);

      applyCompressionState(state, {
        blockId,
        runId,
        topic: "Auth exploration",
        mode: "range",
        startIndex: 2,
        endIndex: 8,
        anchorIndex: 2,
        compressMessageIndex: 10,
        summary: "Summary text",
        summaryTokens: 50,
        consumedBlockIds: [],
      });

      const block = state.prune.messages.blocksById.get(blockId);
      expect(block).toBeDefined();
      expect(block!.active).toBe(true);
      expect(block!.startIndex).toBe(2);
      expect(block!.endIndex).toBe(8);
      expect(block!.summary).toBe("Summary text");

      expect(state.prune.messages.activeBlockIds.has(blockId)).toBe(true);
      expect(state.prune.messages.activeByAnchorIndex.get(2)).toBe(blockId);

      // Messages 2-8 should be marked
      for (let i = 2; i <= 8; i++) {
        const entry = state.prune.messages.byMessageIndex.get(i);
        expect(entry).toBeDefined();
        expect(entry!.activeBlockIds).toContain(blockId);
      }
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/compress-state.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement compression state**

Create `src/compress/state.ts`:

```typescript
import type { SessionState, CompressionBlock, PrunedMessageEntry } from "../state/types.ts";
import { formatBlockRef } from "../utils/message-ids.ts";

export const COMPRESSED_BLOCK_HEADER = "Compressed Block";

export function allocateBlockId(state: SessionState): number {
  const id = state.prune.messages.nextBlockId;
  state.prune.messages.nextBlockId = id + 1;
  return id;
}

export function allocateRunId(state: SessionState): number {
  const id = state.prune.messages.nextRunId;
  state.prune.messages.nextRunId = id + 1;
  return id;
}

export function wrapCompressedSummary(blockId: number, summary: string): string {
  const ref = formatBlockRef(blockId);
  return `[${COMPRESSED_BLOCK_HEADER} ${ref}]\n${summary}\n[End Block ${ref}]`;
}

export interface ApplyCompressionParams {
  blockId: number;
  runId: number;
  topic: string;
  batchTopic?: string;
  mode: "range" | "message";
  startIndex: number;
  endIndex: number;
  anchorIndex: number;
  compressMessageIndex: number;
  summary: string;
  summaryTokens: number;
  consumedBlockIds: number[];
}

export function applyCompressionState(
  state: SessionState,
  params: ApplyCompressionParams,
): { messageIndices: number[] } {
  const now = Date.now();
  const messageIndices: number[] = [];

  // Create the block
  const block: CompressionBlock = {
    blockId: params.blockId,
    runId: params.runId,
    active: true,
    deactivatedByUser: false,
    compressedTokens: 0,
    summaryTokens: params.summaryTokens,
    durationMs: 0,
    mode: params.mode,
    topic: params.topic,
    batchTopic: params.batchTopic,
    startIndex: params.startIndex,
    endIndex: params.endIndex,
    anchorIndex: params.anchorIndex,
    compressMessageIndex: params.compressMessageIndex,
    includedBlockIds: [],
    consumedBlockIds: params.consumedBlockIds,
    parentBlockIds: [],
    directMessageIndices: [],
    directToolIds: [],
    effectiveMessageIndices: [],
    effectiveToolIds: [],
    createdAt: now,
    deactivatedAt: undefined,
    deactivatedByBlockId: undefined,
    summary: params.summary,
  };

  // Mark messages in range
  let totalTokens = 0;
  for (let i = params.startIndex; i <= params.endIndex; i++) {
    messageIndices.push(i);

    let entry = state.prune.messages.byMessageIndex.get(i);
    if (!entry) {
      entry = {
        tokenCount: 0,
        blockIds: [],
        activeBlockIds: [],
      };
      state.prune.messages.byMessageIndex.set(i, entry);
    }

    if (!entry.blockIds.includes(params.blockId)) {
      entry.blockIds.push(params.blockId);
    }
    if (!entry.activeBlockIds.includes(params.blockId)) {
      entry.activeBlockIds.push(params.blockId);
    }

    totalTokens += entry.tokenCount;
  }

  block.compressedTokens = totalTokens;
  block.directMessageIndices = messageIndices;
  block.effectiveMessageIndices = messageIndices;

  // Deactivate consumed blocks
  for (const consumedId of params.consumedBlockIds) {
    const consumed = state.prune.messages.blocksById.get(consumedId);
    if (consumed) {
      consumed.active = false;
      consumed.deactivatedAt = now;
      consumed.deactivatedByBlockId = params.blockId;
      state.prune.messages.activeBlockIds.delete(consumedId);

      // Find and remove anchor mapping
      for (const [anchorIdx, bId] of state.prune.messages.activeByAnchorIndex) {
        if (bId === consumedId) {
          state.prune.messages.activeByAnchorIndex.delete(anchorIdx);
        }
      }
    }
    block.includedBlockIds.push(consumedId);
  }

  // Store the block
  state.prune.messages.blocksById.set(params.blockId, block);
  state.prune.messages.activeBlockIds.add(params.blockId);
  state.prune.messages.activeByAnchorIndex.set(params.anchorIndex, params.blockId);

  return { messageIndices };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm run typecheck
pnpm test -- tests/compress-state.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/compress/state.ts tests/compress-state.test.ts
git commit -m "feat: add compression block state management"
```

---

### Task 2: Search and Boundary Resolution

**Files:**
- Create: `src/compress/search.ts`
- Test: `tests/compress-search.test.ts`

Resolves message ref boundaries (`m0001`, `b1`) to array indices and collects the set of messages in a selection.

- [ ] **Step 1: Write tests**

Create `tests/compress-search.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveBoundaryIndex, resolveSelection } from "../src/compress/search.ts";
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

describe("compress/search", () => {
  describe("resolveBoundaryIndex", () => {
    it("resolves message ref to index", () => {
      const state = createSessionState();
      state.messageIds.byIndex.set(0, "m0001");
      state.messageIds.byIndex.set(5, "m0006");

      expect(resolveBoundaryIndex(state, "m0001")).toBe(0);
      expect(resolveBoundaryIndex(state, "m0006")).toBe(5);
    });

    it("resolves block ref to anchor index", () => {
      const state = createSessionState();
      state.prune.messages.activeByAnchorIndex.set(3, 1);

      expect(resolveBoundaryIndex(state, "b1")).toBe(3);
    });

    it("returns undefined for unknown refs", () => {
      const state = createSessionState();
      expect(resolveBoundaryIndex(state, "m9999")).toBeUndefined();
      expect(resolveBoundaryIndex(state, "b999")).toBeUndefined();
    });
  });

  describe("resolveSelection", () => {
    it("collects message indices in range", () => {
      const messages = [
        makeUserMessage("hello"),
        makeAssistantMessage("hi"),
        makeUserMessage("bye"),
        makeAssistantMessage("goodbye"),
      ];

      const selection = resolveSelection(messages, 1, 3);
      expect(selection.messageIndices).toEqual([1, 2, 3]);
    });

    it("throws for invalid range", () => {
      const messages = [makeUserMessage("hello")];
      expect(() => resolveSelection(messages, 2, 1)).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/compress-search.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement search**

Create `src/compress/search.ts`:

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";
import { parseBoundaryId } from "../utils/message-ids.ts";

/**
 * Resolve a boundary ID (m0001 or b1) to a message array index.
 */
export function resolveBoundaryIndex(
  state: SessionState,
  boundaryId: string,
): number | undefined {
  const parsed = parseBoundaryId(boundaryId);
  if (!parsed) return undefined;

  if (parsed.type === "message") {
    // Find the index that has this ref assigned
    for (const [index, ref] of state.messageIds.byIndex) {
      if (ref === boundaryId) return index;
    }
    return undefined;
  }

  if (parsed.type === "block") {
    // Find the anchor index for this block
    for (const [anchorIndex, blockId] of state.prune.messages.activeByAnchorIndex) {
      if (blockId === parsed.blockId) return anchorIndex;
    }
    return undefined;
  }

  return undefined;
}

export interface SelectionResult {
  messageIndices: number[];
  startIndex: number;
  endIndex: number;
}

/**
 * Collect message indices in a range [startIndex, endIndex].
 */
export function resolveSelection(
  messages: AgentMessage[],
  startIndex: number,
  endIndex: number,
): SelectionResult {
  if (startIndex > endIndex) {
    throw new Error(
      `startId appears after endId in the conversation. Start must come before end.`,
    );
  }

  if (startIndex < 0 || endIndex >= messages.length) {
    throw new Error(
      `Boundary indices out of range. Valid range: 0-${messages.length - 1}`,
    );
  }

  const messageIndices: number[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    messageIndices.push(i);
  }

  return { messageIndices, startIndex, endIndex };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm run typecheck
pnpm test -- tests/compress-search.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/compress/search.ts tests/compress-search.test.ts
git commit -m "feat: add boundary resolution and selection for compression"
```

---

### Task 3: Compression Block Sync

**Files:**
- Create: `src/messages/sync.ts`
- Test: `tests/sync.test.ts`

Reconciles compression block state with the current message array on each context event. Blocks whose compress tool call message no longer exists get deactivated.

- [ ] **Step 1: Write tests**

Create `tests/sync.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { syncCompressionBlocks } from "../src/messages/sync.ts";
import { createSessionState } from "../src/state/state.ts";
import { applyCompressionState, allocateBlockId, allocateRunId } from "../src/compress/state.ts";

describe("syncCompressionBlocks", () => {
  it("keeps active blocks when compress message index is valid", () => {
    const state = createSessionState();
    const blockId = allocateBlockId(state);
    const runId = allocateRunId(state);

    applyCompressionState(state, {
      blockId,
      runId,
      topic: "test",
      mode: "range",
      startIndex: 0,
      endIndex: 3,
      anchorIndex: 0,
      compressMessageIndex: 5,
      summary: "summary",
      summaryTokens: 10,
      consumedBlockIds: [],
    });

    // 6 messages exist (indices 0-5), compress message at index 5 exists
    syncCompressionBlocks(state, 6);

    expect(state.prune.messages.blocksById.get(blockId)!.active).toBe(true);
    expect(state.prune.messages.activeBlockIds.has(blockId)).toBe(true);
  });

  it("deactivates blocks when compress message index exceeds message count", () => {
    const state = createSessionState();
    const blockId = allocateBlockId(state);
    const runId = allocateRunId(state);

    applyCompressionState(state, {
      blockId,
      runId,
      topic: "test",
      mode: "range",
      startIndex: 0,
      endIndex: 3,
      anchorIndex: 0,
      compressMessageIndex: 5,
      summary: "summary",
      summaryTokens: 10,
      consumedBlockIds: [],
    });

    // Only 3 messages exist, compress message at index 5 is gone
    syncCompressionBlocks(state, 3);

    expect(state.prune.messages.blocksById.get(blockId)!.active).toBe(false);
    expect(state.prune.messages.activeBlockIds.has(blockId)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/sync.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement sync**

Create `src/messages/sync.ts`:

```typescript
import type { SessionState } from "../state/types.ts";

/**
 * Reconcile compression block state with current message count.
 * Blocks whose compressMessageIndex exceeds the message array length
 * are deactivated (the compress tool call was compacted away).
 */
export function syncCompressionBlocks(
  state: SessionState,
  messageCount: number,
): void {
  const messagesState = state.prune.messages;
  if (messagesState.blocksById.size === 0) return;

  const now = Date.now();

  // Sort blocks by creation order for deterministic processing
  const blocks = Array.from(messagesState.blocksById.values())
    .sort((a, b) => a.createdAt - b.createdAt || a.blockId - b.blockId);

  messagesState.activeBlockIds.clear();
  messagesState.activeByAnchorIndex.clear();

  for (const block of blocks) {
    // If the compress tool call message no longer exists, deactivate
    if (block.compressMessageIndex >= messageCount) {
      block.active = false;
      block.deactivatedAt = now;
      continue;
    }

    if (block.deactivatedByUser) {
      block.active = false;
      if (block.deactivatedAt === undefined) {
        block.deactivatedAt = now;
      }
      continue;
    }

    // Reactivate if the compress message still exists
    block.active = true;
    block.deactivatedAt = undefined;
    block.deactivatedByBlockId = undefined;
    messagesState.activeBlockIds.add(block.blockId);
    messagesState.activeByAnchorIndex.set(block.anchorIndex, block.blockId);
  }

  // Update per-message entries
  for (const entry of messagesState.byMessageIndex.values()) {
    entry.activeBlockIds = entry.blockIds.filter((id) =>
      messagesState.activeBlockIds.has(id),
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm run typecheck
pnpm test -- tests/sync.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/messages/sync.ts tests/sync.test.ts
git commit -m "feat: add compression block reconciliation"
```

---

### Task 4: Compressed Range Filtering in Prune

**Files:**
- Modify: `src/messages/prune.ts`
- Test: Update `tests/prune.test.ts`

Extend `applyPruning()` with `filterCompressedRanges()` — replaces compressed message ranges with summary user messages and removes the original messages.

- [ ] **Step 1: Add tests for compressed range filtering**

Add to `tests/prune.test.ts`:

```typescript
// Add import:
import { allocateBlockId, allocateRunId, applyCompressionState } from "../src/compress/state.ts";

// Add test suite:
describe("filterCompressedRanges", () => {
  it("replaces compressed messages with summary", () => {
    const state = createSessionState();
    const blockId = allocateBlockId(state);
    const runId = allocateRunId(state);

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "start" }], timestamp: Date.now() } as AgentMessage,
      { role: "assistant", content: [{ type: "text", text: "response 1" }], stopReason: "stop", usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 }, timestamp: Date.now() } as AgentMessage,
      { role: "user", content: [{ type: "text", text: "middle" }], timestamp: Date.now() } as AgentMessage,
      { role: "assistant", content: [{ type: "text", text: "response 2" }], stopReason: "stop", usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 }, timestamp: Date.now() } as AgentMessage,
      { role: "user", content: [{ type: "text", text: "end" }], timestamp: Date.now() } as AgentMessage,
    ];

    applyCompressionState(state, {
      blockId,
      runId,
      topic: "test",
      mode: "range",
      startIndex: 1,
      endIndex: 3,
      anchorIndex: 1,
      compressMessageIndex: 4,
      summary: "Summary of messages 1-3",
      summaryTokens: 10,
      consumedBlockIds: [],
    });

    const result = applyPruning(state, messages);
    // Should have 3 messages: original[0], summary, original[4]
    expect(result.length).toBeLessThan(messages.length);
    // Summary should be present
    const summaryMsg = result.find((m) =>
      Array.isArray(m.content) &&
      m.content.some((c: any) => c.type === "text" && c.text.includes("Summary of messages 1-3"))
    );
    expect(summaryMsg).toBeDefined();
  });
});
```

- [ ] **Step 2: Implement filterCompressedRanges in prune.ts**

Add to `src/messages/prune.ts`:

```typescript
/**
 * Filter out compressed message ranges and inject summaries.
 * Messages covered by active blocks are removed and replaced with
 * a synthetic user message containing the summary at the anchor position.
 */
export function filterCompressedRanges(
  state: SessionState,
  messages: AgentMessage[],
): AgentMessage[] {
  if (state.prune.messages.activeBlockIds.size === 0) return messages;

  const result: AgentMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    // Check if there's a summary to inject at this anchor point
    const blockId = state.prune.messages.activeByAnchorIndex.get(i);
    if (blockId !== undefined) {
      const block = state.prune.messages.blocksById.get(blockId);
      if (block?.active && block.summary) {
        // Inject summary as a user message
        result.push({
          role: "user",
          content: [{ type: "text", text: block.summary }],
          timestamp: Date.now(),
        } as AgentMessage);
      }
    }

    // Skip messages that are covered by active blocks
    const entry = state.prune.messages.byMessageIndex.get(i);
    if (entry && entry.activeBlockIds.length > 0) {
      continue;
    }

    result.push(messages[i]);
  }

  return result;
}

// Update applyPruning to include filterCompressedRanges:
// (modify the existing applyPruning function)
```

Update the `applyPruning` function:

```typescript
export function applyPruning(
  state: SessionState,
  messages: AgentMessage[],
): AgentMessage[] {
  let result = filterCompressedRanges(state, messages);
  result = pruneToolOutputs(state, result);
  result = pruneToolErrors(state, result);
  return result;
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm run typecheck
pnpm test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/messages/prune.ts tests/prune.test.ts
git commit -m "feat: add compressed range filtering to pruning pipeline"
```

---

### Task 5: Range Compress Tool

**Files:**
- Create: `src/compress/range.ts`
- Test: `tests/compress-range.test.ts`

The compress tool handler for range mode. Validates boundaries, resolves selection, applies compression state, and returns a success message.

- [ ] **Step 1: Write tests**

Create `tests/compress-range.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { handleRangeCompress } from "../src/compress/range.ts";
import { createSessionState } from "../src/state/state.ts";
import type { DcpConfig } from "../src/config.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

function makeDefaultConfig(): DcpConfig {
  return {
    enabled: true,
    debug: false,
    compress: {
      mode: "range",
      permission: "allow",
      maxContextPercent: 80,
      minContextPercent: 50,
      nudgeFrequency: 5,
      iterationNudgeThreshold: 15,
      nudgeForce: "soft",
      protectedTools: [],
      protectUserMessages: false,
      protectTags: false,
    },
    manualMode: { default: false, automaticStrategies: true },
    strategies: {
      deduplication: { enabled: true, protectedTools: [] },
      purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
    },
    protectedFilePatterns: [],
    nudgeNotification: "minimal",
  };
}

describe("handleRangeCompress", () => {
  it("compresses a valid range", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    // Assign message refs
    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(1, "m0002");
    state.messageIds.byIndex.set(2, "m0003");
    state.messageIds.byIndex.set(3, "m0004");
    state.messageIds.nextRefIndex = 5;

    // Cache messages for the tool to reference
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 0 } as AgentMessage,
      { role: "assistant", content: [{ type: "text", text: "hi" }], stopReason: "stop", usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 }, timestamp: 0 } as AgentMessage,
      { role: "user", content: [{ type: "text", text: "do stuff" }], timestamp: 0 } as AgentMessage,
      { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 }, timestamp: 0 } as AgentMessage,
    ];

    const result = handleRangeCompress(state, config, messages, {
      topic: "Initial greeting",
      content: [
        { startId: "m0001", endId: "m0002", summary: "User greeted, assistant responded" },
      ],
    });

    expect(result).toContain("Compressed");
    expect(state.prune.messages.blocksById.size).toBe(1);
    expect(state.prune.messages.activeBlockIds.size).toBe(1);
  });

  it("throws for invalid boundary IDs", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [];

    expect(() => handleRangeCompress(state, config, messages, {
      topic: "test",
      content: [{ startId: "invalid", endId: "m0001", summary: "text" }],
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/compress-range.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement range compress handler**

Create `src/compress/range.ts`:

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { resolveBoundaryIndex, resolveSelection } from "./search.ts";
import {
  allocateBlockId,
  allocateRunId,
  applyCompressionState,
  wrapCompressedSummary,
  COMPRESSED_BLOCK_HEADER,
} from "./state.ts";
import { countTokens } from "../utils/tokens.ts";

export interface RangeCompressArgs {
  topic: string;
  content: Array<{
    startId: string;
    endId: string;
    summary: string;
  }>;
}

/**
 * Handle a range compress tool call.
 * Validates boundaries, resolves selection, applies compression state.
 * Returns a success message string.
 *
 * This is called from the tool handler registered via pi.registerTool().
 */
export function handleRangeCompress(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  args: RangeCompressArgs,
): string {
  if (!args.content || args.content.length === 0) {
    throw new Error("content array is required and must not be empty");
  }

  const runId = allocateRunId(state);
  let totalCompressed = 0;

  for (const entry of args.content) {
    if (!entry.startId || !entry.endId || !entry.summary) {
      throw new Error("Each content entry requires startId, endId, and summary");
    }

    const startIndex = resolveBoundaryIndex(state, entry.startId);
    if (startIndex === undefined) {
      throw new Error(
        `startId ${entry.startId} is not available in the current conversation context. Choose an injected ID visible in context.`,
      );
    }

    const endIndex = resolveBoundaryIndex(state, entry.endId);
    if (endIndex === undefined) {
      throw new Error(
        `endId ${entry.endId} is not available in the current conversation context. Choose an injected ID visible in context.`,
      );
    }

    const selection = resolveSelection(messages, startIndex, endIndex);
    const blockId = allocateBlockId(state);
    const wrappedSummary = wrapCompressedSummary(blockId, entry.summary);
    const summaryTokens = countTokens(wrappedSummary);

    // Find the compress tool call's message index (the current last message)
    const compressMessageIndex = messages.length - 1;

    applyCompressionState(state, {
      blockId,
      runId,
      topic: args.topic,
      batchTopic: args.topic,
      mode: "range",
      startIndex: selection.startIndex,
      endIndex: selection.endIndex,
      anchorIndex: selection.startIndex,
      compressMessageIndex,
      summary: wrappedSummary,
      summaryTokens,
      consumedBlockIds: [],
    });

    totalCompressed += selection.messageIndices.length;
  }

  return `Compressed ${totalCompressed} messages into ${COMPRESSED_BLOCK_HEADER}.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm run typecheck
pnpm test -- tests/compress-range.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/compress/range.ts tests/compress-range.test.ts
git commit -m "feat: add range compression tool handler"
```

---

### Task 6: Register Compress Tool and Wire Sync

**Files:**
- Modify: `src/index.ts`

Register the `compress` tool via `pi.registerTool()` with TypeBox parameters. Add `syncCompressionBlocks()` to the context pipeline.

- [ ] **Step 1: Update index.ts**

Add imports:

```typescript
import { Type } from "typebox";
import { handleRangeCompress, type RangeCompressArgs } from "./compress/range.ts";
import { syncCompressionBlocks } from "./messages/sync.ts";
```

Register the tool (after lifecycle hooks, before context handler):

```typescript
// Cache latest messages for compress tool
let latestMessages: AgentMessage[] = [];

pi.registerTool({
  name: "compress",
  label: "Compress",
  description: `Compress conversation ranges into summaries. Use message IDs (m0001, m0002...) visible in context as boundaries.`,
  parameters: Type.Object({
    topic: Type.String({ description: "Short label (3-5 words) for display" }),
    content: Type.Array(
      Type.Object({
        startId: Type.String({ description: "Message or block ID marking range start (e.g. m0001, b2)" }),
        endId: Type.String({ description: "Message or block ID marking range end (e.g. m0012, b5)" }),
        summary: Type.String({ description: "Complete technical summary replacing all content in range" }),
      }),
      { description: "Ranges to compress, each with start/end boundaries and summary" }
    ),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const typedArgs = params as unknown as RangeCompressArgs;
    const resultText = handleRangeCompress(state, config, latestMessages, typedArgs);
    return {
      content: [{ type: "text" as const, text: resultText }],
      details: {},
    };
  },
});
```

Add sync to context pipeline (before pruning):

```typescript
// In the context handler, before Step 1 (strip hallucinations):

// Step 0: Cache messages for compress tool
latestMessages = event.messages;

// Step 0.5: Sync compression blocks
syncCompressionBlocks(state, messages.length);
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
git commit -m "feat: register compress tool and wire compression block sync"
```
