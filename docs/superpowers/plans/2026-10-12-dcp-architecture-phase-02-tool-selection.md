# Compression Tool Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give compression-tool model/selection transitions one owner without changing Pi's selection authority.

**Architecture:** One module retains live state/config roots and ephemeral selection memory, and uses the existing Pi host selection operations. Lifecycle adapters use its operations while capability-only queries keep using the existing pure policy calculation.

**Tech Stack:** Existing TypeScript/ESM, Pi host and extension harness, Vitest, Biome; Node `>=24.15.0`.

**Spec:** [Approved design](../specs/2026-10-12-dcp-architecture-design.md). [Roadmap and shared constraints](2026-10-12-dcp-architecture-plan.md).

## Readiness review — 2026-10-12

The revised plan is ready to implement against the reviewed repository. The original plan needed more precise characterization tests and lifecycle ordering before execution. The revision preserves the approved design, public interface, and existing behavior. This review completes no implementation checkbox.

- Reviewed DCP HEAD: `f3b6f07652ff84777af5914f2f6300d8170817bc` (`f3b6f07`), initially clean, on `20261012-dcp-architecture-phase-02-tool-selection`. Phase 1 is merged: `executeDcpAction` is integrated into commands and the panel; the real `onStateChange` callback still refreshes model identity, reconciles selection, then persists. Implement against this phase-1 result, not the roadmap's historical `2258ca5` baseline.
- Current verification: `pnpm check` passed with `860` tests across `59` suites on Node `v24.21.0`; the seven existing suites listed in Step 1 passed with `220` tests. These observations establish the review baseline; rerun checks during execution.
- No selection owner exists yet. `src/index.ts` still owns the structured-loadout predicate, model refresh, first-session flag, and pre-suppression memory. Extraction remains a small change with no dependency on phases 3 or 4.
- Existing tests cover fresh `new`, reload, declared resume, exclusions, initially denied activation, overlapping model/permission suppression, prompt integration, and phase-1 no-op callback reconciliation. The new tests must explicitly pin all first-start reasons, every loadout declaration field, repeated reconciliation without extra writes, later session/branch memory resets, and side-effect-free tool-call/approval paths.
- Config replacement tests must leave `state.compressPermission` undefined to exercise the config fallback; an explicit session permission takes precedence. Harness branch changes do not restore active tools automatically, so branch tests must arrange Pi's restored loadout before invoking the lifecycle hook.
- A fresh read-only builder review found no unanswered design questions or impossible test setups. Its one test omission is addressed in Step 5: direct handler coverage for a model-select event whose model differs from the context, because the normal harness synchronizes them before dispatch.

### Pi reference and host boundary

Read-only reference: `/Users/lanh/Developer/pi-packages/pi`, clean at `7bd01fb92485c06f92ecfff7ccf3197148bc16af`. Both its coding-agent package and the installed `@earendil-works/pi-coding-agent` report `1.1.0`. Installed declarations/runtime remain authoritative for DCP compilation; source references below explain the host contract without adding a dependency on that checkout.

