# Phase 5 — Pi DCP Permission and Panel UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-call compression approval and one Pi-native status/action panel while retaining every existing command and safe headless behavior.

**Architecture:** Authorize ask calls inside the registered execute function before compression timing or mutation. Build the panel from a pure view model and command-backed action executor sharing the existing command policy guard. A thin Pi TUI component handles rendering, scrolling, selection, and action completion; its controller refreshes data and reconciles permitted actions.

**Tech Stack:** Node.js, TypeScript 7, Pi 1.0 extension and TUI APIs, TypeBox 1.3, Vitest 5, Biome 2, pnpm

**Spec:** `docs/superpowers/specs/2026-10-03-pi-dcp-improvement-roadmap-design.md`

## Global Constraints

- Execute after Phase 4, starting from v0.9.0; prepare v0.10.0 without publishing.
- Permission is exactly `allow | ask | deny`; the default remains `allow`.
- Ask supports TUI and RPC dialogs; print/JSON and unavailable dialog UI fail closed.
- Confirm inside execute for every ask call, including direct execution; never reuse approvals.
- Existing `dcp:*` commands remain supported and use the same domain mutations and pipeline policy guard as panel actions.
- Preserve inactive-tool selection, run-boundary prompt snapshots, sequential compression execution, and restored-loadout precedence. Allow/ask do not implicitly activate `compress`; guidance additionally requires an active tool.
- State-change callbacks remain `(ctx: ExtensionCommandContext) => void`; commands and permitted panel actions pass their current context.
- Snapshot v2 writers retain canonical padded references and block shape; readers and lifetime aggregation accept historical v1 unchanged.
- The single custom panel requires `ctx.mode === "tui"`, independently of RPC's `hasUI`.
- `@earendil-works/pi-tui` is host-provided: exact `"*"` peer and `^1.0.1` development dependency, never a runtime dependency; retain its locked v1.0.1 resolution.
- Pi is the API authority; OpenCode DCP is behavioral inspiration only. Do not copy its AGPL source, adapters, or host permission machinery.

## Readiness Review — 2026-10-05

The earlier plan required revision: Pi emits execution-start before authorization, RPC has dialog UI
but cannot render custom terminal components, panel actions would bypass command-registration guards,
and `manualCommand(state, "")` reports status rather than toggling it.

Reviewed baseline: clean v0.9.0 at `fba7462`, after the Phase 4 merge. `pnpm check` passed formatting,
warning-free lint, typecheck, and 710 tests across 55 files. Schema comparison and package dry-run
passed. The benchmark ran successfully with `node --import tsx scripts/benchmark.ts`; the normal tsx
CLI was blocked by sandbox IPC restrictions. These are baseline results, not verification of Phase 5.

References: Pi `1b094148b91d737fb398bf1591604de58ec169e1` (v1.0.2) and OpenCode DCP
`f8232fde1e63c2251687e4d9634bd53ce11568cb` (v3.2.0). Installed Pi v1.0.1 types support the required
mode, dialog, component, and event-ordering contracts. Pi's extension types, agent-loop ordering, RPC
UI implementation, and question-component example are the API references. OpenCode's compression
pipeline and panel availability are behavioral references; its separate views are outside this phase.

## Review Focus

- Pending/rejected approval must create no compression timing or durable changes despite Pi's early start event; Task 2 reproduces the real ordering.
- RPC confirmations must work while RPC custom UI is never called; Tasks 2 and 4 test modes independently of `hasUI`.
- Confirmation abort/failure or policy changes during the wait must prevent compression; Task 2 checks these boundaries and direct execute.
- Disabled pipelines and stale/non-reactivatable block rows must not bypass command policy or corrupt state; Task 3 checks guard parity and block eligibility.
- Lifetime failure, rendering failure, long block lists, and undefined custom results must retain a usable close path; Task 4 checks fallbacks and scrolling.

---

### Task 1: Add ask permission and compatible v2 persistence

**Files:**

- Modify: `src/config-schema.ts`, `src/state/types.ts`, `src/state/persistence.ts`
- Modify: `src/commands/permission.ts`, `src/commands/register.ts`
- Test: `tests/config.test.ts`, `tests/commands-permission.test.ts`, `tests/persistence.test.ts`
- Test: `tests/index.test.ts`, `tests/commands-lifetime.test.ts`, `tests/session-analysis.test.ts`

