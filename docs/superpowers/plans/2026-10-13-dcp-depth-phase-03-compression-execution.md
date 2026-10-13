# DCP Depth Phase 3: Compression Run Execution and Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for these coupled changes) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give compression execution and completion one owner for policy, approval coordination, timing, and the post-duration checkpoint.

**Architecture:** A deep compression run module handles both modes and the three host paths: preflight, execution, and completion. Native approval, block mutation, notifications, rendering, and checkpoint writes keep their existing owners; the module coordinates them through the same seam tested by callers. The extension adapter retains registration, model refresh, and host result formatting.

**Tech Stack:** TypeScript/ESM, Node `>=24.15.0`, existing Pi SDK, Vitest, Biome, pnpm; no new dependency.

**Spec:** [Approved three-phase design](../specs/2026-10-13-dcp-architecture-deepening-design.md), especially Phase 3, placement revisits, and compatibility constraints.

**Planning baseline:** `41da383`; fresh `pnpm check` passed on 13 October 2026: formatting, lint, type checking, and 66 test files / 1,153 tests. Implementation has not started.

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

| Input / condition | Required behavior | Owning checks |
| --- | --- | --- |
| Config/state/model/raw context changes while approval waits | Read live values at work time; recheck policy without changing tool selection | Task 2 live-input tests and existing contracts |
| Abort signal under `allow` versus `ask` | Preserve the current distinct behavior; no new `allow` cancellation rule | Task 1 characterization, Task 2 |
| Denied/error/no-timing compression completion | Attempt the same deduplicated checkpoint; do not invent duration | Task 2 completion matrix |
| Start timestamp `0`, inactive or multiple matching blocks | Clear timing and delegate duration writes for every matching block | Migrated timing tests, Task 2 |
| Compression or notification callback throws | Preserve propagation and later error-event cleanup | Task 2 exception tests |

## File Map and Fixed Interfaces