| Reference file and symbols                                                                                                                         | Contract and consequence                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/coding-agent/src/core/extensions/types.ts` — `SessionStartEvent`, `ToolDefinition.defaultActive`, `ExtensionAPI` tool methods            | Reasons are `startup`, `reload`, `new`, `resume`, and `fork`. `defaultActive: false` prevents automatic registration activation; explicit host selection can still activate the tool. Keep the three-method host interface and the current first-event predicate.                                             |
| `packages/coding-agent/src/core/agent-session.ts` — `_refreshToolRegistry`, `_isAllowedTool`, `_isActivatedOnRegistration`, `setActiveToolsByName` | Allow/exclude filters determine which tools remain registered. Definition refresh preserves selected names; unknown/hidden names cannot be activated. Keep registration outside the owner and rely on Pi to apply host restrictions; do not duplicate CLI/settings policy.                                    |
| `packages/coding-agent/src/core/agent-session.ts` — constructor, `_restoreToolsFromTranscript`, `bindExtensions`, `navigateTree`                   | Pi restores transcript selection before initial extension handling and before `session_tree`. DCP clears old branch suppression memory after restoring its own state, then reconciles the host's current selection.                                                                                           |
| `packages/coding-agent/src/core/agent-session.ts` — `reload`                                                                                       | Reload rebuilds the extension runtime while retaining active tools and activating newly added defaults. A fresh extension instance whose first event is `reload` must still skip implicit selection. Registration before session load and refreshed definitions with `defaultActive: false` remain necessary. |
| `packages/ai/src/utils/transcript.ts` — `getCurrentSystemMessage`, `getCurrentTools`                                                               | Pi replays system messages into its loadout. DCP's existing branch predicate only detects an explicit `sections`, `toolsAdded`, or `toolsRemoved` field on a system message; preserve that exact predicate rather than introducing transcript replay or treating plain system text as a declaration.          |

The existing harness models registration and selection filtering sufficiently for these DCP transitions, but does not run Pi's runtime reload or restore tools in `setBranch`. Use explicit `harness.setActiveTools` setup and observe DCP writes with `vi.spyOn(harness.api, "setActiveTools")`; clear the spy after host setup. No harness rewrite or new host abstraction is required.

## Global constraints

- Start with completed phase 1. Keep its executor and callback contract working.
- Preserve the exact current first-session selection predicate; do not invent a `reason === "new"` restriction.
- First-session memory is per extension instance; pre-suppression memory is per branch; neither is persisted.
- Config/state roots stay live. Capturing `config.compress` or replaceable maps would be incorrect.
- Capability-only queries and model refresh without reconciliation must not gain active-tool writes.
- Keep approval execution, tool definitions, prompt reload/section integration, and checkpoint orchestration in their existing owners.
- Keep Node `>=24.15.0`, current dependencies, snapshot serialization version `2` and reading versions `1` and `2`. Introduce no configuration option or package version bump.

## Review focus

- Repeated/overlapping suppression records selection only on the first transition and restores it only when every reason clears.
- Restored inactive selection and host exclusions remain authoritative.
- Later session starts and tree navigation clear old suppression memory without repeating implicit activation.
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
  ExtensionAPI,
  "getActiveTools" | "setActiveTools" | "getAllTools"
>;

export interface CompressionToolSelection {
  refreshModel(model: CompressionModelIdentity | undefined): void;
  reconcile(ctx?: Pick<ExtensionContext, "model">): void;
  sessionStarted(
    reason: SessionStartEvent["reason"],
    ctx: ExtensionContext,
  ): void;
  branchRestored(ctx: ExtensionContext): void;
}

export function createCompressionToolSelection(
  host: CompressionToolHost,
  state: SessionState,
  config: DcpConfig,
): CompressionToolSelection;
```

Import `ExtensionAPI`, `ExtensionContext`, and `SessionStartEvent` as types from `@earendil-works/pi-coding-agent`, and the existing `SessionState`/`DcpConfig` types from their current modules. Use `getDcpCapabilities` for policy; do not export a new policy wrapper.

`refreshModel` updates identity only when supplied and performs no host writes. `reconcile(ctx)` refreshes identity when context supplies it, then applies existing suppression/restoration behavior. `sessionStarted` remembers first-session handling, clears branch suppression memory, refreshes identity, performs permitted first implicit selection, and reconciles. `branchRestored` clears branch suppression memory, refreshes identity, and reconciles without implicit selection. The caller invokes the session/branch hooks after state restoration and, for session start, mode-specific tool registration. The owner does not reset or restore session state, set `isSubAgent`, load config, or persist.

Selection happens before policy suppression: even an initially denied first session records the implicit selection and can restore it later. Keep `boolean | undefined` pre-suppression memory so an initially inactive tool is distinct from an unrecorded transition. Reconciliation never activates an inactive tool with no remembered selection. Restoration retains other currently active tools and delegates acceptance of `compress` to the host.

- [ ] **Step 1: Pin the existing transitions.** Confirm a clean or understood worktree and phase-1 integration. Run `pnpm exec vitest run tests/pi-contract.test.ts tests/index.test.ts tests/capabilities.test.ts tests/dcp-actions.test.ts tests/commands-register.test.ts tests/panel.test.ts tests/compress-permission.test.ts`; expect exit `0`. Use the current reason/loadout/exclusion checks and real guarded-action callback tests as the reference behavior.

