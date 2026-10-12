# Compression Tool Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give compression-tool model/selection transitions one owner without changing Pi's selection authority.

**Architecture:** One module retains live state/config roots and ephemeral selection memory, and uses the existing Pi host selection operations. Lifecycle adapters use its operations while capability-only queries keep using the existing pure policy calculation.

**Tech Stack:** Existing TypeScript/ESM, Pi host and extension harness, Vitest, Biome; Node `>=24.15.0`.

**Spec:** [Approved design](../specs/2026-10-12-dcp-architecture-design.md). [Roadmap and shared constraints](2026-10-12-dcp-architecture-plan.md).

## Global constraints

- Start with completed phase 1. Keep its executor and callback contract working.
- Preserve the exact current first-session selection predicate; do not invent a `reason === "new"` restriction.
- First-session memory is per extension instance; pre-suppression memory is per branch; neither is persisted.
- Config/state roots stay live. Capturing `config.compress` or replaceable maps would be incorrect.
- Capability-only queries and model refresh without reconciliation must not gain active-tool writes.
- Keep approval execution, tool definitions, prompt reload/section integration, and checkpoint orchestration in their existing owners.

## Review focus

- Repeated/overlapping suppression records selection only on the first transition and restores it only when every reason clears.
- Restored inactive selection and host exclusions remain authoritative.
- A later branch reset clears old suppression memory without repeating implicit activation.
- A nested config replacement is visible to the existing module instance.
- `tool_call` performs model refresh/policy rejection without adding a new host-selection side effect.

## Task 1: Integrate selection ownership

**Files:**

- Create: `src/tool-selection.ts`, `tests/tool-selection.test.ts`.
- Modify: `src/index.ts:115` through its selection helpers and lifecycle call sites.
- Update integration coverage as needed: `tests/index.test.ts`, `tests/pi-contract.test.ts`, `tests/commands-register.test.ts`.
- Retain: `src/capabilities.ts`, `tests/capabilities.test.ts`, `tests/extension-harness.ts` as the existing host test adapter.

**Interfaces:**

Produce these exports in `src/tool-selection.ts`:

```typescript
export type CompressionModelIdentity = { provider: string; id: string };
export type CompressionToolHost = Pick<
  ExtensionAPI, "getActiveTools" | "setActiveTools" | "getAllTools"
>;

export interface CompressionToolSelection {
  refreshModel(model: CompressionModelIdentity | undefined): void;
  reconcile(ctx?: Pick<ExtensionContext, "model">): void;
  sessionStarted(reason: SessionStartEvent["reason"], ctx: ExtensionContext): void;
  branchRestored(ctx: ExtensionContext): void;
}

export function createCompressionToolSelection(
  host: CompressionToolHost,
  state: SessionState,
  config: DcpConfig,
): CompressionToolSelection;
```

`refreshModel` updates identity only when supplied and performs no host writes. `reconcile(ctx)` refreshes identity when context supplies it, then applies existing suppression/restoration behavior. `sessionStarted` remembers first-session handling, clears branch suppression memory, refreshes identity, performs permitted first implicit selection, and reconciles. `branchRestored` clears branch suppression memory, refreshes identity, and reconciles without implicit selection. The caller invokes the session/branch hooks after state restoration and, for session start, mode-specific tool registration.

- [ ] **Step 1: Pin the existing transitions.** Run `pnpm exec vitest run tests/pi-contract.test.ts tests/index.test.ts tests/capabilities.test.ts`; expect exit `0`. Use the current reason/loadout/exclusion checks as the reference behavior.

- [ ] **Step 2: Write selection-interface tests.** Build the existing extension harness with `compress` registered through its normal registration interface; use the existing schema fixture or the SDK's `Type.Object({})` for that inert test tool, not a new host abstraction. Add `tests/tool-selection.test.ts` cases:

