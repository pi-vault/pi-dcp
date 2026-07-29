# Pi DCP Phase 4 Native Session State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve released DCP behavior across Pi resume, fork, tree navigation, and compaction without restoring ambiguous shared sidecar state.

**Architecture:** Store versioned `pi-dcp-state` custom entries on the active Pi branch. Persist only stable durable facts; rebuild message indices, compression memberships, ownership-derived visibility, tool caches, and timing state from current messages. Forks inherit behavior but receive a new owner snapshot with zeroed statistics.

**Tech Stack:** TypeScript ESM, Pi ExtensionAPI 0.80.3-compatible session APIs, Vitest, pnpm, and Node standard-library JSONL/filesystem APIs.

---

## Readiness Findings

The previous plan was not implementation-ready because it serialized runtime indices through `CompressionBlock[]`, missed compression mutations that occur before the next `context` pass, had an inconsistent command persistence callback, and referenced nonexistent `tests/messages-inject.test.ts`. The normal test suite also races because `tests/index.test.ts` and `tests/integration.test.ts` share `/tmp/test-pi-agent`; `pnpm vitest run --no-file-parallelism` passes all 408 tests. Final release verification must run under Node `>=24.15.0`; the current audit shell used Node 23.11.0.

Legacy `{sessionDir}/dcp/state.json` files remain untouched and are never read for restoration. Phase 4 excludes trusted project configuration, `/dcp:compress`, and benchmarks.

## Durable Contract

Add these types to `src/state/types.ts`:

```ts
export interface DcpSnapshotBlockV1 {
  blockId: number;
  runId: number;
  deactivatedByUser: boolean;
  compressedTokens: number;
  summaryTokens: number;
  durationMs: number;
  mode: "range" | "message";
  topic: string;
  batchTopic?: string;
  compressToolCallId: string;
  startKey: string;
  endKey: string;
  anchorKey: string;
  consumedBlockIds: number[];
  createdAt: number;
  summary: string;
}

export interface DcpSnapshotV1 {
  version: 1;
  ownerSessionId: string;
  manualMode: false | "active";
  compressPermission: "allow" | "deny";
  stats: SessionStats;
  lastCompaction: number;
  pruneTools: Array<[string, number]>;
  blocks: DcpSnapshotBlockV1[];
  nextBlockId: number;
  nextRunId: number;
  messageIds: {
    byRawId: Array<[string, string]>;
    nextRefIndex: number;
  };
  nudges: {
    contextLimitAnchors: string[];
    turnAnchors: string[];
    iterationAnchors: string[];
  };
}
```

`src/state/persistence.ts` exports `serializeDcpSnapshot`, `restoreDcpSnapshot`, `durableStateFingerprint`, and asynchronous `loadAllSessionStats`. The serializer sorts all collections before emitting them. It excludes numeric indices, active/parent maps, message memberships, inverse ID maps, tool/model caches, compression timing, pending manual triggers, and subagent results.

### Task 1: Repair the verification baseline

**Files:** `tests/index.test.ts`, `tests/integration.test.ts`

- [ ] **Step 1: Give each integration test file an isolated agent directory.** Replace the shared `/tmp/test-pi-agent` mock with a file-local temporary directory and remove it in that file’s cleanup hook.
- [ ] **Step 2: Run the normal suite.** Run `pnpm test`; expected result is 408 existing tests passing in parallel with no cross-file filesystem race.
- [ ] **Step 3: Commit the baseline repair.**

```bash
git add tests/index.test.ts tests/integration.test.ts
git commit -m "test: isolate extension agent directories"
```

### Task 2: Define and validate native snapshots

**Files:** `src/state/types.ts`, `src/state/persistence.ts`, `tests/persistence.test.ts`

