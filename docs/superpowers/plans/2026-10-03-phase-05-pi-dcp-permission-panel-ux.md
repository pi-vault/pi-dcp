# Phase 5 — Pi DCP Permission and Panel UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-call compression approval and a Pi-native status/action panel while retaining every existing command and safe headless behavior.

**Architecture:** Extend permission and persistence first, then make tool authorization consume that state. Build the panel from a pure view model and action executor; a thin Pi TUI component handles only rendering and keyboard selection. Existing command functions remain the single mutation path for manual mode, sweep, and block activation.

**Tech Stack:** Node.js, TypeScript 7, Pi 1.0 extension and TUI APIs, TypeBox 1.3, Vitest 5, Biome 2, pnpm

**Spec:** `docs/superpowers/specs/2026-10-03-pi-dcp-improvement-roadmap-design.md`

## Global Constraints

- Execute this phase after `2026-10-03-phase-04-pi-dcp-lifecycle-integration.md` and start from v0.9.0.
- Permission is exactly `allow | ask | deny`; the default remains `allow`.
- `ask` confirms every compression call and fails closed when no interactive UI exists.
- Existing `dcp:*` commands remain supported and use the same domain mutations as panel actions.
- Preserve Phase 4's inactive-tool selection, run-boundary prompt snapshots, and restored-loadout precedence. Allow/ask do not implicitly activate `compress`; guidance additionally requires an active tool.
- State-change callbacks have type `(ctx: ExtensionCommandContext) => void`; commands and panel actions pass their current context for immediate reconciliation.
- `@earendil-works/pi-tui` is host-provided: exact `"*"` peer, compatible development dependency, never a runtime dependency.

## Review Focus

- A rejected `ask` call must not start compression timing or mutate/persist block state; Task 2 checks the blocked lifecycle.
- Restoring a v1 snapshot must preserve allow/deny, while malformed v2 permission values must reject the snapshot; Task 1 covers both versions.
- A headless/RPC call in `ask` mode must block rather than silently allow; Task 2 adds this boundary.
- A panel action against a block that disappeared after the model was built must return a readable message and leave state valid; Task 3 adds the stale-row case.
- Lifetime-stat loading or narrow rendering failure must not remove command access or strand the custom UI; Task 4 tests fallback and close paths.

---

### Task 1: Add `ask` permission and version-2 persistence

**Files:**

- Modify: `src/config-schema.ts`
- Modify: `src/state/types.ts`
- Modify: `src/state/persistence.ts`
- Modify: `src/commands/permission.ts`
- Test: `tests/config.test.ts`
- Test: `tests/persistence.test.ts`
- Test: `tests/commands-permission.test.ts`

**Interfaces:**

- Consumes: existing allow/deny configuration and version-1 snapshots.
- Produces: `export type CompressPermission = "allow" | "ask" | "deny"`, `DcpSnapshotV2`, and a permission command cycling allow -> ask -> deny -> allow.

- [ ] **Step 1: Add failing configuration and cycle tests**

Assert `compress.permission: "ask"` loads without warnings and defaults remain `"allow"`. Update
permission-command tests to assert the exact sequence `allow -> ask -> deny -> allow`, including an
undefined session value beginning from the effective `allow` default.

- [ ] **Step 2: Add failing v1/v2 persistence tests**

Keep literal v1 allow and deny fixtures and assert both parse and restore. Add a v2 fixture with
`compressPermission: "ask"` and assert round-trip preservation. Assert version 2 with any other
permission is rejected and version 1 with `ask` is rejected as invalid historical data.

- [ ] **Step 3: Run focused tests and verify `ask` is unsupported**

Run: `pnpm vitest run tests/config.test.ts tests/commands-permission.test.ts tests/persistence.test.ts`

Expected: FAIL on the new enum, cycle, and v2 snapshot cases.

- [ ] **Step 4: Introduce the shared permission type**

Export `CompressPermission` from `src/state/types.ts` and use it in `SessionState` and config-facing
type annotations. Add `"ask"` to the TypeBox union without changing its default.

- [ ] **Step 5: Implement snapshot version 2 with a v1 reader**

Define `DcpSnapshotV2` with `version: 2` and the three-value permission. Change serialization to
write v2. Parse v1 with its historical allow/deny union and v2 with the new union, returning a
shared snapshot type that restoration can consume. Do not mutate canonical message IDs or block
shape.