- [ ] **Step 2: Write selection-interface tests.** Use `createExtensionHarness`, `createSessionState`, and `makeDefaultConfig`. Register an inert `compress` tool through `harness.api.registerTool`, with `defaultActive: false`, `parameters: Type.Object({})` from the existing `typebox` dependency, and an async empty-text result. Use `harness.context` for lifecycle hooks and `declaredLoadoutMessage` for the ordinary loadout fixture. Add `tests/tool-selection.test.ts` cases:

| Test name                                                              | Assertions                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selects compress on the first non-reload start without a declaration` | Parameterize `startup`, `new`, `resume`, and `fork` with a fresh owner per case; initial `["read"]` becomes `["read", "compress"]` with exactly one selection write. An already-active tool causes zero writes.                                                                                                                                                                                                                                                      |
| `never repeats implicit selection on later starts`                     | After the first event, host deselects `compress`; each later reason, including `new` on an empty branch, leaves `["read"]` with zero DCP writes. Also test first `reload` followed by `new`: the first event consumes the one-time opportunity even though it selects nothing.                                                                                                                                                                                       |
| `honors reload and every structured loadout declaration`               | First `reload` stays inactive. Separately test system `sections: {}`, `toolsAdded: []`, and `toolsRemoved: []`, plus `declaredLoadoutMessage(["read"])`; each prevents implicit activation. Plain system text and non-message entries do not declare a loadout and still permit first activation.                                                                                                                                                                    |
| `honors host exclusions and missing registration`                      | Parameterize `allowedTools: ["read"]`, `excludedTools: ["compress"]`, and `noTools: "all"`; `getAllTools()` omits `compress` and DCP makes zero activation writes. With no `compress` registration, the same result holds.                                                                                                                                                                                                                                           |
| `remembers initial selection across repeated and overlapping reasons`  | Begin `["read", "bash", "compress"]`; permission denial plus disabled model removes only `compress` once. Repeating reconciliation makes no write. Parameterize clearing permission first and model first; neither alone restores it, clearing both restores once, and a repeated allowed pass makes no write.                                                                                                                                                       |
| `remembers an implicit selection through initial denial`               | First allowed registration with `state.compressPermission = "deny"` selects then suppresses: final `["read"]`, exactly two writes. Setting permission to `allow` and reconciling restores `["read", "compress"]` once.                                                                                                                                                                                                                                               |
| `preserves deselection after allowance`                                | Under a declared loadout, initially inactive remains inactive through suppression/allowance. Separately suppress/restore an active tool, then host deselects it; later allowed reconciliation does not reactivate it because the old memory was cleared.                                                                                                                                                                                                             |
| `clears suppression memory on session start and tree navigation`       | Parameterize `sessionStarted("resume", ctx)` and `branchRestored(ctx)`. First call `sessionStarted("new", ctx)` on the old active branch, then suppress it; set the new branch and explicitly restore host `["read"]` before the hook. After hook under denial and later allowance, selection stays `["read"]`. Repeat with host `["read", "compress"]`: the new branch's selection is suppressed then restored on allowance. Neither hook repeats fresh activation. |
| `reads replaced nested config after construction`                      | Keep `state.compressPermission` undefined, begin active, and replace `config.compress` using `{ ...config.compress, permission: "deny" }` then `"allow"`; reconciliation removes then restores `compress`. Separately set session permission `allow` with configured `deny` and prove the session override wins.                                                                                                                                                     |
| `reads current config and subagent policy`                             | For an active tool, parameterize global disable/enable and `state.isSubAgent = true` with replacement `config.experimental` denying/allowing subagents. Each policy transition suppresses/restores once without changing other tools.                                                                                                                                                                                                                                |
| `refreshes model without reconciling tools`                            | With disabled `test/blocked`, `refreshModel({ provider: "test", id: "blocked" })` updates both state fields with zero selection writes and keeps the active tool. Explicit `reconcile()` then suppresses it. `reconcile({ model: harness.model })` with an allowed model updates identity and restores it.                                                                                                                                                           |
| `retains identity when the model is unavailable`                       | After storing a blocked identity, `refreshModel(undefined)` and `reconcile({ model: undefined })` retain provider/id; reconciliation still applies that stored policy. Distinguish this from a caller's explicit `resetSessionState`, which already clears identity.                                                                                                                                                                                                 |

Use exact active-tool arrays and write counts, not only `toContain`. Clear selection spies after host deselection/restoration setup. A loadout declaration records Pi's authority; the owner inspects it but never reconstructs or selects its tools. Use ordinary host-arranged selections for exclusion cases, rather than starting an excluded `compress` active, which the real host would not permit.

For the overlapping-reasons case, assert exact host state after each step:

```typescript
const setActiveTools = vi.spyOn(harness.api, "setActiveTools");
expect(harness.activeTools()).toEqual(["read", "bash", "compress"]);
state.compressPermission = "deny";
state.modelProvider = "test";
state.modelId = "blocked";
config.disabledModels = ["test/blocked"];
selection.reconcile();
expect(harness.activeTools()).toEqual(["read", "bash"]);
expect(setActiveTools).toHaveBeenCalledTimes(1);
selection.reconcile();
expect(setActiveTools).toHaveBeenCalledTimes(1);
state.compressPermission = "allow";
selection.reconcile();
expect(harness.activeTools()).toEqual(["read", "bash"]);
expect(setActiveTools).toHaveBeenCalledTimes(1);
config.disabledModels = [];
selection.reconcile();
expect(harness.activeTools()).toEqual(["read", "bash", "compress"]);
expect(setActiveTools).toHaveBeenCalledTimes(2);
```

- [ ] **Step 3: Run the new tests red.** Run `pnpm exec vitest run tests/tool-selection.test.ts`; expect the missing new module/interface to fail. Do not commit.

- [ ] **Step 4: Implement the owner using existing behavior.** Move the structured-loadout predicate, branch inspection, fresh-selection predicate, suppression memory, and model refresh into this module. Use `getDcpCapabilities` rather than copying policy rules. Read `state` and `config` at call time. Keep first-session and branch memory private. Run `pnpm exec vitest run tests/tool-selection.test.ts`; expect exit `0` before moving production callers.

- [ ] **Step 5: Integrate every production transition.** Create the owner once per extension instance, retaining the existing root `state` and `config` objects. Move the production call sites as follows:

| Adapter                 | Required ordering                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model_select`          | `selection.reconcile({ model: event.model })`; use the event identity rather than assuming the context has caught up.                                                                                                                                                                                                                                                                                                                                                                                            |
| `before_agent_start`    | Keep `refreshRuntimePrompts()` first, then `selection.reconcile(ctx)`, then capability/active-tool guidance calculation and existing section updates.                                                                                                                                                                                                                                                                                                                                                            |
| `context`               | `selection.reconcile(ctx)` before capabilities, pipeline suppression return, guidance, and `runPipeline`.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Phase-1 `onStateChange` | `selection.reconcile(ctx)` then `persistIfChanged()`. Preserve the original command context and the executor's once-per-permitted-attempt contract, including no-ops.                                                                                                                                                                                                                                                                                                                                            |
| `session_start`         | Keep config reload, root state reset, defaults, and `restoreActiveBranch(ctx)` in the adapter. At the existing model-refresh point call `selection.refreshModel(ctx.model)`, then set `state.isSubAgent`, set up prompts, and refresh the mode-specific definition. Call `selection.sessionStarted(event.reason, ctx)` before usage/logging/persistence. Its second identity refresh is harmless and keeps the hook usable alone; this deliberate duplication preserves the existing refresh-before-setup order. |
| `session_tree`          | Keep reset, defaults, and `restoreActiveBranch(ctx)` in the adapter, then set `state.isSubAgent` and call `selection.branchRestored(ctx)` before persistence. The hook refreshes the model before reconciling the already-restored state and host selection.                                                                                                                                                                                                                                                     |
| `tool_call`             | Retain the non-`compress` early return; call only `selection.refreshModel(ctx.model)` before the existing capability query and block result.                                                                                                                                                                                                                                                                                                                                                                     |

