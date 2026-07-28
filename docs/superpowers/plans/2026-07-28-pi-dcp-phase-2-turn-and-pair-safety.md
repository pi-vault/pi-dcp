# Pi DCP Phase 2 Turn and Pair Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect the newest user turns consistently and preserve Pi-compatible assistant tool-call/result structure during every automatic DCP transformation.

**Architecture:** Derive tool age from raw user-message order during cache synchronization. Use one top-level protection boundary for general transformations, retain the legacy deduplication override, and centralize range rejection around the same message boundary.

**Tech Stack:** TypeScript ESM, TypeBox, Vitest, pnpm, generated JSON Schema, and Pi agent message types.

---

## Source, Prerequisite, and Boundaries

- Source roadmap: remaining safety work from Task 4 in [2026-07-28-pi-dcp-reliability-roadmap.md](2026-07-28-pi-dcp-reliability-roadmap.md).
- Prerequisite: [Phase 1](2026-07-28-pi-dcp-phase-1-pruning-foundation.md) is released and its full verification passes.
- This phase does not change compression ownership, nested-block accounting, lifecycle persistence, project configuration, or manual compression.

## Stable Outcome

After this phase:

- `turnProtection: 0` preserves current behavior by default.
- Positive protection values cover the newest raw user turns, not agent iterations.
- Deduplication uses the larger of top-level and legacy protection values.
- Stale-error pruning, sweep, and compression use the top-level value.
- DCP removes orphan results it creates but leaves unmatched assistant tool calls for Pi to normalize.
- The shipped schema and README describe the effective rules.

### Task 1: Add the top-level configuration contract

**Files:**

- Modify: `src/config-schema.ts`, `src/config.ts`
- Regenerate: `dcp.schema.json`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Add failing default and validation tests**

  Add to `tests/config.test.ts`:

  ```ts
  it("defaults top-level turn protection to zero", () => {
    const { config } = loadConfig(path.join(tempDir, "missing.json"));
    expect(config.turnProtection).toBe(0);
  });

  it("accepts a non-negative top-level turn protection", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, JSON.stringify({ turnProtection: 2 }));
    expect(loadConfig(configPath).config.turnProtection).toBe(2);
  });
  ```

- [ ] **Step 2: Confirm the setting is absent**

  ```bash
  pnpm vitest run tests/config.test.ts -t "top-level turn protection"
  ```

  Expected: FAIL because `DcpConfig` has no top-level `turnProtection`.

- [ ] **Step 3: Define the setting once**

  In `src/config-schema.ts`, add:

  ```ts
  turnProtection: Type.Number({
    default: 0,
    minimum: 0,
    description:
      "Protect the newest N user turns from all automatic DCP transformations",
  }),
  ```

  Update `DEFAULT_CONFIG` only as required by the schema-derived type. Do not add a second parser or compatibility alias.

- [ ] **Step 4: Regenerate and test the schema**

  ```bash
  pnpm run generate:schema
  pnpm vitest run tests/config.test.ts
  ```

  Expected: config tests pass and `dcp.schema.json` contains a non-negative top-level `turnProtection` defaulting to `0`.

- [ ] **Step 5: Commit the configuration contract**

  ```bash
  git add src/config-schema.ts src/config.ts dcp.schema.json tests/config.test.ts
  git commit -m "feat: add global user-turn protection"
  ```

### Task 2: Derive tool age from raw user turns

**Files:**

- Modify: `src/state/types.ts`, `src/state/state.ts`, `src/state/tool-cache.ts`
- Modify: `src/state/persistence.ts`, `src/index.ts`
- Test: `tests/tool-cache.test.ts`, `tests/persistence.test.ts`, `tests/integration.test.ts`

- [ ] **Step 1: Add failing ordinal tests**

  Add focused fixtures to `tests/tool-cache.test.ts` that contain two tool calls in one user turn and another call after the next user message:

  ```ts
  syncToolCache(state, messages);

  expect(state.toolParameters.get("call-1")?.userTurn).toBe(1);
  expect(state.toolParameters.get("call-2")?.userTurn).toBe(1);
  expect(state.toolParameters.get("call-3")?.userTurn).toBe(2);
  expect(state.currentUserTurn).toBe(2);
  ```

  Add a second test that calls `syncToolCache()` twice and proves the ordinals are rebuilt from message history rather than incremented.

