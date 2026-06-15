# Phase 3: Deepen the Strategy Module

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Create `src/strategies/runner.ts` as a single entry point for all pruning strategies, encapsulating guard checks, protected-tools resolution, eligibility filtering, and stat bookkeeping. Strategy files shrink to pure predicates.

**Architecture:** The runner owns the shared boilerplate (guards, protection checks, stat mutation). Individual strategy files export only predicates/utilities: `deduplication.ts` exports `createToolSignature`; `purge-errors.ts` exports `isStaleError`. `sweepCommand` delegates to `sweepAll` in the runner. `index.ts` replaces two strategy calls with one.

**Tech Stack:** TypeScript (strict mode), vitest, biome (lint)

**Behavior change:** None. Same tools get pruned under the same conditions.

**Prerequisite:** Phase 2 complete.

---

## File Map

| Action | File                              | Responsibility after this phase                          |
| ------ | --------------------------------- | -------------------------------------------------------- |
| Create | `src/strategies/runner.ts`        | `runStrategies` and `sweepAll` entry points              |
| Modify | `src/strategies/deduplication.ts` | Export only `createToolSignature` and `normalizeParams`  |
| Modify | `src/strategies/purge-errors.ts`  | Export only `isStaleError` predicate                     |
| Modify | `src/commands/sweep.ts`           | Call `sweepAll` instead of reimplementing                |
| Modify | `src/index.ts`                    | Replace two strategy calls with `runStrategies`          |
| Modify | `tests/deduplication.test.ts`     | Keep signature tests, remove `deduplicate` tests         |
| Modify | `tests/purge-errors.test.ts`      | Replace with `isStaleError` predicate tests              |
| Modify | `tests/commands-sweep.test.ts`    | No change needed (tests sweepCommand public interface)   |
| Create | `tests/strategy-runner.test.ts`   | Integration tests for runner (covers former dedup/purge) |

---

### Task 1: Write failing tests for the strategy runner

**Files:**

- Create: `tests/strategy-runner.test.ts`

- [x] **Step 1: Write runner integration tests**

