# Pi DCP Phase 3 Compression Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make in-session compression ownership, batch validation, nesting, visible-token accounting, and timing deterministic and correct.

**Architecture:** Prepare every compression entry completely before mutating state, then commit the prepared batch once. Selection closes over Pi tool-call/result pairs and active compression blocks to a fixed point; one derived-state rebuild maintains visibility and relationships. Blocks own the real compression `toolCallId` and content-derived message keys, while numeric indices remain runtime caches for the current process.

**Tech Stack:** TypeScript ESM, Vitest, pnpm, Pi `AgentMessage` types, TypeBox tool registration, and the existing token estimator.

---

## Source, Prerequisite, and Boundaries

- Source requirement: Task 3 in [2026-07-28-pi-dcp-reliability-roadmap.md](2026-07-28-pi-dcp-reliability-roadmap.md).
- Prerequisite: [Phase 2](2026-07-28-pi-dcp-phase-2-turn-and-pair-safety.md) is released. The current branch passes 399 tests, typecheck, lint, package dry-run, and diff checks; local Node 23.11.0 reports the existing Node >=24.15.0 engine warning.
- Stable block keys are the exact `getMessageKey()` values (`user:<timestamp>:<counter>` or `toolResult:<toolCallId>`), not visible refs such as `m0001`. Phase 4 will serialize these keys and rehydrate their numeric indices.
- This phase guarantees only the running process. Resume, fork, tree, compaction restoration, lifetime scanning, project config, manual compression, and benchmarks remain Phase 4/5 work.
- The source reliability roadmap remains byte-for-byte unchanged.

## File Responsibilities

- `src/state/types.ts`, `src/state/state.ts`: block and timing contracts plus initialization/reset behavior.
- `src/compress/search.ts`, `src/compress/handler.ts`: boundary resolution, fixed-point selection, batch preparation, and result aggregation.
- `src/compress/state.ts`, `src/messages/sync.ts`, `src/messages/prune.ts`: commit, derived-state rebuild, owner-aware synchronization, and visible filtering.
- `src/commands/decompress.ts`, `src/commands/recompress.ts`, `src/index.ts`, `src/pipeline.ts`: command mutations, real tool-call ownership, and timing event flow.
- Existing compression, sync, command, notification, integration, and shared fixture tests are updated in place; no new dependency or second block type is introduced.

## Public Contract

```ts
export function handleCompress(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  compressToolCallId: string,
  args: CompressArgs,
): CompressResult;

export interface SelectionResult {
  startIndex: number;
  endIndex: number;
  messageIndices: number[];
  toolIds: string[];
  consumedBlockIds: number[];
}

export interface CompressionTimingState {
  startTimes: Map<string, number>;
}
```

`CompressionBlock` removes `compressMessageIndex` and the unused `includedBlockIds`, and adds `compressToolCallId`, `startKey`, `endKey`, and `anchorKey`. It retains numeric indices, direct/effective memberships, `consumedBlockIds`, `parentBlockIds`, `deactivatedByUser`, and `deactivatedByBlockId`.

### Task 1: Replace positional ownership and timing contracts

**Files:**

- Modify: `src/state/types.ts`, `src/state/state.ts`, `src/compress/state.ts`
- Modify: `src/compress/handler.ts`, `src/index.ts`, `src/pipeline.ts`, `src/messages/sync.ts`
- Test: `tests/helpers.ts`, `tests/compress-range.test.ts`, `tests/compress-state.test.ts`, `tests/sync.test.ts`, `tests/compression-timing.test.ts`

- [ ] **Step 1: Add failing ownership and timing assertions.**

  Extend the shared block fixture so a valid block contains the new fields and no `compressMessageIndex` or `includedBlockIds`. Add assertions such as:

  ```ts
  expect(block.compressToolCallId).toBe("compress-call-1");
  expect(block.startKey).toBe("user:1000:0");
  expect(block.endKey).toBe("assistant:1001:0");
  expect(block.anchorKey).toBe("user:1000:0");
  ```

  Add a type-level fixture that calls `handleCompress(state, config, messages, "compress-call-1", args)` and add a timing fixture with `callIdToBlockId` and `pendingDurations` removed.

- [ ] **Step 2: Run the contract tests and confirm the expected failure.**

  Run:

  ```bash
  pnpm vitest run tests/compress-range.test.ts tests/compress-state.test.ts tests/sync.test.ts tests/compression-timing.test.ts
  pnpm typecheck
  ```

  Expected: failures identify the old handler signature, positional ownership fields, and obsolete timing maps.

- [ ] **Step 3: Change the state and handler contracts.**

  Replace the block/timing declarations with the approved fields. Change both registered tool callbacks in `src/index.ts` to pass their `_toolCallId` into `handleCompress`. Change `applyCompressionState` to accept prepared block data rather than `compressMessageIndex`.

  Keep `startTimes` only. Remove `applyPendingCompressionDurations` and its pipeline call; timing is applied directly from the end event in Task 4.

