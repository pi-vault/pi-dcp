# Complete Compression Block Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route initialization, restoration, reset, compaction, and duration writes through the existing block lifecycle owner without changing saved sessions.

**Architecture:** Extend the phase-3 public owner with lifecycle operations and integrate every remaining writer in the same phase. The codec keeps versioned value validation/serialization and delegates live block materialization. Session orchestration and runtime timing bookkeeping remain adapters to those operations.

**Tech Stack:** Existing TypeScript/ESM, v1/v2 snapshot types, Vitest, Biome; Node `>=24.15.0`.

**Spec:** [Approved design](../specs/2026-10-12-dcp-architecture-design.md). [Roadmap and shared constraints](2026-10-12-dcp-architecture-plan.md).

## Readiness review — 2026-10-12

Reviewed DCP at `49129d2` (merged phase 3) against the clean local Pi checkout at `/Users/lanh/Developer/pi-packages/pi`, commit `7bd01fb92485c06f92ecfff7ccf3197148bc16af`. DCP's installed coding-agent SDK is `1.1.0`; the reference checkout is evidence for host behavior, not a dependency-upgrade instruction.

The architecture and four proposed exports fit the approved design. The original plan needed more precise verification before execution: existing v1/v2 round-trip cases use empty block lists, the compaction integration case verifies message references without allocating another compression block, and the nested public lifecycle tests do not cross snapshot restoration. Steps 2–3 below close those gaps and define restoration into an already-populated container.

Baseline: `pnpm check` passed (61 test files, 930 tests) on Node `v24.21.0`, pnpm `12.9.1`. The production-write audit found exactly the phase-3 exceptions in `state/state.ts`, `state/persistence.ts`, and `index.ts`; no additional owner migration is needed. This revised plan is ready for implementation after plan review. This planning change implements no product code.

The final local builder check covered spec requirements, signatures, dependency direction, fixture prerequisites, and test ordering. Characterization now passes before missing owner exports are imported. Independent review was attempted but could not run because the reviewer workspace was out of credits; this readiness verdict is based on local review.

## Pi reference contracts

Paths below are relative to `/Users/lanh/Developer/pi-packages/pi` at the reviewed commit.