```typescript
import { describe, it, expect } from "vitest";
import { runStrategies, sweepAll } from "../src/strategies/runner.ts";
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
    });
    state.toolIdList.push(e.id);
  }
}

describe("runStrategies", () => {
  it("deduplicates and purges errors in one call", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 100,
      },
      {
        id: "b1",
        tool: "another_tool",
        parameters: { path: "/b.ts" },
        status: "error",
        turn: 1,
        tokenCount: 200,
      },
    ]);

    const result = runStrategies(state, config);

    // a1 is a duplicate of a2 (same signature), should be pruned
    expect(state.prune.tools.has("a1")).toBe(true);
    expect(state.prune.tools.has("a2")).toBe(false);
    // b1 is an old error (turn 1, current turn 10, threshold 4)
    expect(state.prune.tools.has("b1")).toBe(true);
    expect(result.pruned).toBe(2);
    expect(result.tokensSaved).toBe(300);
  });

  it("respects disabled deduplication", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.deduplication.enabled = false;
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 100,
      },
    ]);

    const result = runStrategies(state, config);
    expect(result.pruned).toBe(0);
  });

  it("respects disabled purgeErrors", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.purgeErrors.enabled = false;
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "err1",
        tool: "custom_tool",
        parameters: {},
        status: "error",
        turn: 1,
        tokenCount: 200,
      },
    ]);

    const result = runStrategies(state, config);
    expect(result.pruned).toBe(0);
  });

  it("skips when manual mode active and automaticStrategies disabled", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.manualMode.automaticStrategies = false;
    state.manualMode = "active";
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 100,
      },
    ]);

    const result = runStrategies(state, config);
    expect(result.pruned).toBe(0);
  });

  it("skips empty toolIdList", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const result = runStrategies(state, config);
    expect(result.pruned).toBe(0);
    expect(result.tokensSaved).toBe(0);
  });

  it("skips protected tools (BASE_PROTECTED_TOOLS)", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "bash",
        parameters: { command: "ls" },
        status: "completed",
        turn: 1,
        tokenCount: 50,
      },
      {
        id: "a2",
        tool: "bash",
        parameters: { command: "ls" },
        status: "completed",
        turn: 2,
        tokenCount: 50,
      },
    ]);

    const result = runStrategies(state, config);
    expect(result.pruned).toBe(0);
  });

  it("skips tools operating on protected file paths", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.protectedFilePatterns = ["src/**/*.ts"];
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { filePath: "src/index.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { filePath: "src/index.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 100,
      },
    ]);

    const result = runStrategies(state, config);
    expect(result.pruned).toBe(0);
  });

  it("does not prune recent errors", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 5;

    seedToolCache(state, [
      {
        id: "err1",
        tool: "custom_tool",
        parameters: {},
        status: "error",
        turn: 3,
        tokenCount: 200,
      },
    ]);

    const result = runStrategies(state, config);
    expect(result.pruned).toBe(0);
  });

  it("updates stats correctly", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 50,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 50,
      },
    ]);

    runStrategies(state, config);
    expect(state.stats.totalPruneTokens).toBe(50);
    expect(state.stats.toolsPruned).toBe(1);
  });

  it("does not re-prune already-pruned tools", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 100,
      },
    ]);
    state.prune.tools.set("a1", 100); // already pruned

    const result = runStrategies(state, config);
    expect(result.pruned).toBe(0);
  });
});

describe("sweepAll", () => {
  it("prunes all non-protected completed tool outputs", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "another_tool",
        parameters: { path: "/b.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 200,
      },
      {
        id: "a3",
        tool: "list_dir",
        parameters: { path: "/" },
        status: "error",
        turn: 3,
        tokenCount: 50,
      },
    ]);

    const result = sweepAll(state, config);
    expect(result.pruned).toBe(2); // a1 and a2 (completed), not a3 (error)
    expect(result.tokensSaved).toBe(300);
    expect(state.prune.tools.has("a1")).toBe(true);
    expect(state.prune.tools.has("a2")).toBe(true);
    expect(state.prune.tools.has("a3")).toBe(false);
  });

  it("respects protected tools from config.compress.protectedTools", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ protectedTools: ["custom_tool"] });

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "another_tool",
        parameters: { path: "/b.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 200,
      },
    ]);

    const result = sweepAll(state, config);
    expect(result.pruned).toBe(1); // only a2
    expect(state.prune.tools.has("a1")).toBe(false);
    expect(state.prune.tools.has("a2")).toBe(true);
  });

  it("skips already-pruned tools", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
    ]);
    state.prune.tools.set("a1", 100); // already pruned

    const result = sweepAll(state, config);
    expect(result.pruned).toBe(0);
  });

  it("updates pruneTokenCounter (unique to sweep)", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
    ]);

    sweepAll(state, config);
    expect(state.stats.pruneTokenCounter).toBe(100);
    expect(state.stats.totalPruneTokens).toBe(100);
    expect(state.stats.toolsPruned).toBe(1);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/strategy-runner.test.ts`
Expected: FAIL — module `../src/strategies/runner.ts` does not exist

---

### Task 2: Implement the strategy runner

**Files:**

- Create: `src/strategies/runner.ts`

- [x] **Step 1: Write the runner**