- [ ] **Step 4: Make synchronization consume real messages.**

  Change the signature to:

  ```ts
  export function syncCompressionBlocks(
    state: SessionState,
    messages: AgentMessage[],
  ): void;
  ```

  Build the owner set from assistant `toolCall` IDs in `messages`. Blocks whose `compressToolCallId` is absent become ineligible and inactive. Blocks with a present owner and no user deactivation become eligible for derived-state rebuilding. Update the pipeline so `syncToolCache(state, messages)` runs before `syncCompressionBlocks(state, messages)`.

- [ ] **Step 5: Run the updated contract tests.**

  ```bash
  pnpm vitest run tests/compress-range.test.ts tests/compress-state.test.ts tests/sync.test.ts tests/compression-timing.test.ts
  pnpm typecheck
  ```

  Expected: all updated fixtures compile; ownership is the real call ID; synchronization no longer depends on an array position; timing state contains only start timestamps.

- [ ] **Step 6: Commit the contract change.**

  ```bash
  git add src/state/types.ts src/state/state.ts src/compress/state.ts src/compress/handler.ts src/messages/sync.ts src/pipeline.ts src/index.ts tests/helpers.ts tests/compress-range.test.ts tests/compress-state.test.ts tests/sync.test.ts tests/compression-timing.test.ts
  git commit -m "refactor: give compression blocks real ownership"
  ```

### Task 2: Prepare complete selections without mutation

**Files:**

- Modify: `src/compress/search.ts`, `src/compress/handler.ts`
- Test: `tests/compress-range.test.ts`, `tests/compress-search.test.ts`

- [ ] **Step 1: Add failing fixed-point and atomicity tests.**

  Add tests for:

  ```ts
  const before = snapshotCompressionState(state);
  expect(() =>
    handleCompress(state, config, messages, "compress-call-1", {
      mode: "range",
      topic: "batch",
      content: [
        { startId: "m0001", endId: "m0002", summary: "valid" },
        { startId: "m9999", endId: "m0002", summary: "invalid" },
      ],
    }),
  ).toThrow(/not available/i);
  expect(snapshotCompressionState(state)).toEqual(before);
  ```

  Add a multi-tool assistant case where the range starts on result B; the resolved selection must include the assistant, result A, and result B. Add a batch whose ranges overlap only after an active block expands one of them.

- [ ] **Step 2: Run the new tests and confirm the old behavior fails.**

  ```bash
  pnpm vitest run tests/compress-range.test.ts tests/compress-search.test.ts -t "atomic|fixed|multi-tool"
  ```

  Expected: the old resolver omits active-block membership and the old handler mutates or allocates before all preparation has completed.

- [ ] **Step 3: Extend `resolveSelection` to a fixed point.**

  Preserve the Phase 2 tool-pair expansion, then repeat these operations until `startIndex` and `endIndex` stop changing:
  1. For every assistant message in the interval, include every matching `toolResult` and every result belonging to that assistant’s tool calls.
  2. For every active block whose `effectiveMessageIndices` intersects the interval, include its complete effective range and record its ID in `consumedBlockIds`.
  3. Re-run pair closure after block expansion.

  Return the sorted message indices, tool IDs, and consumed IDs. Reject reversed/out-of-range boundaries before any state mutation.

- [ ] **Step 4: Add a prepare phase to `handleCompress`.**

  Resolve every entry into a local prepared record before allocating IDs or writing state:

  ```ts
  interface PreparedCompression {
    startIndex: number;
    endIndex: number;
    anchorIndex: number;
    startKey: string;
    endKey: string;
    anchorKey: string;
    summary: string;
    summaryTokens: number;
    compressedTokens: number;
    directMessageIndices: number[];
    directToolIds: string[];
    effectiveMessageIndices: number[];
    effectiveToolIds: string[];
    consumedBlockIds: number[];
  }
  ```

  Derive keys through `state.messageIds.byIndex` → `state.messageIds.byRef`; fail before commit if a resolved index has no raw key. Apply turn protection and final interval overlap checks to the prepared array. Use local candidate IDs (`nextBlockId + offset`) while wrapping summaries, then advance counters only during commit.

- [ ] **Step 5: Run range and search tests.**

  ```bash
  pnpm vitest run tests/compress-range.test.ts tests/compress-search.test.ts
  ```

  Expected: invalid, protected, and expanded-overlap batches leave a byte-equivalent compression snapshot; valid disjoint batches prepare all entries before creating any block.

- [ ] **Step 6: Commit atomic selection preparation.**

  ```bash
  git add src/compress/search.ts src/compress/handler.ts tests/compress-range.test.ts tests/compress-search.test.ts
  git commit -m "fix: prepare compression batches atomically"
  ```