**Interfaces:**

- Produces: `CompressPermission = "allow" | "ask" | "deny"`, `DcpSnapshotV2`, and `DcpSnapshot = DcpSnapshotV1 | DcpSnapshotV2`.
- `serializeDcpSnapshot` returns `DcpSnapshotV2 | undefined`; `parseDcpSnapshot` returns `DcpSnapshot | undefined`. Preserve existing arguments and restoration behavior.
- `permissionCommand(state: SessionState, defaultPermission: CompressPermission = "allow"): string` cycles from `state.compressPermission ?? defaultPermission`.

- [ ] **Step 1: Add failing configuration and command tests**

Assert ask loads without warnings, the built-in default is allow, and cycling follows
`allow -> ask -> deny -> allow`. Preserve the exact `Compress permission: <value>` response.
For undefined state, test the standalone default and configured ask/deny fallbacks:

```ts
expect(permissionCommand(createSessionState(), "deny")).toBe("Compress permission: allow");
```

- [ ] **Step 2: Add failing persistence-consumer tests**

Retain literal v1 allow/deny fixtures and reject v1 ask. Round-trip all three v2 permissions and
reject invalid v2 permissions and unknown versions. Update new-writer assertions to v2 while
retaining v1 reader fixtures. Test mixed v1/v2 lifetime aggregation, selecting each owner's newest
snapshot without double counting. Keep session-analysis and branch restoration behavior unchanged.

- [ ] **Step 3: Verify the new tests fail**

Run: `pnpm vitest run tests/config.test.ts tests/commands-permission.test.ts tests/persistence.test.ts tests/index.test.ts tests/commands-lifetime.test.ts tests/session-analysis.test.ts`

Expected: new ask/v2 cases fail against the existing implementation.

- [ ] **Step 4: Implement types, v2 serialization, and version-aware reading**

Keep `DcpSnapshotV1` and its historical permission union intact. Define v2 by reusing the existing
fields with only version and permission changed; do not duplicate block definitions. Update the
lifetime snapshot map to accept the union. Preserve parser subentry validation, restoration,
owner/statistics semantics, and fingerprint behavior. New serialization preserves ask.

- [ ] **Step 5: Implement cycling and configured fallback**

Update command registration to pass `config.compress.permission`. Keep the existing current-context
callback and pipeline guard; update the command description to advertise allow/ask/deny.

- [ ] **Step 6: Run the Step 3 command and verify all cases pass**

Expected: both reader versions, v2 writers, configured fallbacks, and existing consumers pass.

- [ ] **Step 7: Commit the permission/persistence changes**

Stage only this task's changed files. Suggested message: `feat: add ask compression permission`.

### Task 2: Authorize ask inside execute and correct timing

**Files:**

- Create: `src/compress/permission.ts`
- Modify: `src/index.ts`, `tests/extension-harness.ts`
- Test: `tests/compress-permission.test.ts`, `tests/capabilities.test.ts`, `tests/index.test.ts`
- Test: `tests/integration.test.ts`, `tests/compression-timing.test.ts`, `tests/pi-contract.test.ts`, `tests/sdk-contract.test.ts`

**Interfaces:**

- Consumes: Task 1 permission types, `CompressConfig["mode"]`, Pi `ExtensionContext`, and the execute call's abort signal.
- Produces: `describeCompressionRequest(mode: CompressConfig["mode"], input: Record<string, unknown>): { topic: string; targetCount: number; targetLabel: "range" | "target" }`.
- Produces: `requestCompressionApproval(mode: CompressConfig["mode"], input: Record<string, unknown>, ctx: ExtensionContext, signal?: AbortSignal): Promise<string | undefined>`; undefined means approved, otherwise the string is the error reason.

- [ ] **Step 1: Add failing description and dialog tests**

Assert topic fallback `Untitled compression`, title `Allow DCP compression?`, and message inclusion
of the topic and `2 ranges` or `1 target`. Range counting accepts records with string
`startId`/`endId`/`summary`; message counting accepts string `messageId`/`summary`. Count malformed or
absent arrays as zero valid items, choosing the array by configured mode. Whitespace-only topics use
the fallback. Test singular/plural labels, acceptance, rejection, cancellation, and thrown confirmation.