| Reference                                                                                                                              | Observed contract                                                                                                                                                                                                                                           | Phase-4 consequence                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/coding-agent/src/core/agent-session.ts:2874` and `:3203`; `packages/coding-agent/src/core/extensions/types.ts:798`           | Both manual and automatic compaction append the compaction entry and refresh context before emitting successful `session_compact`. Its payload includes `compactionEntry`, `fromExtension`, `reason`, and `willRetry`; failure/abort uses a separate event. | Keep clearing and checkpoint persistence in the existing success handler. Add no before/failed-compaction clearing or reason-dependent behavior. Use a complete success payload in the new host test.        |
| `packages/coding-agent/src/core/session-manager.ts:1261`, `:1289`, and `:1469`; `packages/coding-agent/src/core/agent-session.ts:3431` | Compaction and custom entries advance the branch leaf. `appendEntry` appends a custom entry; `getBranch` returns the root-to-leaf path including custom entries, distinct from projected context.                                                           | Retain reverse scanning of the current branch, fallback selection, and repair-checkpoint decisions in `index.ts`. A post-compaction DCP checkpoint must be available to resume before the next context pass. |
| `packages/coding-agent/src/core/agent-session.ts:1354`; `packages/coding-agent/src/core/extensions/types.ts:1115`                      | Pi forwards `toolCallId`, `toolName`, `result`, `isError`, and optional monotonic `durationMs` in `tool_execution_end`.                                                                                                                                     | Preserve DCP's existing `now - startTime` timing, even if Pi supplies a different `durationMs`. Do not adopt the host field in this ownership refactor.                                                      |
| DCP `src/pipeline.ts` and `src/compress/blocks.ts:355`                                                                                 | References and tool caches are synchronized before block visibility; blocks require stable boundaries and their assistant owner call, but a result can still be pending.                                                                                    | Restore durable facts without synchronizing. Use real raw history with retained owner calls for context-parity tests; never feed transformed context back as raw history.                                    |

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

- Modify: `src/compress/blocks.ts` (public lifecycle operations), `src/state/state.ts` (creation/reset delegation), `src/state/persistence.ts` (decoded materialization delegation), `src/index.ts` (duration/compaction delegation).
- Modify `src/compress/block-graph.ts` only if private lifecycle helpers belong there; its production consumer remains `blocks.ts` alone. No new source module is needed.
- Add/update behavior coverage: `tests/compression-blocks.test.ts`, `tests/persistence.test.ts`, `tests/state.test.ts`, `tests/compression-timing.test.ts`, `tests/pi-contract.test.ts`; extend `tests/index.test.ts` where fallback/repair assertions need strengthening. Retain `tests/pipeline.test.ts` and `tests/benchmark.test.ts`, changing them only when assertions/imports need it. Reuse `tests/extension-harness.ts` as-is.
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

`createCompressionBlockState` creates independent empty block maps/sets and counters on every call. Clearing mutates the existing block container and collections; it does not reset unrelated session fields. Restoration first empties all four collections in that same container, replaces its contents from already-decoded facts, and sets counters from the snapshot and restored IDs, independently of previous live counters. Empty restoration uses the decoded counters exactly. It neither parses raw data, decides ownership statistics, nor rebuilds visibility early. Duration recording changes every matching block's `durationMs` and nothing else.

- [ ] **Step 1: Capture the durable/lifecycle baseline.** Confirm phase 3 is merged and the worktree is clean or understood. Run `pnpm exec vitest run tests/compression-blocks.test.ts tests/persistence.test.ts tests/state.test.ts tests/compression-timing.test.ts tests/pipeline.test.ts tests/index.test.ts tests/pi-contract.test.ts tests/benchmark.test.ts`; expect exit `0`. Add the current-path characterization tests in Step 2 before adding owner-interface tests or migrating adapters. Compatibility means the current deterministic v2 serialization for equivalent facts; a v1 input still serializes as v2, not byte-identically to its input.

- [ ] **Step 2: Characterize the current durable adapters before changing them.** Add the following tests using existing production exports; they must pass on phase 3. Complete these characterization checks before adding imports of the new owner exports.

**Creation/reset — `tests/state.test.ts`.** Extend factory assertions to all four empty collections and independent state instances. In the reset test, first populate block/derived collections and advance both allocation counters; `resetSessionState` empties those same collections in the same container and returns counters to `1`/`1` alongside the existing unrelated session reset assertions. This tests the factory/reset wiring separately from direct owner operations.

**Nonempty snapshots — `tests/persistence.test.ts`.** Add `preserves nonempty v1/v2 block facts through restoration`, parameterized for v1 `allow`/`deny` and v2 `allow`/`ask`/`deny`. Use two valid blocks (child `7`, parent `8`, run `3`, parent consumes `[7]`), counters `9`/`4`, nonzero duration/token fields, a user-deactivated child, and optional `batchTopic` present on one block and absent on the other. Require defined decoded/serialized snapshots. After `restoreDcpSnapshot`, assert every durable block field, inactive flags, indices `-1`, empty derived collections/memberships, and unchanged input payload. Serialization equals the expected canonical v2 snapshot with the same durable values; a second restore/serialize is identical. Do not compare two possibly-undefined snapshots. Retain parser tests for discarded/duplicate blocks, missing/self consumed references, canonical message refs, and fingerprint exclusions.

**Nested context parity — `tests/compression-blocks.test.ts`.** Add `restores nested consumption and user exclusion through the next context pass`. Reuse the real child/parent raw-history fixture, `compressionConfig`, and complete owner/result messages already in this suite. Create child `b1`, then consuming parent `b2`; retain both owners. Settle each operation with `runPipeline`. Test two checkpoint states: active parent with eligible consumed child, and active parent with a user-deactivated child (deactivate parent, deactivate child, recompress parent). For each, serialize with a non-null session ID, restore into a fresh session with `restoreDcpSnapshot`, then assert inactive/sentinel/empty runtime state before the first pipeline pass. Run both restored and uninterrupted sessions over clones of the same raw history and compare complete returned messages plus active IDs, anchors, message coverage, and parent/consumed links. Deactivate parent in both, run again, and compare: eligible child summary returns in the first case; excluded child stays inactive and original content returns in the second. Durable summary/token/duration fields, allocation counters, and compression statistics stay equal. The direct owner restore test must not expect block-only restoration to restore unrelated reference caches.

**Timing — `tests/compression-timing.test.ts` and the existing persistence timing case in `tests/index.test.ts`.** Use matching blocks with preexisting duration `75` and a different-call block as a control. Pin these adapter outcomes:

| Input                                           | Expected outcome                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Start `0`, now `100`, successful `compress`     | Write `100` to every matching block, including inactive blocks; remove only the matching start. |
| Missing start                                   | No block write or start-map change.                                                             |
| Non-compression event with a matching start ID  | No block write; retain start entry.                                                             |
| Start `0`, now `100`, error completion          | Retain prior duration `75`; remove matching start; retain unrelated starts.                     |
| Start `0`, success, no matching blocks          | Remove matching start without modifying any block.                                              |
| Repeated completion after its start was removed | No second duration write.                                                                       |

Keep `isError` omitted behaving as the existing successful adapter case. In the registered-handler test, start at `1_000`, finish at `2_500`, and supply host `durationMs: 999`: the one resulting checkpoint still stores DCP duration `1_500`; a repeated end appends no duplicate checkpoint. Retain approval-denial and policy-changed completion coverage.

**Compaction/resume — `tests/pi-contract.test.ts`.** Add `continues block run and message references after compaction and resume` using `createExtensionHarness`, existing temporary config, fake time, and real context/tool execution. Complete one compression through `tool_execution_end` to produce block `1`, run `1`, counters `2`/`2`. Emit a fully typed successful `session_compact` payload after the simulated host has appended its compaction entry. At a distinct fake time, assert exactly one new DCP checkpoint with no blocks, counters `2`/`2`, advanced `lastCompaction`, unchanged statistics/permission/manual mode and stable message-reference sequence. Do not add a failed-compaction handler.

Build post-compaction raw history from a valid `compactionSummary`, a retained message, and a new message, with distinct timestamps. Create a second harness for the same session ID with the post-compaction checkpoint in its branch; emit `session_start` reason `resume`. Both live and resumed context passes must retain the retained message's old marker, allocate identical fresh markers, and return equal complete messages. Compress a marker actually shown in that post-compaction view in both harnesses; complete the call, append its owner/result, and pass context again. Both checkpoints contain block `2`, run `2`, next counters `3`/`3`, equal durable block facts (use the same fake clock), and the same summaries and coverage. Set the original harness's branch explicitly with `setBranch` and pass the saved custom checkpoint explicitly to the resumed harness: this harness captures `appendEntry` calls in `entries` without automatically adding them to `getBranch`. No harness rewrite is needed.

**Fallback/repair — `tests/index.test.ts`.** Extend the existing malformed-latest fallback case with a nonempty valid older snapshot and parameterize the newest entry as malformed or unsupported version `3`. Verify exactly one v2 repair checkpoint retains the older block facts/counters and current owner ID; a following restore of that repair does not append another checkpoint. Extend the child-owned fork test with those same block facts and nonzero values for all four saved statistics: inherited state retains block facts/counters but resets all statistics to zero and writes one current-owner checkpoint. Retain the existing no-snapshot baseline and same-owner deduplication cases. Partial record salvage retains the parser's existing warnings and does not acquire a new forced-repair rule.

Run `pnpm exec vitest run tests/state.test.ts tests/persistence.test.ts tests/compression-timing.test.ts tests/index.test.ts tests/pi-contract.test.ts tests/compression-blocks.test.ts`; expect exit `0` before introducing the new owner API tests.

- [ ] **Step 3: Add lifecycle tests to the owner's public seam.** In `tests/compression-blocks.test.ts`, add these named cases using real phase-3 compression fixtures or decoded durable block fixtures from persistence tests:

| Test name                                                             | Assertions                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `distinguishes compaction clearing from session reset`                | Populate all four collections, then set `nextBlockId = 8`, `nextRunId = 4`. Compaction empties them and retains `8`/`4`; repopulate before session clearing, which empties them and returns counters to `1`/`1`. Retain container/map/set identities in both modes; unrelated session values are untouched.                                                                                                                        |
| `restores decoded facts before runtime visibility`                    | Restore into populated block state. Old records disappear; container/map/set identities remain. Restored active flags false, all three runtime indices `-1`, parent/direct/effective memberships empty, and both deactivation runtime fields undefined. Durable fields unchanged; unrelated session values untouched. Full context reconstruction is tested through persistence in Step 2, which also restores message references. |
| `repairs restored allocation counters without altering durable facts` | Decoded counters `2`/`2`, block ID `7`, run ID `3`: final counters `8`/`4`; summary, duration, user-deactivated flag, and consumed IDs unchanged.                                                                                                                                                                                                                                                                                  |
| `uses decoded counters when restoring empty or lower-ID state`        | Start with populated state and live counters `50`/`40`. Restore decoded block `7`, run `3`, counters `2`/`2`: obtain `8`/`4`, not the prior counters. Restore empty blocks with counters `8`/`4`: all collections empty and counters exactly `8`/`4`; repeat to prove no stale state survives. Also retain decoded counters higher than any restored ID.                                                                           |
| `records duration for every block owned by a call`                    | Two matching blocks, including an inactive one, receive `75`; another call's duration remains unchanged; no counters or statistics change.                                                                                                                                                                                                                                                                                         |
| `creates current empty block state`                                   | Current four maps/sets empty; allocation counters both `1`; two returned containers share no maps/sets; no session/global mutation.                                                                                                                                                                                                                                                                                                |

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

- [ ] **Step 4: Run the new owner tests red.** Run `pnpm exec vitest run tests/compression-blocks.test.ts`; expect missing new exports or failing new lifecycle assertions. Existing integration compatibility tests should still pass before their adapters change. Do not commit the intermediate state.

- [ ] **Step 5: Implement the lifecycle operations.** Move the existing initialization/reset/restore-block logic into the owner, retaining the phase-3 public operations. Clear all four collections before materialization, including on repeated/empty restoration. Preserve the block container and collection identities. Restoration's counters are `Math.max(decodedCounter, ...restoredIds.map(id => id + 1))` independently for blocks and runs; do not include previous live counters. Materialize the existing runtime sentinels and defer graph reconstruction; preserve decoded facts without new validation/normalization. Record the supplied duration verbatim for all matching calls; do not add rounding, clamping, or active-only filtering. Run `pnpm exec vitest run tests/compression-blocks.test.ts`; expect exit `0` before adapter integration.

- [ ] **Step 6: Integrate every remaining live writer.** `createSessionState` obtains block state from `createCompressionBlockState`; `resetSessionState` delegates its block clearing at the old ordering point. `restoreDcpSnapshot` keeps parsing/resetting/session-wide assignments but calls `restoreCompressionBlocks` instead of constructing/inserting graph records or assigning block counters. The compaction handler delegates only block clearing with mode `compaction`; it retains its current tool/ref/timing/cache clearing, timestamp, logging, and persistence. Keep `applyCompressionTiming` in `index.ts` as the existing timing adapter: check tool/start, delete the start entry, return on error, then call `recordCompressionDuration` with `now - startTime`. Remove obsolete private reset/materialization helpers from the old owners.

- [ ] **Step 7: Verify complete compatibility.** Run `pnpm exec vitest run tests/compression-blocks.test.ts tests/compression-block-controls.test.ts tests/persistence.test.ts tests/state.test.ts tests/compression-timing.test.ts tests/pipeline.test.ts tests/index.test.ts tests/pi-contract.test.ts tests/benchmark.test.ts tests/dcp-actions.test.ts tests/tool-selection.test.ts`; expect exit `0`. Validate both unchanged snapshots and unchanged transformed context, not only block counts.

- [ ] **Step 8: Audit ownership and dependency direction.** Run `rg -n 'blocksById|activeBlockIds|activeByAnchorIndex|byMessageIndex|nextBlockId|nextRunId|durationMs|deactivatedByUser|deactivatedByBlockId|consumedBlockIds|parentBlockIds|directMessageIndices|effectiveMessageIndices|directToolIds|effectiveToolIds|startIndex|endIndex|anchorIndex|compressedTokens|summaryTokens' src` and inspect mutations, including local aliases; only `blocks.ts` and `block-graph.ts` may mutate live block state. Codec writes to newly decoded value records are allowed and are distinct from live state writes. Session statistics, timing start maps, tool pruning, and message-reference writes remain with their existing owners. Run `rg -n 'block-graph|state/state|state.ts' src/compress src/state src/index.ts`; confirm the owner uses state types without importing the factory/persistence runtime. The new runtime direction is `state.ts`/`persistence.ts`/`index.ts` → `blocks.ts` → `block-graph.ts`, never back to the state factory or codec; production consumers never import `block-graph.ts` directly.

- [ ] **Step 9: Run the complete gate and final review.** Run `pnpm check` and `git diff --check`; both exit `0`. Review all four phases for behavior changes, leftover alternate dispatch paths, write exceptions, and dead code. No new dependency, config key, version, or schema change is permitted.

- [ ] **Step 10: Commit the entire phase.** Stage the owner, persistence/session/timing integrations, removed helpers, and tests actually changed. Commit as `refactor: centralize compression block lifecycle writes`.

## Atomic exit and rollback

Every production live block write crosses the owner; codecs and projections remain separate; all phases are usable and compatible with saved sessions. Revert this complete phase to restore phase 3's documented lifecycle writers without reverting ordinary block ownership. No data migration is required.