- [ ] **Step 1: Add failing contract tests.** Cover exact snapshot fields, deterministic sorting, runtime-field exclusion, same-owner round trips, parent-owned fork restoration, malformed roots, malformed map entries, malformed blocks, invalid counters, duplicate IDs, and counter repair.
- [ ] **Step 2: Confirm the new API is absent.** Run `pnpm vitest run tests/persistence.test.ts -t snapshot`; expected failure is missing snapshot types/functions.
- [ ] **Step 3: Implement validation without a dependency.** Add a narrow runtime type guard. Reject invalid root/version/owner/counter data; retain valid blocks and map entries; warn once per discarded block through the existing logger callback. Normalize duplicate/sorted collections and discard invalid consumed-block references.
- [ ] **Step 4: Implement serialization and in-place restore.** `restoreDcpSnapshot(snapshot, state, currentSessionId)` resets and fills the existing `SessionState`; it resets only `stats` when `snapshot.ownerSessionId !== currentSessionId`. Rebuild `byRef` from `byRawId` and leave all runtime caches empty.
- [ ] **Step 5: Run focused tests and commit.**

```bash
pnpm vitest run tests/persistence.test.ts
git add src/state/types.ts src/state/persistence.ts tests/persistence.test.ts
git commit -m "feat: define native dcp session snapshots"
```

### Task 3: Restore active branches and rehydrate current messages

**Files:** `src/index.ts`, `src/pipeline.ts`, `src/messages/sync.ts`, `src/messages/inject.ts`, `src/compress/state.ts`; tests: `tests/index.test.ts`, `tests/integration.test.ts`, `tests/inject.test.ts`, `tests/sync.test.ts`, `tests/pipeline.test.ts`

- [ ] **Step 1: Add failing lifecycle tests.** Mock `getSessionId()` and `getBranch()` with unrelated entries, older valid snapshots, malformed newest snapshots, parent-owned snapshots, and no snapshot. Assert resume, reload, fork, and tree restore the expected branch state.
- [ ] **Step 2: Select the newest valid entry.** Scan `getBranch()` in reverse, accept only `custom` entries with `customType === "pi-dcp-state"`, continue past malformed candidates, and record whether filtering/fallback requires a repair append.
- [ ] **Step 3: Restore in place on `session_start` and `session_tree`.** Reset state, apply current config defaults and subagent runtime flags, restore the selected snapshot, set the real Pi session ID, and append a forced child-owned snapshot when ownership differs. Do not read sidecars.
- [ ] **Step 4: Reorder the pipeline.** Run these steps before pruning or injection:

```text
assign message refs
sync tool cache and current user-turn ordinal
build current tool-call list
remove stale pruned IDs, message mappings, and nudge anchors
resolve stable block keys and drop blocks with missing boundaries/owners
derive parent links, direct/effective memberships, and active maps
run strategies, inject IDs/nudges, and apply pruning
```

- [ ] **Step 5: Rebuild compression state from stable facts.** Derive current numeric indices from keys, derive direct/effective memberships from each range and `consumedBlockIds`, and derive parent links/active visibility from retained blocks. Never trust serialized runtime collections.
- [ ] **Step 6: Run lifecycle tests and commit.**

```bash
pnpm vitest run tests/index.test.ts tests/integration.test.ts tests/inject.test.ts tests/sync.test.ts tests/pipeline.test.ts
git add src/index.ts src/pipeline.ts src/messages/sync.ts src/messages/inject.ts src/compress/state.ts tests/index.test.ts tests/integration.test.ts tests/inject.test.ts tests/sync.test.ts tests/pipeline.test.ts
git commit -m "fix: restore dcp state from pi branches"
```

### Task 4: Persist every durable mutation exactly once

**Files:** `src/index.ts`, `src/commands/register.ts`, `src/state/persistence.ts`; tests: `tests/index.test.ts`, `tests/integration.test.ts`, `tests/commands-register.test.ts`, `tests/compression-timing.test.ts`

- [ ] **Step 1: Add failing append tests.** Assert one append after successful compression including final duration, strategy/nudge changes, sweep, manual/permission changes, decompress/recompress, compaction reset, and tree cleanup. Assert no append for failed or unchanged commands and repeated context passes.
- [ ] **Step 2: Add the centralized persistence closure.** Keep `lastPersistedFingerprint` in `src/index.ts`; compute fingerprints from the sorted durable serializer with a constant owner value. `persistIfChanged(force = false)` uses `state.sessionId`, catches/logs append failures, and updates the cache only after `pi.appendEntry()` succeeds.
- [ ] **Step 3: Wire mutation sources.** Pass `onStateChange: () => void` to `registerDcpCommands`; command handlers call it after their state mutation and before notification. Call persistence after `runPipeline`, after `session_compact`, after compression `tool_execution_end` timing, and after lifecycle restoration/repair. The timing hook is the compression persistence point so snapshots contain final duration values.
- [ ] **Step 4: Remove runtime sidecar calls.** Delete `saveSessionState`/`loadSessionState` runtime usage while leaving legacy files on disk.
- [ ] **Step 5: Run focused tests and commit.**

