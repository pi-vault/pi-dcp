# DCP Depth Phase 2: Branch Restoration and Checkpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for these coupled changes) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give branch restoration and checkpoint decisions one owner while preserving host event order and durable-state behavior.

**Architecture:** Move reset/default/restore coordination and fingerprint/repair decisions behind a deep branch persistence module. A scoped restoration operation runs a synchronous host callback before its checkpoint attempt, keeping host model/tool/prompt work in its current order and repair force local to that event. Reuse the snapshot codec, compression block owner, Pi host adapter, and existing harness.

**Tech Stack:** TypeScript/ESM, Node `>=24.15.0`, existing Pi SDK, Vitest, Biome, pnpm; no new dependency.

**Spec:** [Approved three-phase design](../specs/2026-10-13-dcp-architecture-deepening-design.md), especially Phase 2, placement revisits, and compatibility constraints.

**Readiness review:** Revised against `96824f4` on 13 October 2026, after Phase 1 merged in PR #87. The working tree was clean before this review. Fresh `pnpm check` passed formatting, lint, type checking, and 67 test files / 1,159 tests. Phase 2 implementation has not started.

The original two-call interface stored a pending repair flag between restoration and persistence. If host work threw before `persist()`, that flag could force an unrelated shutdown/context write. Current handlers lose their local force flag when they exit; Pi reports handler errors and can continue with later events. This revision uses a synchronous callback to preserve that behavior without adding caller-managed cancellation or repair state. Temporary probes against the unchanged extension confirmed abandoned-event force, failed equal-fingerprint repair, changed-state retry behavior, and real installed-SDK branch repair/leaf advancement.

**Outcome:** The revised plan is ready to implement. An independent builder check found no material unanswered questions. This review verifies the baseline and planned fixtures; implementation still requires the characterization and owner-interface checks below.

## Pi Source Reference and Host Contract

Reference checkout: `/Users/lanh/Developer/pi-packages/pi`, commit `3daa20280` (package version `1.2.0`). The installed SDK is `1.1.0`; its corresponding types/runtime were checked too. Use installed SDK types for implementation and tests; do not upgrade dependencies or import the reference checkout.

- `packages/coding-agent/docs/extensions.md`, persistence guidance: restore from `getBranch()`, never all file entries; abandoned branches are alternative histories.
- `packages/coding-agent/src/core/session-manager.ts`, `getBranch()`/`appendCustomEntry()`/`_appendEntry()`: branch entries run root-to-leaf; custom entries attach to and advance the active leaf. Append mutates in-memory entries before file persistence can throw. Preserve the current retry rule; add no rollback or transactional guarantee.
- `packages/coding-agent/src/core/agent-session.ts`, `bindExtensions()`/`navigateTree()` and the runtime `appendEntry` action: the active branch and tool loadout are established before `session_start`/`session_tree` handlers; `appendEntry` is synchronous and delegates to `appendCustomEntry`.
- `packages/coding-agent/src/core/extensions/runner.ts`, `emit()`: handler exceptions are reported and subsequent processing can continue. DCP must propagate non-append exceptions and leave no repair force for later events.
- `packages/coding-agent/src/core/extensions/types.ts`: `getSessionId()` returns a string; `appendEntry<T>(customType, data?)` returns `void`. An assigned session identity can receive a baseline before any conversation exists. Pi may keep that entry in memory until a conversation starts; successful append means the host call returned, not proof of a file flush.

The reference is evidence for the existing host contract, not additional feature scope. The in-memory harness records appends but does not attach them to its branch automatically; supplement it with the real installed-SDK branch test below.

## Global Constraints

- Preserve current commands, text output, dashboard rows, notifications, tool result text, optional display metadata, error messages, and UI routing.
- Preserve pruning/compression algorithms, protected content, message references, compression priority, nudges, tool selection, and statistics calculations.
- Preserve snapshot version `2`, reading versions `1` and `2`, durable field names, fingerprints, owner-session statistics rules, and repair behavior.
- Preserve root `SessionState` and configuration identities; read replaceable nested state at operation time.
- Preserve host event order, per-call approval, approval cancellation, policy rechecks, exception propagation, and checkpoint trigger locations.
- Keep Node `>=24.15.0`, TypeScript/ESM, current dependencies, and configuration. Add no configuration option, dependency, generic event framework, or release.
- Preserve meaningful behavior coverage; replace private tests only after equivalent interface coverage exists.
- Execute after [Phase 1](2026-10-13-dcp-depth-phase-01-reporting.md). Phase 1 is an order prerequisite; this module does not depend on its reporting exports. Do not implement compression execution here.

## Review Focus

