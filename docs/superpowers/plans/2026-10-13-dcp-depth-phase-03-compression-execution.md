# DCP Depth Phase 3: Compression Run Execution and Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for these coupled changes) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give compression execution and completion one owner for policy, approval coordination, timing, and the post-duration checkpoint.

**Architecture:** A deep compression run module handles both modes and the three host paths: preflight, execution, and completion. Native approval, block mutation, notifications, rendering, and checkpoint writes keep their existing owners; the module coordinates them through the same seam tested by callers. The extension adapter retains registration, model refresh, and host result formatting.

**Tech Stack:** TypeScript/ESM, Node `>=24.15.0`, existing Pi SDK, Vitest, Biome, pnpm; no new dependency.

**Spec:** [Approved three-phase design](../specs/2026-10-13-dcp-architecture-deepening-design.md), especially Phase 3, placement revisits, and compatibility constraints.

**Readiness baseline (14 October 2026):** Reviewed against `9b57752`, after Phases 1 and 2 merged. The working tree was clean before review. Fresh `pnpm check` passed formatting, lint, type checking, and 68 test files / 1,186 tests on Node `v24.21.0`. Phase 3 implementation has not started.

**Review outcome:** The approved architecture and fixed interfaces still fit the current repository. Before implementation, this revision refreshes the prerequisite evidence and closes gaps in the host contract and its verification: completion without execution, host versus DCP duration, live SDK context getters, and errors introduced after block mutation. Temporary tests against unchanged production code passed three real installed-SDK error-path probes (preflight rejection, a throwing notification, and a tool-result hook changing success to error) plus both deferred-approval cases with independent clocks. Those probes were removed; Task 1 makes their assertions permanent before extraction. The default run clock must also resolve `Date.now` at operation time, preserving existing tests that install their clock spy after extension creation.

**Implementation status (15 October 2026):** Tasks 1–2 are implemented against `015ee36`. `src/compress/execution.ts` now owns per-call policy, approval coordination, timing, and completion sequencing; `src/index.ts` retains registration, model refresh, and host result formatting via a small `formatCompressOutcome` adapter. Task 1's preflight, post-mutation failure, and dual-clock characterizations live in `tests/sdk-contract.test.ts`; the allow-path abort characterization lives in `tests/pi-contract.test.ts`; `tests/compression-timing.test.ts` was migrated to `execution.complete` with deterministic clocks. Fresh `pnpm check` passed formatting, lint, type checking, and 69 test files / 1,222 tests; `git diff --check` passed.

## Pi Source Reference and Host Contract

Reference checkout: `/Users/lanh/Developer/pi-packages/pi`, commit `3daa20280f6a7c7cbe0935680c9a38fdc3863005` (coding-agent version `1.2.0`). The installed agent-core/coding-agent SDK is `1.1.0`; the corresponding installed runtime and types were checked too. Implement against installed SDK imports and types; do not upgrade dependencies or import the reference checkout.

- `packages/agent/src/agent-loop.ts`, `executeToolCallsSequential()`/`prepareToolCall()`: `tool_execution_start` precedes argument validation and `tool_call`. Invalid arguments, a preflight block, or host abort can skip tool execution but still produce `tool_execution_end`. Such a call has no DCP start timestamp; completion must still request the ordinary checkpoint. Keep both tool definitions `executionMode: "sequential"`.
- The same file, `executePreparedToolCall()`/`finalizeExecutedToolCall()`/`emitToolExecutionEnd()`: Pi catches thrown tool errors, lets the later tool-result hook change `isError`, and emits the final error status. Completion trusts `event.isError`, not the execution outcome, result details, or a cached success flag. A notification may throw after blocks and statistics have changed; preserve those mutations, clear timing on the error end, and persist without recording a successful duration. Do not add rollback or execution-time cleanup/checkpoints.
- Pi's optional `tool_execution_end.durationMs` measures `execute()` with `performance.now()`: it includes approval waits and excludes later result-hook time. DCP's existing duration uses `Date.now()` from actual compression work until completion: it excludes approval and includes the later host interval. Do not replace DCP timing with the host duration or add that field to `CompressionCompletion`.
- `packages/coding-agent/src/core/agent-session.ts`, `_beforeToolCall()`/`_afterToolCall()` and lifecycle forwarding: the host awaits completion handlers before proceeding to the tool-result message/next context pass. Keep DCP timing cleanup, duration recording, and the synchronous checkpoint in that handler, not `tool_result` or `tool_execution_start`. Exceptions from direct DCP execution propagate to Pi; Pi's conversion to an error result is a separate host responsibility.
- `packages/coding-agent/src/core/extensions/wrapper.ts`, `packages/coding-agent/src/core/tools/tool-definition-wrapper.ts`, and `packages/coding-agent/src/core/extensions/runner.ts`, `createContext()`/`createToolContext()`: the tool adapter forwards its signal and a context with live model/UI/signal getters. Pass the original context into the run owner and approval/notification adapters. Do not spread/destructure its getter-backed values before waiting for approval or refresh model/tool selection inside the owner.
- `packages/coding-agent/src/modes/rpc/rpc-mode.ts`, `createDialogPromise()`: native confirmation resolves false on cancellation/abort, including an already-aborted signal. Keep `requestCompressionApproval` as the adapter and retain its TUI/RPC/unavailable-UI rules. Pi itself checks aborts before calling `execute`; the direct-execution `allow` characterization below deliberately bypasses that host gate and must not redefine host cancellation.

