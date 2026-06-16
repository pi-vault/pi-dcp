# Phase 4: Index-Based Lookup for Tool Chain Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `assistantIndex` and `resultIndex` to `ToolParameterEntry` for O(1) lookup of tool chain pairs, enabling faster validation in `expandRangeForToolChains`.

**Architecture:** Extend `syncToolCache` to record the message indices when building the cache. Add an optimized path in `expandRangeForToolChains` that uses cached indices when available, falling back to the scan-based approach otherwise.

**Tech Stack:** Vitest, TypeScript

**Depends on:** Phase 1 (extends the same function), Phase 3 (optimizes the expansion function)

---

### Task 1: Add `assistantIndex` and `resultIndex` to `ToolParameterEntry`

**Files:**
- Modify: `src/state/types.ts:101-108`
- Modify: `src/state/state.ts` (only if `createSessionState` initializes entries — it doesn't, Map is empty)
- Test: `tests/tool-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/tool-cache.test.ts`:

```typescript
it("records assistantIndex and resultIndex", () => {
  const state = createSessionState();
  state.currentTurn = 1;

  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "do it" }], timestamp: Date.now() } as AgentMessage,
    makeAssistantWithToolCall("call1", "read", { filePath: "/tmp/foo.ts" }),
    {
      role: "toolResult",
      toolCallId: "call1",
      toolName: "read",
      content: [{ type: "text", text: "result" }],
      isError: false,
      timestamp: Date.now(),
    } as AgentMessage,
  ];

  syncToolCache(state, messages);

  const entry = state.toolParameters.get("call1")!;
  expect(entry.assistantIndex).toBe(1);
  expect(entry.resultIndex).toBe(2);
});

it("sets resultIndex undefined when no toolResult present", () => {
  const state = createSessionState();
  state.currentTurn = 1;

  const messages: AgentMessage[] = [
    makeAssistantWithToolCall("call1", "read", { filePath: "/tmp/foo.ts" }),
  ];

  syncToolCache(state, messages);

  const entry = state.toolParameters.get("call1")!;
  expect(entry.assistantIndex).toBe(0);
  expect(entry.resultIndex).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tool-cache.test.ts`

Expected: FAILS because `entry.assistantIndex` is `undefined` (field doesn't exist yet).

- [ ] **Step 3: Add fields to `ToolParameterEntry` type**

Modify `src/state/types.ts`:

```typescript
export interface ToolParameterEntry {
  tool: string;
  parameters: unknown;
  status: "pending" | "running" | "completed" | "error" | undefined;
  error: string | undefined;
  turn: number;
  tokenCount: number | undefined;
  /** Index of the assistant message containing this tool call. */
  assistantIndex: number | undefined;
  /** Index of the toolResult message for this tool call. */
  resultIndex: number | undefined;
}
```

- [ ] **Step 4: Update `syncToolCache` to record indices**

Modify `src/state/tool-cache.ts` — update the first pass to store result indices and the second pass to record assistant indices:

```typescript
export function syncToolCache(
  state: SessionState,
  messages: AgentMessage[],
): void {
  // First pass: collect tool results with token counts and indices
  const resultsByCallId = new Map<
    string,
    { isError: boolean; errorText?: string; tokenCount: number; index: number }
  >();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "toolResult") continue;
    resultsByCallId.set(msg.toolCallId, {
      isError: msg.isError,
      errorText: msg.isError ? extractToolResultText(msg) : undefined,
      tokenCount: countMessageTokens(msg),
      index: i,
    });
  }

  // Second pass: collect tool calls from assistant messages
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    if (!Array.isArray(msg.content)) continue;

    for (const part of msg.content) {
      if (typeof part !== "object" || part === null) continue;
      const p = part as unknown as Record<string, unknown>;
      if (p.type !== "toolCall" || typeof p.id !== "string") continue;

      const callId = p.id as string;
      if (state.toolParameters.has(callId)) continue;

      const result = resultsByCallId.get(callId);
      const entry: ToolParameterEntry = {
        tool: (p.name as string) ?? "unknown",
        parameters: p.arguments ?? {},
        status: result ? (result.isError ? "error" : "completed") : "pending",
        error: result?.errorText,
        turn: state.currentTurn,
        tokenCount: result?.tokenCount,
        assistantIndex: i,
        resultIndex: result?.index,
      };

      state.toolParameters.set(callId, entry);
    }
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm vitest run tests/tool-cache.test.ts`

Expected: All tests pass.

- [ ] **Step 6: Update existing test helpers that construct `ToolParameterEntry`**

The `seedToolCache` helper in `tests/strategy-runner.test.ts` constructs entries directly. Add the new fields:

```typescript
function seedToolCache(
  state: ReturnType<typeof createSessionState>,
  entries: Array<{
    id: string;
    tool: string;
    parameters: Record<string, unknown>;
    status: "completed" | "error";
    turn: number;
    tokenCount: number;
  }>,
): void {
  for (const e of entries) {
    state.toolParameters.set(e.id, {
      tool: e.tool,
      parameters: e.parameters,
      status: e.status,
      error: undefined,
      turn: e.turn,
      tokenCount: e.tokenCount,
      assistantIndex: undefined,
      resultIndex: undefined,
    });
    state.toolIdList.push(e.id);
  }
}
```

Also update the existing test in `tests/tool-cache.test.ts` that manually constructs an entry ("does not overwrite existing entries"):

```typescript
state.toolParameters.set("call1", {
  tool: "read",
  parameters: { filePath: "/old" },
  status: "completed",
  error: undefined,
  turn: 1,
  tokenCount: 50,
  assistantIndex: undefined,
  resultIndex: undefined,
});
```

- [ ] **Step 7: Run full check**

Run: `pnpm run check`

Expected: lint, typecheck, and all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/state/types.ts src/state/tool-cache.ts tests/tool-cache.test.ts tests/strategy-runner.test.ts
git commit -m "feat: add assistantIndex and resultIndex to ToolParameterEntry

Records the message array index of both the assistant message containing
the toolCall and the toolResult message. Enables O(1) lookup for tool chain
validation instead of scanning the full message array."
```

---

### Task 2: Optimize `expandRangeForToolChains` with cached indices

**Files:**
- Modify: `src/compress/search.ts`
- Test: `tests/compress-search.test.ts`

- [ ] **Step 1: Write the test for index-based expansion**

Add to `tests/compress-search.test.ts`:

```typescript
import { expandRangeForToolChains } from "../src/compress/search.ts";
import { createSessionState } from "../src/state/state.ts";
import { syncToolCache } from "../src/state/tool-cache.ts";

describe("expandRangeForToolChains with cached indices", () => {
  function makeAssistantToolCall(callId: string, name: string): AgentMessage {
    return {
      role: "assistant",
      content: [{ type: "toolCall", id: callId, name, arguments: {} }],
      stopReason: "toolUse",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
      timestamp: Date.now(),
    } as unknown as AgentMessage;
  }

  function makeToolResultMsg(callId: string): AgentMessage {
    return {
      role: "toolResult",
      toolCallId: callId,
      toolName: "read",
      content: [{ type: "text", text: "result" }],
      isError: false,
      timestamp: Date.now(),
    } as AgentMessage;
  }

  it("uses cached indices for expansion when state is provided", () => {
    const state = createSessionState();
    state.currentTurn = 1;

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "do it" }], timestamp: Date.now() } as AgentMessage,
      makeAssistantToolCall("c1", "read"),
      makeToolResultMsg("c1"),
      { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() } as unknown as AgentMessage,
    ];

    syncToolCache(state, messages);

    // Range [0,1] includes assistant toolCall but not result at index 2
    const result = expandRangeForToolChains(messages, 0, 1, state);
    expect(result.endIndex).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/compress-search.test.ts`

Expected: FAILS because `expandRangeForToolChains` doesn't accept a `state` parameter yet.

- [ ] **Step 3: Add optional state parameter and index-based fast path**

Modify `expandRangeForToolChains` in `src/compress/search.ts`:

```typescript
import type { SessionState } from "../state/types.ts";

/**
 * Expand a compression range to ensure all tool call chains are complete.
 * If state is provided, uses cached assistantIndex/resultIndex for O(1) lookups.
 * Otherwise, scans the message array.
 */
export function expandRangeForToolChains(
  messages: AgentMessage[],
  startIndex: number,
  endIndex: number,
  state?: SessionState,
): ExpandedRange {
  // Fast path: use cached indices from tool parameter entries
  if (state && state.toolParameters.size > 0) {
    return expandWithCachedIndices(messages, startIndex, endIndex, state);
  }

  // Fallback: scan-based expansion (original implementation)
  return expandByScan(messages, startIndex, endIndex);
}

function expandWithCachedIndices(
  messages: AgentMessage[],
  startIndex: number,
  endIndex: number,
  state: SessionState,
): ExpandedRange {
  let start = startIndex;
  let end = endIndex;
  let changed = true;

  while (changed) {
    changed = false;

    for (const [, entry] of state.toolParameters) {
      const aIdx = entry.assistantIndex;
      const rIdx = entry.resultIndex;
      if (aIdx === undefined) continue;

      // Assistant in range but result outside → expand end
      if (rIdx !== undefined && aIdx >= start && aIdx <= end && rIdx > end) {
        end = rIdx;
        changed = true;
      }

      // Result in range but assistant outside → expand start
      if (rIdx !== undefined && rIdx >= start && rIdx <= end && aIdx < start) {
        start = aIdx;
        changed = true;
      }
    }
  }

  return { startIndex: start, endIndex: end };
}

function expandByScan(
  messages: AgentMessage[],
  startIndex: number,
  endIndex: number,
): ExpandedRange {
  let start = startIndex;
  let end = endIndex;
  let changed = true;

  while (changed) {
    changed = false;

    const callIdsInRange = new Set<string>();
    for (let i = start; i <= end; i++) {
      const msg = messages[i];
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (typeof part !== "object" || part === null) continue;
        const p = part as unknown as Record<string, unknown>;
        if (p.type === "toolCall" && typeof p.id === "string") {
          callIdsInRange.add(p.id as string);
        }
      }
    }

    for (let i = end + 1; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== "toolResult") continue;
      if (callIdsInRange.has(msg.toolCallId)) {
        end = i;
        changed = true;
      }
    }

    const resultCallIdsInRange = new Set<string>();
    for (let i = start; i <= end; i++) {
      const msg = messages[i];
      if (msg.role !== "toolResult") continue;
      resultCallIdsInRange.add(msg.toolCallId);
    }

    for (let i = 0; i < start; i++) {
      const msg = messages[i];
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (typeof part !== "object" || part === null) continue;
        const p = part as unknown as Record<string, unknown>;
        if (p.type === "toolCall" && typeof p.id === "string") {
          if (resultCallIdsInRange.has(p.id as string)) {
            start = i;
            changed = true;
          }
        }
      }
    }
  }

  return { startIndex: start, endIndex: end };
}
```

- [ ] **Step 4: Update `resolveSelection` call site to pass state**

The `resolveSelection` function is called from `normalizeEntries` in `handler.ts`. Update the call chain:

In `src/compress/search.ts`, modify `resolveSelection` to accept optional state:

```typescript
export function resolveSelection(
  messages: AgentMessage[],
  startIndex: number,
  endIndex: number,
  state?: SessionState,
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

  const expanded = expandRangeForToolChains(messages, startIndex, endIndex, state);

  const messageIndices: number[] = [];
  for (let i = expanded.startIndex; i <= expanded.endIndex; i++) {
    messageIndices.push(i);
  }

  return {
    messageIndices,
    startIndex: expanded.startIndex,
    endIndex: expanded.endIndex,
  };
}
```

In `src/compress/handler.ts`, pass `state` through to `resolveSelection`:

```typescript
// In normalizeEntries, update the resolveSelection call:
const selection = resolveSelection(messages, startIndex, endIndex, state);
```

Update the `normalizeEntries` function signature to include `state` (it already receives it).

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm vitest run tests/compress-search.test.ts tests/compress-range.test.ts`

Expected: All tests pass.

- [ ] **Step 6: Run full check**

Run: `pnpm run check`

Expected: lint, typecheck, and all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/compress/search.ts src/compress/handler.ts tests/compress-search.test.ts
git commit -m "perf: use cached indices in expandRangeForToolChains

When SessionState has populated toolParameters with assistantIndex and
resultIndex, expandRangeForToolChains uses O(1) lookups per tool call
instead of scanning the full message array. Falls back to scan when
state is not provided."
```
