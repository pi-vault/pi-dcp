# Pi DCP Phase 2 Turn and Pair Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect the newest raw user turns consistently and preserve Pi-compatible assistant tool-call/result structure during every DCP transformation.

**Architecture:** Derive tool age from raw user-message order during every cache synchronization. Use one protected message boundary for pruning, sweep, and both compression modes. Normal compression selections expand to complete tool pairs; the existing one-way orphan-result cleanup remains only as a safety net for stale or corrupt state.

**Tech Stack:** TypeScript ESM, TypeBox, Vitest, pnpm, generated JSON Schema, and Pi agent message types.

---

## Entry Conditions and Scope

- Phase 1 is complete at the current merge commit; its handoff guarantees failed-input pruning and the protected default tool set.
- Preserve the source roadmap unchanged: `docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md`.
- Do not change compression ownership, nesting/accounting, lifecycle snapshots, trusted project configuration, or manual compression command design; those belong to Phases 3–5.
- `turnProtection: 0` preserves current behavior. Positive values are a hard boundary for deduplication, stale-error pruning, sweep, range compression, and message compression.
- The repository baseline is 377 passing tests, successful typechecking, lint success with 88 warnings and 1 info, a successful package dry-run, and a stable generated schema.

## Public Interfaces

- Add `DcpConfig.turnProtection: number`, restricted to non-negative integers, default `0`.
- Replace `ToolParameterEntry.turn` with `userTurn`.
- Replace `SessionState.currentTurn` with runtime-only `currentUserTurn`.
- Add `getProtectedTurnStart(messages, turns): number | undefined`.
- Keep `strategies.deduplication.turnProtection` as a legacy dedup-only setting; deduplication uses the larger of the two values.

### Task 1: Add the top-level configuration contract

**Files:**

- Modify: `src/config-schema.ts`, `src/config.ts`, `dcp.schema.json`
- Test: `tests/config.test.ts`, `tests/helpers.ts`

- [x] **Step 1: Add failing configuration tests**

  Add tests for the default, a positive value, and invalid negative input:

  ```ts
  it("defaults top-level turn protection to zero", () => {
    expect(
      loadConfig(path.join(tempDir, "missing.json")).config.turnProtection,
    ).toBe(0);
  });

  it("accepts a non-negative top-level turn protection", () => {
    const file = path.join(tempDir, "dcp.json");
    fs.writeFileSync(file, JSON.stringify({ turnProtection: 2 }));
    expect(loadConfig(file).config.turnProtection).toBe(2);
  });

  it("resets a negative top-level turn protection", () => {
    const file = path.join(tempDir, "dcp.json");
    fs.writeFileSync(file, JSON.stringify({ turnProtection: -1 }));
    const result = loadConfig(file);
    expect(result.config.turnProtection).toBe(0);
    expect(
      result.warnings.some((warning) => warning.includes("turnProtection")),
    ).toBe(true);
  });
  ```

- [x] **Step 2: Confirm the tests fail**

  Run `pnpm vitest run tests/config.test.ts -t "top-level turn protection"`.

  Expected: failure because `DcpConfig` has no top-level property.

- [x] **Step 3: Add the schema property once**

  Add this property to `DcpConfigSchema`:

  ```ts
  turnProtection: Type.Integer({
    default: 0,
    minimum: 0,
    description: "Protect the newest N user turns from all DCP transformations",
  }),
  ```

  Let `Value.Create` populate `DEFAULT_CONFIG`; do not add a second parser or compatibility alias. Add `turnProtection: 0` to hand-built `makeDefaultConfig()` fixtures.

- [x] **Step 4: Regenerate and verify the schema**

  Run `pnpm run generate:schema` and `pnpm vitest run tests/config.test.ts`.

  Expected: configuration tests pass and `dcp.schema.json` contains the default and minimum.

- [x] **Step 5: Commit the configuration contract**

  ```bash
  git add src/config-schema.ts src/config.ts dcp.schema.json tests/config.test.ts tests/helpers.ts
  git commit -m "feat: add global user-turn protection"
  ```

### Task 2: Derive tool age from raw user turns

**Files:**

- Modify: `src/state/types.ts`, `src/state/state.ts`, `src/state/tool-cache.ts`, `src/state/persistence.ts`
- Modify: `src/index.ts`, `src/commands/context.ts`
- Test: `tests/tool-cache.test.ts`, `tests/state.test.ts`, `tests/persistence.test.ts`, `tests/pipeline.test.ts`, `tests/integration.test.ts`, `tests/commands-context.test.ts`
- Update fixtures: `tests/helpers.ts`, `tests/prune.test.ts`, `tests/purge-errors.test.ts`, `tests/compress-search.test.ts`, `tests/commands-sweep.test.ts`

