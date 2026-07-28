# Pi DCP Phase 4 Native Session State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve all released DCP behavior across Pi resume, fork, tree navigation, and compaction without restoring ambiguous shared sidecar state.

**Architecture:** Append versioned durable snapshots as Pi custom session entries, select the newest valid snapshot on the active branch, and rebuild runtime-only caches and compression indices from current messages. Attribute statistics to Pi session ownership so forks retain behavior without inheriting totals.

**Tech Stack:** TypeScript ESM, Pi ExtensionAPI 0.80.3-compatible session APIs, Vitest, pnpm, and Node standard-library filesystem/JSONL APIs.

---

## Source, Prerequisite, and Boundaries

- Source roadmap: Task 2 and the lifetime-reporting portion of Task 6 in [2026-07-28-pi-dcp-reliability-roadmap.md](2026-07-28-pi-dcp-reliability-roadmap.md).
- Prerequisite: [Phase 3](2026-07-28-pi-dcp-phase-3-compression-correctness.md) is released and its full verification passes.
- Legacy `{sessionDir}/dcp/state.json` files are left untouched and are never used for restoration.
- This phase does not add trusted project config, `/dcp:compress`, or benchmarks.

## Stable Outcome

After this phase:

- Durable state is stored under Pi custom type `pi-dcp-state`, snapshot version `1`.
- Resume and tree navigation restore the newest valid snapshot on the active branch.
- Forks inherit pruning/compression behavior but reset session statistics.
- Runtime caches, numeric indices, active maps, model metadata, and timing maps are rebuilt or reset.
- Compaction and command mutations append updated snapshots.
- Lifetime totals scan real Pi session JSONL files and count only the latest snapshot per owner session.
- Malformed entries degrade safely with warnings instead of losing the whole session.

### Task 1: Define and validate the native snapshot contract

**Files:**

- Modify: `src/state/types.ts`, `src/state/persistence.ts`
- Test: `tests/persistence.test.ts`

- [ ] **Step 1: Add failing round-trip and validation tests**

  Add fixtures for a complete active Phase 3 block and assert:

  ```ts
  const snapshot = serializeDcpSnapshot(state, "pi-session-1");
  const restored = restoreDcpSnapshot(
    snapshot,
    createSessionState(),
    "pi-session-1",
  );

  expect(snapshot.version).toBe(1);
  expect(restored.prune.messages.blocksById.get(1)?.compressToolCallId).toBe(
    "compress-call-1",
  );
  expect(restored.toolParameters.size).toBe(0);
  expect(restored.compressionTiming.callIdToBlockIds.size).toBe(0);
  ```

  Add cases for the wrong version, malformed roots, one malformed block among valid blocks, and a snapshot owned by a parent session.

- [ ] **Step 2: Confirm native serialization is missing**

  ```bash
  pnpm vitest run tests/persistence.test.ts -t "snapshot"
  ```

  Expected: FAIL because `DcpSnapshotV1`, serialization, and restoration do not exist.

- [ ] **Step 3: Add the durable type**

  In `src/state/types.ts`:

  ```ts
  export interface DcpSnapshotV1 {
    version: 1;
    ownerSessionId: string;
    manualMode: false | "active";
    compressPermission: "allow" | "deny";
    stats: SessionStats;
    lastCompaction: number;
    pruneTools: Array<[string, number]>;
    blocks: CompressionBlock[];
    nextBlockId: number;
    nextRunId: number;
    messageIds: {
      byRawId: Record<string, string>;
      byRef: Record<string, string>;
      nextRefIndex: number;
    };
    nudges: {
      contextLimitAnchors: string[];
      turnAnchors: string[];
      iterationAnchors: string[];
    };
  }
  ```

  Do not serialize `toolParameters`, `toolIdList`, `currentUserTurn`, `byIndex`, active/anchor maps, model metadata, timing maps, or sub-agent result caches.

