# Phase 3: Deepen the Strategy Module

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/strategies/runner.ts` as a single entry point for all pruning strategies, encapsulating guard checks, protected-tools resolution, eligibility filtering, and stat bookkeeping.

**Architecture:** The runner owns the shared boilerplate (guards, protection checks, stat mutation). Individual strategy files (`deduplication.ts`, `purge-errors.ts`) shrink to exported predicates. `sweepCommand` delegates to a `sweepAll` function in the runner. `index.ts` replaces two strategy calls with one.

**Tech Stack:** TypeScript (strict mode), vitest, biome (lint)

**Behavior change:** None. Same tools get pruned under the same conditions.

**Prerequisite:** Phase 2 complete.

---

## File Map

| Action | File                              | Responsibility                                                           |
| ------ | --------------------------------- | ------------------------------------------------------------------------ |
| Create | `src/strategies/runner.ts`        | `runStrategies` and `sweepAll` entry points                              |
| Modify | `src/strategies/deduplication.ts` | Export `createToolSignature` and grouping predicate, remove guards/stats |
| Modify | `src/strategies/purge-errors.ts`  | Export age-check predicate, remove guards/stats                          |
| Modify | `src/commands/sweep.ts`           | Call `sweepAll` instead of reimplementing                                |
| Modify | `src/index.ts`                    | Replace two strategy calls with `runStrategies`                          |
| Modify | `tests/deduplication.test.ts`     | Update to test through runner or exported predicates                     |
| Modify | `tests/purge-errors.test.ts`      | Update to test through runner or exported predicates                     |
| Modify | `tests/commands-sweep.test.ts`    | Update import to `sweepAll`                                              |
| Create | `tests/strategy-runner.test.ts`   | Integration tests for the runner                                         |

---

### Task 1: Write failing tests for the strategy runner

**Files:**

- Create: `tests/strategy-runner.test.ts`

- [ ] **Step 1: Write runner integration tests**

```typescript
import { describe, it, expect } from "vitest";
import { runStrategies, sweepAll } from "../src/strategies/runner.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";
import type { SessionState } from "../src/state/types.ts";
import type { DcpConfig } from "../src/config.ts";

function seedToolCache(
  state: SessionState,
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
        tool: "read_file",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "read_file",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 100,
      },
      {
        id: "b1",
        tool: "write_file",
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
        tool: "read_file",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "read_file",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 100,
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
        tool: "read_file",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "read_file",
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

  it("updates stats correctly", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "read_file",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 50,
      },
      {
        id: "a2",
        tool: "read_file",
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
});