- [ ] **Step 2: Confirm agent-iteration age fails the test**

  ```bash
  pnpm vitest run tests/tool-cache.test.ts -t "user turn"
  ```

  Expected: FAIL because entries expose `turn` and state exposes `currentTurn`.

- [ ] **Step 3: Replace iteration metadata**

  In `src/state/types.ts`, replace only the age field:

  ```ts
  // Remove:
  turn: number;

  // Add:
  userTurn: number;
  ```

  Replace `SessionState.currentTurn` with runtime-only `currentUserTurn: number`. Initialize it to `0`.

  In `syncToolCache()`, clear and rebuild the derived tool cache. Increment a local ordinal only when a raw message has `role === "user"`, assign it to each following assistant tool call, and copy the final value to `state.currentUserTurn`.

- [ ] **Step 4: Remove the old lifecycle and persistence paths**

  Delete the `turn_end` listener that increments `currentTurn`. Remove `currentTurn` from sidecar serialization and restoration. Legacy sidecars may still load their other fields in this phase, but the discarded counter must not affect protection.

  Update test helpers and fixtures from `turn` to `userTurn`.

- [ ] **Step 5: Run focused state tests**

  ```bash
  pnpm vitest run tests/tool-cache.test.ts tests/persistence.test.ts tests/integration.test.ts
  ```

  Expected: user-turn ordinals rebuild deterministically, lifecycle tests no longer expect `turn_end` increments, and persistence ignores the removed counter.

- [ ] **Step 6: Commit user-turn metadata**

  ```bash
  git add src/state src/index.ts tests/tool-cache.test.ts tests/persistence.test.ts tests/integration.test.ts
  git commit -m "fix: derive tool age from user turns"
  ```

### Task 3: Define one protected message boundary

**Files:**

- Modify: `src/compress/search.ts`
- Create: `tests/turn-protection.test.ts`

- [ ] **Step 1: Add boundary tests**

  Cover zero turns, fewer existing turns than requested, and multiple messages within a turn:

  ```ts
  expect(getProtectedTurnStart(messages, 0)).toBeUndefined();
  expect(getProtectedTurnStart(messages, 1)).toBe(lastUserIndex);
  expect(getProtectedTurnStart(messages, 99)).toBe(firstUserIndex);
  ```

- [ ] **Step 2: Confirm the helper is missing**

  ```bash
  pnpm vitest run tests/turn-protection.test.ts
  ```

  Expected: FAIL because `getProtectedTurnStart` does not exist.

- [ ] **Step 3: Add the boundary helper**

  In `src/compress/search.ts`:

  ```ts
  export function getProtectedTurnStart(
    messages: AgentMessage[],
    turns: number,
  ): number | undefined {
    if (turns <= 0) return undefined;
    const userIndices = messages.flatMap((message, index) =>
      message.role === "user" ? [index] : [],
    );
    return userIndices[Math.max(0, userIndices.length - turns)];
  }
  ```

  An empty history returns `undefined`; a history with fewer user turns than requested protects from its first user message.

- [ ] **Step 4: Run the helper tests**

  ```bash
  pnpm vitest run tests/turn-protection.test.ts
  ```

  Expected: all boundary cases pass.

- [ ] **Step 5: Commit the shared boundary**

  ```bash
  git add src/compress/search.ts tests/turn-protection.test.ts
  git commit -m "test: define protected user-turn boundary"
  ```

### Task 4: Apply protection and pair safety everywhere

**Files:**

- Modify: `src/strategies/runner.ts`, `src/messages/prune.ts`
- Modify: `src/compress/search.ts`, `src/compress/handler.ts`
- Test: `tests/strategy-runner.test.ts`, `tests/prune.test.ts`
- Test: `tests/turn-protection.test.ts`, `tests/compress-range.test.ts`

- [ ] **Step 1: Add failing transformation tests**

  Prove:

  - deduplication protects `Math.max(config.turnProtection, config.strategies.deduplication.turnProtection)`;
  - stale-error pruning and sweep protect `config.turnProtection`;
  - a compression range that starts before but overlaps the protected boundary is rejected;
  - fewer historical turns than configured protects all existing user turns;
  - DCP-created orphan results are removed;
  - unmatched assistant tool calls remain so Pi can insert provider error results.

