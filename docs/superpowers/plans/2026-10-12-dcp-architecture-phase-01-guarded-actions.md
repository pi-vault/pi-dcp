# Guarded DCP Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make commands and the TUI panel use one guarded action module while retaining their existing presentation.

**Architecture:** A synchronous executor owns policy, dispatch, and callback ordering. Adapters pass requests and the current context, then present the returned message. Existing command implementations stay inside the executor's implementation dependencies for this phase.

**Tech Stack:** Existing TypeScript/ESM, Pi types, Vitest, Biome; Node `>=24.15.0`.

**Spec:** [Approved design](../specs/2026-10-12-dcp-architecture-design.md). [Roadmap and shared constraints](2026-10-12-dcp-architecture-plan.md).

## Global constraints

- Implement phase 1 against `2258ca5`; later phase-2/3/4 modules are not dependencies.
- Preserve command parsing/messages, current policy-message precedence, stale panel action results, and synchronous exception propagation.
- Permission-only denial does not reject these actions.
- Invoke the original callback/context once after a normally completed permitted attempt, including a query, validation error, or no-op. Policy rejection and implementation throws skip it.
- UI delivery stays in the adapters. Informational commands and model compression execution/approval remain unchanged.

## Review focus

- Panel policy changes between projection and execution: execution uses current context/config/state.
- Missing block from a stale panel row: permitted result remains true, error copy is unchanged, callback runs once.
- Manual query/invalid input and empty sweep: callback remains observable even without a mutation.
- Command implementation throws: same exception escapes and callback/UI delivery do not run.
- Callback throws: propagate once without retry or a second callback.

## Task 1: Integrate the shared action seam

**Files:**

- Create: `src/commands/actions.ts`, `tests/dcp-actions.test.ts`.
- Modify: `src/commands/register.ts:18`, `src/tui/panel-model.ts:16`, `src/tui/panel.ts:279`.
- Update tests: `tests/commands-register.test.ts`, `tests/panel-model.test.ts`, `tests/panel.test.ts`.
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
export type DcpPanelAction = Extract<
  DcpAction,
  { type: "toggle-manual" | "cycle-permission" | "sweep" | "toggle-block" }
> | { type: "close" };
```

Close is handled by the panel before execution. `buildDcpPanelModel` remains read-only. Remove `applyDcpPanelAction` after its production and test consumers move.

- [ ] **Step 1: Characterize current adapter behavior.** Run `pnpm exec vitest run tests/commands-register.test.ts tests/panel-model.test.ts tests/panel.test.ts tests/index.test.ts`; expect exit `0`. Add any missing integration assertion for no-op callback effects before changing those adapters.

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
    state, config, onStateChange,
  });
  expect(result).toEqual({
    permitted: true,
    message: "Manual mode: on. Automatic compression is paused.",
  });
  expect(onStateChange).toHaveBeenCalledTimes(1);
});
```

Add named cases with these exact assertions:

| Test name | Assertions |
| --- | --- |
| `rejects current pipeline policy before execution` | `config.enabled = false`; manual mode stays false, `permitted` is false, message is `DCP is disabled by configuration.`, callback count is `0`. |
| `allows operator controls under permission denial` | Permission `deny`; sweep/manual/permission/block controls still reach their normal command result. |
| `preserves callbacks for allowed errors and no-ops` | Manual args `""` and `"invalid"`, empty sweep, already-selected manual mode: `permitted` true and callback count `1` for each attempt. |
| `rechecks a stale block action` | Toggle missing block `99`: message `Block 99 not found.`, `permitted` true, callback count `1`. |
| `reads current policy after a panel projection` | Build a row while enabled, disable config before execution: no mutation and callback count `0`. |
| `propagates command errors before callback` | Mock the existing sweep implementation to throw a sentinel error; the same error escapes, callback count `0`. |
| `propagates a callback error once` | Callback throws a sentinel error after a permitted action; same error escapes, callback count `1`. |

- [ ] **Step 3: Run the new tests red.** Run `pnpm exec vitest run tests/dcp-actions.test.ts`; expect a missing `src/commands/actions.ts` export/import failure, or a failing assertion if the file already exists. Do not commit this intermediate state.

- [ ] **Step 4: Implement `executeDcpAction`.** Resolve capabilities from current context model with the current state fallback; use `getDcpPipelineDisabledMessage` to retain policy-message precedence. Reject before dispatch. Dispatch through the existing command implementations, resolving panel toggles from current state. Invoke the callback after normal completion, then return `{ permitted: true, message }`. Do not use `finally`, a `changed` flag, or a new promise contract.

- [ ] **Step 5: Integrate both adapters completely.** The five command registrations pass the corresponding requests and show the returned message as before; remove their individual gates and callback calls for these actions. The panel narrows out close, passes its action directly, and presents the result without a second callback. Remove executable dispatch and command imports from `panel-model.ts`; retain row availability and read-only projection behavior.

- [ ] **Step 6: Verify the usable result.** Run `pnpm exec vitest run tests/dcp-actions.test.ts tests/commands-register.test.ts tests/panel-model.test.ts tests/panel.test.ts tests/commands-permission.test.ts tests/index.test.ts tests/pi-contract.test.ts`; expect exit `0`. Verify command and panel actions each produce one callback, rejected/close paths produce none, and prior notification/panel behavior is unchanged.

- [ ] **Step 7: Run the complete gate.** Run `pnpm check` and `git diff --check`; both must exit `0`. Review the diff for duplicate action execution, residual `applyDcpPanelAction`, UI access in the executor, or changes outside this phase.

- [ ] **Step 8: Commit the entire phase.** Stage only the files listed for this task and commit as `refactor: share guarded DCP action execution`. Include all integration and test changes in this commit.

## Atomic exit and rollback

Every affected command and panel action uses the new executor in production, all behavior checks pass, and no later module is required. Reverting this phase's complete commit restores the original independent adapter paths. A new executor with unmigrated adapters is not a completed phase.