- [ ] **Step 2: Add failing mode and lifecycle tests**

Extend the typed harness with configurable `mode`, observable confirm/custom mocks, and an execute
signal/call ID. Test TUI and RPC with `hasUI: true`, and print/JSON or `hasUI: false` without confirm.
Reproduce `tool_execution_start -> tool_call -> execute -> tool_execution_end`: deferred approval
must start no timing; rejected calls create no blocks, statistic changes, or DCP entries. Assert
approval delay is excluded from successful block durations. Test direct execute, two successive ask
calls, abort during confirmation, and policy suppression introduced while confirmation is pending.
Exercise the public SDK execution path offline without real model requests; preserve Phase 4 loadout
contract tests. Update timing tests that previously treated the early start event as compression work.

- [ ] **Step 3: Verify approval and timing tests fail**

Run: `pnpm vitest run tests/compress-permission.test.ts tests/capabilities.test.ts tests/index.test.ts tests/integration.test.ts tests/compression-timing.test.ts tests/pi-contract.test.ts tests/sdk-contract.test.ts`

Expected: ask authorization and post-approval timing assertions fail.

- [ ] **Step 4: Implement confirmation at the execution boundary**

Make `executeCompressTool` asynchronous. Keep policy guards in both `tool_call` and execute; the hook
must not confirm. For effective ask permission, await the helper before any timing or compression
mutation. Require both a TUI/RPC mode and dialog-capable UI; pass `_signal ?? ctx.signal` to confirm.
Return an error tool result (`isError: true`) with `Compression requires interactive approval` when
UI is unavailable, or `Compression was not approved` for false/cancelled/aborted/failed confirmation.
Recheck the abort signal and capabilities after the wait, returning the existing policy error when
suppressed. Do not introduce approval caches or tokens.

- [ ] **Step 5: Move compression timing to actual work**

Remove the compression start-time mutation from `tool_execution_start`; remove that handler if it
has no remaining responsibility. Set the start time immediately before `handleCompress`. Keep
execution-end timing cleanup unconditional even if permission/model policy changed after work began.
Ask and allow share existing capabilities: only deny contributes the permission suppression reason.

- [ ] **Step 6: Run authorization and compression regressions**

Run the Step 3 command, then:
`pnpm vitest run tests/compress-range.test.ts tests/compress-message.test.ts tests/benchmark.test.ts`

Expected: every ask call confirms once, no denied-call residue, approval wait excluded, existing
loadout/guidance rules and benchmark gates preserved.

- [ ] **Step 7: Commit authorization and timing changes**

Stage only this task's changed files. Suggested message: `feat: confirm compression before execution`.

### Task 3: Build the panel model and guarded command-backed actions

**Files:**

- Create: `src/tui/panel-model.ts`
- Modify: `src/capabilities.ts`, `src/commands/register.ts`, `src/utils/context-limits.ts`, `src/state/persistence.ts`
- Test: `tests/panel-model.test.ts`, `tests/capabilities.test.ts`, `tests/commands-register.test.ts`
- Test: `tests/context-limits.test.ts`, `tests/commands-lifetime.test.ts`

**Interfaces:**

- Produces: `getDcpPipelineDisabledMessage(capabilities: DcpCapabilities): string | undefined` in capabilities; undefined means pipeline-eligible, otherwise preserve existing command messages and reason precedence.
- Produces: `ResolvedContextLimits { min: number | undefined; max: number | undefined }` and `resolveContextLimits(config: { compress: CompressConfig }, state: SessionState, contextUsage: ContextUsage | undefined): ResolvedContextLimits`.
- Export `LifetimeStats` from persistence and use it as `loadAllSessionStats`' existing aggregate return type; preserve the loader and lifetime-command behavior.
- Define `DcpPanelAction` as `toggle-manual | cycle-permission | sweep | toggle-block` (with numeric `blockId`) `| close`, using a `type` discriminant.
- `DcpPanelModelInput` contains state/config, current model provider/id/contextWindow or undefined, context usage or undefined, lifetime stats or undefined, and `compressToolActive: boolean`.
- `buildDcpPanelModel(input: DcpPanelModelInput): DcpPanelModel` produces formatted status/statistic fields and structured numeric-sorted block rows with availability reasons and actions. Stable row IDs are action types or `block:<id>`.
- `applyDcpPanelAction(action: DcpPanelAction, state: SessionState, config: DcpConfig, capabilities: DcpCapabilities): { permitted: boolean; message?: string }` contains no Pi UI calls. Close returns `{ permitted: false }`; policy rejection returns false plus its message; permitted commands return true plus their command response, including stale-row responses.