Phase 2 now exports `createDcpCheckpoints(...).persist(): void` from `src/state/checkpoints.ts`; its implemented restoration API is `restoreAndCheckpoint(source, ctx, afterRestore)`. Phase 3 only passes the existing `persist` operation into the run owner. It does not change restoration, fingerprint memory, append retries, or warning handling.

## Global Constraints

- Preserve current commands, text output, dashboard rows, notifications, tool result text, optional display metadata, error messages, and UI routing.
- Preserve pruning/compression algorithms, protected content, message references, compression priority, nudges, tool selection, and statistics calculations.
- Preserve snapshot version `2`, reading versions `1` and `2`, durable field names, fingerprints, owner-session statistics rules, and repair behavior.
- Preserve root `SessionState` and configuration identities; read replaceable nested state at operation time.
- Preserve host event order, per-call approval, approval cancellation, policy rechecks, exception propagation, and checkpoint trigger locations.
- Keep Node `>=24.15.0`, TypeScript/ESM, current dependencies, and configuration. Add no configuration option, dependency, generic event framework, or release.
- Preserve meaningful behavior coverage; replace private tests only after equivalent interface coverage exists.
- Execute after [Phase 2](2026-10-13-dcp-depth-phase-02-checkpoints.md). Consume its `DcpCheckpoints.persist(): void` through a `() => void` dependency; do not reimplement checkpoint policy.
- Preserve sequential tool execution and both registered schemas/descriptions. Keep model compression/approval outside `executeDcpAction`.

## Review Focus

| Input / condition                                                         | Required behavior                                                                                 | Owning checks                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Config/state/model/raw context changes while approval waits               | Read live values at work time; recheck policy without changing tool selection                     | Task 2 live-input tests and existing contracts        |
| Abort signal under `allow` versus `ask`                                   | Preserve the current distinct behavior; no new `allow` cancellation rule                          | Task 1 characterization, Task 2                       |
| Denied/error/no-execution/no-timing completion                            | Attempt the same deduplicated checkpoint; do not invent duration or use host timing               | Task 1 SDK characterization, Task 2 completion matrix |
| Start timestamp `0`, inactive or multiple matching blocks                 | Clear timing and delegate duration writes for every matching block                                | Migrated timing tests, Task 2                         |
| Compression/notification throws or a result hook changes success to error | Preserve direct propagation and mutations; use the final host error status for cleanup/checkpoint | Task 1 SDK characterization, Task 2 exception tests   |

## File Map and Fixed Interfaces

- Create `src/compress/execution.ts`: compression-run policy, approval coordination, timing, and completion sequencing.
- Modify `src/index.ts`: instantiate/delegate to the module; retain schemas, model refresh, and result/display adapters.
- Create `tests/compression-execution.test.ts`; migrate `tests/compression-timing.test.ts` to the new owner interface; extend `tests/pi-contract.test.ts` and `tests/sdk-contract.test.ts` for the missing behavior below.
- Keep `src/compress/permission.ts`, `src/compress/blocks.ts`, `src/capabilities.ts`, `src/state/state.ts`, `src/state/checkpoints.ts`, and presentation modules with their existing responsibilities.

Define these exports in `src/compress/execution.ts` using existing `AgentMessage`, `ExtensionContext`, `SessionState`, `DcpConfig`, `CompressArgs`, and `CompressResult` types:

```ts
export type CompressionExecutionOutcome =
  | { status: "rejected"; message: string }
  | { status: "compressed"; result: CompressResult };
export interface CompressionCompletion {
  toolCallId: string;
  toolName: string;
  isError?: boolean;
}
export interface CompressionExecutionDependencies {
  state: SessionState;
  config: DcpConfig;
  getMessages: () => AgentMessage[];
  onCompressed: (result: CompressResult, ctx: ExtensionContext) => void;
  persist: () => void;
  now?: () => number;
}
export interface CompressionExecution {
  checkToolCall(
    ctx: Pick<ExtensionContext, "model">,
  ): { block: true; reason: string } | undefined;
  execute(
    mode: CompressArgs["mode"],
    toolCallId: string,
    params: Record<string, unknown>,
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ): Promise<CompressionExecutionOutcome>;
  complete(event: CompressionCompletion): void;
}
export function createCompressionExecution(
  dependencies: CompressionExecutionDependencies,
): CompressionExecution;
```

The production dependencies read `latestMessages` through a getter, call the current `sendCompressNotification` through `onCompressed`, and pass `checkpoints.persist`. Use the current `requestCompressionApproval` implementation directly; its real/native context and the existing confirm harness are the two adapters. Do not inject an alternate compression algorithm just to simplify tests. `now` defaults to `Date.now`; tests may supply a deterministic clock.

`checkToolCall` evaluates current capabilities with `ctx.model` identity falling back to stored identity; it does not refresh model state, select tools, request approval, or persist. Suppression order remains config, model, subagent, permission. Preserve these exact first-reason messages:

| Reason     | Tool-call rejection                              | Direct-execution rejection                       |
| ---------- | ------------------------------------------------ | ------------------------------------------------ |
| config     | `Compression is disabled by configuration.`      | `Compression is disabled by configuration.`      |
| model      | `Compression is disabled for the current model`  | `Compression is disabled for the current model.` |
| subagent   | `Compression is disabled in sub-agent sessions.` | `Compression is disabled in sub-agent sessions.` |
| permission | `Compression denied by configuration`            | `Compression is denied by configuration.`        |

`execute` preserves the existing approval sequence: initial policy, current permission, and, only for `ask`, native per-call confirmation followed by abort and fresh policy checks. Then start timing, call `handleCompress`, and invoke synchronous `onCompressed`. Read messages/config/nested state at work time. Do not persist during execution. Resolve `signal ?? ctx.signal` when entering the ask path, pass that same signal to approval, and check it after approval; an explicit signal takes precedence. Preserve the current allow-path behavior. Denial text comes unchanged from the approval adapter; exceptions from compression/notification propagate. Keep the clock default live (`now ?? Date.now` at an operation, or an equivalent wrapper) so later clock spies/fake timers still apply.

`complete` ignores non-compression events. For a compression event, clear matching timing even on error, delegate successful duration recording to `recordCompressionDuration`, then call `persist` exactly once regardless of whether a timing entry existed. Missing `isError` remains success for the existing direct interface/tests; the native SDK supplies a boolean. Trust that final event flag even when execution previously returned success. Do not gate completion on current policy, infer a missing start from host `durationMs`, or add retry/cancellation behavior. One `persist()` call is one deduplicated attempt, not a guarantee that an entry is appended; checkpoint exceptions retain current propagation.

## Task 1: Characterize the Remaining Host Behavior

**Files:** `tests/pi-contract.test.ts`, `tests/sdk-contract.test.ts`; retain `tests/index.test.ts` and `tests/compress-permission.test.ts`.

**Interfaces:** Consumes `askHarness`, `validCompression`, `createExtensionHarness`, and current extension event/tool methods; SDK cases reuse `createHostSession`, the existing fake provider stream, and the state-factory spy. Produces assertions reused unchanged by Task 2. Pi must generate the SDK lifecycle events; do not synthesize completion events in those tests or build a second host harness.

- [x] **Step 1: Add `preserves allow-path behavior with an already-aborted signal`.** Reuse `askHarness({ config: { compress: { permission: "allow" } } })`, its valid content/refs, and an aborted `AbortController`. Execute valid compression, assert the current successful tool content, and assert native confirmation was not called. This pins the existing allow path; do not generalize cancellation while extracting approval logic.