### Task 3: Commit nested blocks and rebuild derived visibility

**Files:**

- Modify: `src/compress/state.ts`, `src/compress/handler.ts`, `src/messages/sync.ts`
- Modify: `src/commands/decompress.ts`, `src/commands/recompress.ts`
- Test: `tests/compress-cycle.test.ts`, `tests/commands-decompress.test.ts`, `tests/sync.test.ts`

- [ ] **Step 1: Add failing nested-cycle tests.**

  Create child, parent, and grandparent blocks through `handleCompress`, then assert:

  ```ts
  expect(parent.consumedBlockIds).toEqual([child.blockId]);
  expect(child.parentBlockIds).toContain(parent.blockId);
  expect(grandparent.consumedBlockIds).toContain(parent.blockId);
  ```

  Deactivate the parent and assert eligible children become active. Keep a user-deactivated child inactive. Add a case with another active parent consuming the same child and assert the child remains inactive until all active parents are gone.

- [ ] **Step 2: Run nested tests and confirm incomplete relationships.**

  ```bash
  pnpm vitest run tests/compress-cycle.test.ts tests/commands-decompress.test.ts tests/sync.test.ts
  ```

  Expected: the current implementation leaves consumed blocks empty, overwrites anchor mappings, and never rebuilds child visibility.

- [ ] **Step 3: Implement one derived-state rebuild function.**

  Add this internal contract in `src/compress/state.ts`:

  ```ts
  export function rebuildCompressionState(
    state: SessionState,
    eligibleBlockIds: ReadonlySet<number>,
  ): void;
  ```

  The function must:
  - process blocks in creation order;
  - activate eligible, non-user-deactivated blocks unless an eligible ancestor consumes them;
  - set `deactivatedByBlockId` for blocks hidden by an active parent and clear it for visible blocks;
  - rebuild `activeBlockIds` and `activeByAnchorIndex` from active blocks;
  - rebuild every `byMessageIndex.blockIds` and `activeBlockIds` entry from block effective memberships while preserving token counts.

  Add a helper that preserves candidates hidden by a parent (`active` or `deactivatedByBlockId !== undefined`) for command mutations. `syncCompressionBlocks` supplies the authoritative eligible set from current compression tool-call IDs; the commit path adds all newly created IDs before rebuilding.

- [ ] **Step 4: Commit relationships in one pass.**

  During batch commit, store each prepared block, set each consumed block inactive, append the new block ID to its `parentBlockIds`, and call `rebuildCompressionState` once after all blocks exist. Do not update active sets or per-message membership incrementally in the handler.

- [ ] **Step 5: Make command mutations rebuild state.**

  `decompressCommand` sets `deactivatedByUser = true`, clears `active`, and calls the rebuild helper. `recompressCommand` requires a user-deactivated block, clears the flag, sets it as an eligible active candidate, and calls the same helper. Command handlers retain their existing result strings and validation.

- [ ] **Step 6: Run nested and pipeline tests.**

  ```bash
  pnpm vitest run tests/compress-cycle.test.ts tests/commands-decompress.test.ts tests/sync.test.ts tests/pipeline.test.ts
  ```

  Expected: child/parent/grandparent cycles preserve relationships, active summaries are mutually consistent, and deactivation restores only eligible visible content.

- [ ] **Step 7: Commit nested-state behavior.**

  ```bash
  git add src/compress/state.ts src/compress/handler.ts src/messages/sync.ts src/commands/decompress.ts src/commands/recompress.ts tests/compress-cycle.test.ts tests/commands-decompress.test.ts tests/sync.test.ts tests/pipeline.test.ts
  git commit -m "fix: preserve nested compression visibility"
  ```

### Task 4: Count visible tokens and apply batch timing

**Files:**

- Modify: `src/compress/handler.ts`, `src/compress/state.ts`, `src/index.ts`
- Test: `tests/compress-range.test.ts`, `tests/compress-cycle.test.ts`, `tests/compression-timing.test.ts`, `tests/compress-notification.test.ts`, `tests/integration.test.ts`

- [ ] **Step 1: Add failing accounting tests.**

  Assert:

  ```ts
  expect(rawBlock.compressedTokens).toBeGreaterThan(0);
  expect(parent.compressedTokens).toBe(child.summaryTokens + directRawTokens);
  expect(result.compressedTokens).toBe(
    blockOne.compressedTokens + blockTwo.compressedTokens,
  );
  expect(result.compressedTokens - result.summaryTokens).toBe(expectedSavings);
  ```

  Include a nested case proving hidden child raw messages are not counted again.

