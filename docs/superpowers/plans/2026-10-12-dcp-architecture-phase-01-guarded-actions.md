# Guarded DCP Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make commands and the TUI panel use one guarded action module while retaining their existing presentation.

**Architecture:** A synchronous executor owns policy, dispatch, and callback ordering. Adapters pass requests and the current context, then present the returned message. Existing command implementations stay inside the executor's implementation dependencies for this phase.

**Tech Stack:** Existing TypeScript/ESM, Pi types, Vitest, Biome; Node `>=24.15.0`.

**Spec:** [Approved design](../specs/2026-10-12-dcp-architecture-design.md). [Roadmap and shared constraints](2026-10-12-dcp-architecture-plan.md).

## Readiness review — 2026-10-12

The revised plan is ready to implement against the reviewed current repository. The original plan needed the execution-baseline and verification clarifications below; the architecture and approved behavior remain unchanged. This review completes no implementation step.

- Reviewed DCP HEAD: `847806621b5125c4ec54cdfc0d725fbebf5029f8` (`8478066`), initially clean. `2258ca5` is the historical architecture-review baseline, not the checkout to implement against. Since that baseline, planning was merged and dependencies moved to Pi `1.1.0`; `src/` has no intervening changes. This phase's execution baseline supersedes the roadmap's historical base for phase 1.
- Current verification: `pnpm check` passed with `819` tests across `58` suites on Node `v24.21.0`; the six existing action/adapter/host suites in Step 1 passed with `160` tests. These are review observations; rerun the gates during execution.
- No shared executor exists yet. Commands own their guards/callbacks; `applyDcpPanelAction` owns panel dispatch, while `openDcpPanel` owns the panel's guard calculation/callback.
- Existing registration tests check disabled-model rejection but not successful callback count/order. Panel controller tests observe snapshots; snapshot deduplication cannot prove exactly one callback. Add direct callback-spy coverage at both adapters, plus a real callback reconciliation test.
- The original test table leaves policy precedence, stale toggle direction, raw argument forwarding, and callback-before-presentation coverage implicit. The revised steps pin those behaviors.
- A fresh read-only builder review checked this plan against the approved design, current adapters/harness, Pi source, and installed SDK. It found no important unanswered questions or impossible test setups.

### Pi reference and host boundary

Read-only reference: `/Users/lanh/Developer/pi-packages/pi`, clean at `7bd01fb92485c06f92ecfff7ccf3197148bc16af`. The reference package and installed `@earendil-works/pi-coding-agent` both report `1.1.0`; the installed package declarations/runtime remain authoritative for DCP compilation.