```typescript
import { BASE_PROTECTED_TOOLS, type DcpConfig } from "../config.ts";
import type { SessionState } from "../state/types.ts";
import {
  isToolNameProtected,
  getFilePathsFromParameters,
  isFilePathProtected,
} from "./protected-patterns.ts";
import { createToolSignature } from "./deduplication.ts";
import { isStaleError } from "./purge-errors.ts";

export interface StrategyResult {
  pruned: number;
  tokensSaved: number;
}

/**
 * Run all enabled pruning strategies against the current tool cache.
 * Owns: guard checks, protected-tools resolution, eligibility filtering, stat bookkeeping.
 */
export function runStrategies(
  state: SessionState,
  config: DcpConfig,
): StrategyResult {
  if (state.toolIdList.length === 0) {
    return { pruned: 0, tokensSaved: 0 };
  }
  if (state.manualMode === "active" && !config.manualMode.automaticStrategies) {
    return { pruned: 0, tokensSaved: 0 };
  }

  let pruned = 0;
  let tokensSaved = 0;

  // --- Deduplication ---
  if (config.strategies.deduplication.enabled) {
    const protectedTools = [
      ...BASE_PROTECTED_TOOLS,
      ...config.strategies.deduplication.protectedTools,
    ];

    const unpruned = state.toolIdList.filter(
      (id) => !state.prune.tools.has(id),
    );

    // Group by signature
    const groups = new Map<string, string[]>();
    for (const callId of unpruned) {
      const entry = state.toolParameters.get(callId);
      if (!entry) continue;
      if (isToolNameProtected(entry.tool, protectedTools)) continue;

      const filePaths = getFilePathsFromParameters(
        entry.tool,
        entry.parameters as Record<string, unknown>,
      );
      if (isFilePathProtected(filePaths, config.protectedFilePatterns))
        continue;

      const sig = createToolSignature(entry.tool, entry.parameters);
      const group = groups.get(sig) ?? [];
      group.push(callId);
      groups.set(sig, group);
    }

    // Prune all but last in each group
    for (const [, callIds] of groups) {
      if (callIds.length <= 1) continue;
      for (let i = 0; i < callIds.length - 1; i++) {
        const callId = callIds[i];
        const entry = state.toolParameters.get(callId);
        const tokens = entry?.tokenCount ?? 0;
        state.prune.tools.set(callId, tokens);
        pruned++;
        tokensSaved += tokens;
      }
    }
  }

  // --- Purge Errors ---
  if (config.strategies.purgeErrors.enabled) {
    const protectedTools = [
      ...BASE_PROTECTED_TOOLS,
      ...config.strategies.purgeErrors.protectedTools,
    ];
    const turnThreshold = config.strategies.purgeErrors.turns;
    const unpruned = state.toolIdList.filter(
      (id) => !state.prune.tools.has(id),
    );

    for (const callId of unpruned) {
      const entry = state.toolParameters.get(callId);
      if (!entry) continue;
      if (!isStaleError(entry, state.currentTurn, turnThreshold)) continue;
      if (isToolNameProtected(entry.tool, protectedTools)) continue;

      const filePaths = getFilePathsFromParameters(
        entry.tool,
        entry.parameters as Record<string, unknown>,
      );
      if (isFilePathProtected(filePaths, config.protectedFilePatterns))
        continue;

      const tokens = entry.tokenCount ?? 0;
      state.prune.tools.set(callId, tokens);
      pruned++;
      tokensSaved += tokens;
    }
  }

  // Update stats once
  state.stats.totalPruneTokens += tokensSaved;
  state.stats.toolsPruned += pruned;

  return { pruned, tokensSaved };
}

/**
 * Sweep variant: prune all non-protected completed tool outputs.
 * Used by the dcp:sweep command.
 */
export function sweepAll(
  state: SessionState,
  config: DcpConfig,
): StrategyResult {
  const protectedTools = new Set([
    ...BASE_PROTECTED_TOOLS,
    ...config.compress.protectedTools,
  ]);

  let pruned = 0;
  let tokensSaved = 0;

  for (const [toolCallId, entry] of state.toolParameters) {
    if (state.prune.tools.has(toolCallId)) continue;
    if (protectedTools.has(entry.tool)) continue;
    if (entry.status !== "completed") continue;

    const tokens = entry.tokenCount ?? 0;
    state.prune.tools.set(toolCallId, tokens);
    pruned++;
    tokensSaved += tokens;
  }

  state.stats.toolsPruned += pruned;
  state.stats.totalPruneTokens += tokensSaved;
  state.stats.pruneTokenCounter += tokensSaved;

  return { pruned, tokensSaved };
}
```

- [x] **Step 2: Export `isStaleError` from purge-errors.ts (add only)**

Append to `src/strategies/purge-errors.ts` (do NOT remove existing code yet — runner tests need this export but existing tests still call `purgeErrors`):

```typescript
/**
 * Pure predicate: returns true if the entry is a stale error that should be purged.
 */
export function isStaleError(
  entry: {
    status: "pending" | "running" | "completed" | "error" | undefined;
    turn: number;
  },
  currentTurn: number,
  turnThreshold: number,
): boolean {
  if (entry.status !== "error") return false;
  return currentTurn - entry.turn >= turnThreshold;
}
```

