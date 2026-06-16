# Phase 3: Protect Tool Call Chains During Compression

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compression never produces a filtered message array that splits a `toolCall` from its `toolResult`, preventing 400 errors from providers.

**Architecture:** Two-layer defense. Layer 1: `expandRangeForToolChains` expands the compression range to always include both halves of every tool call pair that overlaps the range. Layer 2: `removeOrphanedToolResults` in `filterCompressedRanges` drops any orphaned `toolResult` as a safety net.

**Tech Stack:** Vitest, TypeScript

---

### Task 1: Implement `expandRangeForToolChains`

**Files:**
- Modify: `src/compress/search.ts`
- Test: `tests/compress-search.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/compress-search.test.ts`:

```typescript
import { expandRangeForToolChains } from "../src/compress/search.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("expandRangeForToolChains", () => {
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

  it("expands endIndex to include orphaned toolResult", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "do it" }], timestamp: Date.now() } as AgentMessage,
      makeAssistantToolCall("c1", "read"),    // index 1
      makeToolResultMsg("c1"),                 // index 2
      { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() } as unknown as AgentMessage,
    ];

    // Range [0,1] includes the assistant toolCall but not its toolResult at index 2
    const result = expandRangeForToolChains(messages, 0, 1);
    expect(result.endIndex).toBe(2);
  });

  it("expands startIndex to include orphaned assistant toolCall", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "do it" }], timestamp: Date.now() } as AgentMessage,
      makeAssistantToolCall("c1", "read"),    // index 1
      makeToolResultMsg("c1"),                 // index 2
      { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() } as unknown as AgentMessage,
    ];

    // Range [2,3] includes the toolResult but not its assistant at index 1
    const result = expandRangeForToolChains(messages, 2, 3);
    expect(result.startIndex).toBe(1);
  });

  it("does not expand when range already contains both halves", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "do it" }], timestamp: Date.now() } as AgentMessage,
      makeAssistantToolCall("c1", "read"),    // index 1
      makeToolResultMsg("c1"),                 // index 2
      { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() } as unknown as AgentMessage,
    ];

    // Range [1,2] already contains both
    const result = expandRangeForToolChains(messages, 1, 2);
    expect(result.startIndex).toBe(1);
    expect(result.endIndex).toBe(2);
  });

  it("handles multiple tool calls in one assistant message", () => {
    const multiCallAssistant: AgentMessage = {
      role: "assistant",
      content: [
        { type: "toolCall", id: "c1", name: "read", arguments: {} },
        { type: "toolCall", id: "c2", name: "write", arguments: {} },
      ],
      stopReason: "toolUse",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
      timestamp: Date.now(),
    } as unknown as AgentMessage;

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "do both" }], timestamp: Date.now() } as AgentMessage,
      multiCallAssistant,           // index 1
      makeToolResultMsg("c1"),      // index 2
      makeToolResultMsg("c2"),      // index 3
      { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() } as unknown as AgentMessage,
    ];

    // Range [0,1] - includes the assistant with two tool calls, must expand to include both results
    const result = expandRangeForToolChains(messages, 0, 1);
    expect(result.endIndex).toBe(3);
  });

  it("returns unchanged range when no tool calls present", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() } as AgentMessage,
      { role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: Date.now() } as unknown as AgentMessage,
    ];

    const result = expandRangeForToolChains(messages, 0, 1);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/compress-search.test.ts`

Expected: FAILS with `expandRangeForToolChains is not a function` (not yet exported).

- [ ] **Step 3: Implement `expandRangeForToolChains`**

Add to `src/compress/search.ts`:

```typescript
export interface ExpandedRange {
  startIndex: number;
  endIndex: number;
}

/**
 * Expand a compression range to ensure all tool call chains are complete.
 * If the range includes an assistant message with toolCall but not its toolResult,
 * expand endIndex. If it includes a toolResult but not its assistant, expand startIndex.
 * Repeats until stable.
 */
export function expandRangeForToolChains(
  messages: AgentMessage[],
  startIndex: number,
  endIndex: number,
): ExpandedRange {
  let start = startIndex;
  let end = endIndex;
  let changed = true;

  while (changed) {
    changed = false;

    // Collect all toolCall IDs from assistant messages in [start, end]
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

    // For each toolCall in range, ensure its toolResult is also in range
    for (let i = end + 1; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== "toolResult") continue;
      if (callIdsInRange.has(msg.toolCallId)) {
        end = i;
        changed = true;
      }
    }

    // Collect all toolResult toolCallIds in [start, end]
    const resultCallIdsInRange = new Set<string>();
    for (let i = start; i <= end; i++) {
      const msg = messages[i];
      if (msg.role !== "toolResult") continue;
      resultCallIdsInRange.add(msg.toolCallId);
    }

    // For each toolResult in range, ensure its assistant toolCall is also in range
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

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run tests/compress-search.test.ts`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/compress/search.ts tests/compress-search.test.ts
git commit -m "feat: add expandRangeForToolChains to prevent orphaned tool results