| Input / condition                                                   | Required behavior                                                                                                        | Owning checks                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Host work throws after restoration                                  | Propagate the exception, skip that event's checkpoint, and drop its force decision                                       | Task 1 exception characterization, Task 2 scoped-operation tests         |
| Same durable facts on an empty/malformed branch                     | Still attempt the event's forced baseline/repair checkpoint after host work                                              | Task 2 restore matrix, Task 1 SDK branch test                            |
| Append fails for changed facts or an equal-fingerprint forced write | Warn without advancing the fingerprint; changed facts retry, but equal facts do not gain a recurring forced-retry policy | Tasks 1–2 failure and force characterization                             |
| Shutdown before compression completion                              | Persist current block facts without inventing a duration                                                                 | Task 1 host shutdown test                                                |
| Configuration/model/tool work between restore and persist           | Use current config defaults and preserve selection-before-checkpoint ordering                                            | Existing lifecycle contracts, Task 2 integration and callback-order test |

## File Map and Fixed Interfaces

- Create `src/state/checkpoints.ts`: restoration coordination, fingerprint memory, event-local force intent, and append behavior.
- Modify `src/index.ts`: instantiate the owner and delegate restoration/persistence; retain other host work.
- Create `tests/checkpoints.test.ts`; extend `tests/index.test.ts` for missing host behavior and `tests/sdk-contract.test.ts` for actual branch traversal/append behavior.
- Existing `src/state/persistence.ts`, `src/state/state.ts`, `src/compress/blocks.ts`, and `src/tool-selection.ts` remain the implementations of their existing responsibilities.

Define these exports in `src/state/checkpoints.ts` using installed SDK types and the existing `DcpConfig`/`SessionState`:

```ts
export type DcpCheckpointHost = Pick<ExtensionAPI, "appendEntry">;
export type DcpBranchContext = Pick<ExtensionContext, "sessionManager">;
export type DcpRestoreSource = "session-start" | "branch-navigation";
export type DcpCheckpointWarning = (
  message: string,
  details?: Record<string, unknown>,
) => void;
export interface DcpCheckpoints {
  restoreAndCheckpoint(
    source: DcpRestoreSource,
    ctx: DcpBranchContext,
    afterRestore: () => void,
  ): void;
  persist(): void;
}
export function createDcpCheckpoints(
  host: DcpCheckpointHost,
  state: SessionState,
  config: DcpConfig,
  warn: DcpCheckpointWarning,
): DcpCheckpoints;
```

`restoreAndCheckpoint` resets state through `resetSessionState`, applies current configured manual-mode/permission defaults, and performs the existing reverse branch scan/codec restoration. `session-start` clears the previous fingerprint; `branch-navigation` preserves it until the same existing restore/append conditions update it. A clean same-owner restoration records the restored fingerprint; inherited owners, skipped invalid snapshots, or missing state require that event's forced checkpoint.

After restoration, invoke `afterRestore` exactly once, synchronously. The caller supplies the existing intervening host work; the owner knows none of its model/prompt/selection details. Only after the callback returns successfully, attempt the checkpoint with the local force decision. Restoration or callback exceptions propagate and skip that attempt. Do not checkpoint in `finally`, retain a module-level pending-force flag, or change fingerprint memory to hide an exception. Later `persist()` calls use ordinary changed-state deduplication; they may still write changed facts after an abandoned event.

`persist` and the scoped operation's private checkpoint attempt share the existing serialize/fingerprint/deduplication/append ordering. Advance the fingerprint only after the host append returns. Catch only the existing append region, retaining `failed to persist native session state` and `{ error: String(error) }`; codec or warning callback exceptions propagate as before. Serialization returns without appending when `state.sessionId` is absent; an empty conversation with an assigned identity still gets its baseline. Use a warning closure that reads the current `logger` variable after reload; do not capture the initial logger. The callback must remain synchronous, with no `async` callback or added await boundary.

## Task 1: Characterize Checkpoint and Host Behavior

**Files:** `tests/index.test.ts`, `tests/sdk-contract.test.ts`; retain current restoration, compaction, command-callback, and contract tests.

**Interfaces:** Consumes existing `createExtension`, `createMockApi`, `registeredHandler`, and `sessionContext` fixtures in index tests, and `createHostSession`/`SessionManager.inMemory()` in SDK tests. Produces baseline assertions reused unchanged after extraction.

- [ ] **Step 1: Add `retries changed state after append failure without advancing the fingerprint`.** Start an empty session to establish a successful baseline. Use `vi.spyOn(api, "appendEntry").mockImplementationOnce(() => { throw new Error("append failed"); })` before the manual-mode command changes state. Spy on `Logger.prototype.warn`; assert the existing warning. Trigger `session_shutdown`: the unchanged-since-failure manual-mode state must now append successfully. Repeating shutdown must append nothing. Restore spies after the test; retain the existing session-context fixtures and command path.

