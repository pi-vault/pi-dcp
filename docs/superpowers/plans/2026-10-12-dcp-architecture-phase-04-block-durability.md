# Complete Compression Block Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route initialization, restoration, reset, compaction, and duration writes through the existing block lifecycle owner without changing saved sessions.

**Architecture:** Extend the phase-3 public owner with lifecycle operations and integrate every remaining writer in the same phase. The codec keeps versioned value validation/serialization and delegates live block materialization. Session orchestration and runtime timing bookkeeping remain adapters to those operations.

**Tech Stack:** Existing TypeScript/ESM, v1/v2 snapshot types, Vitest, Biome; Node `>=24.15.0`.

**Spec:** [Approved design](../specs/2026-10-12-dcp-architecture-design.md). [Roadmap and shared constraints](2026-10-12-dcp-architecture-plan.md).

## Global constraints

- Start with completed phase 3; retain all its operations and working callers.
- Serialization still emits version `2`; parsing still accepts versions `1` and `2` with existing warning, filtering, and repair behavior. No new semantic rejection or migration rule.
- Keep owner-session/statistics decisions, raw payload parsing, fingerprints, and repair checkpoint decisions outside the block owner.
- Full reset empties block state and sets both allocation counters to `1`; compaction empties block state but preserves both counters.
- Restoration starts with inactive blocks, runtime indices `-1`, and empty derived memberships. The next context pass rebuilds visibility after references/tool cache are ready.
- Successful timing updates every matching block, including inactive blocks. Error completion clears the start-time entry and leaves block duration untouched.

## Review focus

- Decoded counters below restored identifiers: next counters become at least the largest corresponding ID plus `1`.
- Invalid/newer snapshots and inherited owner: fallback/repair checkpoints and statistics ownership keep their existing behavior.
- Compaction followed by compression: block/run IDs and message-reference sequence never regress.
- Valid start time `0`, missing start time, non-compression events, and error completion: each keeps its current timing outcome.
- Nested snapshot restoration: consumed/user-deactivated facts survive and yield the same model-visible context as uninterrupted execution.

## Task 1: Complete lifecycle ownership and integrate durable paths

**Files:**

- Modify: `src/compress/blocks.ts`, its private `src/compress/block-graph.ts`, `src/state/state.ts:11`, `src/state/persistence.ts:288`, `src/index.ts:133` and its `session_compact` handler.
- Update tests: `tests/compression-blocks.test.ts`, `tests/persistence.test.ts`, `tests/state.test.ts`, `tests/compression-timing.test.ts`, `tests/pipeline.test.ts`, `tests/index.test.ts`, `tests/pi-contract.test.ts`, `tests/benchmark.test.ts` only when their assertions/imports need it.
- Retain all phase-1/2 interfaces and all phase-3 public block operations.

**Interfaces:**

Add these exports to `src/compress/blocks.ts`; import snapshot/state types from `../state/types.ts`:

```typescript
export interface DurableCompressionBlocks {
  blocks: readonly DcpSnapshotBlockV1[];
  nextBlockId: number;
  nextRunId: number;
}

export function createCompressionBlockState(): PruneMessagesState;
export function clearCompressionBlocks(
  state: SessionState,
  mode: "session" | "compaction",
): void;
export function restoreCompressionBlocks(
  state: SessionState,
  snapshot: DurableCompressionBlocks,
): void;
export function recordCompressionDuration(
  state: SessionState,
  toolCallId: string,
  durationMs: number,
): void;
```

`createCompressionBlockState` creates the current empty block maps/sets and counters. Clearing mutates the existing block container and collections; it does not reset unrelated session fields. Restoration replaces the live block contents from already-decoded facts and restores counters without parsing raw data, deciding ownership statistics, or rebuilding visibility early. Duration recording changes every matching block's `durationMs` and nothing else.

- [ ] **Step 1: Capture the durable/lifecycle baseline.** Run `pnpm exec vitest run tests/persistence.test.ts tests/state.test.ts tests/compression-timing.test.ts tests/pipeline.test.ts tests/index.test.ts tests/pi-contract.test.ts tests/benchmark.test.ts`; expect exit `0`. Capture representative v1 and v2 decoded fixtures and compare restored/serialized values; byte/field compatibility is the target, not a schema update.

- [ ] **Step 2: Add lifecycle tests to the owner's public seam.** In `tests/compression-blocks.test.ts`, add these named cases using real phase-3 compression fixtures or decoded durable block fixtures from persistence tests:

| Test name | Assertions |
| --- | --- |
| `distinguishes compaction clearing from session reset` | With `nextBlockId = 8`, `nextRunId = 4`, compaction empties all block maps/sets and retains `8`/`4`; session reset empties them and returns counters to `1`/`1`; unrelated session values are untouched. |
| `restores decoded facts before runtime visibility` | Restored active flags false, all three runtime indices `-1`, derived memberships empty; next `runPipeline` produces the same summaries and coverage as uninterrupted state. |
| `repairs restored allocation counters without altering durable facts` | Decoded counters `2`/`2`, block ID `7`, run ID `3`: final counters `8`/`4`; summary, duration, user-deactivated flag, and consumed IDs unchanged. |
| `records duration for every block owned by a call` | Two matching blocks, including an inactive one, receive `75`; another call's duration remains unchanged; no counters or statistics change. |
| `creates current empty block state` | Current four maps/sets empty; allocation counters both `1`; no session/global mutation. |

The counter/clear distinction must be explicit:

```typescript
state.prune.messages.nextBlockId = 8;
state.prune.messages.nextRunId = 4;
clearCompressionBlocks(state, "compaction");
expect(state.prune.messages.nextBlockId).toBe(8);
expect(state.prune.messages.nextRunId).toBe(4);
expect(state.prune.messages.blocksById.size).toBe(0);
clearCompressionBlocks(state, "session");
expect(state.prune.messages.nextBlockId).toBe(1);
expect(state.prune.messages.nextRunId).toBe(1);
```

- [ ] **Step 3: Add adapter compatibility assertions.** In `tests/compression-timing.test.ts`, pin start time `0`, missing start, non-compression event, successful completion, error completion, and success with no matching block. Assert error clears the matching start entry but preserves duration; no start means no write. In persistence/index tests, preserve discarded-record warnings, invalid-latest fallback/repair, inherited-owner statistics, and delayed graph reconstruction. Retain v1/v2 round-trip checks and benchmark token gates.

- [ ] **Step 4: Run the new owner tests red.** Run `pnpm exec vitest run tests/compression-blocks.test.ts`; expect missing new exports or failing new lifecycle assertions. Existing integration compatibility tests should still pass before their adapters change. Do not commit the intermediate state.

- [ ] **Step 5: Implement the lifecycle operations.** Reuse the existing initialization/reset/restore-block logic inside the owner implementation. Preserve all maps/sets and counter behavior. Restoration's counters are `Math.max(decodedCounter, ...restoredIds.map(id => id + 1))` independently for blocks and runs. Materialize the existing runtime sentinels and defer graph reconstruction. Record the supplied duration verbatim for all matching calls; do not add rounding, clamping, or active-only filtering.

- [ ] **Step 6: Integrate every remaining live writer.** `createSessionState` obtains block state from `createCompressionBlockState`; `resetSessionState` delegates its block clearing at the old ordering point. `restoreDcpSnapshot` keeps parsing/resetting/session-wide assignments but calls `restoreCompressionBlocks` instead of constructing/inserting graph records or assigning block counters. The compaction handler delegates only block clearing with mode `compaction`; it retains its current tool/ref/timing/cache clearing, timestamp, logging, and persistence. Keep `applyCompressionTiming` in `index.ts` as the existing timing adapter: check tool/start, delete the start entry, return on error, then call `recordCompressionDuration` with `now - startTime`. Remove obsolete private reset/materialization helpers from the old owners.

- [ ] **Step 7: Verify complete compatibility.** Run `pnpm exec vitest run tests/compression-blocks.test.ts tests/compression-block-controls.test.ts tests/persistence.test.ts tests/state.test.ts tests/compression-timing.test.ts tests/pipeline.test.ts tests/index.test.ts tests/pi-contract.test.ts tests/benchmark.test.ts tests/dcp-actions.test.ts tests/tool-selection.test.ts`; expect exit `0`. Validate both unchanged snapshots and unchanged transformed context, not only block counts.

- [ ] **Step 8: Audit ownership and dependency direction.** Search production `src/` for mutations of block maps/sets, counters, lifecycle flags, duration, parent/consumed IDs, and memberships; only `blocks.ts` and `block-graph.ts` may mutate live block state. Codec writes to newly decoded value records are allowed and are distinct from live state writes. Session statistics, timing start maps, tool pruning, and message-reference writes remain with their existing owners. Confirm `blocks.ts`/`block-graph.ts` use state type imports and do not import the `state/state.ts` factory; production consumers never import `block-graph.ts` directly.

- [ ] **Step 9: Run the complete gate and final review.** Run `pnpm check` and `git diff --check`; both exit `0`. Review all four phases for behavior changes, leftover alternate dispatch paths, write exceptions, and dead code. No new dependency, config key, version, or schema change is permitted.

- [ ] **Step 10: Commit the entire phase.** Stage the owner, persistence/session/timing integrations, removed helpers, and tests actually changed. Commit as `refactor: centralize compression block lifecycle writes`.

## Atomic exit and rollback

Every production live block write crosses the owner; codecs and projections remain separate; all phases are usable and compatible with saved sessions. Revert this complete phase to restore phase 3's documented lifecycle writers without reverting ordinary block ownership. No data migration is required.