- [ ] **Step 6: Implement permission cycling**

Make `permissionCommand(state)` advance through the exact three-value sequence and retain the
existing human-readable `Compress permission: <value>` response.

- [ ] **Step 7: Run configuration, command, and persistence tests**

Run: `pnpm vitest run tests/config.test.ts tests/commands-permission.test.ts tests/persistence.test.ts tests/session-analysis.test.ts`

Expected: PASS for both snapshot versions and all permission transitions.

- [ ] **Step 8: Commit permission persistence**

```bash
git add src/config-schema.ts src/state/types.ts src/state/persistence.ts src/commands/permission.ts tests/config.test.ts tests/persistence.test.ts tests/commands-permission.test.ts tests/session-analysis.test.ts
git commit -m "feat: add ask compression permission"
```

### Task 2: Confirm `ask` calls and reconcile tool exposure

**Files:**

- Create: `src/compress/permission.ts`
- Modify: `src/capabilities.ts`
- Modify: `src/index.ts`
- Test: `tests/compress-permission.test.ts`
- Test: `tests/capabilities.test.ts`
- Test: `tests/index.test.ts`
- Test: `tests/integration.test.ts`

**Interfaces:**

- Consumes: `CompressPermission`, Pi `tool_call` input, and `ctx.ui.confirm`.
- Produces: `describeCompressionRequest(input: Record<string, unknown>): { topic: string; targetCount: number; targetLabel: "range" | "target" }` in `src/compress/permission.ts` and per-call allow/block decisions.

- [ ] **Step 1: Extend capability tests for `ask`**

Assert `ask` leaves `pipelineEnabled` and `compressionEnabled` true when no other policy reason
suppresses them. With an active `compress` tool it includes the DCP prompt section and permits
nudges. With an inactive tool it preserves that selection and omits guidance. Only `deny` adds a
permission suppression reason; global/model/sub-agent suppression continues to apply.

- [ ] **Step 2: Add failing confirmation tests**

In `tests/compress-permission.test.ts`, for range input with two `content` ranges, assert the dialog title is `Allow DCP compression?` and
the message includes the topic and `2 ranges`. For message mode with one target, assert `1 target`.
Test approval returns no block result, rejection returns
`{ block: true, reason: "Compression was not approved" }`, and no UI returns
`{ block: true, reason: "Compression requires interactive approval" }` without calling confirm.

- [ ] **Step 3: Add the blocked-lifecycle assertion**

After a rejected call, assert no compression timing entry, block, statistics change, or persisted
custom entry is created. Keep the existing defensive deny assertion.

- [ ] **Step 4: Run capability and lifecycle tests**

Run: `pnpm vitest run tests/capabilities.test.ts tests/index.test.ts tests/integration.test.ts`

Expected: FAIL because `ask` is not yet authorized or confirmed.

- [ ] **Step 5: Implement request description and confirmation**

In `src/compress/permission.ts`, extract a string topic when present, otherwise use
`Untitled compression`; count valid array items from `content` or `targets`, otherwise zero. In the `tool_call` handler, block deny first, then for
ask require `ctx.hasUI` and await `ctx.ui.confirm`. Do not cache approval across calls.

- [ ] **Step 6: Reconcile runtime permission changes immediately**

Treat allow and ask as compression-enabled in capabilities; deny remains suppressed. Ensure the
permission command invokes the state-change callback with its current command context, reconciling
active tools immediately and the prompt on the next run. Preserve the pre-suppression active state
within a branch and Pi's selected loadout across restoration as established in Phase 4. Retain the
defensive capability guard in the registered execute function.

- [ ] **Step 7: Run focused and complete compression tests**

Run: `pnpm vitest run tests/compress-permission.test.ts tests/capabilities.test.ts tests/index.test.ts tests/integration.test.ts tests/compression-timing.test.ts tests/compress-range.test.ts tests/compress-message.test.ts`

Expected: PASS; approval occurs for every ask call and blocked calls leave no timing/state residue.

- [ ] **Step 8: Commit ask authorization**

```bash
git add src/compress/permission.ts src/capabilities.ts src/index.ts tests/compress-permission.test.ts tests/capabilities.test.ts tests/index.test.ts tests/integration.test.ts
git commit -m "feat: confirm compression calls in ask mode"
```