- [x] **Step 1: Add failing ordinal and rebuild tests**

  Use raw messages containing two tool calls in one user turn and a third call after the next user message:

  ```ts
  syncToolCache(state, messages);
  expect(state.toolParameters.get("call-1")?.userTurn).toBe(1);
  expect(state.toolParameters.get("call-2")?.userTurn).toBe(1);
  expect(state.toolParameters.get("call-3")?.userTurn).toBe(2);
  expect(state.currentUserTurn).toBe(2);
  ```

  Also call `syncToolCache()` twice, first with a pending call and then with its result, and assert that status, token count, and indices refresh rather than preserving stale metadata.

- [x] **Step 2: Replace iteration metadata**

  Change the age fields:

  ```ts
  // ToolParameterEntry
  userTurn: number;

  // SessionState
  currentUserTurn: number;
  ```

  Initialize and reset `currentUserTurn` to `0`. In `syncToolCache()`, clear `state.toolParameters`, count raw `user` messages in order, assign the current ordinal to each assistant `toolCall`, and set `state.currentUserTurn` to the final ordinal. Keep the existing result token/error/index collection.

- [x] **Step 3: Remove the old lifecycle and sidecar counter**

  Delete the `turn_end` listener that increments `currentTurn`. Remove `currentTurn` from sidecar serialization, restoration, and logging. Legacy sidecars may still restore stats, message IDs, nudges, and compaction time, but their discarded counter must not affect protection.

- [x] **Step 4: Update observability and fixtures**

  Change `/dcp:context` to emit `Current user turn: ${state.currentUserTurn}`. Migrate every fixture field from `turn` to `userTurn` and every manual state assignment from `currentTurn` to `currentUserTurn`. Keep test histories raw-user-message driven where pipeline behavior is being tested.

- [x] **Step 5: Run state-focused verification**

  Run:

  ```bash
  pnpm vitest run tests/tool-cache.test.ts tests/state.test.ts tests/persistence.test.ts tests/pipeline.test.ts tests/integration.test.ts tests/commands-context.test.ts
  ```

  Expected: deterministic rebuilds, refreshed result metadata, no persisted counter, and the renamed context output.

- [x] **Step 6: Commit user-turn metadata**

  ```bash
  git add src/state src/index.ts src/commands/context.ts tests
  git commit -m "fix: derive tool age from user turns"
  ```

### Task 3: Apply the hard boundary to pruning and sweep

**Files:**

- Modify: `src/strategies/runner.ts`, `src/strategies/purge-errors.ts`
- Test: `tests/strategy-runner.test.ts`, `tests/turn-protection.test.ts`, `tests/purge-errors.test.ts`, `tests/commands-sweep.test.ts`

- [x] **Step 1: Rewrite the existing protection tests around user ordinals**

  Replace the current agent-iteration fixtures with raw-user-turn equivalents. Cover:
  - global `0` preserves existing dedup behavior;
  - dedup uses `Math.max(global, legacy)`;
  - stale-error pruning still requires its configured threshold;
  - global protection prevents stale-error pruning inside the window;
  - sweep skips recent completed results;
  - fewer historical user turns than configured protects every existing user turn.

- [x] **Step 2: Use user-turn age in strategies**

  Deduplication must use:

  ```ts
  const protectedTurns = Math.max(
    config.turnProtection,
    config.strategies.deduplication.turnProtection,
  );
  const age = state.currentUserTurn - entry.userTurn;
  if (age < protectedTurns) continue;
  ```

  Stale errors must use `state.currentUserTurn` and `entry.userTurn`, with the effective threshold equal to the larger of `purgeErrors.turns` and `config.turnProtection`. Sweep must skip entries whose age is less than `config.turnProtection`.

- [x] **Step 3: Run the pruning suite**

  Run `pnpm vitest run tests/strategy-runner.test.ts tests/turn-protection.test.ts tests/purge-errors.test.ts tests/commands-sweep.test.ts`.

  Expected: all strategy paths honor their documented effective value.

- [x] **Step 4: Commit unified pruning protection**

  ```bash
  git add src/strategies/runner.ts src/strategies/purge-errors.ts tests/strategy-runner.test.ts tests/turn-protection.test.ts tests/purge-errors.test.ts tests/commands-sweep.test.ts
  git commit -m "fix: protect recent user turns during pruning"
  ```

### Task 4: Define protected boundaries and preserve Pi tool pairs

**Files:**

- Modify: `src/compress/search.ts`, `src/compress/handler.ts`, `src/messages/prune.ts`
- Test: `tests/compress-search.test.ts`, `tests/compress-range.test.ts`, `tests/compress-message.test.ts`, `tests/prune.test.ts`, `tests/turn-protection.test.ts`