- [ ] **Step 2: Add failing all-block timing coverage.**

  Create a two-range batch with call ID `compress-call-1`, set a start timestamp, simulate a successful `tool_execution_end`, and assert:

  ```ts
  expect(blockOne.durationMs).toBe(1500);
  expect(blockTwo.durationMs).toBe(1500);
  expect(state.compressionTiming.startTimes.has("compress-call-1")).toBe(false);
  ```

- [ ] **Step 3: Implement visible-token preparation.**

  For each prepared entry, build the union of consumed blocks’ effective raw indices. Calculate:

  ```ts
  compressedTokens =
    sum(consumedBlock.summaryTokens) +
    sum(countMessageTokens(message) for each direct selected index);
  ```

  Count each consumed summary once, count only direct raw messages thereafter, store the result on the block, and aggregate it into `CompressResult`. Use the existing wrapped-summary estimator for `summaryTokens`.

- [ ] **Step 4: Apply duration directly from Pi events.**

  In `tool_execution_end`, after computing `durationMs` and confirming `!event.isError`, assign the duration to every block whose `compressToolCallId` equals `event.toolCallId`:

  ```ts
  for (const block of state.prune.messages.blocksById.values()) {
    if (block.compressToolCallId === event.toolCallId) {
      block.durationMs = durationMs;
    }
  }
  ```

  Remove the newest-block scan, call-ID mapping, pending-duration map, and pipeline application step.

- [ ] **Step 5: Run accounting, timing, notification, and integration tests.**

  ```bash
  pnpm vitest run tests/compress-range.test.ts tests/compress-cycle.test.ts tests/compression-timing.test.ts tests/compress-notification.test.ts tests/integration.test.ts
  ```

  Expected: raw and nested blocks report nonzero visible input, batch results aggregate correctly, every block receives one duration, and notifications retain aggregate token/message fields.

- [ ] **Step 6: Commit accounting and timing.**

  ```bash
  git add src/compress/handler.ts src/compress/state.ts src/index.ts tests/compress-range.test.ts tests/compress-cycle.test.ts tests/compression-timing.test.ts tests/compress-notification.test.ts tests/integration.test.ts
  git commit -m "fix: account and time compression batches correctly"
  ```

### Task 5: Document and release the phase

**Files:**

- Modify: `README.md`, `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-07-28-pi-dcp-phase-3-compression-correctness.md`
- Modify: `docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md`

- [ ] **Step 1: Document the released behavior.**

  Add entries under the existing Unreleased sections describing atomic batches, fixed-point pair/block expansion, nested restoration, visible-token accounting, and duration coverage for every block. State explicitly that resume/fork/tree/compaction restoration begins in Phase 4.

- [ ] **Step 2: Run focused phase verification.**

  ```bash
  pnpm vitest run tests/compress-range.test.ts tests/compress-cycle.test.ts tests/compress-state.test.ts tests/sync.test.ts tests/commands-decompress.test.ts tests/compression-timing.test.ts tests/compress-notification.test.ts tests/integration.test.ts
  ```

  Expected: all Phase 3 ownership, atomicity, nesting, accounting, command-cycle, sync, and timing tests pass.

- [ ] **Step 3: Run full verification.**

  ```bash
  pnpm test
  pnpm typecheck
  pnpm lint
  pnpm pack --dry-run
  git diff --check
  git diff --exit-code HEAD -- docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md
  ```

  Expected: all tests and type checks pass, lint does not exceed the current baseline of 84 warnings and 1 info, packaging succeeds, and the source roadmap has no diff.

- [ ] **Step 4: Record the release.**

  After verification, change only Phase 3 from `not started` to `complete` in the phased roadmap and record the release commit/tag and verification date in this plan. Do not alter later phase statuses or the source roadmap.

- [ ] **Step 5: Commit documentation and release metadata.**

  ```bash
  git add README.md CHANGELOG.md docs/superpowers/plans/2026-07-28-pi-dcp-phase-3-compression-correctness.md docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md
  git commit -m "docs: release compression correctness"
  ```

## Acceptance Criteria

- Every block records the real compression tool-call ID and raw boundary keys.
- Invalid or overlapping batches cannot partially mutate state.
- Pair and active-block expansion reaches a complete fixed point.
- Nested consume/deactivate/recompress cycles preserve coherent visibility and relationships.
- `compressedTokens` measures visible context replaced without nested double-counting.
- Timing is applied to every block created by a successful batch.
- Focused and full verification pass without Phase 4 or Phase 5 behavior.
- Documentation limits Phase 3 guarantees to the running process.

## Phase 4 Handoff

Phase 4 may serialize `compressToolCallId`, `startKey`, `endKey`, `anchorKey`, direct/effective memberships, nested relationships, token counts, and durations. It must rebuild numeric indices, active maps, and per-message derived state from current messages instead of trusting stale runtime caches.

## Release Record

- Status: complete
- Release commit or tag: b2936da
- Verification date: 2026-07-28