- [ ] **Step 2: Confirm inconsistent protection**

  ```bash
  pnpm vitest run tests/strategy-runner.test.ts tests/prune.test.ts tests/turn-protection.test.ts tests/compress-range.test.ts
  ```

  Expected: at least the stale-error, sweep, compression-overlap, and unmatched-assistant cases fail.

- [ ] **Step 3: Use user-turn age in strategies**

  Replace comparisons against `currentTurn` and `entry.turn` with:

  ```ts
  const age = state.currentUserTurn - entry.userTurn;
  ```

  Deduplication uses:

  ```ts
  const protectedTurns = Math.max(
    config.turnProtection,
    config.strategies.deduplication.turnProtection,
  );
  ```

  Stale-error pruning and sweep use only `config.turnProtection`.

- [ ] **Step 4: Reject protected compression ranges**

  Compute `protectedStart` once from the raw messages before resolving compression inputs. Reject any resolved range whose `endIndex` is at or beyond that boundary. Do not partially trim a requested range.

- [ ] **Step 5: Preserve Pi-compatible pairs**

  Keep the existing orphan-`toolResult` cleanup after DCP filtering. Remove any cleanup that drops unmatched assistant tool-call parts. Ensure range expansion includes both sides of every tool pair it touches, so DCP itself does not create either orphan direction.

- [ ] **Step 6: Run the safety suite**

  ```bash
  pnpm vitest run tests/strategy-runner.test.ts tests/prune.test.ts tests/turn-protection.test.ts tests/compress-range.test.ts
  ```

  Expected: every transformation respects the configured boundary and pair-safety cases pass.

- [ ] **Step 7: Commit unified safety behavior**

  ```bash
  git add src/strategies/runner.ts src/messages/prune.ts src/compress/search.ts src/compress/handler.ts tests/strategy-runner.test.ts tests/prune.test.ts tests/turn-protection.test.ts tests/compress-range.test.ts
  git commit -m "fix: protect recent user turns consistently"
  ```

### Task 5: Document and release Phase 2

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md`

- [ ] **Step 1: Document configuration and semantics**

  Explain top-level `turnProtection`, the legacy deduplication override, raw user-turn counting, behavior when fewer turns exist, and Pi-compatible unmatched-call normalization.

- [ ] **Step 2: Run configuration consistency checks**

  ```bash
  pnpm run generate:schema
  git diff --exit-code -- dcp.schema.json
  ```

  Expected: regeneration is clean after intentional schema changes are staged.

- [ ] **Step 3: Run full phase verification**

  ```bash
  pnpm test
  pnpm typecheck
  pnpm lint
  pnpm pack --dry-run
  git diff --check
  git diff --exit-code HEAD -- docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md
  ```

  Expected: all commands pass; lint adds no diagnostics above the Phase 1 baseline; the source roadmap is unchanged.

- [ ] **Step 4: Prove the phase is independently usable**

  Run one integration fixture with `turnProtection: 1` and verify stale content before the last user turn is transformed while the last turn and its tool pairs remain intact.

- [ ] **Step 5: Commit the Phase 2 release**

  ```bash
  git add README.md CHANGELOG.md dcp.schema.json docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md
  git commit -m "docs: release turn and pair safety"
  ```

## Acceptance Criteria

- Top-level protection defaults to `0` and preserves previous behavior.
- Raw user turns, not agent iterations, determine tool age.
- All automatic transformation paths enforce the documented effective value.
- Protected compression ranges fail atomically.
- DCP preserves Pi’s expected assistant-call/result normalization behavior.
- Focused and full verification pass without Phase 3–5 code.
- README, schema, and release notes describe the released behavior.

## Handoff to Phase 3

Phase 3 may rely on:

- `ToolParameterEntry.userTurn`;
- runtime `SessionState.currentUserTurn`;
- `DcpConfig.turnProtection`;
- `getProtectedTurnStart(messages, turns)`;
- pair-complete compression selection and atomic protected-range rejection.

Phase 3 must not change the meaning of user-turn protection.

## Release Record

- Status: not started
- Release commit or tag: not recorded
- Verification date: not recorded
