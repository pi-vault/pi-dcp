# Phase 3: Turn Protection for Deduplication

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `turnProtection` config to the deduplication strategy that prevents pruning duplicate tool outputs that are within N turns of the current conversation turn.

**Architecture:** Add a numeric `turnProtection` field to `DeduplicationConfig` (default: 3, 0 disables). In the dedup loop in `runStrategies`, check each non-last duplicate entry's turn against `state.currentTurn` and skip pruning if the gap is smaller than the threshold.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Write failing tests

**Files:**
- Create: `tests/turn-protection.test.ts`

- [ ] **Step 1: Write test file**

Create `tests/turn-protection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runStrategies } from "../src/strategies/runner.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";

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

describe("turn protection for deduplication", () => {
  it("does not prune duplicates within the turn window", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.deduplication.turnProtection = 3;
    state.currentTurn = 5;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 3, // gap = 5 - 3 = 2, within window of 3
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 5,
        tokenCount: 100,
      },
    ]);

    const result = runStrategies(state, config);
    expect(state.prune.tools.has("a1")).toBe(false); // protected by turn window
    expect(state.prune.tools.has("a2")).toBe(false); // last in group, always kept
    expect(result.pruned).toBe(0);
  });

  it("prunes duplicates outside the turn window", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.deduplication.turnProtection = 3;
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2, // gap = 10 - 2 = 8, outside window of 3
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 9,
        tokenCount: 100,
      },
    ]);

    const result = runStrategies(state, config);
    expect(state.prune.tools.has("a1")).toBe(true); // old enough to prune
    expect(state.prune.tools.has("a2")).toBe(false); // last in group
    expect(result.pruned).toBe(1);
  });

  it("prunes all duplicates when turnProtection is 0 (disabled)", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.deduplication.turnProtection = 0;
    state.currentTurn = 5;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 4, // would be within window of 3, but protection is disabled
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 5,
        tokenCount: 100,
      },
    ]);

    const result = runStrategies(state, config);
    expect(state.prune.tools.has("a1")).toBe(true); // pruned — no protection
    expect(result.pruned).toBe(1);
  });

  it("does not affect purge-errors strategy", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.deduplication.turnProtection = 3;
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "err1",
        tool: "custom_tool",
        parameters: {},
        status: "error",
        turn: 1, // stale error
        tokenCount: 200,
      },
    ]);

    const result = runStrategies(state, config);
    // purge-errors has its own turn logic, unaffected by dedup turnProtection
    expect(state.prune.tools.has("err1")).toBe(true);
    expect(result.pruned).toBe(1);
  });

  it("protects recent entries even with multiple duplicates", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.deduplication.turnProtection = 3;
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2, // gap 8, outside window
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 8, // gap 2, inside window
        tokenCount: 100,
      },
      {
        id: "a3",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 10, // last in group
        tokenCount: 100,
      },
    ]);

    const result = runStrategies(state, config);
    expect(state.prune.tools.has("a1")).toBe(true);  // old, pruned
    expect(state.prune.tools.has("a2")).toBe(false); // recent, protected
    expect(state.prune.tools.has("a3")).toBe(false); // last in group
    expect(result.pruned).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/turn-protection.test.ts`
Expected: FAIL — `turnProtection` property does not exist on `DeduplicationConfig`.

---

### Task 2: Add turnProtection to config

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/helpers.ts`

- [ ] **Step 1: Add to DeduplicationConfig interface**

In `src/config.ts`, update the `DeduplicationConfig` interface to add `turnProtection`:

```ts
export interface DeduplicationConfig {
  enabled: boolean;
  protectedTools: string[];
  /** Protect duplicate tool outputs from pruning for N turns after invocation. 0 disables. */
  turnProtection: number;
}
```

- [ ] **Step 2: Add default value**

In `DEFAULT_CONFIG.strategies.deduplication`, add `turnProtection: 3`:

```ts
    deduplication: {
      enabled: true,
      protectedTools: [],
      turnProtection: 3,
    },
```

- [ ] **Step 3: Add merge logic**

In the `mergeConfig` function, inside the `if (s.deduplication && typeof s.deduplication === "object")` block, add after the `protectedTools` check:

```ts
      if (typeof d.turnProtection === "number" && d.turnProtection >= 0)
        target.strategies.deduplication.turnProtection = d.turnProtection;
```

- [ ] **Step 4: Update test helpers**

In `tests/helpers.ts`, update `makeDefaultConfig` to include `turnProtection` in the deduplication config:

```ts
    strategies: {
      deduplication: { enabled: true, protectedTools: [], turnProtection: 3 },
      purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
    },
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

---

### Task 3: Implement turn protection in dedup loop

**Files:**
- Modify: `src/strategies/runner.ts`

- [ ] **Step 1: Add turn protection check**

In `src/strategies/runner.ts`, replace the "Prune all but last in each group" loop (lines 68-79) with:

```ts
    // Prune all but last in each group
    for (const [, callIds] of groups) {
      if (callIds.length <= 1) continue;
      for (let i = 0; i < callIds.length - 1; i++) {
        const callId = callIds[i];
        const entry = state.toolParameters.get(callId);
        if (!entry) continue;

        // Turn protection: skip if this entry is too recent
        const turnProtection = config.strategies.deduplication.turnProtection;
        if (
          turnProtection > 0 &&
          state.currentTurn - entry.turn < turnProtection
        ) {
          continue;
        }

        const tokens = entry.tokenCount ?? 0;
        state.prune.tools.set(callId, tokens);
        pruned++;
        tokensSaved += tokens;
        prunedToolNames.push(entry.tool);
      }
    }
```

- [ ] **Step 2: Run all tests**

Run: `pnpm check`
Expected: All tests pass including new `turn-protection.test.ts` and existing `strategy-runner.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts src/strategies/runner.ts tests/helpers.ts tests/turn-protection.test.ts
git commit -m "feat: add turn protection for deduplication strategy"
```