- [ ] **Step 4: Implement narrow serialization and validation**

  Add:

  ```ts
  serializeDcpSnapshot(state, ownerSessionId): DcpSnapshotV1
  restoreDcpSnapshot(snapshot, state, currentSessionId): SessionState
  ```

  Validate the root, version, owner ID, finite counters, map-entry arrays, nested collections, stable block keys, and every block field needed by Phase 3. Discard malformed blocks individually and log one warning per discarded block. If ownership differs, restore behavior state and reset only `stats`.

  Reuse the existing logger and state-rebuild helpers; do not add a validation dependency.

- [ ] **Step 5: Rebuild derived compression collections**

  After accepting blocks, rebuild active block IDs, anchor mappings, per-message memberships, and counters from valid durable records. Never trust duplicated derived sets from serialized input.

- [ ] **Step 6: Run persistence unit tests**

  ```bash
  pnpm vitest run tests/persistence.test.ts
  ```

  Expected: exact-shape, same-session, fork-owner, malformed-entry, and runtime-cache exclusion cases pass.

- [ ] **Step 7: Commit the snapshot contract**

  ```bash
  git add src/state/types.ts src/state/persistence.ts tests/persistence.test.ts
  git commit -m "feat: define native dcp session snapshots"
  ```

### Task 2: Restore snapshots from the active Pi branch

**Files:**

- Modify: `src/state/persistence.ts`, `src/index.ts`
- Test: `tests/integration.test.ts`, `tests/persistence.test.ts`

- [ ] **Step 1: Add failing branch-selection tests**

  Mock `ctx.sessionManager.getBranch()` with:

  - unrelated entries;
  - an older valid `pi-dcp-state` entry;
  - a newer malformed entry;
  - a newest valid entry.

  Assert the newest valid entry is selected. Add resume, `session_tree`, and fork-owner cases.

- [ ] **Step 2: Confirm lifecycle restore is absent**

  ```bash
  pnpm vitest run tests/integration.test.ts -t "snapshot|session tree|fork"
  ```

  Expected: FAIL because lifecycle handlers still use sidecar state or do not scan Pi entries.

- [ ] **Step 3: Select the newest valid branch entry**

  Add a helper that scans `getBranch()` newest-to-oldest for:

  ```ts
  entry.type === "custom" && entry.customType === "pi-dcp-state"
  ```

  Return the first snapshot that passes root validation. Continue past malformed entries.

- [ ] **Step 4: Restore on session start and tree navigation**

  In both `session_start` and `session_tree`:

  1. create a clean runtime state;
  2. restore the newest valid active-branch snapshot;
  3. set `state.sessionId = ctx.sessionManager.getSessionId()`;
  4. let the next pipeline sync rebuild user-turn and tool caches.

  Do not read a legacy sidecar as fallback.

- [ ] **Step 5: Run lifecycle restoration tests**

  ```bash
  pnpm vitest run tests/integration.test.ts tests/persistence.test.ts
  ```

  Expected: resume, tree selection, fork ownership, malformed-newest fallback, and no-snapshot startup pass.

- [ ] **Step 6: Commit active-branch restoration**

  ```bash
  git add src/state/persistence.ts src/index.ts tests/integration.test.ts tests/persistence.test.ts
  git commit -m "fix: restore dcp state from active pi branches"
  ```

### Task 3: Rehydrate message references after lifecycle changes

**Files:**

- Modify: `src/messages/sync.ts`, `src/messages/inject.ts`
- Modify: `src/compress/state.ts`, `src/index.ts`
- Test: `tests/messages-inject.test.ts`, `tests/compress-cycle.test.ts`, `tests/integration.test.ts`

- [ ] **Step 1: Add failing rehydration tests**

  Restore blocks with stable keys but stale numeric indices. Assert that the pipeline:

  - assigns current message refs first;
  - maps `startKey`, `endKey`, and `anchorKey` to current indices;
  - rebuilds Phase 2 user-turn metadata;
  - deactivates a block whose boundary no longer exists;
  - removes nudge anchors absent from current history.

- [ ] **Step 2: Confirm stale indices are trusted**

  ```bash
  pnpm vitest run tests/messages-inject.test.ts tests/compress-cycle.test.ts tests/integration.test.ts -t "rehydrat|stale"
  ```

  Expected: FAIL because restoration precedes message-reference assignment or retains missing anchors.