- [ ] **Step 2: Add `does not carry a failed event-local force decision into later shutdown`.** Establish a baseline and save its serialized entry. Set the branch to that same baseline followed by a malformed DCP entry; invoke `session_tree` with the append throwing once. The forced repair attempt warns. Invoke shutdown with unchanged durable facts; append call count must remain one for this failed force attempt. This pins the current fingerprint-equal behavior rather than silently adding retries.

- [ ] **Step 3: Add `persists untimed compression on shutdown`.** Reuse the valid range compression/context fixtures already used by index tests, with protection permitting the selected content. Start a session, run a context pass, execute a compression, and emit shutdown without a compression-end event. Assert one new checkpoint contains the created block with duration `0`; a repeated shutdown adds none. Do not change compression algorithms to support the fixture.

- [ ] **Step 4: Add `drops repair force when intervening host work throws`.** Establish a successful baseline; use a branch containing that identical baseline followed by a malformed DCP entry. Make `api.getActiveTools` throw once during selection after restoration. The registered `session_tree` handler must reject with that error and append nothing; unchanged shutdown must also append nothing. Repeat with `session_start` (`reason: "reload"`): its exception still skips the event's checkpoint, but shutdown now appends once because session start cleared fingerprint memory. A second shutdown deduplicates. Restore spies in `finally`. These cases distinguish dropping force from suppressing ordinary changed-state retries.

- [ ] **Step 5: Add `repairs only the navigated branch through the real SDK`.** Use the existing offline `createHostSession` helper with `SessionManager.inMemory()`, spying on `createSessionState` as existing SDK tests do. Before binding, append a same-owner snapshot A with manual mode `"active"` and distinct stats, then a malformed DCP child of A. Branch back to A and append a valid same-owner snapshot B with manual mode `false` and different stats; bind with `reason: "resume"` on B. Capture DCP-entry count after binding. Navigate to the malformed child using `session.navigateTree(id)`; assert A's facts are restored, one v2 repair is appended with `parentId` equal to that child, and the repair is the active leaf. B remains in `getEntries()` but is absent from `getBranch()`. Navigate to B, then to the saved repair entry: each restores its own facts with no additional DCP entry. Use custom-entry targets, since Pi navigates user-message targets to their parent. Keep model networking disabled and substitute no real provider.

- [ ] **Step 6: Verify current behavior.** Run `pnpm exec vitest run tests/index.test.ts tests/sdk-contract.test.ts tests/pi-contract.test.ts tests/persistence.test.ts tests/state.test.ts`; expect exit `0`. Characterization tests should pass before extraction. If observed force/failure behavior differs, investigate and reconcile with the approved preservation requirement before proceeding.

## Task 2: Introduce and Integrate the Branch Persistence Owner

**Files:** Create `src/state/checkpoints.ts`, `tests/checkpoints.test.ts`; modify `src/index.ts`. Retain Task 1's characterization changes unchanged.

**Interfaces:** Produces the fixed exports above. Phase 3 consumes `DcpCheckpoints.persist()` through a `() => void` dependency. Existing event/command interfaces stay unchanged.

- [ ] **Step 1: Write failing tests at the owner interface.** Build contexts with `createExtensionHarness({ sessionId, branch }).context` and use a recording/throwing `appendEntry` adapter. Create snapshots via `serializeDcpSnapshot` and existing state constructors. Test this matrix:

  | Case                                                        | Assert inside `afterRestore` and after `restoreAndCheckpoint` returns                                |
  | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
  | Clean same-owner v1/v2 snapshot                             | Restored stats/permission/refs; no append until durable facts change                                 |
  | Parent-owned snapshot restored to `child`                   | Blocks/refs retained; session stats zero; one child-owned v2 checkpoint                              |
  | Unsupported v3 or malformed newest entry                    | Older valid snapshot restored; one repair checkpoint                                                 |
  | No valid DCP entry                                          | Current configured defaults; one baseline checkpoint even if fingerprint matched the previous branch |
  | Changed state, append throws then succeeds                  | Existing warning; successful retry; subsequent unchanged call deduplicated                           |
  | Equal-fingerprint forced attempt throws                     | Later unchanged attempt does not repeat force                                                        |
  | Host callback throws on an equal-fingerprint repair branch  | Exception propagates; no event append; later ordinary persist deduplicates                           |
  | Session start clears fingerprint, then host callback throws | No event append; later ordinary persist writes once and then deduplicates                            |
  | No session ID                                               | No append                                                                                            |

  Inside the callback, assert restoration is complete and no append has happened; after it returns, inspect the checkpoint. Cover clean same-owner v1 and v2 (including v2 `"ask"`), newest-valid selection, ignored non-DCP entries, and an all-invalid branch falling back to current defaults. An otherwise valid same-owner snapshot with a discarded invalid block retains the codec's warning and normalization; do not invent an additional repair condition. The no-session-ID case uses fresh `createSessionState()` without restoration, not a fictional null-returning Pi manager.

  Also test `preserves root identity and reads reloaded defaults`, `waits for host work before writing a repair`, `ignores reference-only changes`, and `reads new nested state for each persist`. Mutate/replace `config.manualMode` and `config.compress` on the same config root before restoration; retain the state root through resets. For ordering, observe restored facts inside the callback, change a durable fact there, and verify only the final facts are appended after callback completion. For fingerprint exclusions, change message references/counters and runtime-only model/timing fields, call ordinary `persist()`, and assert no append; a later durable mutation must append the current references too. Retain codec tests as the authority for serialization/fingerprint algorithms.

  Test `propagates restoration warnings and host-work exceptions without appending`: use an otherwise valid snapshot with an invalid block to trigger `Discarded invalid DCP snapshot block`; a throwing warning callback prevents the host callback and checkpoint. Unsupported versions are silently skipped by the current codec. A throwing host callback runs once and prevents the checkpoint. Test `propagates an append-warning exception and retries changed facts`: let append throw and then the supplied warning throw; the exception propagates, fingerprint memory is unchanged, and a later ordinary persist succeeds. Keep direct interface tests about observable calls/state, not private force storage.

  ```ts
  it("does not append without a session identity", () => {
    const host = { appendEntry: vi.fn() } satisfies DcpCheckpointHost;
    const checkpoints = createDcpCheckpoints(
      host,
      createSessionState(),
      makeDefaultConfig(),
      vi.fn(),
    );
    checkpoints.persist();
    expect(host.appendEntry).not.toHaveBeenCalled();
  });
  ```