describe("sweepAll", () => {
  it("prunes all non-protected completed tool outputs", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    seedToolCache(state, [
      {
        id: "a1",
        tool: "read_file",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "write_file",
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
    const config = makeDefaultConfig({ protectedTools: ["read_file"] });

    seedToolCache(state, [
      {
        id: "a1",
        tool: "read_file",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "write_file",
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
        tool: "read_file",
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
        tool: "read_file",
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

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/strategy-runner.test.ts`
Expected: FAIL — module `../src/strategies/runner.ts` does not exist

---

### Task 2: Implement the strategy runner

**Files:**

- Create: `src/strategies/runner.ts`

- [ ] **Step 1: Write the runner**

```typescript
import { BASE_PROTECTED_TOOLS, type DcpConfig } from "../config.ts";
import type { SessionState } from "../state/types.ts";
import {
  isToolNameProtected,
  getFilePathsFromParameters,
  isFilePathProtected,
} from "./protected-patterns.ts";
import { createToolSignature } from "./deduplication.ts";

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
  // Common guards
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
      if (entry.status !== "error") continue;
      if (isToolNameProtected(entry.tool, protectedTools)) continue;

      const filePaths = getFilePathsFromParameters(
        entry.tool,
        entry.parameters as Record<string, unknown>,
      );
      if (isFilePathProtected(filePaths, config.protectedFilePatterns))
        continue;

      const turnAge = state.currentTurn - entry.turn;
      if (turnAge < turnThreshold) continue;

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

- [ ] **Step 2: Run runner tests**

Run: `pnpm vitest run tests/strategy-runner.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 4: Commit runner**

```bash
git add src/strategies/runner.ts tests/strategy-runner.test.ts
git commit -m "feat: add strategy runner with runStrategies and sweepAll

Single entry point for all pruning strategies. Centralizes guard
checks, protected-tools resolution, and stat bookkeeping.

Generated with [Devin](https://cli.devin.ai/docs)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 3: Shrink deduplication.ts to signature logic only

**Files:**

- Modify: `src/strategies/deduplication.ts`

- [ ] **Step 1: Remove deduplicate function, keep exports**

Replace the entire file content with:

```typescript
import { BASE_PROTECTED_TOOLS, type DcpConfig } from "../config.ts";
import type { SessionState } from "../state/types.ts";
import {
  isToolNameProtected,
  getFilePathsFromParameters,
  isFilePathProtected,
} from "./protected-patterns.ts";

export interface DeduplicationResult {
  pruned: number;
  tokensSaved: number;
}

/**
 * @deprecated Use runStrategies from ./runner.ts instead.
 * Retained temporarily for backward compatibility during transition.
 */
export function deduplicate(
  state: SessionState,
  config: DcpConfig,
): DeduplicationResult {
  if (!config.strategies.deduplication.enabled) {
    return { pruned: 0, tokensSaved: 0 };
  }

  if (state.manualMode === "active" && !config.manualMode.automaticStrategies) {
    return { pruned: 0, tokensSaved: 0 };
  }

  if (state.toolIdList.length === 0) {
    return { pruned: 0, tokensSaved: 0 };
  }

  const protectedTools = [
    ...BASE_PROTECTED_TOOLS,
    ...config.strategies.deduplication.protectedTools,
  ];

  const unpruned = state.toolIdList.filter((id) => !state.prune.tools.has(id));

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
    if (isFilePathProtected(filePaths, config.protectedFilePatterns)) continue;

    const sig = createToolSignature(entry.tool, entry.parameters);
    const group = groups.get(sig) ?? [];
    group.push(callId);
    groups.set(sig, group);
  }

  // For each group with duplicates, prune all but the last (most recent)
  let pruned = 0;
  let tokensSaved = 0;
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

  state.stats.totalPruneTokens += tokensSaved;
  state.stats.toolsPruned += pruned;

  return { pruned, tokensSaved };
}

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

Note: We keep the `deduplicate` function (marked deprecated) so existing tests still pass during this transition. The runner imports `createToolSignature` from this file. `normalizeParams` is now exported for testability.

- [ ] **Step 2: Run deduplication tests**

Run: `pnpm vitest run tests/deduplication.test.ts`
Expected: All tests PASS (function signature unchanged)

---

### Task 4: Update sweep.ts to use sweepAll

**Files:**

- Modify: `src/commands/sweep.ts`

- [ ] **Step 1: Replace implementation with delegation**

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

- [ ] **Step 2: Run sweep tests**

Run: `pnpm vitest run tests/commands-sweep.test.ts`
Expected: All tests PASS

---

### Task 5: Update index.ts to use runStrategies

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Update imports**

Replace lines 20-21:

```typescript
import { deduplicate } from "./strategies/deduplication.ts";
import { purgeErrors } from "./strategies/purge-errors.ts";
```

With:

```typescript
import { runStrategies } from "./strategies/runner.ts";
```

- [ ] **Step 2: Replace strategy calls**

Replace lines 208-223:

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

- [ ] **Step 3: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 4: Run integration tests**

Run: `pnpm vitest run tests/integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/strategies/runner.ts src/strategies/deduplication.ts src/commands/sweep.ts src/index.ts tests/strategy-runner.test.ts
git commit -m "refactor: route all strategy calls through runner.ts

index.ts now calls runStrategies() instead of deduplicate() + purgeErrors().
sweepCommand delegates to sweepAll(). Guards, protection checks, and stat
bookkeeping are centralized in the runner.

No behavior change.

Generated with [Devin](https://cli.devin.ai/docs)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```