| Test name | Assertions |
| --- | --- |
| `selects an allowed tool only at the first session start` | Fresh first event with no declared loadout selects registered `compress`; a later start after deselection does not reactivate it. |
| `honors reload and declared host selections` | First reload or a branch with `declaredLoadoutMessage()` does not add `compress`; exclusion or unregistered tool never activates it. |
| `remembers initial selection across overlapping reasons` | Initially active; permission deny plus disabled model removes it; clearing either alone leaves it inactive; clearing both restores it. |
| `preserves a tool that was already deselected` | Initially inactive under a declared loadout; suppression and later allowance keep it inactive. |
| `clears suppression memory when the branch changes` | Old branch selected then suppressed; host restores an inactive selection on another branch; `branchRestored` followed by allowance leaves it inactive. |
| `reads replaced nested config after construction` | Replace `config.compress` with permission deny/allow after creating the owner; reconciliation follows the replacement. |
| `refreshes model without reconciling tools` | `refreshModel` changes identity but leaves active tools unchanged; a later explicit reconciliation applies policy. |
| `retains identity when the model is unavailable` | Refresh with undefined leaves the stored provider/id unchanged. |

For the overlapping-reasons case, assert exact host state after each step:

```typescript
expect(harness.activeTools()).toContain("compress");
state.compressPermission = "deny";
state.modelProvider = "test";
state.modelId = "blocked";
config.disabledModels = ["test/blocked"];
selection.reconcile();
expect(harness.activeTools()).not.toContain("compress");
state.compressPermission = "allow";
selection.reconcile();
expect(harness.activeTools()).not.toContain("compress");
config.disabledModels = [];
selection.reconcile();
expect(harness.activeTools()).toContain("compress");
```

- [ ] **Step 3: Run the new tests red.** Run `pnpm exec vitest run tests/tool-selection.test.ts`; expect the missing new module/interface to fail. Do not commit.

- [ ] **Step 4: Implement the owner using existing behavior.** Move the structured-loadout predicate, branch inspection, fresh-selection predicate, suppression memory, and model refresh into this module. Use `getDcpCapabilities` rather than copying policy rules. Read `state` and `config` at call time. Keep first-session and branch memory private.

- [ ] **Step 5: Integrate every production transition.** Create the owner once per extension instance. Replace model-select with `reconcile({ model: event.model })`; before-agent-start, context, and phase-1 callback paths call `reconcile(ctx)` at their current ordering point. Session start restores state and refreshes the definition before `sessionStarted`; tree navigation restores state before `branchRestored`. The `tool_call` path uses only `refreshModel(ctx.model)` before its existing capability query. Remove the old closure memory and transition helpers after all callers move. Preserve the side-effect-free `evaluateCapabilities(ctx)` path for tool execution/approval and other policy-only queries.

- [ ] **Step 6: Verify all adapters and identities.** Run `pnpm exec vitest run tests/tool-selection.test.ts tests/pi-contract.test.ts tests/index.test.ts tests/capabilities.test.ts tests/dcp-actions.test.ts tests/commands-register.test.ts tests/panel.test.ts tests/compress-permission.test.ts`; expect exit `0`. Assert host loadout, prompt guidance, and callback behavior, including initially denied selection and config reload.

- [ ] **Step 7: Run the complete gate.** Run `pnpm check` and `git diff --check`; both exit `0`. Audit `getActiveTools`/`setActiveTools` call sites: actual compression-tool selection writes belong to the new owner, while availability reads can stay in adapters. Neither capability queries nor per-call approval creates new selection writes.

- [ ] **Step 8: Commit the entire phase.** Stage its new module/tests, `src/index.ts`, and only integration tests actually changed. Commit as `refactor: own compression tool selection transitions`.

## Atomic exit and rollback

All production selection transitions use the owner, lifecycle/approval contracts pass, and phase-1 actions remain usable. Reverting this complete phase restores the original selection helpers while leaving the shared action executor intact. Phase 3 is not required for compilation or correct behavior.