- Create `src/compress/execution.ts`: compression-run policy, approval coordination, timing, and completion sequencing.
- Modify `src/index.ts`: instantiate/delegate to the module; retain schemas, model refresh, and result/display adapters.
- Create `tests/compression-execution.test.ts`; migrate `tests/compression-timing.test.ts` to the new owner interface; extend `tests/pi-contract.test.ts` only for missing behavior.
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
  checkToolCall(ctx: Pick<ExtensionContext, "model">):
    { block: true; reason: string } | undefined;
  execute(
    mode: CompressArgs["mode"], toolCallId: string,
    params: Record<string, unknown>, ctx: ExtensionContext,
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

| Reason | Tool-call rejection | Direct-execution rejection |
| --- | --- | --- |
| config | `Compression is disabled by configuration.` | `Compression is disabled by configuration.` |
| model | `Compression is disabled for the current model` | `Compression is disabled for the current model.` |
| subagent | `Compression is disabled in sub-agent sessions.` | `Compression is disabled in sub-agent sessions.` |
| permission | `Compression denied by configuration` | `Compression is denied by configuration.` |

`execute` preserves the existing approval sequence: policy, current permission, native per-call confirmation for `ask`, abort check, fresh policy check, timing start, `handleCompress`, then synchronous `onCompressed`. Read messages/config/nested state at work time. Do not persist during execution. Preserve `signal ?? ctx.signal` in the ask path and the current allow-path behavior. Denial text comes unchanged from the approval adapter; exceptions from compression/notification propagate.

`complete` ignores non-compression events. For a compression event, clear matching timing even on error, delegate successful duration recording to `recordCompressionDuration`, then call `persist` exactly once regardless of whether a timing entry existed. Missing `isError` remains success. Do not gate completion on current policy or add retry/cancellation behavior.

## Task 1: Characterize the Remaining Host Behavior

**Files:** `tests/pi-contract.test.ts`; retain `tests/index.test.ts`, `tests/compress-permission.test.ts`, and existing SDK contracts.

**Interfaces:** Consumes `askHarness`, `validCompression`, `createExtensionHarness`, and current extension event/tool methods. Produces assertions reused unchanged by Task 2.

- [ ] **Step 1: Add `preserves allow-path behavior with an already-aborted signal`.** Reuse `askHarness({ config: { compress: { permission: "allow" } } })`, its valid content/refs, and an aborted `AbortController`. Execute valid compression, assert the current successful tool content, and assert native confirmation was not called. This pins the existing allow path; do not generalize cancellation while extracting approval logic.

- [ ] **Step 2: Verify current behavior.** Run `pnpm exec vitest run tests/pi-contract.test.ts tests/index.test.ts tests/compress-permission.test.ts tests/compression-timing.test.ts tests/sdk-contract.test.ts`; expect exit `0` before extraction. This includes Phase 2's untimed-compression shutdown test, existing TUI/RPC approval, repeated confirmations, post-approval policy changes, disabled-model completion, and both-mode cycles. Reuse that evidence instead of adding duplicate tests. Treat differences from the stated baseline as a preservation issue to investigate, not an opportunity for a behavior fix inside this phase.

## Task 2: Own the Run Lifecycle and Integrate the Host

**Files:** Create `src/compress/execution.ts`, `tests/compression-execution.test.ts`; modify `src/index.ts`, `tests/compression-timing.test.ts`, and missing host contract tests from Task 1.

**Interfaces:** Produces the fixed exports above. Consumes Phase 2's persistence operation and existing approval/block operations. The registered Pi tool interface and successful/error result shapes stay unchanged.

- [ ] **Step 1: Write failing owner tests.** Use `createSessionState`, `makeDefaultConfig`, and `createExtensionHarness().context`. Reuse the real raw-message/ref fixtures from existing compression tests for successful range/message cases, configuring turn protection to permit selection. Test all four rejection reasons and precedence, both modes, every-call `ask`, native denial/unavailable UI, abort and policy changes during confirmation, and fresh config/nested-state/message reads after that wait. Assert no tool-selection call on a policy-only query.

  Test completion at the interface, including this fixture requiring no compression selection:

  ```ts
  it("clears error timing and still requests a checkpoint", () => {
    const state = createSessionState();
    state.compressionTiming.startTimes.set("call", 0);
    const persist = vi.fn();
    const execution = createCompressionExecution({
      state, config: makeDefaultConfig(), getMessages: () => [],
      onCompressed: vi.fn(), persist, now: () => 100,
    });
    execution.complete({ toolCallId: "call", toolName: "compress", isError: true });
    expect(state.compressionTiming.startTimes.has("call")).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
  });
  ```

  Add completion cases for no start, time zero, omitted error flag, multiple/inactive matching blocks, unrelated tool, policy changes, and repeated end events. A repeated end does not rewrite duration, but still requests one deduplicated checkpoint per compression-end event. In the persistence callback, assert timing has cleared and successful durations have already changed. Test compression and `onCompressed` exceptions propagating, no checkpoint during execution, and cleanup when the later error end arrives.

- [ ] **Step 2: Demonstrate failure.** Run `pnpm exec vitest run tests/compression-execution.test.ts`; expect missing module/exports.

- [ ] **Step 3: Implement the run module.** Use live root/config reads and the actual `getDcpCapabilities`, `requestCompressionApproval`, `handleCompress`, and `recordCompressionDuration`. Copy existing rejection copy exactly. Keep the timing map in `state.compressionTiming.startTimes`; do not create competing run state. Invoke `onCompressed` once after normal compression and before returning the successful outcome. Do not catch unexpected compression/notification/persistence exceptions or call the operator-action callback.

- [ ] **Step 4: Integrate the three host paths and migrate timing tests.** Instantiate once in `createExtension`. After `selection.refreshModel(ctx.model)`, tool-call handling delegates to `checkToolCall`. Registered mode-specific `execute` callbacks await `execution.execute`; map rejection to `{ content: [{ type: "text", text: message }], details: {}, isError: true }`, and success to the existing result text plus `createCompressionDisplayDetails`. Keep `renderCall`/`renderResult` and registration definitions unchanged. Compression-end handling calls only `execution.complete(event)` then returns, including policy-suppressed/error/no-start cases. Preserve the non-compression path. Delete closure-local execute/rejection helpers and `applyCompressionTiming` from `index.ts`; migrate its existing timing assertions to `execution.complete` with deterministic `now`. Do not retain a test-only forwarding export or delete meaningful duration coverage.

- [ ] **Step 5: Verify the complete phase.** Run `pnpm exec vitest run tests/compression-execution.test.ts tests/compression-timing.test.ts tests/compress-permission.test.ts tests/compression-blocks.test.ts tests/compress-cycle.test.ts tests/index.test.ts tests/pi-contract.test.ts tests/sdk-contract.test.ts tests/compress-notification.test.ts tests/notification-delivery.test.ts tests/compress-render.test.ts tests/tool-selection.test.ts tests/checkpoints.test.ts`; expect exit `0`. Audit that timing and completion/checkpoint ordering have one production owner, that existing block writes still go through `blocks.ts`, and that successful/error host result shapes remain exact. Run `pnpm check` and `git diff --check`; expect exit `0`.

- [ ] **Step 6: Commit the completed phase.** Stage only the listed source/tests and actual progress updates to this plan; commit with `refactor: own DCP compression run execution`. Ship Tasks 1–2 together as the usable phase. No schema, release, user-visible documentation, configuration, or glossary change is required.

## Completion and Whole-Change Handoff

All three phases are complete only when their integrated production paths and meaningful checks pass. Phases 2–3 intentionally revise the earlier placement decision while preserving guarded-action, selection, codec, and block ownership. Revert later dependent phases first. All checkboxes are intentionally unchecked at plan-writing time; review and choose an execution method before implementation.