- [ ] **Step 3: Reorder the pipeline**

  Run lifecycle-sensitive steps in this order:

  1. assign stable message refs;
  2. sync the Phase 2 tool cache and user-turn ordinal;
  3. resolve each durable block’s stable boundaries;
  4. deactivate blocks with missing/invalid boundaries;
  5. rebuild compression derived indices;
  6. remove stale nudge anchors;
  7. apply pruning and injection.

- [ ] **Step 4: Preserve stable formats**

  Keep existing message-reference formats. Rehydrate from the Phase 3 keys rather than inventing an additional session key or positional fallback.

- [ ] **Step 5: Run focused pipeline tests**

  ```bash
  pnpm vitest run tests/messages-inject.test.ts tests/compress-cycle.test.ts tests/integration.test.ts
  ```

  Expected: restored blocks target current indices, stale blocks fail closed, and current user-turn protection remains correct.

- [ ] **Step 6: Commit lifecycle rehydration**

  ```bash
  git add src/messages/sync.ts src/messages/inject.ts src/compress/state.ts src/index.ts tests/messages-inject.test.ts tests/compress-cycle.test.ts tests/integration.test.ts
  git commit -m "fix: rehydrate durable dcp state from current messages"
  ```

### Task 4: Append snapshots after durable mutations

**Files:**

- Modify: `src/state/persistence.ts`, `src/index.ts`
- Modify: `src/commands/register.ts`
- Test: `tests/integration.test.ts`, `tests/commands-register.test.ts`

- [ ] **Step 1: Add failing append tests**

  Assert one new `pi-dcp-state` entry after each successful durable mutation:

  - compression;
  - strategy/nudge pruning changes;
  - sweep;
  - manual/permission mode changes;
  - decompress/recompress;
  - compaction reset;
  - tree restoration followed by stale-anchor cleanup.

  Assert no append when a command fails or the durable fingerprint is unchanged.

- [ ] **Step 2: Confirm mutations are not persisted natively**

  ```bash
  pnpm vitest run tests/integration.test.ts tests/commands-register.test.ts -t "append|persist"
  ```

  Expected: FAIL because durable changes still write a sidecar or have no mutation callback.

- [ ] **Step 3: Add one append closure and fingerprint**

  In `src/index.ts`:

  ```ts
  const persistSnapshot = (ctx: ExtensionContext): void => {
    pi.appendEntry(
      "pi-dcp-state",
      serializeDcpSnapshot(state, ctx.sessionManager.getSessionId()),
    );
  };
  ```

  Add `durableStateFingerprint(state)` using the serialized durable shape with a constant owner value. Capture the fingerprint before a pipeline pass or command and append only when it changes after successful completion.

- [ ] **Step 4: Add the command mutation callback**

  Change command registration to accept:

  ```ts
  onStateChange: () => void
  ```

  Call it after successful durable mutations in sweep, manual, permission, decompress, and recompress handlers. Keep passing the config object whose identity Phase 2 preserves across reloads; Phase 5 does not need a getter wrapper.

- [ ] **Step 5: Remove sidecar runtime writes**

  Delete runtime calls that save or restore `{sessionDir}/dcp/state.json`. Leave existing files on disk untouched. Keep only standard-library reads needed by lifetime scanning.

- [ ] **Step 6: Run mutation persistence tests**

  ```bash
  pnpm vitest run tests/integration.test.ts tests/commands-register.test.ts
  ```

  Expected: each successful durable change appends one current-owner snapshot, no-op/failed changes append none, and no runtime sidecar write occurs.

- [ ] **Step 7: Commit native mutation persistence**

  ```bash
  git add src/state/persistence.ts src/index.ts src/commands/register.ts tests/integration.test.ts tests/commands-register.test.ts
  git commit -m "fix: append snapshots after durable mutations"
  ```

### Task 5: Make lifetime totals session-owned

**Files:**

- Modify: `src/state/persistence.ts`, `src/commands/lifetime.ts`
- Test: `tests/commands-lifetime.test.ts`

