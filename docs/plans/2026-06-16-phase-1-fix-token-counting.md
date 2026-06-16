# Phase 1: Fix Token Counting in syncToolCache

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `tokenCount` on every `ToolParameterEntry` so strategies report real token savings instead of 0.

**Architecture:** Extend the first pass in `syncToolCache` to also compute token counts for each `toolResult` message. Store these counts in the `resultsByCallId` map. In the second pass, read the precomputed token count when building the entry.

**Tech Stack:** Vitest, TypeScript, `countMessageTokens` from `src/utils/tokens.ts`

---

### Task 1: Extend `syncToolCache` first pass to compute token counts

**Files:**
- Modify: `src/state/tool-cache.ts:1-52`
- Test: `tests/tool-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/tool-cache.test.ts`:

```typescript
it("populates tokenCount from toolResult message content", () => {
  const state = createSessionState();
  state.currentTurn = 1;

  const messages: AgentMessage[] = [
    makeAssistantWithToolCall("call1", "read", { filePath: "/tmp/foo.ts" }),
    {
      role: "toolResult",
      toolCallId: "call1",
      toolName: "read",
      content: [{ type: "text", text: "a".repeat(400) }],
      isError: false,
      timestamp: Date.now(),
    } as AgentMessage,
  ];

  syncToolCache(state, messages);

  const entry = state.toolParameters.get("call1")!;
  // 400 chars / 4 = 100 tokens
  expect(entry.tokenCount).toBe(100);
});

it("sets tokenCount undefined when toolResult not yet received", () => {
  const state = createSessionState();
  state.currentTurn = 1;

  const messages: AgentMessage[] = [
    makeAssistantWithToolCall("call1", "read", { filePath: "/tmp/foo.ts" }),
    // No toolResult for call1
  ];

  syncToolCache(state, messages);

  const entry = state.toolParameters.get("call1")!;
  expect(entry.tokenCount).toBeUndefined();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/tool-cache.test.ts`

Expected: First test FAILS because `entry.tokenCount` is `undefined` instead of `100`. Second test passes (already undefined).

- [ ] **Step 3: Implement the fix in `syncToolCache`**

In `src/state/tool-cache.ts`, modify the first pass to also store `tokenCount`, and import `countMessageTokens`:

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState, ToolParameterEntry } from "./types.ts";
import { countMessageTokens } from "../utils/tokens.ts";

export function syncToolCache(
  state: SessionState,
  messages: AgentMessage[],
): void {
  // First pass: collect tool results with token counts
  const resultsByCallId = new Map<
    string,
    { isError: boolean; errorText?: string; tokenCount: number }
  >();
  for (const msg of messages) {
    if (msg.role !== "toolResult") continue;
    resultsByCallId.set(msg.toolCallId, {
      isError: msg.isError,
      errorText: msg.isError ? extractToolResultText(msg) : undefined,
      tokenCount: countMessageTokens(msg),
    });
  }

  // Second pass: collect tool calls from assistant messages
  for (const msg of messages) {
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
      };

      state.toolParameters.set(callId, entry);
    }
  }
}
```

- [ ] **Step 4: Run all tests to verify pass**

Run: `pnpm vitest run tests/tool-cache.test.ts`

Expected: All tests pass, including the two new ones.

- [ ] **Step 5: Run full check**

Run: `pnpm run check`

Expected: lint, typecheck, and all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/state/tool-cache.ts tests/tool-cache.test.ts
git commit -m "fix: populate tokenCount in syncToolCache from toolResult content

Strategies (deduplication, purge-errors) read entry.tokenCount to report
savings. Previously this was always undefined, causing 0 tokens reported.
Now computed via countMessageTokens on the toolResult message."
```

---

> **Note:** Task 2 was removed. `tests/strategy-runner.test.ts` already contains 15 tests that seed `tokenCount` directly on entries and assert non-zero `tokensSaved` / `totalPruneTokens` values. A separate test here would pass immediately without exercising the `syncToolCache` fix and therefore provides no TDD value.