Remove `StructuredSystemFields`, `declaresToolLoadout`, the old closure memory, and transition helpers from `index.ts` after all callers move, including the now-unused `SessionStartEvent` type import. Preserve the side-effect-free `evaluateCapabilities(ctx)` path for direct execution, approval rechecks, `message_end`, and other policy-only queries. `session_compact` and `session_shutdown` do not invoke selection lifecycle hooks or reset the first-start flag.

Add the following characterization assertions in `tests/pi-contract.test.ts` using its existing config/temp-directory setup; retain meaningful existing tests:

| Test name                                                                 | Assertions                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preserves an inactive restored loadout across tree navigation`           | Start with selected `compress`, suppress it, then set a declared new branch and explicitly arrange host `["read"]`. Emit `session_tree` and later clear suppression through `dcp:permission` or an allowed model transition; active tools remain `["read"]`.                                                                                                                                                                                                                  |
| `reloads the definition and policy without fresh activation`              | Same extension instance, with no DCP snapshot on the arranged branch: write a message-mode/deny config and emit a later `session_start` with reason `reload`; schema reflects message mode and selected `compress` is suppressed. Later allowance via the command restores the remembered selection. In a separate deselected case, reload does not activate `compress`. A restored snapshot's explicit permission remains authoritative over the config default.             |
| `blocks a newly disallowed tool call without reconciling selection`       | Start allowed/active; spy on `api.setActiveTools`, then `harness.setModel({ provider: "test", id: "blocked" })` without a model-select event. Emit compress `tool_call`: returns `{ block: true, reason: "Compression is disabled for the current model" }`, zero writes, selection remains active. Clear `ctx.model`, emit again, and assert the same rejection to prove cached identity was refreshed. A subsequent context pass with an allowed model reconciles normally. |
| `keeps defensive execution and approval queries free of selection writes` | Direct execute under a newly blocked context rejects with the existing dotted message and zero writes. In an ask case with no intervening lifecycle event, confirmation/denial and the post-wait policy query make zero writes. Do not count model-select writes intentionally triggered by existing approval-race tests as approval side effects.                                                                                                                            |
| `retains first-start handling and suppression memory through compaction`  | Start selected then suppressed; emit `session_compact`, allow policy and reconcile: `compress` restores. Host deselects, then a later empty-branch `session_start` with reason `new` leaves it inactive.                                                                                                                                                                                                                                                                      |

Existing prompt reload/section and guarded-action callback reconciliation cases remain integration gates. Use public host behavior and results rather than mocking the new owner or exposing its private memory.

Add `uses the selected event model when the context is stale` in `tests/index.test.ts`, using its existing `writeDisabledModelConfig`, `createMockApi`, `registeredHandler`, and `sessionContext` helpers. Configure `disabledModel`, construct the extension with `["read", "compress"]`, and directly invoke the registered `model_select` handler with event model `disabledModel` but context model `enabledModel`; expect `["read"]` and one selection write. Then invoke it with event model `enabledModel` but context model `disabledModel`; expect `["read", "compress"]` and two writes total. Include the existing `type`, `previousModel`, and `source` event fields. Do not use `harness.emit` for this case: it updates the context to the event model and would conceal the regression.

- [ ] **Step 6: Verify all adapters and identities.** Run `pnpm exec vitest run tests/tool-selection.test.ts tests/pi-contract.test.ts tests/index.test.ts tests/capabilities.test.ts tests/dcp-actions.test.ts tests/commands-register.test.ts tests/panel.test.ts tests/compress-permission.test.ts`; expect exit `0`. Assert host loadout, prompt guidance, and callback behavior, including initially denied selection and config reload.

- [ ] **Step 7: Run the complete gate.** Run `pnpm check` and `git diff --check`; both exit `0`. Audit production `getActiveTools`/`setActiveTools` call sites and assignments to `state.modelProvider`/`state.modelId`: actual compression-tool selection writes and supplied-model updates belong to the new owner, while availability reads and the existing `resetSessionState` identity clearing stay in their current owners. Neither capability queries nor per-call approval creates new selection writes. Confirm no selection memory entered snapshots and no old helper/import remains.

- [ ] **Step 8: Commit the entire phase.** Stage its new module/tests, `src/index.ts`, and only integration tests actually changed. Commit as `refactor: own compression tool selection transitions`.

## Atomic exit and rollback

All production selection transitions use the owner, lifecycle/approval contracts pass, and phase-1 actions remain usable. Reverting this complete phase restores the original selection helpers while leaving the shared action executor intact. Phase 3 is not required for compilation or correct behavior.