- [x] **Step 3: Run runner tests**

Run: `pnpm vitest run tests/strategy-runner.test.ts`
Expected: All tests PASS

- [x] **Step 4: Run full check**

Run: `pnpm check`
Expected: PASS (existing tests still pass since old functions remain temporarily)

---

### Task 3: Wire callers to use the runner

**Files:**

- Modify: `src/commands/sweep.ts`
- Modify: `src/index.ts`

- [x] **Step 1: Replace sweep.ts with delegation**

Replace the entire file with:

```typescript
import type { SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { sweepAll } from "../strategies/runner.ts";

export function sweepCommand(state: SessionState, config: DcpConfig): string {
  const result = sweepAll(state, config);
  return `Sweep complete: ${result.pruned} tool outputs pruned, ~${result.tokensSaved} tokens saved.`;
}
```

- [x] **Step 2: Update index.ts imports**

Replace:

```typescript
import { deduplicate } from "./strategies/deduplication.ts";
import { purgeErrors } from "./strategies/purge-errors.ts";
```

With:

```typescript
import { runStrategies } from "./strategies/runner.ts";
```

- [x] **Step 3: Replace strategy calls in index.ts context handler**

Replace:

```typescript
// Step 3: Run strategies
const dedupResult = deduplicate(state, config);
const purgeResult = purgeErrors(state, config);

if (dedupResult.pruned > 0) {
  logger.info("dedup", "pruned duplicates", {
    count: dedupResult.pruned,
    tokens: dedupResult.tokensSaved,
  });
}
if (purgeResult.pruned > 0) {
  logger.info("purge", "pruned error inputs", {
    count: purgeResult.pruned,
    tokens: purgeResult.tokensSaved,
  });
}
```

With:

```typescript
// Step 3: Run strategies
const strategyResult = runStrategies(state, config);
if (strategyResult.pruned > 0) {
  logger.info("strategies", "pruned tool outputs", {
    count: strategyResult.pruned,
    tokens: strategyResult.tokensSaved,
  });
}
```

- [x] **Step 4: Run full check**

Run: `pnpm check`
Expected: PASS

---

### Task 4: Shrink strategy files to predicates

Now that no caller imports `deduplicate` or `purgeErrors`, remove them.

**Files:**

- Modify: `src/strategies/deduplication.ts`
- Modify: `src/strategies/purge-errors.ts`
- Modify: `tests/deduplication.test.ts`
- Modify: `tests/purge-errors.test.ts`

- [x] **Step 1: Replace deduplication.ts with signature utilities only**

Replace the entire file with:

```typescript
/**
 * Tool call signature utilities for deduplication.
 *
 * Creates deterministic signatures from tool name + parameters,
 * used by the strategy runner to group duplicate calls.
 */

export function createToolSignature(
  toolName: string,
  parameters: unknown,
): string {
  const normalized = normalizeParams(parameters);
  return `${toolName}::${JSON.stringify(normalized)}`;
}

export function normalizeParams(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizeParams);

  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = normalizeParams(obj[key]);
    if (v !== undefined) {
      sorted[key] = v;
    }
  }
  return sorted;
}
```

- [x] **Step 2: Replace purge-errors.ts with predicate only**

Replace the entire file with:

```typescript
/**
 * Staleness predicate for error tool results.
 *
 * Used by the strategy runner to identify error outputs
 * old enough to be pruned from context.
 */

export function isStaleError(
  entry: {
    status: "pending" | "running" | "completed" | "error" | undefined;
    turn: number;
  },
  currentTurn: number,
  turnThreshold: number,
): boolean {
  if (entry.status !== "error") return false;
  return currentTurn - entry.turn >= turnThreshold;
}
```

- [x] **Step 3: Update deduplication.test.ts**

Replace the entire file with (keep only signature tests):