Scans a proposed compression range for tool call/result pairs that
would be split. Expands the range to include both halves of every
pair, preventing provider 400 errors from orphaned toolResult messages."
```

---

### Task 2: Wire `expandRangeForToolChains` into `resolveSelection`

**Files:**
- Modify: `src/compress/search.ts:39-62`
- Modify: `src/compress/handler.ts` (pass messages through)
- Test: `tests/compress-range.test.ts`

- [ ] **Step 1: Write the failing integration test**

Add to `tests/compress-range.test.ts`:

```typescript
describe("handleCompress tool chain protection", () => {
  it("auto-expands range to include orphaned toolResult", () => {
    const state = createSessionState();
    state.messageIds.byRef.set("m0001", 0);
    state.messageIds.byRef.set("m0002", 1);

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "read it" }], timestamp: Date.now() } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
        stopReason: "toolUse",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
        timestamp: Date.now(),
      } as unknown as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read",
        content: [{ type: "text", text: "file contents" }],
        isError: false,
        timestamp: Date.now(),
      } as AgentMessage,
      { role: "assistant", content: [{ type: "text", text: "here it is" }], timestamp: Date.now() } as unknown as AgentMessage,
    ];

    const config = makeDefaultConfig();
    // Compress range m0001..m0002 = indices 0..1 (assistant toolCall without its result)
    const result = handleCompress(state, config, messages, {
      topic: "test",
      mode: "range",
      content: [{ startId: "m0001", endId: "m0002", summary: "read a file" }],
    });

    // Should auto-expand to include index 2 (toolResult), so 3 messages compressed
    expect(result).toContain("Compressed 3 messages");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/compress-range.test.ts`

Expected: FAILS — reports "Compressed 2 messages" because `resolveSelection` does not expand.

- [ ] **Step 3: Modify `resolveSelection` to call `expandRangeForToolChains`**

Update `resolveSelection` in `src/compress/search.ts`:

```typescript
/**
 * Collect message indices in a range [startIndex, endIndex].
 * Auto-expands the range to protect tool call chains from being split.
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

  // Expand range to avoid splitting tool call chains
  const expanded = expandRangeForToolChains(messages, startIndex, endIndex);

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

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run tests/compress-range.test.ts tests/compress-search.test.ts`

Expected: All tests pass.

- [ ] **Step 5: Run full check**

Run: `pnpm run check`

Expected: lint, typecheck, and all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/compress/search.ts tests/compress-range.test.ts
git commit -m "feat: wire expandRangeForToolChains into resolveSelection

resolveSelection now auto-expands ranges to include both halves of any
tool call chain overlapping the boundary, preventing 400 errors."
```

---

### Task 3: Add orphan safety net in `filterCompressedRanges`

**Files:**
- Modify: `src/messages/prune.ts:9-41`
- Test: `tests/prune.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/prune.test.ts`:

```typescript
describe("filterCompressedRanges orphan safety net", () => {
  it("removes orphaned toolResult messages from filtered output", () => {
    const state = createSessionState();
    const blockId = allocateBlockId(state);
    const runId = allocateRunId(state);

    // Simulate a scenario where compression covers only the assistant (index 1)
    // but leaves its toolResult (index 2) as an orphan
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "read it" }], timestamp: Date.now() } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
        stopReason: "toolUse",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
        timestamp: Date.now(),
      } as unknown as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read",
        content: [{ type: "text", text: "file contents" }],
        isError: false,
        timestamp: Date.now(),
      } as AgentMessage,
      { role: "user", content: [{ type: "text", text: "thanks" }], timestamp: Date.now() } as AgentMessage,
    ];

    // Manually create a block that covers only index 1 (the assistant with toolCall)
    // This simulates a stale/corrupt block state that Layer 1 should have prevented
    applyCompressionState(state, {
      blockId,
      runId,
      topic: "test",
      mode: "range",
      startIndex: 1,
      endIndex: 1,
      anchorIndex: 1,
      compressMessageIndex: 3,
      summary: "Summary of tool use",
      summaryTokens: 5,
      consumedBlockIds: [],
    });

    const result = applyPruning(state, messages);

    // The orphaned toolResult (c1) should NOT be in the output
    const hasOrphan = result.some(
      (m) => m.role === "toolResult" && (m as { toolCallId: string }).toolCallId === "c1",
    );
    expect(hasOrphan).toBe(false);

    // Should still have: user(0), summary, user(3) = 3 messages
    expect(result).toHaveLength(3);
  });

  it("keeps toolResult when its assistant is present in output", () => {
    const state = createSessionState();

    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
        stopReason: "toolUse",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
        timestamp: Date.now(),
      } as unknown as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read",
        content: [{ type: "text", text: "file contents" }],
        isError: false,
        timestamp: Date.now(),
      } as AgentMessage,
    ];

    const result = applyPruning(state, messages);

    // Both should survive
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("assistant");
    expect(result[1].role).toBe("toolResult");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/prune.test.ts`

Expected: First test FAILS — the orphaned `toolResult` is still in the output (4 messages instead of 3).

- [ ] **Step 3: Implement the orphan safety net**

Modify `filterCompressedRanges` in `src/messages/prune.ts`:

```typescript
/**
 * Filter out compressed message ranges and inject summaries.
 * Messages covered by active blocks are removed and replaced with
 * a synthetic user message containing the summary at the anchor position.
 *
 * Safety net: any toolResult without a matching toolCall in the output is removed.
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

  // Safety net: remove orphaned toolResult messages
  return removeOrphanedToolResults(result);
}

/**
 * Remove toolResult messages whose toolCallId has no matching toolCall
 * in an assistant message in the output array.
 */
function removeOrphanedToolResults(messages: AgentMessage[]): AgentMessage[] {
  // Collect all toolCall IDs from assistant messages
  const toolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (typeof part !== "object" || part === null) continue;
      const p = part as unknown as Record<string, unknown>;
      if (p.type === "toolCall" && typeof p.id === "string") {
        toolCallIds.add(p.id as string);
      }
    }
  }

  // Filter out toolResult messages without a matching toolCall
  return messages.filter((msg) => {
    if (msg.role !== "toolResult") return true;
    return toolCallIds.has((msg as unknown as { toolCallId: string }).toolCallId);
  });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run tests/prune.test.ts`

Expected: All tests pass.

- [ ] **Step 5: Run full check**

Run: `pnpm run check`

Expected: lint, typecheck, and all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/messages/prune.ts tests/prune.test.ts
git commit -m "fix: add orphan safety net to filterCompressedRanges

Belt-and-suspenders defense: after filtering compressed ranges, scan
the output for toolResult messages whose toolCallId has no matching
toolCall in any assistant message. Remove them to prevent provider 400s.

This catches edge cases where stale block state references shifted indices."
```
