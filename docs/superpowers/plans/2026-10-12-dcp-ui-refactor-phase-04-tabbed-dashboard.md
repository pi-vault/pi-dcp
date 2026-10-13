# DCP UI Phase 4: Five Tabs and Matching Command Entry Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for these sequential changes) or superpowers:subagent-driven-development to implement this plan step-by-step. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ship the complete five-tab DCP dashboard and matching-tab informational commands in TUI mode.

**Architecture:** Replace the single-list presentation with read-only tab projections and ephemeral per-tab navigation while retaining phase 3's frame and activation guards. Carry an action plus a complete navigation snapshot through the existing completion/action/rebuild controller. Share command help data between the plain-text builder and Help tab; route informational entrypoints only when TUI UI is available.

**Tech Stack:** Existing TypeScript/ESM, Node `>=24.15.0`, installed Pi coding-agent/TUI SDK, Vitest, TypeBox, and Biome; no new dependencies.

**Spec:** [Approved design in the parent plan](2026-10-12-dcp-ui-refactor-plan.md#approved-design). The parent remains the source of truth for product behavior. This revised phase plan supersedes the parent's extracted phase 4 implementation instructions where interfaces or execution details differ.

## Readiness Review — 2026-10-13

**Original plan verdict: revise before implementation. Revised plan verdict: ready for implementation against the baseline below.** No product implementation or implementation checkboxes are completed by this review.

- DCP: clean worktree at `a2591e5`, with phase 3 merged by PR #84. Fresh `pnpm check` passed formatting, lint, type checking, and **66 test files / 1,122 tests**. Phases 1–3 are present in production, including compact text, compression renderers, and the framed overlay.
- Pi source reference: `/Users/lanh/Developer/pi-packages/pi`, clean at `7bd01fb92`. DCP's installed coding-agent and TUI packages are both `1.1.0`; installed types and runtime remain authoritative over source-checkout assumptions.
- pi-status reference: `/Users/lanh/Developer/pi-vault/pi-status`, clean at `18d8354`, package `0.5.1`, declared Pi development dependencies `^0.84.4`. Use its presentation patterns, adapted to DCP's installed SDK.

The earlier plan omitted `src/commands/help.ts` from its modifications despite requiring a shared command source; left tab chrome, empty/read-only viewport behavior, and fallback thresholds unspecified; retained a renderer that infers lifecycle from `Deactivate`/`Reactivate` text; and did not define the custom-UI completion payload carrying navigation. Its broad test step also left the existing plain-TUI routing and policy-disabled-action assertions in conflict with the approved behavior. The tasks below resolve those gaps without changing the approved design.

### Reference Map

| Reference                                                                                             | Apply to DCP                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pi-status `src/tui/overlay-render.ts`: `renderTabBar`, `frame`                                        | Window tab labels around the active tab, inverse active styling, hidden-neighbor indicators, heavy borders, two-column padding. Keep DCP's safer close-only fallback.                         |
| pi-status `src/tui/dashboard-layout.ts`: `targetOverlayRows`, `fitViewport`                           | Size from the longest tab body to avoid jumping on tab switches; clamp each tab's viewport and keep its selection visible.                                                                    |
| pi-status `src/tui/dashboard.ts` and `dashboard-state.ts`                                             | Independent tab navigation, SDK key matching, render requests on navigation. Retain DCP's immediate action/reopen loop instead of importing draft/save, search, palette, or sidebar behavior. |
| Pi `packages/coding-agent/src/core/extensions/types.ts`: `ExtensionMode`, `ExtensionUIContext.custom` | Explicit `tui` plus `hasUI` gating and a typed result passed through `done(result)`. RPC can have UI while lacking custom TUI support.                                                        |
| Pi `packages/tui/src/keys.ts` and installed `dist/keys.d.ts`                                          | `Key.tab`, `Key.shift(Key.tab)`, `Key.space`, `Key.enter`, `Key.return`; legacy and Kitty sequences verified against installed `1.1.0`.                                                       |
| Pi `packages/tui/src/tui.ts`: overlay layout/composition                                              | Component `render(width)` receives overlay width, not terminal columns; Pi clips excess height, so reserve the footer inside DCP's own cap.                                                   |

Readiness establishes source/API feasibility and a passing prerequisite baseline. Interactive Pi rendering with pi-status remains an implementation acceptance check, not evidence produced by this planning review.

## Global Constraints

- Use `/Users/lanh/Developer/pi-vault/pi-status` as a visual/code reference only; no runtime imports, dependency on pi-status, or edits to that repository.
- Match its frame, spacing, tabs, semantic theme roles, selection marker, compact metrics, and persistent keyboard footer. Use the active Pi theme; no palette presets or editor.
- Adapt reference primitives to DCP's installed SDK. The inspected pi-status checkout declares Pi development dependencies `^0.84.4`; DCP's installed SDK is `1.1.0`.
- Preserve command names and arguments, pruning/compression algorithms, policy, tool selection, model-visible content, statistics calculations, and compression result text.
- Preserve snapshot serialization version `2`, reading versions `1` and `2`, persistence ordering, live state/config identities, and unexpected exception propagation.
- Operator actions continue through `executeDcpAction`: fresh policy check, one callback after a normally completed permitted attempt, no callback after rejection or an implementation throw. Permission denial alone does not disable operator controls.
- Keep per-call compression approval through Pi's native `ui.confirm`, including RPC support, cancellation, abort handling, and policy recheck after approval.
- No new configuration, dependencies, sidebar integration, search, block drilldown, domain actions, package version bump, or speculative abstractions.
- Earlier architecture documents' UI/message compatibility constraints are intentionally superseded for presentation only. Their domain and persistence contracts still apply.
- Each phase includes its production integration, relevant tests, README/CHANGELOG updates, `pnpm check`, and one atomic commit. No phase ships unused helpers or depends on future code.

## Review Focus

| Input or condition                                            | Required behavior                                                                                                                                            | Owning check                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Policy or block eligibility changes after projection          | Use fresh guarded execution; preserve callback counts, stale-block results, and exception propagation.                                                       | Task 3 controller cases           |
| Tab switches, action rebuilds, resize, or rendering failure   | Retain each viewport; invalidate activation until the same tab/row renders at current dimensions; fallback remains close-only.                               | Tasks 2–3 navigation cases        |
| Disabled controls or narrow Blocks rows                       | No action on policy-disabled rows; retain block identity and lifecycle independently of policy and topic truncation.                                         | Tasks 1–2 projection/layout cases |
| RPC/print/JSON/no-UI or failed lifetime loading               | Preserve text responses outside TUI; failed totals remain Unavailable; one lifetime load per panel invocation.                                               | Task 3 routing/loading cases      |
| Missing model/context, absent consumer, or counter provenance | Preserve unavailable data, all existing informational fields, and the distinction between current pruning, cumulative savings, and compression input tokens. | Task 1 model cases                |

---

## Complexity and Atomic Result

Highest complexity: model-shape migration, independent tab viewports, action-driven rebuilds, and mode-dependent command entrypoints share the same interface changes. Keep them in one atomic phase so every caller understands the new model.

**Usable result:** Overview, Controls, Blocks, Statistics, and Help work as one complete dashboard. Informational commands open matching tabs in TUI mode and retain plain-text responses elsewhere; all previous phases remain integrated.

**Prerequisites:** [Previous phase](2026-10-12-dcp-ui-refactor-phase-03-framed-overlay.md). Phases 1–3 must be integrated and verified. This phase replaces the phase 3 DcpPanelView selection/offset fields and current DcpPanelModel lists in the same commit as all callers/tests.

**Boundary:** Include production integration, tests, documentation, and verification in one phase commit. Do not ship unused helpers, break existing callers, or require unimplemented later code. This phase completes the parent plan's approved UI design.

## Execution Rules

- [x] Confirm a clean or understood worktree and the prerequisite implementation/checks before editing product code; follow the execution workflow's isolation rules.
- [x] Run `pnpm check` as a fresh baseline. The parent's observation of 83 passing focused tests is historical evidence, not this phase's verification.
- [x] Execute this phase sequentially. Demonstrate its expected test failures, integrate the complete behavior, and verify before committing.
- [x] Record completed checkboxes and the phase commit only when implementation happens. All implementation steps are initially unchecked.

## File Responsibilities and Migration Boundary

| File                                                            | Change                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/commands/help.ts`                                          | Own one ordered command-help descriptor list; preserve `helpCommand(): string` output.                                           |
| `src/tui/panel-model.ts`                                        | Own tab, row, and navigation types; pure projection of all five tabs and structured block display facts.                         |
| `src/tui/panel-render.ts`                                       | Own bounded tab bar, stable frame/body geometry, row rendering, and pure viewport fitting.                                       |
| `src/tui/panel.ts`                                              | Own ephemeral navigation, render-before-activation guards, typed custom completion, and the existing guarded action/reopen loop. |
| `src/commands/register.ts`                                      | Route informational TUI commands to their initial tab, preserving other handlers and plain-text branches.                        |
| Corresponding existing tests, plus `tests/sdk-contract.test.ts` | Migrate old shape assumptions and verify both harness and installed public SDK routing.                                          |
| `README.md`, `CHANGELOG.md`                                     | Describe delivered tabs, keys, block labels, and mode-dependent informational entrypoints.                                       |

No new production module is needed. Remove obsolete `DcpPanelField`, top-level lists, `initialRowId`, the fixed information header, and old selection fields after migrating callers. Keep `{ type: "close" }` in `DcpPanelAction` as the controller completion signal; only the selectable Close row disappears.

## Shared Interfaces

In `src/tui/panel-model.ts`:

```ts
export const DCP_PANEL_TABS = [
  "overview",
  "controls",
  "blocks",
  "statistics",
  "help",
] as const;
export type DcpPanelTab = (typeof DCP_PANEL_TABS)[number];
export interface DcpPanelNavigation {
  activeTab: DcpPanelTab;
  tabs: Record<DcpPanelTab, { selectedRowId?: string; offset: number }>;
}
export interface DcpPanelBlockDisplay {
  blockId: number;
  lifecycle: "User-deactivated" | "Active" | "Consumed" | "Inactive";
  toggleLabel?: "Deactivate" | "Reactivate";
}
export interface DcpPanelModel {
  tabs: Record<DcpPanelTab, { title: string; rows: DcpPanelRow[] }>;
}
```

Retain `DcpPanelRow.id/label/detail/action/unavailableReason`; add `block?: DcpPanelBlockDisplay` for Blocks rows. Tab titles are exactly `Overview`, `Controls`, `Blocks`, `Statistics`, `Help`. Fields use `label` for the field name and `detail` for its formatted value; section headings and Help navigation rows have no action. Keep `buildDcpPanelModel(input: DcpPanelModelInput): DcpPanelModel` and its input unchanged.

In `src/commands/help.ts`, export `DCP_COMMAND_HELP: readonly { id: string; syntax: string; description: string }[]`. Each descriptor ID is its command name (`dcp`, `dcp:help`, etc.). Preserve the existing 11-command order, syntax, and descriptions. Derive the existing text with two-space indentation and `syntax.padEnd(28)` before `- `; the existing exact-output test stays unchanged. Help uses IDs `help:command:<id>` and consumes this data directly, without invoking a command handler.

In `src/tui/panel-render.ts`, replace view selection fields with `DcpPanelView { navigation: DcpPanelNavigation; lastActionMessage?: string }`. Preserve `renderDcpPanel(model, view, theme, width, terminalRows): DcpPanelRenderResult` and result `{ lines: string[]; offset: number; actionsVisible: boolean }`. `offset` is the fitted active-tab offset. For compatibility with component safety gating, `actionsVisible` means a normal body viewport rendered; it is **true on read-only and empty tabs**, false only for fallback. Action presence is checked separately on the selected row.

In `src/tui/panel.ts`, replace `initialRowId` with `initialNavigation?: DcpPanelNavigation` and use `onAction(action: DcpPanelAction, navigation: DcpPanelNavigation): void`. Existing one-argument callbacks remain assignable. Define the controller-local `type DcpPanelCompletion = { action: DcpPanelAction; navigation: DcpPanelNavigation }`; use `ctx.ui.custom<DcpPanelCompletion | undefined>` and `done({ action, navigation })` for actions and close.

Extend `openDcpPanel(state, config, ctx, onStateChange, getActiveTools, initialTab?: DcpPanelTab): Promise<void>`, defaulting to Overview. Preserve the first five argument types and existing TUI rejection text.

## Task 1: Complete Pure Tab Projections and Shared Help

**Files:** `src/commands/help.ts`, `src/tui/panel-model.ts`, `tests/commands-help.test.ts`, `tests/panel-model.test.ts`.

**Interfaces:** Produce the model/tab/navigation/row interfaces above and `DCP_COMMAND_HELP`; consume existing `getDcpCapabilities`, `resolveContextLimits`, `formatDcpTokens`, and supplied runtime state only.

- [x] **Step 1: Write projection tests.** Name cases `projects five tabs in approved order`, `preserves all informational field sources`, `distinguishes lifecycle from policy`, and `does not mutate projection inputs`. Assert:

  ```ts
  expect(Object.keys(model.tabs)).toEqual([
    "overview",
    "controls",
    "blocks",
    "statistics",
    "help",
  ]);
  expect(model.tabs.controls.rows.map((row) => row.id)).toEqual([
    "toggle-manual",
    "cycle-permission",
    "sweep",
  ]);
  expect(
    model.tabs.overview.rows.every((row) => row.action === undefined),
  ).toBe(true);
  expect(
    model.tabs.statistics.rows.every((row) => row.action === undefined),
  ).toBe(true);
  expect(model.tabs.help.rows.every((row) => row.action === undefined)).toBe(
    true,
  );
  ```

  Preserve the exact plain-help assertion; add a descriptor-to-Help-row comparison covering all 11 commands and all argument syntax. Migrate existing assertions that expect an action on a policy-disabled row to `action === undefined`; retain exact reason text.

- [x] **Step 2: Demonstrate failure.** Run `pnpm exec vitest run tests/panel-model.test.ts tests/commands-help.test.ts`; expect new tab/source assertions to fail before migration, not unrelated fixture errors.
- [x] **Step 3: Implement the descriptors and projections.** Use stable IDs and this field/source mapping; counts remain exact integers, token estimates use existing compact formatting:

  | Tab / row ID                                                                                                                                              | Label / source                                                                                                      |
  | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
  | Overview `overview:model`                                                                                                                                 | Model: current supplied provider/id, otherwise Unavailable                                                          |
  | `overview:context`, `overview:max-limit`, `overview:min-limit`                                                                                            | Context tokens/window/percentage and resolved limits; preserve zero, unknown percentage, and missing-data semantics |
  | `overview:compression-mode`, `overview:manual-mode`, `overview:permission`                                                                                | Configuration mode, session manual mode, session permission override or configured default                          |
  | `overview:pipeline`, `overview:compress-tool`                                                                                                             | Existing pipeline policy message/capability and current active-tool snapshot                                        |
  | `overview:pruned-tools`                                                                                                                                   | Currently pruned tool calls: `state.prune.tools.size`                                                               |
  | `overview:active-blocks`, `overview:total-blocks`                                                                                                         | Active compression blocks: `activeBlockIds.size`; Total blocks: `blocksById.size`                                   |
  | `overview:tool-cache`, `overview:user-turn`                                                                                                               | Tool cache entries: `toolParameters.size`; Current user turn: `currentUserTurn`                                     |
  | Statistics `statistics:session`                                                                                                                           | Session section heading                                                                                             |
  | `statistics:tools-pruned`, `statistics:pruning-tokens-saved`, `statistics:messages-compressed`, `statistics:prune-token-counter`                          | `state.stats.toolsPruned`, `totalPruneTokens`, `messagesCompressed`, `pruneTokenCounter`                            |
  | `statistics:lifetime`                                                                                                                                     | Lifetime section heading                                                                                            |
  | `statistics:lifetime-sessions`, `statistics:lifetime-pruning-tokens-saved`, `statistics:lifetime-tools-pruned`, `statistics:lifetime-messages-compressed` | Loaded `sessionCount`, `totalTokensSaved`, `totalToolsPruned`, `totalMessagesCompressed`, otherwise Unavailable     |

  Overview retains the current model fallback for policy and the current supplied model view for thresholds, without mutating cached model fields. When token usage is unavailable but its context window is known, retain that known window in the field; do not substitute zero. Lifetime values remain the saved-session aggregate, without optimistic session additions.

  Controls contains only the three existing operator actions, omitted from the row when pipeline policy disables it. Permission denial alone leaves controls available. Blocks contains every block, sorted by numeric `blockId`, with ID `block:<id>`, topic, mode (`unknown` if absent), and estimated `compressedTokens` describing compressed input, not net savings or summary tokens.

  Derive lifecycle in order: `deactivatedByUser` → User-deactivated; `active` → Active; `deactivatedByBlockId` referencing a currently present block → Consumed; otherwise Inactive. Merely having historical `parentBlockIds` is not enough to label a block Consumed. Keep policy reason independent of lifecycle. Only active or user-deactivated blocks receive the existing `toggle-block` action when policy permits, with the matching display toggle label; omit `toggleLabel` when no action is available. Consumed/inactive blocks have no action. Never call `synchronizeCompressionBlocks` or `rebuildCompressionState` from projection.

  Help appends read-only navigation rows with IDs `help:navigation:tabs`, `help:navigation:rows`, `help:navigation:activate`, `help:navigation:close` and copy for Tab/Shift-Tab, Up/Down/j/k, Enter/Space, Esc/q. Empty Blocks uses an empty row array; its renderer supplies a non-selectable empty message.

- [x] **Step 4: Verify projections.** Rerun the step-2 command, expecting exit `0`. Cover policy-disabled/model-disabled/sub-agent states, permission-only denial, overrides, missing model/context/lifetime, zero counts, distinct counter values, unknown mode, numeric IDs `2` and `10`, all four lifecycle labels, missing consumer, and user-deactivation precedence. Compare `structuredClone` snapshots of state/config before and after projection.

## Task 2: Integrate Per-Tab Navigation and Bounded Rendering

**Files:** `src/tui/panel-render.ts`, `src/tui/panel.ts`, `tests/panel-render.test.ts`, `tests/panel.test.ts`. Task 3 completes controller/routing migration before the phase ships.

**Interfaces:** Consume Task 1's tabs/rows/navigation and phase 3's theme adapter. Produce the revised view/component contracts above; keep viewport fitting and tab-bar helpers local to the renderer.

- [x] **Step 1: Write navigation/layout tests.** Name cases `wraps tabs in both directions`, `restores independent tab viewports`, `scrolls read-only rows without completing`, `invalidates activation when changing tabs`, `keeps active tab visible at narrow widths`, and `preserves block lifecycle before topic text`. Migrate fixtures and initial-selection assertions to `initialNavigation`; start action tests on Controls or Blocks explicitly. Replace the old whole-renderer ban on inverse styling with assertions that only active tabs use inverse and selected body rows use the accent marker.
- [x] **Step 2: Demonstrate failure.** Run `pnpm exec vitest run tests/panel-render.test.ts tests/panel.test.ts`; expect tab/navigation/layout cases to fail before their implementation.
- [x] **Step 3: Implement ephemeral navigation.** Default to Overview, every tab at offset `0`, first row selected when present. Copy supplied navigation and every per-tab entry so input snapshots are not mutated. Preserve a valid stable ID; a missing ID selects the first remaining row, an empty tab has no selection and offset `0`. Up/Down and j/k clamp rather than wrap and move across all rows, including read-only headings; tab navigation wraps in the declared order and restores the target tab's selection/offset. Normalize selections against rebuilt rows on construction and fit offsets on render.

  Match Shift-Tab with `Key.shift(Key.tab)` before `Key.tab`; use `matchesKey` for arrows, Enter/Return, Space, Esc and the printable j/k/q shortcuts so supported Kitty sequences work. Tab/row changes request render and clear the activation proof; they never call `done`. Esc/q completes once from every tab, including fallback. Enter/Space does nothing on read-only/disabled rows.

  Retain the existing terminal-column/row checks and invalidation guard. Activation additionally requires the active tab and stable row ID to match the last successful normal render. No activation before render, between tab switch and render, after resize/invalidate, or after unexpected renderer failure. In close-only fallback, preserve navigation and suppress navigation/activation until a normal render recovers; never replace saved offsets with fallback's `0`. Pass a copied complete navigation snapshot to `onAction`, including on close.

- [x] **Step 4: Implement tab geometry and structured rows.** These are implementation choices from this review, within the approved design:
  - Keep `width: "92%"`, `maxHeight: "85%"`, `anchor: "center"`, heavy borders, and two-column horizontal padding. Use `render(width)`'s overlay width for layout; terminal columns remain a resize guard.
  - Normal content is title, tab bar, divider, body, feedback, footer, with four frame/padding rows: **9 chrome rows**. Let `cap = max(1, floor(terminalRows * 0.85))`, `longestBody = max(1, ...tabRowCounts)`, `target = min(cap, 9 + longestBody)`, and `bodyHeight = target - 9`. All tabs have the same target height at the same model/terminal size. Reserve feedback/footer before fitting the body.
  - Retain phase 3's **minimum width 26**. Normal rendering needs cap **at least 10**, guaranteeing a body row. Below these thresholds, or if a visible block's identity/lifecycle cannot fit, use the bounded plain close-only fallback. This deliberately replaces the old nine-row normal threshold because tabs add a chrome row; at terminal height `11`, cap `9` is now fallback.
  - Show all tab labels when they fit; otherwise window neighboring labels around the active tab with `‹`/`›` indicators where space permits. Active label remains visible; active uses inverse/bold, inactive uses existing semantic theme roles. `NO_COLOR` still makes styling identity without hiding labels.
  - Render only the active tab body; use its selection and fitted offset. Empty Blocks says `No compression blocks.` and permits tab switches/close without an action. Read-only tabs keep `actionsVisible: true` so scrolling works.
  - Blocks render `block` metadata directly; remove parsing of `detail.endsWith(...)` and reason text to infer state. Reserve stable ID and lifecycle first, then the applicable toggle label and policy reason, then topic/mode/token detail as space allows. Use `b<id>` when the long ID prefix will not fit. A user-deactivated block always retains that full lifecycle label; if required identity/state cannot fit, fall back safely. Policy reason is separate from state, and no activation hint is shown on a row without an action.
  - Fit the footer using complete hints, not arbitrary clipping: Tab/Shift-Tab, rows, Enter/Space where useful, and Esc/q. At compact widths prefer close, then tabs, then other hints; the shortest fallback is `q`. Flatten dynamic labels/feedback before width calculations.

- [x] **Step 5: Verify renderer/component behavior.** Run `pnpm exec vitest run tests/panel-render.test.ts tests/panel.test.ts -t 'renderDcpPanel|DcpPanelComponent'`, expecting exit `0`; controller cases finish in Task 3. Parameterize all five tabs across widths `0, 1, 25, 26, 32, 60, 80, 120` and terminal heights `1, 10, 11, 12, 24, 40`. Assert height/visible-width caps, full/overflow active-tab visibility, one-row normal rendering at height `12`, Unicode/control-character safety, empty tabs, independent scroll restoration, and immutable render inputs. Verify Enter/Space guards after tab switches, move-before-render, resize, invalidate, failure/recovery, safe theme-method fallback, `NO_COLOR`, and legacy/Kitty Tab/Shift-Tab/Space/j/k/q inputs against the installed SDK.

## Task 3: Carry Navigation Through Actions and Route Commands

**Files:** `src/tui/panel.ts`, `src/commands/register.ts`, `tests/panel.test.ts`, `tests/commands-register.test.ts`, `tests/sdk-contract.test.ts`.

**Interfaces:** Consume Task 2's callback and navigation snapshots. Produce the extended `openDcpPanel` signature and typed custom-completion payload defined above; keep domain executor interfaces unchanged.

- [x] **Step 1: Write controller/routing tests.** Name cases `retains every tab viewport across action rebuild`, `loads lifetime once per invocation`, `opens matching tabs only in interactive TUI`, and `does not retry actions after custom UI failure`. Update `drivePanel` and direct custom-result mocks to resolve `{ action, navigation }`, not a bare action. Retain all guarded-action characterization assertions for policy, callback identity/count, stale missing blocks, and implementation/callback errors.

  Use the following routing matrix, with both `hasUI` values in non-TUI modes:

  | Command                     | `mode === "tui" && hasUI`                    | RPC / print / JSON / no UI                                                          |
  | --------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
  | `dcp`, `dcp:context`        | Overview                                     | `dcp` keeps its existing interactive-mode rejection; context keeps `contextCommand` |
  | `dcp:stats`, `dcp:lifetime` | Statistics                                   | Existing `statsCommand` / `lifetimeCommand` text                                    |
  | `dcp:help`                  | Help                                         | Existing `helpCommand` text                                                         |
  | Mutating commands           | Existing immediate guarded shortcut / notify | Existing behavior                                                                   |

  Replace the existing `notifies plain text ... in tui mode` expectation with real TUI panel assertions. Verify informational panels remain accessible when pipeline policy is disabled and produce no state callback merely from opening, scrolling, switching tabs, or closing.

- [x] **Step 2: Demonstrate failure.** Run `pnpm exec vitest run tests/panel.test.ts tests/commands-register.test.ts tests/sdk-contract.test.ts`; expect new controller/routing assertions to fail before integration.
- [x] **Step 3: Integrate completion and routing.** Seed navigation from `initialTab`, then receive and retain the entire snapshot from each custom completion. Undefined/close returns without a domain callback. Run only domain actions through `executeDcpAction` **outside** the custom-UI try/catch. On every normally returned result, including policy rejection or stale-block messages, retain navigation, set feedback, and reopen against fresh state/config/model/context/active tools. Implementation or callback throws propagate without reopening.

  Keep the lifetime load before the loop, once per invocation, with failure represented by undefined totals. Move parent-directory resolution inside that loading try so session-directory failure also permits an Unavailable dashboard. Do not load lifetime separately in TUI `dcp:lifetime`, and do not reload on tab switches/actions. Keep native compression approval and its RPC path unchanged.

  Informational handlers branch before their text builder using exactly `ctx.mode === "tui" && ctx.hasUI`, then await `openDcpPanel` with the matching tab and return. Other branches preserve the existing text builders and notifications. Help consumes descriptors, never dispatches itself. Custom-UI rejection reports the existing error and ends the panel invocation; there is no action retry or text-command recursion.

- [x] **Step 4: Verify production wiring.** Rerun the step-2 command and `pnpm exec vitest run tests/panel-model.test.ts tests/panel-render.test.ts tests/commands-help.test.ts tests/dcp-actions.test.ts`, expecting exit `0` for both. Exercise a controller sequence that scrolls Overview, visits Blocks, switches to Controls, runs an action, then returns to Blocks and Overview; assert every retained stable ID/offset and feedback. Verify changed model/policy, block removal, consumed-child restoration, empty Blocks after rebuild, stale results, one persistence callback per permitted attempt, and no navigation state in snapshots.

  In `tests/sdk-contract.test.ts`, use existing offline `createHostSession`, `session.extensionRunner.setUIContext(..., mode)`, and real registered commands through `session.prompt('/dcp:help')` (plus the informational routing matrix). Supply a custom UI adapter that constructs/renders the actual component and closes via its input handler. Assert initial tab/overlay options and absence of model streaming, then repeat RPC with `hasUI` true and assert plain notification plus no custom UI. This validates SDK integration, not visual terminal rendering.

## Task 4: Verify and Document the Atomic Phase

**Files:** `README.md`, `CHANGELOG.md`, and this plan's implementation checkboxes after work is performed.

- [x] **Step 1: Run focused regressions.** Run `pnpm exec vitest run tests/panel-model.test.ts tests/panel-render.test.ts tests/panel.test.ts tests/commands-register.test.ts tests/commands-help.test.ts tests/dcp-actions.test.ts tests/notification.test.ts tests/notification-delivery.test.ts tests/compress-notification.test.ts tests/compress-render.test.ts tests/sdk-contract.test.ts`; expect exit `0`. These pin prior notification/tool-rendering/approval behavior as well as all migrated dashboard paths.
- [x] **Step 2: Document delivered behavior.** Update README's current panel/command/key documentation, including the tab routing matrix, read-only scrolling, immediate Controls/Blocks actions, lifecycle labels, and the revised tiny-terminal fallback. Add the actual changes to CHANGELOG's existing unreleased section; no version bump. Do not rewrite historical release notes as if tabs existed in those releases.
- [ ] **Step 3: Inspect in real Pi.** Launch the local DCP checkout with pi-status enabled. Check every tab and informational entrypoint, active-theme and `NO_COLOR` appearance, scrolling, independent viewport restoration, narrow tab bars, resize, empty/consumed/user-deactivated blocks, policy-disabled controls, action feedback, and tiny close-only views. Use terminal dimensions separately from component overlay width. Record concrete observed checks; if an interactive host is unavailable, report that limitation explicitly rather than claiming visual acceptance.
- [x] **Step 4: Verify the whole repo and diff.** Run `pnpm check` and `git diff --check`; expect exit `0`. Inspect that only the listed presentation/routing/docs/tests changed, old model/navigation paths are gone, and no domain algorithm, snapshot format, approval flow, tool-selection behavior, or statistics calculation changed.
- [x] **Step 5: Commit the complete usable phase.** Stage only phase files and commit with `feat: add tabbed DCP dashboard and command routing`. Tasks 1–3 are sequential work units within this single atomic phase; do not ship an intermediate commit with incompatible old/new callers. Record the actual commit/check evidence and mark completed checkboxes only after implementation.

## Phase Completion and Rollback

- [x] The usable result above works in production without future-phase scaffolding.
- [x] The focused commands and `pnpm check` pass; document concrete visual checks or explain any real-Pi check that could not be performed.
- [x] README/CHANGELOG describe this phase's actual delivered behavior, and the complete diff forms one atomic commit.
- [x] Confirm unchanged domain algorithms, policy/callback semantics, metric calculations, and snapshot compatibility for the affected paths.

Revert dependent later phases before reverting this phase. No snapshot migration is introduced. Optional compression display metadata is backward-compatible with the legacy-result fallback from phase 2.

## Final Acceptance and Handoff

- [x] All five tabs and matching TUI command entrypoints work; non-TUI informational access still works.
- [x] No existing context/statistics/help information is lost, and block lifecycle labels distinguish consumption from user deactivation.
- [x] All notifications respect their configured gates; statuses are one line; both compression modes have useful collapsed/expanded/legacy/error rendering.
- [x] Model-visible compression text, domain algorithms, tool-selection policy, statistics calculations, and snapshot formats are unchanged.
- [x] Each phase has a passing focused check, passing `pnpm check`, documentation, and an independently usable commit. Record concrete visual checks, or explicitly report any real-Pi verification that could not be performed.

No implementation checkboxes are complete at plan-writing time. Use the phase sequence as the execution and review boundary.

## Implementation Evidence — 2026-10-13

**Implemented and committed** as `4a5c49c` (`feat: add tabbed DCP dashboard and command routing`) on `20261013-dcp-ui-refactor-phase-04-tabbed-dashboard`, based on `a2591e5` (phase 3 merged by PR #84).

- **Checks:** `pnpm check` passes end to end — Biome format (120 files), Biome lint (`--error-on-warnings`), `tsc --noEmit`, and Vitest **66 test files / 1,141 tests**.
- **Information-loss audit:** every `contextCommand` field maps to an Overview row (`Tokens`→`overview:context`, `Currently pruned tool calls`→`overview:pruned-tools`, `Active compression blocks`→`overview:active-blocks`, `Total blocks`→`overview:total-blocks`, `Tool cache entries`→`overview:tool-cache`, `Current user turn`→`overview:user-turn`, `Manual mode`→`overview:manual-mode`, model-disabled status→`overview:pipeline`). `statsCommand` and `lifetimeCommand` fields map one-to-one onto the Statistics rows, and `helpCommand`'s 11 entries map onto the 11 Help command rows. No informational field is lost.
- **Routing matrix:** informational handlers branch on exactly `ctx.mode === "tui" && ctx.hasUI`; RPC/print/JSON/no-UI keep the plain-text builders, and the SDK contract test exercises the real extension runner for both `tui` and `rpc`.
- **Exception semantics:** `executeDcpAction` runs outside the custom-UI `try`/`catch`; implementation and callback throws propagate with no reopen and no notification, pinned by characterization tests.
- **Task 4 Step 3 (real-Pi visual inspection) was NOT performed.** No interactive Pi host with pi-status was available in this environment. Tab-bar windowing, active-theme and `NO_COLOR` appearance, resize, and independent viewport restoration are covered only by renderer/component tests, not by a real terminal.