| Reference file                                                                                                                     | Relevant contract                                                                                                 | Phase-1 consequence                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/coding-agent/src/core/extensions/types.ts` — `RegisteredCommand`, `ExtensionCommandContext`, `ExtensionUIContext.custom` | Handlers return `Promise<void>`; custom UI returns a promise; command contexts carry the current model and UI.    | Keep registered handlers and `openDcpPanel` async. Only the domain executor is synchronous. Preserve the TUI mode/`hasUI` guard.                                                                                             |
| `packages/coding-agent/src/core/extensions/runner.ts` — `createContext`, `createCommandContext`                                    | Context values use guarded live getters; command-context creation preserves descriptors.                          | Pass the original context to execution and callback. Read model identity at action time after the panel wait; do not spread or cache the context. Getter failures propagate like other unexpected errors.                    |
| `packages/coding-agent/src/core/agent-session.ts` — `_tryExecuteExtensionCommand`                                                  | Pi extracts raw arguments, awaits the registered handler, and catches handler failures to report a command error. | Forward raw args unchanged. Executor tests assert synchronous throws; direct registered-handler/controller tests assert promise rejection with the same error. Do not add a DCP catch, notify, or retry for action failures. |

The installed counterparts are `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` and `runner.js`. This review does not require changing or rebuilding Pi, adding a Pi checkout dependency, or modifying the extension harness.

## Global constraints

- Implement phase 1 from the reviewed current DCP code (`8478066` or a descendant containing this revised plan), retaining its dependency/lockfile changes. If runtime code changed since review, repeat the readiness check. Later phase-2/3/4 modules are not dependencies.
- Preserve command parsing/messages, current policy-message precedence, stale panel action results, and synchronous exception propagation.
- Permission-only denial does not reject these actions.
- Invoke the original callback/context once after a normally completed permitted attempt, including a query, validation error, or no-op. Policy rejection and implementation throws skip it.
- UI delivery stays in the adapters. Informational commands and model compression execution/approval remain unchanged.
- Preserve live root state/config references and read nested values at execution time; do not capture a prebuilt capability object, `config.compress`, or `blocksById` in registration.

## Review focus

- Panel policy changes between projection and execution: execution uses current context/config/state.
- Missing block from a stale panel row: permitted result remains true, error copy is unchanged, callback runs once.
- Manual query/invalid input and empty sweep: callback remains observable even without a mutation.
- Command implementation throws: same exception escapes and callback/UI delivery do not run.
- Callback throws: propagate once without retry or a second callback.
- Pi context getters, command handlers, and panel waits: current model identity wins over cached state, missing identity falls back per field, and action errors remain outside the custom-UI recovery catch.

## Task 1: Integrate the shared action seam

**Files:**

- Create: `src/commands/actions.ts`, `tests/dcp-actions.test.ts`.
- Modify: `src/commands/register.ts:18`, `src/tui/panel-model.ts:16`, `src/tui/panel.ts:279`.
- Update tests: `tests/commands-register.test.ts`, `tests/panel-model.test.ts`, `tests/panel.test.ts`, `tests/pi-contract.test.ts`.
- Retain: `src/commands/manual.ts`, `permission.ts`, `sweep.ts`, `decompress.ts`, `recompress.ts`; `src/index.ts` keeps the existing `onStateChange` callback.

**Interfaces:**

Produce these exports in `src/commands/actions.ts`:

```typescript
export type DcpAction =
  | { type: "manual"; args: string }
  | { type: "toggle-manual" }
  | { type: "cycle-permission" }
  | { type: "sweep" }
  | { type: "decompress"; args: string }
  | { type: "recompress"; args: string }
  | { type: "toggle-block"; blockId: number };

export interface DcpActionDependencies {
  state: SessionState;
  config: DcpConfig;
  onStateChange: (ctx: ExtensionCommandContext) => void;
}

export interface DcpActionResult {
  permitted: boolean;
  message: string;
}

export function executeDcpAction(
  action: DcpAction,
  ctx: ExtensionCommandContext,
  dependencies: DcpActionDependencies,
): DcpActionResult;
```

Use type imports from the existing SDK, `../config.ts`, and `../state/types.ts`. The two manual forms and three block-control forms preserve command input versus panel toggle intent; they are request forms for five action families, not new user-visible operations.

The panel retains its current request set:

```typescript
export type DcpPanelAction =
  | Extract<
      DcpAction,
      { type: "toggle-manual" | "cycle-permission" | "sweep" | "toggle-block" }
    >
  | { type: "close" };