- [ ] **Step 1: Add JSONL lifetime fixtures**

  Create temporary Pi session files containing headers, unrelated entries, multiple valid snapshots for one owner, a fork-owned inherited snapshot, malformed lines, and legacy `dcp/state.json` files.

  Assert `loadAllSessionStats()` selects the latest valid snapshot for each `ownerSessionId`, sums each owner once, and ignores legacy sidecars.

- [ ] **Step 2: Confirm current totals use unsafe storage**

  ```bash
  pnpm vitest run tests/commands-lifetime.test.ts
  ```

  Expected: FAIL because lifetime reporting scans project sidecars or double-counts inherited fork totals.

- [ ] **Step 3: Scan Pi session JSONL**

  With Node standard-library filesystem APIs:

  1. walk the supplied sessions parent directory for Pi session JSONL files;
  2. parse lines independently;
  3. keep only custom entries with `customType === "pi-dcp-state"`;
  4. validate version-1 snapshots;
  5. retain the newest valid entry per `ownerSessionId`;
  6. sum its `stats`.

  Skip malformed lines and unreadable/non-session files with the existing warning path. Do not add a JSONL dependency.

- [ ] **Step 4: Run lifetime tests**

  ```bash
  pnpm vitest run tests/commands-lifetime.test.ts
  ```

  Expected: totals reflect real Pi owners, latest snapshots, and fork-reset statistics exactly once.

- [ ] **Step 5: Commit lifetime ownership**

  ```bash
  git add src/state/persistence.ts src/commands/lifetime.ts tests/commands-lifetime.test.ts
  git commit -m "fix: aggregate lifetime stats from pi sessions"
  ```

### Task 6: Document recovery and release Phase 4

**Files:**

- Modify: `README.md`, `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md`

- [ ] **Step 1: Document lifecycle semantics**

  Explain custom-entry ownership, snapshot versioning, resume/tree selection, fork statistic resets, compaction behavior, malformed-entry recovery, runtime-cache rebuilding, lifetime aggregation, and the decision to ignore but not delete legacy sidecars.

- [ ] **Step 2: Run focused lifecycle verification**

  ```bash
  pnpm vitest run tests/persistence.test.ts tests/integration.test.ts tests/messages-inject.test.ts tests/compress-cycle.test.ts tests/commands-register.test.ts tests/commands-lifetime.test.ts
  ```

  Expected: snapshot, rehydration, append, fork, tree, compaction, malformed-data, and lifetime cases pass.

- [ ] **Step 3: Run full phase verification**

  ```bash
  pnpm test
  pnpm typecheck
  pnpm lint
  pnpm pack --dry-run
  git diff --check
  git diff --exit-code HEAD -- docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md
  ```

  Expected: all commands pass; lint adds no diagnostics above baseline; package contents are valid; the source roadmap remains unchanged.

- [ ] **Step 4: Prove the phase is independently usable**

  Create pruning and nested compression state, resume it, navigate to another tree branch and back, fork it, and compact it. Verify behavior restores on the owning branch, fork statistics restart at zero, and lifetime totals count each owner once.

- [ ] **Step 5: Commit the Phase 4 release**

  ```bash
  git add README.md CHANGELOG.md docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md
  git commit -m "docs: release native session state"
  ```

## Acceptance Criteria

- Version-1 snapshots contain durable state and exclude runtime caches.
- Restore selects the newest valid active-branch entry and tolerates malformed entries.
- Forks inherit behavior but reset statistics under the new Pi session owner.
- Numeric indices and Phase 2/3 derived state rebuild from current messages.
- Every successful durable mutation appends a native snapshot; no-op and failed paths do not.
- Runtime no longer reads or writes shared DCP sidecars.
- Lifetime totals scan Pi sessions and count each owner’s latest statistics once.
- Focused and full verification pass without Phase 5 code.
- Recovery and migration behavior are documented.

## Handoff to Phase 5

Phase 5 may rely on:

- `DcpSnapshotV1` and `pi-dcp-state`;
- active-branch restore and current-owner append behavior;
- `durableStateFingerprint`;
- command `onStateChange()` persistence;
- owner-correct lifetime aggregation.

Phase 5 must use the existing mutation callback for its new command and must not introduce another persistence path.

## Release Record

- Status: not started
- Release commit or tag: not recorded
- Verification date: not recorded