- [x] **Step 2: Pin completion without execution through the installed SDK.** Add `checkpoints a preflight-blocked compression without starting timing`. In the existing real host setup, wrap `session.agent.beforeToolCall`; change the observed state's `compressPermission` to `"deny"` immediately before delegating to the original hook. This makes state dirty after context's checkpoint while keeping the tool callable for that call. Assert `tool_execution_start`, `tool_call`, then one error `tool_execution_end`; no confirmation, notification, or tool-result hook runs. At end, assert no timing/block/statistics change, no host `durationMs`, exact preflight rejection text `Compression denied by configuration`, and a latest checkpoint with `compressPermission: "deny"`. This proves an untimed completion still requests persistence even while policy suppresses compression.

- [x] **Step 3: Pin post-mutation failures through the installed SDK.** Add `checkpoints mutated blocks without duration after a notification error` and `uses the final tool-result error status after successful compression`. Use a valid range selecting older raw context. For the first, configure toast notifications and make native `ui.notify` throw `new Error("notification failed")`; assert Pi emits error content `notification failed` and empty details. For the second, keep notification successful and wrap/delegate the real `session.agent.afterToolCall`, returning its fields with `isError: true`; assert execution's normal text/display metadata remain in the final result while the end event is an error. In both, observe the start entry still present during the result hook, then cleared at completion; blocks/statistics remain changed and are checkpointed with `durationMs: 0`. Do not assert rollback or successful duration for either case. Capture the checkpoint at the end event, before the next context pass can mask missing completion persistence.

- [x] **Step 4: Distinguish both clocks in the existing deferred-approval SDK test.** Keep its approved/denied cases and DCP elapsed assertion of `7`. Supply a separate deterministic `performance.now()` clock: advance it by `5_000` while approval waits, leave it unchanged through execution/result hooks, and assert host end `durationMs: 5_000` for both approved and denied execution. Continue advancing the existing `Date.now()` test clock by `7` in the result hook. This makes substituting host duration for DCP duration observably wrong without a wall-clock timing assertion.

- [x] **Step 5: Verify current behavior.** Run `pnpm exec vitest run tests/pi-contract.test.ts tests/index.test.ts tests/compress-permission.test.ts tests/compression-timing.test.ts tests/sdk-contract.test.ts`; expect exit `0` before extraction. This includes Phase 2's untimed-compression shutdown test, existing TUI/RPC approval, repeated confirmations, post-approval policy changes, disabled-model completion, and both-mode cycles. Reuse that evidence instead of adding duplicate tests. Treat differences from the stated baseline as a preservation issue to investigate, not an opportunity for a behavior fix inside this phase.

## Task 2: Own the Run Lifecycle and Integrate the Host

**Files:** Create `src/compress/execution.ts`, `tests/compression-execution.test.ts`; modify `src/index.ts` and `tests/compression-timing.test.ts`. Retain Task 1's host assertions in `tests/pi-contract.test.ts` and `tests/sdk-contract.test.ts` unchanged.

**Interfaces:** Produces the fixed exports above. Consumes Phase 2's persistence operation and existing approval/block operations. The registered Pi tool interface and successful/error result shapes stay unchanged.

- [x] **Step 1: Write failing owner tests.** Use `createSessionState`, `makeDefaultConfig`, and `createExtensionHarness().context`. Reuse the real raw-message/ref fixtures from existing compression tests for successful range/message cases, configuring turn protection to permit selection. Test all four rejection reasons and precedence, both modes, every-call `ask`, native denial/unavailable UI, abort and policy changes during confirmation, and fresh config/nested-state/message reads after that wait. Assert no tool-selection call on a policy-only query.

  Include `preserves live context model getters across approval`, using a getter-backed context whose model changes while confirmation is pending and asserting the exact model rejection with no work/timing/checkpoint. Add `uses the explicit signal before the context signal` and `falls back to the context signal when no call signal is supplied`, asserting the signal passed to `confirm` and the post-wait decision. In the live-state case, replace nested block/reference state and the raw-message array behind `getMessages` while awaiting approval, and change relevant config in place; prove work uses the replacements and leaves the old nested state untouched. `checkToolCall` also needs a missing-context-model case using current stored model identity. Keep manual mode and active-tool selection outside policy suppression.

  Test completion at the interface, including this fixture requiring no compression selection:

  ```ts
  it("clears error timing and still requests a checkpoint", () => {
    const state = createSessionState();
    state.compressionTiming.startTimes.set("call", 0);
    const persist = vi.fn();
    const execution = createCompressionExecution({
      state,
      config: makeDefaultConfig(),
      getMessages: () => [],
      onCompressed: vi.fn(),
      persist,
      now: () => 100,
    });
    execution.complete({
      toolCallId: "call",
      toolName: "compress",
      isError: true,
    });
    expect(state.compressionTiming.startTimes.has("call")).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
  });
  ```

  Add completion cases for no start, time zero, omitted error flag, multiple/inactive matching blocks, unrelated tool, policy changes, and repeated end events. A repeated end does not rewrite duration, but still requests one deduplicated checkpoint per compression-end event. In the persistence callback, assert timing has cleared and successful durations have already changed. Test compression and `onCompressed` exceptions propagating, no checkpoint during execution, and cleanup when the later error end arrives. Trigger the compression exception with real invalid/protected selection; do not inject a replacement compressor. If `onCompressed` throws, assert existing block/statistics writes survive and its original error propagates. A throwing `persist` callback must propagate after timing/duration updates, without retrying within `complete`.