- [x] **Step 1: Add boundary tests**

  Cover zero turns, empty history, one protected turn, fewer turns than configured, and a range that begins before but ends inside the protected window:

  ```ts
  expect(getProtectedTurnStart(messages, 0)).toBeUndefined();
  expect(getProtectedTurnStart(messages, 1)).toBe(lastUserIndex);
  expect(getProtectedTurnStart(messages, 99)).toBe(firstUserIndex);
  ```

- [x] **Step 2: Add the shared helper**

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

- [x] **Step 3: Enforce the boundary before compression mutation**

  In `handleCompress()`, compute `protectedStart` once from raw `messages`, normalize all entries first, and reject if any resolved selection has `endIndex >= protectedStart`. Route message-mode targets through `resolveSelection(messages, index, index, state)` so they expand to complete tool groups. Reject protected or overlapping selections before allocating a run or block ID.

- [x] **Step 4: Preserve Pi-compatible fallback behavior**

  Keep `removeOrphanedToolResults()` as a one-way cleanup after DCP filtering. Do not remove assistant `toolCall` parts when their result is absent; Pi’s provider transform inserts an error result. Add tests proving an orphan result is removed and an unmatched assistant call survives.

- [x] **Step 5: Run compression and pair tests**

  Run:

  ```bash
  pnpm vitest run tests/compress-search.test.ts tests/compress-range.test.ts tests/compress-message.test.ts tests/prune.test.ts tests/turn-protection.test.ts
  ```

  Expected: old selections succeed, protected overlap fails atomically, both compression modes expand pairs, and fallback normalization remains one-way.

- [x] **Step 6: Commit pair-safe compression**

  ```bash
  git add src/compress/search.ts src/compress/handler.ts src/messages/prune.ts tests/compress-search.test.ts tests/compress-range.test.ts tests/compress-message.test.ts tests/prune.test.ts tests/turn-protection.test.ts
  git commit -m "fix: enforce compression turn and pair safety"
  ```

### Task 5: Document and release Phase 2

**Files:**

- Modify: `README.md`, `CHANGELOG.md`, `dcp.schema.json`
- Modify: `docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md`
- Test: one raw-message integration fixture in `tests/integration.test.ts`

- [x] **Step 1: Document the released semantics**

  Describe top-level `turnProtection`, raw user-turn counting, the legacy deduplication maximum, fewer-turn behavior, all-path enforcement, pair-complete compression, and Pi’s unmatched-call normalization.

- [x] **Step 2: Run the independent integration check**

  Configure `turnProtection: 1` in a fixture containing an older turn and a newest user/tool turn. Assert that older eligible content transforms while the newest user turn and its tool-call/result group remain intact.

- [x] **Step 3: Run final verification**

  ```bash
  pnpm run generate:schema
  git diff --exit-code -- dcp.schema.json
  pnpm test
  pnpm typecheck
  pnpm lint
  pnpm pack --dry-run
  git diff --check
  git diff --exit-code HEAD -- docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md
  ```

  Expected: 377 or more passing tests, no type errors, no lint diagnostics above the baseline, stable schema, successful package dry-run, and unchanged source roadmap.

- [x] **Step 4: Record completion**

  Mark Phase 2 `complete` in the phased roadmap, record the implementation commit and verification date in this plan, then commit:

  ```bash
  git add README.md CHANGELOG.md dcp.schema.json docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md docs/superpowers/plans/2026-07-28-pi-dcp-phase-2-turn-and-pair-safety.md tests/integration.test.ts
  git commit -m "docs: release turn and pair safety"
  ```

## Acceptance Criteria

- Top-level protection defaults to `0` and preserves existing behavior.
- User-turn ordinals rebuild deterministically from raw messages and are not persisted.
- Dedup, stale-error pruning, sweep, and both compression modes enforce the hard boundary.
- Protected compression batches fail atomically.
- Overlapping expanded compression selections fail atomically.
- Normal DCP compression does not split assistant/tool-result pairs.
- DCP removes orphan results it creates but leaves unmatched assistant calls for Pi normalization.
- README, schema, changelog, and phase index describe the released behavior.
- Full and focused verification pass without Phase 3–5 code.

## Handoff to Phase 3

Phase 3 may rely on `ToolParameterEntry.userTurn`, runtime `SessionState.currentUserTurn`, `DcpConfig.turnProtection`, `getProtectedTurnStart()`, and pair-complete selection with atomic protected-range rejection. Phase 3 must not change the meaning of user-turn protection.

## Release Record

- Status: complete
- Release commit or tag: implementation range `605db9a^..6534710` (the final release-record commit does not self-reference)
- Verification date: 2026-07-28
- Verification: schema regenerated; 399 tests, typecheck, lint (84 warnings and 1 info), package, and diff checks passed under Node 23.11.0 (the package requires Node 24.15.0 or newer).