```

Close is handled by the panel before execution. `buildDcpPanelModel` remains read-only. Remove `applyDcpPanelAction` after its production and test consumers move.

- [ ] **Step 1: Characterize current adapter behavior.** Confirm an understood worktree and run `pnpm check`, then `pnpm exec vitest run tests/commands-register.test.ts tests/panel-model.test.ts tests/panel.test.ts tests/commands-permission.test.ts tests/index.test.ts tests/pi-contract.test.ts`; expect exit `0`. Before changing adapters, add the following characterization tests and rerun those six suites green:
  - In `commands-register.test.ts`, register with `createExtensionHarness().api`, fresh state/config, and an `onStateChange` spy. Call each of the five guarded handlers with the explicit `harness.commandContext`; assert one callback with that exact object per permitted attempt, and one `notify(message, "info")` after the callback. Include manual query, invalid manual input, repeated `on`, empty sweep, and invalid/missing block arguments. Use independent fixtures or clear spies between attempts.
  - In `panel.test.ts`, call `openDcpPanel` directly with fresh state/config and a callback spy, using the existing custom-UI driver and fake theme. Each of the four panel action types calls back once with the same context; rejection, explicit close, and `undefined` completion call back zero times. A permitted stale missing-block result still calls back once. In the callback assert custom UI has opened only once; the second component then shows the result, proving callback precedes rebuilding/presentation. Keep existing full-extension persistence/render tests.
  - In `pi-contract.test.ts`, parameterize manual query (`""`), invalid manual args (`"invalid"`), already-selected manual off (`"off"`), and empty sweep. Start with `disabledModels: ["test/disabled"]` and current model `test/disabled`, emit `session_start`, verify `compress` was suppressed, and clear baseline entries. Call `harness.setModel({ provider: "test", id: "enabled" })` without a `model_select` event, then run the no-op command: `compress` is restored and entries remain empty. This proves the real callback refreshes model identity/reconciles selection even when persistence is deduplicated. Retain the existing `index.test.ts` snapshot-deduplication assertions.

- [ ] **Step 2: Write action-seam tests.** Use `createExtensionHarness().commandContext`, `createSessionState`, and `makeDefaultConfig`; use a spy for the existing callback. Include this contract test in `tests/dcp-actions.test.ts`:

```typescript
it("calls back once with the original context after a permitted manual action", () => {
  const ctx = createExtensionHarness().commandContext;
  const state = createSessionState();
  const config = makeDefaultConfig();
  const onStateChange = vi.fn((seen: ExtensionCommandContext) => {
    expect(seen).toBe(ctx);
    expect(state.manualMode).toBe("active");
  });
  const result = executeDcpAction({ type: "manual", args: "on" }, ctx, {
    state,
    config,
    onStateChange,
  });
  expect(result).toEqual({
    permitted: true,
    message: "Manual mode: on. Automatic compression is paused.",
  });
  expect(onStateChange).toHaveBeenCalledTimes(1);
});
```

Add named cases with these exact assertions:

| Test name                                           | Assertions                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rejects current pipeline policy before execution`  | `config.enabled = false`; `expect(state.manualMode).toBe(false)`, `permitted` is false, message is `DCP is disabled by configuration.`, callback count is `0`. Parameterize all seven request forms with a fresh fixture; block/permission/tool-pruning state also remains unchanged.                                                                                                                                                 |
| `preserves policy message precedence`               | Combine global disable, sub-agent suppression, disabled model, and permission denial. Message is `DCP is disabled by configuration.`; with global enable it is `DCP is disabled in sub-agent sessions.`; with sub-agent suppression removed it is `DCP is disabled for the current model.`. Every rejection has callback count `0`.                                                                                                   |
| `allows operator controls under permission denial`  | Permission `deny`; sweep/manual/permission/block controls still reach their normal command result.                                                                                                                                                                                                                                                                                                                                    |
| `preserves callbacks for allowed errors and no-ops` | Manual args `""` and `"invalid"`, empty sweep, already-selected manual mode: `permitted` true and callback count `1` for each attempt.                                                                                                                                                                                                                                                                                                |
| `rechecks a stale block action`                     | Toggle missing block `99`: message `Block 99 not found.`, `permitted` true, callback count `1`.                                                                                                                                                                                                                                                                                                                                       |
| `reads current policy after a panel projection`     | Build a row while enabled, disable config before execution: no mutation and callback count `0`.                                                                                                                                                                                                                                                                                                                                       |
| `uses live model identity with cached fallback`     | On the same context, `harness.setModel` changes enabled to disabled and disabled to enabled; execution follows the latest model rather than cached state. With `harness.context.model = undefined`, cached disabled model rejects with `DCP is disabled for the current model.` and callback count `0`.                                                                                                                               |
| `reads replaced nested config and block state`      | Replace `config.compress` with a current permission of `deny`, leaving the session override undefined: cycling returns `Compress permission: allow`. With session override `ask`, it returns `Compress permission: deny`. Replace `state.prune.messages.blocksById` after projection; execution resolves the replacement block map.                                                                                                   |
| `resolves toggle direction from current state`      | Project manual off then set it active before execution: toggle returns `Manual mode: off. Automatic compression resumed.`. Project an active block then mark it user-deactivated: toggle returns `Block 1 reactivated. Compression will apply on next context pass.`. If the block is inactive and not user-deactivated, return `Block 1 was not deactivated by user. Cannot reactivate.`. All are permitted with callback count `1`. |
| `preserves raw command argument behavior`           | Manual `" ON "` succeeds with the existing on message; decompression/recompression `"1suffix"` still parse block `1` using the existing implementation. Empty and invalid block args retain `Usage: dcp:decompress <blockId>`, `Usage: dcp:recompress <blockId>`, and `Invalid block ID: invalid`, with callback count `1`.                                                                                                           |
| `propagates command errors before callback`         | Mock the existing sweep implementation to throw a sentinel error; the same error escapes, callback count `0`.                                                                                                                                                                                                                                                                                                                         |
| `propagates a callback error once`                  | Callback throws a sentinel error after a permitted action; same error escapes, callback count `1`.                                                                                                                                                                                                                                                                                                                                    |