- [ ] **Step 1: Add failing limit and model tests**

Assert shared resolution preserves per-model override, global absolute, and legacy percentage
precedence. Percentage limits with no usable window are undefined; absolute limits still resolve.
Existing over-limit decisions must use the shared result. Assert all planned panel fields, explicit
unavailable values, numeric block ordering, active/user-deactivated/otherwise-inactive distinctions,
and tool/policy availability. Test current model identity/window overriding stale cached display
inputs without mutating state; do not fabricate current usage from missing data.

- [ ] **Step 2: Add failing action and guard-parity tests**

Test manual toggle from both states, permission cycling with configured fallback, sweep, block
deactivation/reactivation, and exact stale message `Block <id> not found.`. Non-user-deactivated
inactive blocks must not become reactivatable. Assert global/model/sub-agent suppression rejects
all mutations with the same messages as direct commands. Deny permission alone permits panel
mutations when pipeline-eligible. Recheck policy against current context after building a model.

- [ ] **Step 3: Verify model and guard tests fail**

Run: `pnpm vitest run tests/panel-model.test.ts tests/capabilities.test.ts tests/commands-register.test.ts tests/context-limits.test.ts tests/commands-lifetime.test.ts`

Expected: missing shared helpers/model and guard-parity cases fail.

- [ ] **Step 4: Implement shared policy and data resolution**

Delegate registration's existing pipeline guard to the shared message helper. Keep informational
commands available and compression's additional permission/active-tool checks intact. Export the
limit resolver and delegate `isContextOverLimits` to it without changing precedence. Build a
read-only current-model view for panel resolution rather than updating session state from rendering.

- [ ] **Step 5: Implement model and domain action delegation**

Manual toggle passes `state.manualMode === "active" ? "off" : "on"` to `manualCommand`. Permission
cycling passes configured fallback; sweep and block controls call their existing commands. Reject
policy-disabled actions before domain mutation. Only active blocks offer deactivation and only
user-deactivated blocks offer reactivation; display other blocks without a toggle. Re-read block
state when acting, preserving existing command eligibility/error responses. Close does nothing.

- [ ] **Step 6: Run model, guard, and command regressions**

Run the Step 3 command, then:
`pnpm vitest run tests/commands-manual.test.ts tests/commands-permission.test.ts tests/commands-sweep.test.ts tests/commands-decompress.test.ts tests/commands-recompress.test.ts`

Expected: shared resolution and policy pass without duplicating mutation logic or changing existing
no-argument manual-command status behavior.

- [ ] **Step 7: Commit panel domain behavior**

Stage only this task's changed files. Suggested message: `feat: add guarded DCP panel actions`.

### Task 4: Add the TUI component, controller, and dcp command

**Files:**

- Create: `src/tui/panel.ts`
- Modify: `src/commands/register.ts`, `src/commands/help.ts`, `package.json`, `pnpm-lock.yaml`
- Test: `tests/panel.test.ts`, `tests/commands-register.test.ts`, `tests/commands-help.test.ts`, `tests/package-metadata.test.ts`

**Interfaces:**

- Consumes: Task 3 model/actions, Pi Theme/custom UI, and pi-tui Component/key/width helpers.
- `DcpPanelComponent` implements `render(width)`, `invalidate()`, and `handleInput(data)`; constructor inputs are the model and options containing theme, `getHeight(): number`, `requestRender(): void`, `onAction(action): void`, optional initial row ID, and optional last action message.
- `openDcpPanel(state: SessionState, config: DcpConfig, ctx: ExtensionCommandContext, onStateChange: (ctx: ExtensionCommandContext) => void, getActiveTools: () => string[]): Promise<void>` supplies current policy/tool/model inputs and registers through the existing command-registration function.