### Task 3: Build the panel view model and action executor

**Files:**

- Create: `src/ui/panel-model.ts`
- Modify: `src/utils/context-limits.ts`
- Modify: `src/commands/lifetime.ts`
- Test: `tests/panel-model.test.ts`
- Test: `tests/context-limits.test.ts`
- Test: `tests/commands-lifetime.test.ts`

**Interfaces:**

- Consumes: state, config, current model/context usage, resolved limits, and structured lifetime statistics.
- Produces: `resolveContextLimits(...)`, `DcpPanelModel`, `DcpPanelAction`, `buildDcpPanelModel(...)`, and `applyDcpPanelAction(action, state, config): string`.

- [ ] **Step 1: Add failing resolved-limit tests**

Export `resolveContextLimits(config, state, contextUsage)` and assert it returns absolute min/max
values after model override, global absolute, and percentage resolution. Assert unavailable context
windows yield `undefined` only for percentage limits; existing over-limit decisions must delegate
to the same result.

- [ ] **Step 2: Add failing panel-model tests**

Build a state with active and user-deactivated blocks. Assert the model contains model key, usage,
resolved limits, compression/manual/permission modes, session statistics, structured lifetime
totals, and deterministic block rows sorted by block ID. Assert unavailable usage/model/lifetime
data renders explicit `unavailable` values rather than throwing.

- [ ] **Step 3: Add failing action-executor tests**

Assert actions:

- toggle manual mode through `manualCommand`;
- cycle permission through `permissionCommand`;
- sweep through `sweepCommand`;
- deactivate an active block through `decompressCommand`;
- reactivate a user-deactivated block through `recompressCommand`;
- return `Block <id> not found.` for a stale block row.

- [ ] **Step 4: Run model and command tests**

Run: `pnpm vitest run tests/panel-model.test.ts tests/context-limits.test.ts tests/commands-lifetime.test.ts`

Expected: FAIL because structured panel data and exported limit resolution do not exist.

- [ ] **Step 5: Expose shared resolved limits and lifetime types**

Add `ResolvedContextLimits { min: number | undefined; max: number | undefined }`; make
`isContextOverLimits` consume `resolveContextLimits`. Export the existing lifetime aggregate as
`LifetimeStats` so the panel consumes data rather than parsing command text.

- [ ] **Step 6: Implement the pure panel model and actions**

Define action variants `toggle-manual`, `cycle-permission`, `sweep`, `toggle-block` with `blockId`,
and `close`. The action executor delegates to existing command functions and contains no Pi UI
calls. The model contains already-formatted scalar labels plus structured block rows for rendering.

- [ ] **Step 7: Run panel-model and regression tests**

Run: `pnpm vitest run tests/panel-model.test.ts tests/context-limits.test.ts tests/commands-lifetime.test.ts tests/commands-manual.test.ts tests/commands-permission.test.ts tests/commands-sweep.test.ts tests/commands-decompress.test.ts`

Expected: PASS with no duplicated mutation logic.

- [ ] **Step 8: Commit panel domain behavior**

```bash
git add src/ui/panel-model.ts src/utils/context-limits.ts src/commands/lifetime.ts tests/panel-model.test.ts tests/context-limits.test.ts tests/commands-lifetime.test.ts
git commit -m "feat: add DCP panel view model and actions"
```

### Task 4: Add the Pi custom panel and `dcp` command

**Files:**