- [ ] **Step 2: Demonstrate failure.** Run `pnpm exec vitest run tests/checkpoints.test.ts`; expect missing module/exports before implementation.

- [ ] **Step 3: Implement the owner.** Reuse `parseDcpSnapshot`, `restoreDcpSnapshot`, `serializeDcpSnapshot`, and `durableStateFingerprint` without changing their algorithms or consolidating their repeated decoding/serialization in this phase. Keep the last fingerprint private; keep force as a local value in `restoreAndCheckpoint`. Restore, invoke the synchronous callback, then pass force to the private persistence attempt. Ordinary `persist()` passes no force. No callback/restore catch or `finally` append is needed: stack unwinding drops the local decision. Retain current root/config references and current logger through the supplied warning closure.

- [ ] **Step 4: Integrate every production call site.** Instantiate `createDcpCheckpoints` once in `createExtension`, with `(message, details) => logger.warn("dcp", message, details)`. Replace `restoreActiveBranch`, `persistIfChanged`, and closure-local fingerprint storage. At `session_start`, reload config and clear `latestMessages`, then call `restoreAndCheckpoint("session-start", ctx, () => { ... })` with the current model/subagent/prompt/registration/selection/context-window/log work in that synchronous callback. At `session_tree`, clear `latestMessages`, then call `restoreAndCheckpoint("branch-navigation", ctx, () => { ... })` with current subagent/selection work. These operations perform the final checkpoint; add no separate `persist()` there. Replace the other persistence triggers with `checkpoints.persist()` in place: operator callback after selection, compaction after resets/logging, shutdown before logging, compression end after duration, and context after pipeline/logging but before notifications. Keep compaction's block clearing and reference-sequence behavior with existing owners. Remove obsolete imports/locals; do not relocate other event logic.

- [ ] **Step 5: Verify the complete phase.** Run `pnpm exec vitest run tests/checkpoints.test.ts tests/index.test.ts tests/persistence.test.ts tests/state.test.ts tests/pi-contract.test.ts tests/sdk-contract.test.ts tests/tool-selection.test.ts tests/dcp-actions.test.ts tests/compression-timing.test.ts tests/pipeline.test.ts`; expect exit `0`. Audit all seven trigger categories above against the source and assert no append before restoration's host callback completes, no pending force survives a failed event, and the warning closure observes the reloaded logger. Run `pnpm check` and `git diff --check`; expect exit `0`.

- [ ] **Step 6: Commit the integrated phase.** Stage only the listed source/tests and actual progress updates to this plan; commit with `refactor: own DCP branch restoration and checkpoints`. Ship Tasks 1–2 as the complete usable phase. No snapshot schema, release note, version, configuration, or domain glossary change is needed.

## Completion and Handoff

The phase is complete when production events use the owner, no caller manages fingerprints or repair-force flags, all current ordering/storage behavior is pinned, and checks pass. This intentionally revisits the prior plan's checkpoint placement without changing codec/block/selection ownership. Next is [Phase 3](2026-10-13-dcp-depth-phase-03-compression-execution.md); its `DcpCheckpoints.persist()` dependency is unchanged. Implementation boxes remain unchecked; this readiness revision authorizes no product-code execution by itself.
