# DCP Depth Phase 2: Branch Restoration and Checkpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for these coupled changes) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give branch restoration and checkpoint decisions one owner while preserving host event order and durable-state behavior.

**Architecture:** Move reset/default/restore coordination and ephemeral fingerprint/repair decisions behind a deep branch persistence module. Its interface separates restoration from the later persistence attempt so host model/tool/prompt work keeps its current order. Reuse the snapshot codec, compression block owner, Pi host adapter, and existing harness.

**Tech Stack:** TypeScript/ESM, Node `>=24.15.0`, existing Pi SDK, Vitest, Biome, pnpm; no new dependency.

**Spec:** [Approved three-phase design](../specs/2026-10-13-dcp-architecture-deepening-design.md), especially Phase 2, placement revisits, and compatibility constraints.

**Planning baseline:** `41da383`; fresh `pnpm check` passed on 13 October 2026: formatting, lint, type checking, and 66 test files / 1,153 tests. Implementation has not started.

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

| Input / condition | Required behavior | Owning checks |
| --- | --- | --- |
| Same durable facts on an empty/malformed branch | Still attempt the event's forced baseline/repair checkpoint | Task 2 restore matrix |
| Failed append after a changed-state write | Warn without advancing the fingerprint; subsequent changed-state attempt retries | Tasks 1–2 failure tests |
| Failed forced write with a previously equal fingerprint | Consume that event's force decision; no recurring forced-retry policy | Tasks 1–2 force characterization |
| Shutdown before compression completion | Persist current block facts without inventing a duration | Task 1 host shutdown test |
| Configuration/model/tool work between restore and persist | Use current config defaults and preserve selection-before-checkpoint ordering | Existing lifecycle contracts, Task 2 integration |

## File Map and Fixed Interfaces

- Create `src/state/checkpoints.ts`: restoration coordination, fingerprint memory, event-local force intent, and append behavior.
- Modify `src/index.ts`: instantiate the owner and delegate restoration/persistence; retain other host work.
- Create `tests/checkpoints.test.ts`; extend `tests/index.test.ts` for missing host behavior.
- Existing `src/state/persistence.ts`, `src/state/state.ts`, `src/compress/blocks.ts`, and `src/tool-selection.ts` remain the implementations of their existing responsibilities.

Define these exports in `src/state/checkpoints.ts` using installed SDK types and the existing `DcpConfig`/`SessionState`:

```ts
export type DcpCheckpointHost = Pick<ExtensionAPI, "appendEntry">;
export type DcpBranchContext = Pick<ExtensionContext, "sessionManager">;
export type DcpRestoreSource = "session-start" | "branch-navigation";
export type DcpCheckpointWarning = (
  message: string, details?: Record<string, unknown>,
) => void;
export interface DcpCheckpoints {
  restoreBranch(source: DcpRestoreSource, ctx: DcpBranchContext): void;
  persist(): void;
}
export function createDcpCheckpoints(
  host: DcpCheckpointHost, state: SessionState,
  config: DcpConfig, warn: DcpCheckpointWarning,
): DcpCheckpoints;
```

`restoreBranch` resets state through `resetSessionState`, applies current configured manual-mode/permission defaults, and performs the existing reverse branch scan/codec restoration. `session-start` clears the previous fingerprint; `branch-navigation` preserves it until the same existing restore/append conditions update it. A clean same-owner restoration records the restored fingerprint; inherited owners, skipped invalid snapshots, or missing state retain the existing force decision. It does not append immediately or return snapshot internals to callers.

`persist` consumes the stored event force decision for this attempt and runs the existing serialize/fingerprint/deduplication/append ordering. It advances the fingerprint only on success. Catch only host append failure, retaining `failed to persist native session state` and `{ error: String(error) }`; codec or warning callback exceptions propagate as before. Empty-session serialization returns without appending. Use a warning closure that reads the current `logger` variable after reload; do not capture the initial logger.

## Task 1: Characterize Write Failures and Shutdown

**Files:** `tests/index.test.ts`; retain current restoration, compaction, command-callback, and contract tests.

**Interfaces:** Consumes existing `createExtension`, `createMockApi`, `registeredHandler`, and `sessionContext` fixtures in that file. Produces baseline assertions reused unchanged after extraction.

- [ ] **Step 1: Add `retries changed state after append failure without advancing the fingerprint`.** Start an empty session to establish a successful baseline. Use `vi.spyOn(api, "appendEntry").mockImplementationOnce(() => { throw new Error("append failed"); })` before the manual-mode command changes state. Spy on `Logger.prototype.warn`; assert the existing warning. Trigger `session_shutdown`: the unchanged-since-failure manual-mode state must now append successfully. Repeating shutdown must append nothing. Restore spies after the test; retain the existing session-context fixtures and command path.

- [ ] **Step 2: Add `does not carry a failed event-local force decision into later shutdown`.** Establish a baseline and save its serialized entry. Set the branch to that same baseline followed by a malformed DCP entry; invoke `session_tree` with the append throwing once. The forced repair attempt warns. Invoke shutdown with unchanged durable facts; append call count must remain one for this failed force attempt. This pins the current fingerprint-equal behavior rather than silently adding retries.