- Create: `src/ui/panel.ts`
- Modify: `src/commands/register.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `tests/package-metadata.test.ts`
- Test: `tests/panel.test.ts`
- Test: `tests/commands-register.test.ts`

**Interfaces:**

- Consumes: `DcpPanelModel`, `DcpPanelAction`, Pi `Theme`, `ctx.ui.custom`, and pi-tui key/width helpers.
- Produces: `DcpPanelComponent` and `openDcpPanel(state, config, ctx, onStateChange): Promise<void>`, registered as command `dcp`, with `onStateChange: (ctx: ExtensionCommandContext) => void`.

- [ ] **Step 1: Add the host-provided pi-tui metadata test**

Append `@earendil-works/pi-tui` to `hostProvidedPackages`. Assert it is absent from dependencies,
present as peer `"*"`, and present in devDependencies. Run the test and verify it fails before
changing package metadata.

- [ ] **Step 2: Add failing rendering and key tests**

Instantiate `DcpPanelComponent` with a fixed model and action callback. At widths 60, 80, and 120,
assert every rendered line's visible width is within the requested width and the title/status/actions
remain present. Assert arrows and `j`/`k` change selection, Enter returns the selected action, and
Escape/`q` returns `close` exactly once.

- [ ] **Step 3: Add failing command-controller tests**

Assert `dcp` is registered. In TUI mode, mock `ctx.ui.custom` to return a permission action then
close; assert state changes, `onStateChange(ctx)` runs, and the next model reflects the new value. In
non-TUI mode, assert one error notification and no custom UI call. Make lifetime loading reject and
assert the panel still opens with unavailable totals and existing commands remain registered.

- [ ] **Step 4: Run UI and metadata tests**

Run: `pnpm vitest run tests/panel.test.ts tests/commands-register.test.ts tests/package-metadata.test.ts`

Expected: FAIL because the panel, command, and pi-tui peer are absent.

- [ ] **Step 5: Add pi-tui as a host-provided package**

Add `"@earendil-works/pi-tui": "^1.0.0"` to devDependencies and exact `"*"` to peerDependencies.
Run `pnpm install --lockfile-only` and verify the root importer changes without unrelated resolution
updates.

- [ ] **Step 6: Implement the terminal component**

Use `Theme` from pi-coding-agent and `matchesKey`/`truncateToWidth` from pi-tui. Render a compact
header, usage/threshold/status rows, selectable core actions, block rows, lifetime totals, and a
keyboard footer. Track only selection and completion state; return actions through the callback.

- [ ] **Step 7: Implement the panel controller and command**

In TUI mode, load lifetime totals, build a fresh model, await one component action, execute it, call
`onStateChange(ctx)`, and reopen until `close`. Catch lifetime-read failures as unavailable data. Register
`dcp` without removing or renaming any `dcp:*` command.

- [ ] **Step 8: Run UI, command, package, and type checks**

Run: `pnpm vitest run tests/panel.test.ts tests/commands-register.test.ts tests/package-metadata.test.ts && pnpm typecheck && pnpm lint`

Expected: PASS with zero warnings and pi-tui present only as a host-provided development peer.

- [ ] **Step 9: Commit the custom panel**

```bash
git add src/ui/panel.ts src/commands/register.ts package.json pnpm-lock.yaml tests/package-metadata.test.ts tests/panel.test.ts tests/commands-register.test.ts
git commit -m "feat: add interactive DCP status panel"
```

### Task 5: Finalize and verify the v0.10.0 release

**Files:**

- Modify: `dcp.schema.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

**Interfaces:**

- Consumes: ask permission, v2 persistence, and panel behavior from Tasks 1-4.
- Produces: documented and packaged v0.10.0 UX with generated configuration schema.

- [ ] **Step 1: Document permissions and panel controls**

Document allow/ask/deny semantics, headless ask denial, the permission cycle, `dcp` panel fields and
keys, and unchanged direct commands. Add v0.10.0 release notes and set the package version to
`0.10.0`.

- [ ] **Step 2: Regenerate schema and run complete verification**

Run: `pnpm generate:schema && pnpm check && pnpm run pack:dry-run && pnpm benchmark`

Expected: exit 0, zero lint warnings, all compact-marker benchmark gates pass, and the schema
contains the three-value permission union.

- [ ] **Step 3: Manually verify permission flows in Pi**

In interactive Pi, test one approved and one rejected ask call, switch to deny and confirm the tool
and prompt disappear, then return to allow and confirm prior active-tool state is restored. Resume,
fork, and navigate the session tree; confirm v2 permission and blocks restore.

- [ ] **Step 4: Manually verify the panel**

Open `dcp` at approximately 60, 80, and 120 columns. Verify arrows, `j`/`k`, Enter, Escape, `q`,
manual toggle, permission cycle, sweep, and block deactivate/reactivate. Confirm direct `dcp:*`
commands still work after closing the panel.

- [ ] **Step 5: Review and commit v0.10.0 metadata**

Run: `git diff --check && git status --short`

```bash
git add dcp.schema.json README.md CHANGELOG.md package.json
git commit -m "chore: prepare pi-dcp 0.10.0"
```