```bash
pnpm vitest run tests/index.test.ts tests/integration.test.ts tests/commands-register.test.ts tests/compression-timing.test.ts
git add src/index.ts src/commands/register.ts src/state/persistence.ts tests/index.test.ts tests/integration.test.ts tests/commands-register.test.ts tests/compression-timing.test.ts
git commit -m "fix: persist durable dcp mutations"
```

### Task 5: Aggregate lifetime statistics from Pi sessions

**Files:** `src/state/persistence.ts`, `src/commands/lifetime.ts`, `src/commands/register.ts`; tests: `tests/commands-lifetime.test.ts`, `tests/persistence.test.ts`

- [ ] **Step 1: Add JSONL fixtures.** Create temporary nested project-session directories containing valid headers, repeated snapshots for one owner, copied parent snapshots, child-owned snapshots, malformed lines, unrelated entries, unreadable files, and legacy sidecars.
- [ ] **Step 2: Implement the asynchronous scanner.** Stream `.jsonl` files recursively under the supplied sessions root, require a valid Pi header, parse each line independently, validate `pi-dcp-state`, and retain the newest valid entry per owner by custom-entry timestamp.
- [ ] **Step 3: Update the command boundary.** Make `lifetimeCommand()` await `loadAllSessionStats()` and keep the existing output format. The command scans all project session directories under the current sessions parent.
- [ ] **Step 4: Run tests and commit.**

```bash
pnpm vitest run tests/commands-lifetime.test.ts tests/persistence.test.ts
git add src/state/persistence.ts src/commands/lifetime.ts src/commands/register.ts tests/commands-lifetime.test.ts tests/persistence.test.ts
git commit -m "fix: aggregate lifetime stats from pi sessions"
```

### Task 6: Document and release Phase 4

**Files:** `README.md`, `CHANGELOG.md`, `docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md`

- [ ] **Step 1: Document lifecycle behavior.** Explain version 1 snapshots, active-branch selection, fork ownership/stat resets, compaction reset, malformed-entry recovery, rebuilt runtime caches, global lifetime aggregation, and ignored legacy sidecars.
- [ ] **Step 2: Run supported-runtime release verification.** Use Node `>=24.15.0` and run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm pack --dry-run
git diff --check
git diff --exit-code HEAD -- docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md
```

Expected: all tests pass in parallel, typecheck succeeds, lint has no diagnostics above the recorded baseline, package dry-run succeeds, and the source roadmap is unchanged.

- [ ] **Step 3: Prove the lifecycle acceptance path.** Exercise pruning and nested compression, resume, tree navigation away/back, fork, compaction, malformed snapshot fallback, and `dcp:lifetime`; verify owning-branch behavior, zeroed fork stats, and one lifetime total per owner.
- [ ] **Step 4: Record the release and commit documentation.** Change only Phase 4’s roadmap status after all acceptance criteria pass, then commit:

```bash
git add README.md CHANGELOG.md docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md
git commit -m "docs: release native session state"
```

## Acceptance Criteria

- Version 1 snapshots contain only durable stable facts and exclude runtime caches/indices.
- Restore selects the newest valid active-branch entry and tolerates malformed entries.
- Forks inherit behavior, reset statistics, and append a new owner snapshot immediately.
- Current message keys rebuild all compression memberships and active visibility.
- Every successful durable mutation persists once; failed/no-op paths do not.
- Runtime never reads or writes shared DCP sidecars.
- Lifetime scans real Pi JSONL sessions and counts each owner’s latest statistics once.
- Normal parallel and supported-runtime release verification pass without Phase 5 code.

## Handoff to Phase 5

Phase 5 may use `DcpSnapshotV1`, active-branch restore, `durableStateFingerprint`, the command `onStateChange()` callback, and owner-correct lifetime aggregation. It must use this persistence path for new commands and must not add another state store.

## Release Record

- Status: not started
- Release commit or tag: not recorded
- Verification date: not recorded