Move the mutation cases from the old `applyDcpPanelAction` suite to this public seam, including both manual toggle directions and block deactivate/reactivate. Keep read-only projection assertions in `panel-model.test.ts`; move its close-execution assertion to the direct controller tests. Permission-denial cases use fresh config/state for each request so cycling permission cannot accidentally remove the denial for subsequent assertions. Use existing block fixtures without inventing a new shared fixture module. For sentinel errors use top-level module imports and `vi.spyOn` on the existing sweep export, restoring the spy after each test; do not add injectable command implementations to the production interface solely for tests. Assert error identity, not only its text.

- [ ] **Step 3: Run the new tests red.** Run `pnpm exec vitest run tests/dcp-actions.test.ts`; expect a missing `src/commands/actions.ts` export/import failure, or a failing assertion if the file already exists. Do not commit this intermediate state.

- [ ] **Step 4: Implement `executeDcpAction`.** Resolve capabilities from current context model with the current state fallback; use `getDcpPipelineDisabledMessage` to retain policy-message precedence. Reject before dispatch. Dispatch through the existing command implementations, resolving panel toggles from current state. Invoke the callback after normal completion, then return `{ permitted: true, message }`. Do not use `finally`, a `changed` flag, or a new promise contract.

- [ ] **Step 5: Integrate both adapters completely.** Map `dcp:manual` to `{ type: "manual", args }`, `dcp:permission` to `{ type: "cycle-permission" }`, `dcp:sweep` to `{ type: "sweep" }`, and decompression/recompression to their raw-args requests. Notify the returned message with `"info"` even on policy rejection; remove these five handlers' individual gates/callbacks. Retain `capabilities` and `rejectWhenDisabled` in `register.ts` for `dcp:compress`, which remains outside the seam. The panel narrows out close, passes its action and original context directly, stores `result.message`, and loops without a second guard or callback. Keep execution outside the `ctx.ui.custom` recovery catch. Remove executable dispatch and command imports from `panel-model.ts`; retain row availability and read-only projection behavior.

  Add direct adapter exception tests in `commands-register.test.ts` and `panel.test.ts`: a sweep implementation sentinel rejects the handler/controller with that same error and zero callbacks; a callback sentinel rejects with that error and exactly one callback. Both cases produce no command notification or next panel component. Preserve the existing custom-UI failure notification test separately. These tests must fail if an adapter swallows executor errors or invokes its callback again.

- [ ] **Step 6: Verify the usable result.** Run `pnpm exec vitest run tests/dcp-actions.test.ts tests/commands-register.test.ts tests/panel-model.test.ts tests/panel.test.ts tests/commands-permission.test.ts tests/index.test.ts tests/pi-contract.test.ts`; expect exit `0`. Verify command and panel actions each produce one callback, rejected/close paths produce none, and prior notification/panel behavior is unchanged.

- [ ] **Step 7: Run the complete gate.** Run `pnpm check` and `git diff --check`; both must exit `0`. Search production/test TypeScript for `applyDcpPanelAction`; expect no remaining definition/import/call. Review the diff for duplicate action execution, action or callback UI delivery in the executor, context copies, retained mutable-adapter dispatch, runtime import cycles, or changes outside this phase. The existing callback may still reconcile host selection and persist; the executor owns its ordering, not those effects.

- [ ] **Step 8: Commit the entire phase.** Stage only the files listed for this task and commit as `refactor: share guarded DCP action execution`. Include all integration and test changes in this commit.

## Atomic exit and rollback

Every affected command and panel action uses the new executor in production, all behavior checks pass, and no later module is required. Reverting this phase's complete commit restores the original independent adapter paths. A new executor with unmigrated adapters is not a completed phase.