```typescript
import { describe, expect, it } from "vitest";
import {
  createToolSignature,
  normalizeParams,
} from "../src/strategies/deduplication.ts";

describe("deduplication utilities", () => {
  describe("createToolSignature", () => {
    it("creates deterministic signature", () => {
      const sig1 = createToolSignature("read", { filePath: "/tmp/a.ts" });
      const sig2 = createToolSignature("read", { filePath: "/tmp/a.ts" });
      expect(sig1).toBe(sig2);
    });

    it("normalizes key order", () => {
      const sig1 = createToolSignature("edit", {
        filePath: "a",
        content: "b",
      });
      const sig2 = createToolSignature("edit", {
        content: "b",
        filePath: "a",
      });
      expect(sig1).toBe(sig2);
    });

    it("strips null/undefined values", () => {
      const sig1 = createToolSignature("read", { filePath: "a" });
      const sig2 = createToolSignature("read", {
        filePath: "a",
        extra: null,
      });
      expect(sig1).toBe(sig2);
    });
  });

  describe("normalizeParams", () => {
    it("returns undefined for null", () => {
      expect(normalizeParams(null)).toBeUndefined();
    });

    it("returns undefined for undefined", () => {
      expect(normalizeParams(undefined)).toBeUndefined();
    });

    it("passes through primitives", () => {
      expect(normalizeParams("hello")).toBe("hello");
      expect(normalizeParams(42)).toBe(42);
      expect(normalizeParams(true)).toBe(true);
    });

    it("recursively normalizes arrays", () => {
      expect(normalizeParams([{ b: 2, a: 1 }])).toEqual([{ a: 1, b: 2 }]);
    });

    it("sorts object keys and strips undefined values", () => {
      expect(normalizeParams({ z: 1, a: 2, m: undefined })).toEqual({
        a: 2,
        z: 1,
      });
    });
  });
});
```

- [x] **Step 4: Update purge-errors.test.ts**

Replace the entire file with (test the predicate directly):

```typescript
import { describe, expect, it } from "vitest";
import { isStaleError } from "../src/strategies/purge-errors.ts";

describe("isStaleError", () => {
  it("returns true for old errors past threshold", () => {
    const entry = { status: "error" as const, turn: 3 };
    expect(isStaleError(entry, 10, 4)).toBe(true);
  });

  it("returns false for recent errors within threshold", () => {
    const entry = { status: "error" as const, turn: 3 };
    expect(isStaleError(entry, 5, 4)).toBe(false);
  });

  it("returns false for errors exactly at threshold boundary", () => {
    const entry = { status: "error" as const, turn: 6 };
    // currentTurn=10, threshold=4, age=4: 4 >= 4 is true
    expect(isStaleError(entry, 10, 4)).toBe(true);
  });

  it("returns false for non-error entries", () => {
    const completed = { status: "completed" as const, turn: 1 };
    expect(isStaleError(completed, 10, 4)).toBe(false);

    const pending = { status: "pending" as const, turn: 1 };
    expect(isStaleError(pending, 10, 4)).toBe(false);
  });

  it("returns false for undefined status", () => {
    const entry = { status: undefined, turn: 1 };
    expect(isStaleError(entry, 10, 4)).toBe(false);
  });
});
```

- [x] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS — all tests pass, no lint errors, no type errors

---

### Task 5: Run integration tests and commit

- [x] **Step 1: Run integration tests**

Run: `pnpm vitest run tests/integration.test.ts`
Expected: PASS

- [x] **Step 2: Commit**

```bash
git add src/strategies/runner.ts src/strategies/deduplication.ts src/strategies/purge-errors.ts src/commands/sweep.ts src/index.ts tests/strategy-runner.test.ts tests/deduplication.test.ts tests/purge-errors.test.ts
git commit -m "refactor: deepen strategy module with runner entry point

Create src/strategies/runner.ts with runStrategies() and sweepAll()
as single entry points for all pruning strategies. Guards, protection
checks, and stat bookkeeping are centralized in the runner.

Strategy files shrink to pure predicates:
- deduplication.ts: createToolSignature + normalizeParams
- purge-errors.ts: isStaleError

index.ts and sweepCommand delegate to the runner.
No behavior change.

Generated with [Devin](https://cli.devin.ai/docs)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```