- [ ] **Step 3: Add `persists untimed compression on shutdown`.** Reuse the valid range compression/context fixtures already used by index tests, with protection permitting the selected content. Start a session, run a context pass, execute a compression, and emit shutdown without a compression-end event. Assert one new checkpoint contains the created block with duration `0`; a repeated shutdown adds none. Do not change compression algorithms to support the fixture.

- [ ] **Step 4: Verify current behavior.** Run `pnpm exec vitest run tests/index.test.ts tests/pi-contract.test.ts tests/persistence.test.ts tests/state.test.ts`; expect exit `0`. Characterization tests should pass before extraction. If observed force/failure behavior differs, investigate and reconcile with the approved preservation requirement before proceeding.

## Task 2: Introduce and Integrate the Branch Persistence Owner

**Files:** Create `src/state/checkpoints.ts`, `tests/checkpoints.test.ts`; modify `src/index.ts`.

**Interfaces:** Produces the fixed exports above. Phase 3 consumes `DcpCheckpoints.persist()` through a `() => void` dependency. Existing event/command interfaces stay unchanged.

- [ ] **Step 1: Write failing tests at the owner interface.** Build contexts with `createExtensionHarness({ sessionId, branch }).context` and use a recording/throwing `appendEntry` adapter. Create snapshots via `serializeDcpSnapshot` and existing state constructors. Test this matrix:

  | Case | Assert after `restoreBranch`, then `persist` |
  | --- | --- |
  | Clean same-owner v1/v2 snapshot | Restored stats/permission/refs; no append until durable facts change |
  | Parent-owned snapshot restored to `child` | Blocks/refs retained; session stats zero; one child-owned v2 checkpoint |
  | Unsupported v3 or malformed newest entry | Older valid snapshot restored; one repair checkpoint |
  | No valid DCP entry | Current configured defaults; one baseline checkpoint even if fingerprint matched the previous branch |
  | Changed state, append throws then succeeds | Existing warning; successful retry; subsequent unchanged call deduplicated |
  | Equal-fingerprint forced attempt throws | Later unchanged attempt does not repeat force |
  | No session ID | No append |

  Also test `preserves root identity and reads reloaded defaults`, `waits for host work before writing a repair`, `ignores reference-only changes`, and `reads new nested state for each persist`. For ordering, assert no append after restoration, change a durable fact, then persist and inspect the final snapshot.

  ```ts
  it("does not append without a session identity", () => {
    const host = { appendEntry: vi.fn() } satisfies DcpCheckpointHost;
    const checkpoints = createDcpCheckpoints(
      host, createSessionState(), makeDefaultConfig(), vi.fn(),
    );
    checkpoints.persist();
    expect(host.appendEntry).not.toHaveBeenCalled();
  });
  ```

- [ ] **Step 2: Demonstrate failure.** Run `pnpm exec vitest run tests/checkpoints.test.ts`; expect missing module/exports before implementation.

- [ ] **Step 3: Implement the owner.** Reuse `parseDcpSnapshot`, `restoreDcpSnapshot`, `serializeDcpSnapshot`, and `durableStateFingerprint` without changing their algorithms or consolidating their repeated decoding/serialization in this phase. Keep pending force private and consume it at the scheduled persistence attempt, including early return/exception paths, exactly as an event-local force argument would behave. Retain current root/config references and current logger through the supplied warning closure.

- [ ] **Step 4: Integrate every production call site.** Instantiate `createDcpCheckpoints` once in `createExtension`. Replace `restoreActiveBranch`, `persistIfChanged`, and closure-local fingerprint storage. At `session_start`, reload config, clear `latestMessages`, restore with `session-start`, perform current model/subagent/prompt/registration/selection/context-window/log work, then persist. At `session_tree`, clear `latestMessages`, restore with `branch-navigation`, perform current subagent/selection work, then persist. Replace the other persistence triggers in place: operator callback after selection, compaction after resets/logging, shutdown, compression end after duration, and context after pipeline/logging but before notifications. Keep compaction's block clearing and reference-sequence behavior with existing owners. Remove obsolete imports/locals; do not relocate other event logic.

- [ ] **Step 5: Verify the complete phase.** Run `pnpm exec vitest run tests/checkpoints.test.ts tests/index.test.ts tests/persistence.test.ts tests/state.test.ts tests/pi-contract.test.ts tests/sdk-contract.test.ts tests/tool-selection.test.ts tests/dcp-actions.test.ts tests/compression-timing.test.ts tests/pipeline.test.ts`; expect exit `0`. Audit all seven trigger categories above against the source and assert no extra eager append during restore. Run `pnpm check` and `git diff --check`; expect exit `0`.

- [ ] **Step 6: Commit the integrated phase.** Stage only the listed source/tests and actual progress updates to this plan; commit with `refactor: own DCP branch restoration and checkpoints`. Ship Tasks 1–2 as the complete usable phase. No snapshot schema, release note, version, configuration, or domain glossary change is needed.

## Completion and Handoff

The phase is complete when production events use the owner, no caller manages fingerprints or repair-force flags, all current ordering/storage behavior is pinned, and checks pass. This intentionally revisits the prior plan's checkpoint placement without changing codec/block/selection ownership. Next is [Phase 3](2026-10-13-dcp-depth-phase-03-compression-execution.md); implementation boxes remain unchecked at plan-writing time.