- [x] **Step 2: Demonstrate failure.** Run `pnpm exec vitest run tests/compression-execution.test.ts`; expect missing module/exports.

- [x] **Step 3: Implement the run module.** Use live root/config reads and the actual `getDcpCapabilities`, `requestCompressionApproval`, `handleCompress`, and `recordCompressionDuration`. Copy existing rejection copy exactly. Keep the timing map in `state.compressionTiming.startTimes`; do not create competing run state. Invoke `onCompressed` once after normal compression and before returning the successful outcome. Do not catch unexpected compression/notification/persistence exceptions or call the operator-action callback.

- [x] **Step 4: Integrate the three host paths and migrate timing tests.** Instantiate once in `createExtension`, after `checkpoints` exists, passing the live raw-context getter, current notification closure, and its `persist` operation. After `selection.refreshModel(ctx.model)`, compression tool-call handling delegates to `checkToolCall`. Registered mode-specific `execute` callbacks await `execution.execute`; map rejection to `{ content: [{ type: "text", text: message }], details: {}, isError: true }`, and success to the existing result text plus `createCompressionDisplayDetails`. A small shared host-formatting helper is acceptable; it owns no policy, approval, timing, or checkpoint sequencing. Keep `renderCall`/`renderResult` and registration definitions unchanged. Compression-end handling calls only `execution.complete(event)` then returns, including policy-suppressed/error/no-start cases. Preserve the non-compression path and the `evaluateCapabilities` helper still used by other handlers. Delete the old execution implementation/rejection helpers, obsolete imports, and `applyCompressionTiming` from `index.ts`; migrate its existing timing assertions to `execution.complete` with deterministic `now`. Do not retain a test-only forwarding export or delete meaningful duration coverage.

- [x] **Step 5: Verify the complete phase.** Run `pnpm exec vitest run tests/compression-execution.test.ts tests/compression-timing.test.ts tests/compress-permission.test.ts tests/compression-blocks.test.ts tests/compress-cycle.test.ts tests/index.test.ts tests/pi-contract.test.ts tests/sdk-contract.test.ts tests/compress-notification.test.ts tests/notification-delivery.test.ts tests/compress-render.test.ts tests/tool-selection.test.ts tests/checkpoints.test.ts`; expect exit `0`. Audit that timing and completion/checkpoint ordering have one production owner, that existing block writes still go through `blocks.ts`, and that successful/error host result shapes remain exact. Run `pnpm check` and `git diff --check`; expect exit `0`.

- [x] **Step 6: Commit the completed phase.** Stage only the listed source/tests and actual progress updates to this plan; commit with `refactor: own DCP compression run execution`. Ship Tasks 1–2 together as the usable phase. No schema, release, user-visible documentation, configuration, or glossary change is required.

## Completion and Whole-Change Handoff

Phase 3 is implemented: tool preflight, direct execution, and completion delegate to `createCompressionExecution`, `index.ts` keeps only registration and formatting, Task 1's host characterizations are permanent, and all checks pass. This intentionally revisits the earlier checkpoint-placement decision while preserving guarded-action, selection, codec, and block ownership. Phases 1 and 2 are also implemented. The three-phase work is complete; no follow-up phase is required, and no schema, release, user-visible documentation, configuration, or glossary change was needed.