- [ ] **Step 1: Add failing metadata, rendering, and key tests**

Assert pi-tui is absent from runtime dependencies, has peer `"*"`, development specifier `^1.0.1`, and
locked v1.0.1. At 60/80/120 columns and 24 rows, assert visible widths and total height remain bounded
with long topics, wide characters, and dozens of blocks. Selection stays visible while scrolling
and after resize. Arrow keys and `j`/`k` navigate selectable actions; Enter completes the selected
action; Escape/`q` returns close exactly once. Assert selection changes request rendering and an
injected rendering failure produces a bounded unthemed fallback with functional close keys.

- [ ] **Step 2: Add failing controller and command tests**

Assert all eleven commands are registered and help lists `dcp`. In RPC mode with `hasUI: true`, and
print/JSON or unavailable TUI, assert exactly one error notification and no lifetime/custom call.
Mock permission action then close: assert one callback with current ctx, updated model, retained
selection, and a displayed command response. Verify close and policy rejection do not call the
callback. Recheck policy before actions even if the displayed model allowed them. Lifetime rejection
opens with unavailable totals; loading occurs once per invocation. Undefined custom results close
without looping; custom rejection notifies once and existing commands remain accessible. Keep
missing-directory zero totals compatible with the current loader.

- [ ] **Step 3: Verify UI and metadata tests fail**

Run: `pnpm vitest run tests/panel.test.ts tests/commands-register.test.ts tests/commands-help.test.ts tests/package-metadata.test.ts`

Expected: missing panel/command and peer metadata assertions fail.

- [ ] **Step 4: Add the host-provided development peer**

Add devDependency `"@earendil-works/pi-tui": "^1.0.1"` and peer `"*"`. Refresh the lockfile using
`pnpm install --lockfile-only`; ensure the new root importer uses existing v1.0.1 without unrelated
resolution changes. Materialize dependencies as needed for UI tests without upgrading other packages.

- [ ] **Step 5: Implement the bounded terminal component**

Use Pi Theme plus pi-tui `matchesKey`, `Key`, `truncateToWidth`, and `visibleWidth`. Keep the compact
status/statistics header and close-key footer visible, allocating remaining height to a scrolling
core-action/block list. Clamp navigation at the first/last selectable row. Flatten multiline row
labels, bound every line, and keep selected actions visible. Use `tui.terminal.rows` for height and
`tui.requestRender()` for selection updates. Track selection/completion only; rendering formatting
failure returns a minimal unthemed closable view. The component performs no domain mutations.

- [ ] **Step 6: Implement controller, registration, and help**

Require `ctx.mode === "tui" && ctx.hasUI` before any lifetime/custom work; otherwise notify
`DCP panel requires interactive TUI mode. Use dcp:help for available commands.` once and return.
Load lifetime totals once from the same parent directory as `dcp:lifetime`, using undefined on
rejection. Build from current ctx and `getActiveTools()`, await one component action, recompute
capabilities, and call the Task 3 executor. For permitted actions call `onStateChange(ctx)`; retain
its message and rebuild. Restore the acted-on row ID, falling back to the first selectable action
if it vanished. Close/undefined results return; custom rejection notifies once and returns. Register
`dcp` and add help without removing or renaming any existing command.

- [ ] **Step 7: Run UI, command, metadata, and type checks**

Run the Step 3 command, then `pnpm typecheck && pnpm lint`.

Expected: UI completion/scrolling/fallback, guarded mutations, command preservation, and dependency
metadata pass; zero lint warnings.

- [ ] **Step 8: Commit the custom panel**

Stage only this task's changed files. Suggested message: `feat: add interactive DCP status panel`.

### Task 5: Document and verify v0.10.0

**Files:**

- Modify: `dcp.schema.json`, `README.md`, `CHANGELOG.md`, `package.json`

**Interfaces:**

- Consumes: Tasks 1–4; produces documented, verified v0.10.0 release metadata without publishing.

- [ ] **Step 1: Document permissions and panel behavior**

Document allow/ask/deny, TUI/RPC confirmation, print/JSON denial, rejection/abort behavior, permission
cycling, and backward-readable snapshots. Document the single panel's fields, keys, scrolling,
policy-disabled actions, and direct command fallback. Set version `0.10.0` and add release notes.

- [ ] **Step 2: Regenerate and compare the schema**

Run: `pnpm generate:schema`, then `node --import tsx scripts/generate-schema.ts | diff -u dcp.schema.json -`.

Expected: generated schema contains allow/ask/deny and comparison exits 0 with no differences.
If the tsx CLI is sandbox-blocked, generate with
`node --import tsx scripts/generate-schema.ts > dcp.schema.json` instead.

- [ ] **Step 3: Run complete automated verification**

Run: `pnpm check && pnpm run pack:dry-run && pnpm benchmark`.

Expected: exit 0, zero lint warnings, all tests including compact-marker token gates pass, and the
package includes the new UI/permission modules. Token gates live in `tests/benchmark.test.ts` and
run under `pnpm check`; the benchmark command reports measurements. If its launcher is blocked by
sandbox IPC, run `node --import tsx scripts/benchmark.ts` instead and record that substitution.

- [ ] **Step 4: Manually verify permission and restoration flows**

In Pi TUI and a dialog-capable RPC client, approve one ask call and reject another; cancel/abort a
pending call and confirm no compression occurred. Verify print/JSON ask fails closed. Switch to
deny, then allow; tool exposure and prompt guidance must obey Phase 4 selection rules, including
an intentionally inactive tool. Resume, fork, navigate the tree, and reload with v1/v2 snapshots;
confirm permissions/blocks restore and branch loadouts remain authoritative.

- [ ] **Step 5: Manually verify panel usability**

At 60/80/120 columns and approximately 24 rows, exercise navigation, Enter, Escape/q, every action,
long block-list scrolling, and retained selection. Confirm disabled-policy actions cannot mutate,
non-user-deactivated blocks cannot be reactivated, and direct commands work after closing. If a
manual environment is unavailable, record the unverified cases rather than claiming them complete.

- [ ] **Step 6: Review and commit release metadata**

Run: `git diff --check && git status --short`; verify scope and all acceptance results.
Stage only this task's changed files. Suggested message: `chore: prepare pi-dcp 0.10.0`.

## Implementation Handoff

The previous Phase 5 plan is superseded by this revision. The agreed design uses execute-boundary
approval, TUI/RPC dialogs, and one compact scrolling panel. Implementation was committed through
`a3f5c61` on the Phase 5 branch; review fixes follow in the working tree. Publishing remains a
separate decision.

## Implementation Review — 2026-10-05

The initial implementation passed 800 automated tests. Review regressions reproduced omitted
lifetime counters, clipped tool availability at 60 columns, inaccessible inactive block rows,
invisible actions remaining executable in rendering fallback, overflowing one/two-row terminals,
and long block topics hiding action/state text at 60/80/120 columns.
The panel now keeps those counters/status fields visible, permits browsing inactive rows without
activation, and disables actions in fallback or views too short to display them while preserving
close instructions. Block rows reserve space for action/state text before truncating topics, while
retaining their identifiers when a disabled-policy reason also needs truncation. Row
labels also normalize carriage returns and tabs to keep terminal lines valid. Command help now
describes cycling through allow/ask/deny.

A separate regression reproduced panel mutations being allowed when the current model was missing
even though direct commands rejected the cached disabled model. Both the panel model and controller
now use the same current-or-cached policy identity as command registration; missing display data
remains explicitly unavailable. Offline public-SDK tests run Pi's actual agent loop with a simulated
provider response and deferred RPC approval. They observe the full execution-start, tool-call,
confirmation, execution-end sequence; pending approval creates no timing or blocks, rejection changes
no compression statistics or DCP entries, and a simulated 5,000 ms approval wait is excluded from
the successful 7 ms block duration.

After these fixes, `pnpm check` passed formatting, warning-free lint, typecheck, and 819 tests across
58 files. Generated-schema comparison and package dry-run passed; benchmarks ran with
`node --import tsx scripts/benchmark.ts` to avoid the sandbox's tsx CLI IPC restriction. Live Pi
TUI/RPC verification and publishing have not been performed in this review.
