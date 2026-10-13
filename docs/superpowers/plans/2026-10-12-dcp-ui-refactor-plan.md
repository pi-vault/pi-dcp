# DCP UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for these sequential changes) or superpowers:subagent-driven-development to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply pi-status's terminal UI conventions to all DCP surfaces, culminating in a five-tab dashboard and matching-tab informational commands.

**Architecture:** Keep presentation local to DCP and retain the existing guarded action and compression lifecycle owners. Introduce formatting and tool rendering first, then frame the working single-list panel, and finally replace that panel's presentation with tab projections and per-tab navigation. Every phase integrates its production callers and is usable without subsequent phases.

**Tech Stack:** Existing TypeScript/ESM, Node `>=24.15.0`, installed Pi coding-agent/TUI SDK, Vitest, TypeBox, and Biome; no new dependencies.

**Spec:** [Approved design](#approved-design), reproduced in this document from the approved brainstorming conversation. Read it together with the phase instructions.

## Global Constraints

- Use `/Users/lanh/Developer/pi-vault/pi-status` as a visual/code reference only; no runtime imports, dependency on pi-status, or edits to that repository.
- Match its frame, spacing, tabs, semantic theme roles, selection marker, compact metrics, and persistent keyboard footer. Use the active Pi theme; no palette presets or editor.
- Adapt reference primitives to DCP's installed SDK. The inspected pi-status checkout uses Pi `0.84.4`; DCP uses Pi `1.1.0`.
- Preserve command names and arguments, pruning/compression algorithms, policy, tool selection, model-visible content, statistics calculations, and compression result text.
- Preserve snapshot serialization version `2`, reading versions `1` and `2`, persistence ordering, live state/config identities, and unexpected exception propagation.
- Operator actions continue through `executeDcpAction`: fresh policy check, one callback after a normally completed permitted attempt, no callback after rejection or an implementation throw. Permission denial alone does not disable operator controls.
- Keep per-call compression approval through Pi's native `ui.confirm`, including RPC support, cancellation, abort handling, and policy recheck after approval.
- No new configuration, dependencies, sidebar integration, search, block drilldown, domain actions, package version bump, or speculative abstractions.
- Earlier architecture documents' UI/message compatibility constraints are intentionally superseded for presentation only. Their domain and persistence contracts still apply.
- Each phase includes its production integration, relevant tests, README/CHANGELOG updates, `pnpm check`, and one atomic commit. No phase ships unused helpers or depends on future code.

## Review Focus

| Input or condition | Required behavior | Phase/test ownership |
| --- | --- | --- |
| Detailed compression notification delivered as status | One-line compact metrics; configured summaries remain exclusive to detailed toasts. | 1: notification delivery matrix |
| Historical tool results have empty details, or the host supplies an error/partial result | Original text remains readable; never invent success metrics. | 2: tool renderer legacy/error/partial cases |
| Resize, Unicode, long labels, tiny terminals, or broken theme rendering | Width/height remain bounded, close remains possible, and unseen actions cannot execute. | 2–4: renderer and component cases |
| Policy or block state changes between projection and activation | Fresh guarded execution preserves rejection, stale-block results, callback identity/count, and exception behavior. | 3–4: controller/action cases |
| Non-TUI invocation, missing UI/model/context, or failed lifetime loading | Informational access remains available; missing values are Unavailable rather than zero. | 4: command routing and model cases |

## Approved Design

The final dashboard is centered at `92%` terminal width and capped at `85%` terminal height. It uses heavy `┏━┃┗` borders, two-column horizontal padding, inverse active tabs, an accent `▸` selection marker, dim descriptions, and a persistent key-hint footer. Navigation and last-action feedback fit inside that height cap.

| Tab | Contents |
| --- | --- |
| Overview | Read-only model, context tokens/window/percentage, resolved min/max limits, compression mode, manual mode, effective permission, pipeline policy, compress-tool availability, currently pruned tool calls, active/total block counts, tool-cache entries, and current user turn. |
| Controls | Manual-mode toggle, permission cycling, and sweep, applied immediately. |
| Blocks | Every block sorted numerically, with stable ID, topic, mode, estimated compressed tokens, lifecycle label, and existing deactivate/reactivate action when eligible. |
| Statistics | Session tools pruned, cumulative pruning tokens saved, messages compressed, prune-token counter; lifetime sessions, pruning tokens saved, tools pruned, and messages compressed. |
| Help | All existing commands, argument syntax, descriptions, and dashboard navigation. |

`dcp` opens Overview. In `ctx.mode === "tui" && ctx.hasUI`, `dcp:context` opens Overview, `dcp:stats` and `dcp:lifetime` open Statistics, and `dcp:help` opens Help. Other contexts retain plain-text informational responses. Opening Help must not recursively run a command.

Tab/Shift-Tab switches tabs. Up/Down and `j`/`k` navigate or scroll, including read-only tabs. Enter/Space activates an eligible row. Esc/`q` closes. There is no draft/save/discard model: operator actions apply immediately. Keep active tab, stable selected IDs, and per-tab offsets through action-driven rebuilds and resizing; navigation is ephemeral and never persisted.

Lifecycle labels use existing facts: User-deactivated takes precedence, then Active, then Consumed when a consuming relationship establishes that fact; otherwise Inactive. Consumed and otherwise inactive rows cannot be toggled. Policy-disabled action rows remain visible with their reason but have no action. A stale previously actionable row still goes through the guarded executor.

Notifications retain off/minimal/detailed, toast/status, existing suppression/delivery timing, and `showCompression`. Status output is one line; detailed toasts preserve tool names, topics, and summaries only when configured. Raw notification strings contain no ANSI styling. Compression tool calls/results gain active-theme rendering; expanded results show original output and available block IDs without duplicating summaries in metadata.

Unavailable lifetime totals do not prevent opening the dashboard. Load lifetime statistics once per invocation, not once per action or tab switch. Do not update lifetime totals optimistically from current-session metrics: preserve the current saved-session aggregation semantics.

## Phase Sequence and Atomicity

| Phase | Complexity | Usable result at its commit | Dependency |
| --- | --- | --- | --- |
| 1 — Text and notifications | Lowest: pure formatting plus delivery selection | Consistent compact DCP output; detailed status notifications no longer span lines. Commands and panel retain their current interaction. | Current code |
| 2 — Compression tool rendering | Moderate: SDK callbacks and optional metadata | Both compression modes display useful themed calls/results, including historical and error results. | Phase 1 formatting |
| 3 — Framed single-list overlay | Higher: terminal geometry and component integration | Existing DCP controls work in a pi-status-style centered overlay with safe sizing. | Phase 2 theme adapter and Phase 1 formatting |
| 4 — Five tabs and command routing | Highest: projections, navigation state, action rebuilds, multiple entrypoints | Complete approved dashboard, with informational commands opening matching tabs in TUI mode. | Phase 3 panel shell |

Each row is a valid stopping point. The single-list panel in phase 3 is the working UI for that release, not an unused scaffold. Phase 4 replaces its rendering/navigation in the same commit as every caller and test migration. Revert dependent later commits first; optional tool metadata needs no saved-session migration.

## Baseline and File Responsibilities

Planning reconnaissance observed a clean worktree and `83` passing tests across the panel, panel-model, command registration, and notification suites. This is historical evidence; rerun checks during implementation.

- [ ] Confirm a clean or understood worktree, follow the execution workflow's isolation rules, and run `pnpm check` before phase 1.
- [ ] Execute phases sequentially because they share extension wiring and presentation modules. Do not implement future-phase scaffolding early.
- [ ] Within each phase: add behavior tests, observe failure, implement and integrate, run focused tests, review the diff, run `pnpm check`, and commit the complete phase.
- [ ] Update completion checkboxes and record commit IDs only when phases are actually implemented.

| Module | Responsibility |
| --- | --- |
| `src/tui/formatters.ts` (new, phase 1) | Compact token formatting and single-line dynamic labels. |
| `src/tui/notification.ts` and informational command builders | Plain-text presentation, keeping transport/delivery with current adapters. |
| `src/tui/theme.ts` (new, phase 2) | Small active-Pi-theme adapter and `NO_COLOR` handling, without pi-status's palette machinery. |
| `src/tui/compress-render.ts` (new, phase 2) | Optional compression display metadata and SDK call/result renderers. |
| `src/tui/panel-render.ts` (new, phase 3) | Pure panel layout/rendering, framing, tab bar, viewport fitting, and footer budget. |
| `src/tui/panel-model.ts` | Read-only projection of current domain facts; final tab and navigation types. |
| `src/tui/panel.ts` | Input handling, ephemeral selection/scroll state, and guarded action/controller loop. |
| `src/commands/register.ts` and `src/index.ts` | Command routing, notification delivery, and compression renderer/metadata integration. |

## Phase 1: Consistent Text and Notifications

**Files:** Create `src/tui/formatters.ts` and `tests/formatters.test.ts`. Modify `src/tui/notification.ts`, `src/index.ts`, `src/commands/context.ts`, `src/commands/stats.ts`, `src/commands/lifetime.ts`, and `src/commands/help.ts`. Update the corresponding command/notification tests and `tests/index.test.ts`. Update README and CHANGELOG for this phase's visible output changes.

**Interfaces:**

- Produce `formatDcpTokens(tokens: number, estimated?: boolean): string`: use lowercase `k`/uppercase `M`, at most one fractional digit, remove trailing `.0`, and prefix estimates with `~`. Counts remain integer counts; missing values are handled by callers as Unavailable.
- Produce `flattenDcpLabel(value: string): string` for single-line topics/labels: collapse whitespace and trim.
- Retain existing notification builder and informational command signatures. Preserve the action executor's domain messages; this phase changes the informational reports and automatic-notification copy, not action dispatch outcomes.
- Exact minimal copy: `DCP · saved ~12.4k tokens · pruned 8 outputs`; compression copy: `DCP · compressed ~12.4k tokens · summary ~2.1k · 5 messages`, with singular nouns when the count is one.

- [ ] **Step 1: Add failing formatting and delivery tests.** Pin these representative assertions and extend them to zero, singular, detailed, and unavailable cases:

  ```ts
  expect(formatDcpTokens(12_400, true)).toBe("~12.4k");
  expect(formatDcpTokens(1_000_000)).toBe("1M");
  expect(flattenDcpLabel("Auth\r\n  system")).toBe("Auth system");
  expect(buildMinimalMessage({ tokensSaved: 12_400, pruned: 8 }))
    .toBe("DCP · saved ~12.4k tokens · pruned 8 outputs");
  ```

  In extension-harness tests, assert detailed compression/status invokes `setStatus("dcp", message)` with no `\r`, `\n`, topic, or summary; detailed compression/toast retains topic and configured summary. Preserve off/no-UI/zero-work suppression. Pruning toasts retain per-pass metrics and statuses retain cumulative metrics. Informational builders retain every current metric and command entry, without ANSI.
- [ ] **Step 2: Demonstrate failure.** Run `pnpm exec vitest run tests/formatters.test.ts tests/notification.test.ts tests/compress-notification.test.ts tests/index.test.ts tests/commands-help.test.ts tests/commands-context.test.ts tests/commands-stats.test.ts tests/commands-lifetime.test.ts tests/commands-register.test.ts`. Expect failure on new formatting/delivery assertions before implementation.
- [ ] **Step 3: Implement formatting and wire actual callers.** Keep aligned label/value text reports and all current information. In `sendCompressNotification`, select detailed output only for detailed/toast; status always uses the minimal builder. Do not change delivery timing, notification severity, the `dcp` status key, configuration warnings, model content, or pruning/compression statistics.
- [ ] **Step 4: Verify the phase.** Run the step-2 command and `pnpm check`; expect all checks to exit `0`. Inspect exact notification strings for singular/plural, estimates, and summary gates.
- [ ] **Step 5: Document and commit the usable result.** Describe compact formatting and single-line statuses in README/CHANGELOG; run `git diff --check`, stage only phase files, and commit with `feat: unify DCP text and notification presentation`.

## Phase 2: Compression Tool Calls and Results

**Files:** Create `src/tui/theme.ts`, `src/tui/compress-render.ts`, `tests/theme.test.ts`, and `tests/compress-render.test.ts`. Modify `src/index.ts`; extend tool-registration/execution coverage in `tests/index.test.ts`, `tests/sdk-contract.test.ts`, and the existing harness only as required. Update README and CHANGELOG.

**Interfaces:**

- Consume phase 1's token and label formatters.
- Produce `DcpTheme = Pick<Theme, "fg" | "bg" | "bold" | "inverse">` and `createDcpTheme(theme: Theme, env?: NodeJS.ProcessEnv): DcpTheme`. `NO_COLOR` presence returns identity styling. Theme methods that throw fall back to their plain input; no fixed colors/configuration are introduced.
- Produce `CompressionDisplayDetails` with optional `dcpCompression: Pick<CompressResult, "topic" | "messagesCompressed" | "compressedTokens" | "summaryTokens" | "blockIds"> & { mode: CompressArgs["mode"] }`.
- Produce `createCompressionDisplayDetails(mode: CompressArgs["mode"], result: CompressResult): CompressionDisplayDetails` using a copied block-ID array.
- Produce `renderCompressCall(mode: CompressArgs["mode"], args: unknown, theme: Theme): Component` and `renderCompressResult(result: AgentToolResult<CompressionDisplayDetails>, options: ToolRenderResultOptions, theme: Theme, context: Pick<ToolRenderContext, "isError">): Component`, using the installed SDK's types. Both tool definitions wire these callbacks; call rendering closes over the registered mode.

- [ ] **Step 1: Add failing renderer/metadata tests.** Assert call output contains the flattened topic, registered mode, and range/target count without the submitted summaries. Assert collapsed metadata-backed results include message count and estimated compressed/summary tokens; expanded results additionally include original result text and `bN` identifiers. Assert metadata uses the exact execution result counts/IDs and does not contain summaries.

  Pin representative data assertions:

  ```ts
  expect(createCompressionDisplayDetails("range", result).dcpCompression)
    .toMatchObject({ mode: "range", messagesCompressed: 5, blockIds: [1, 2] });
  expect(JSON.stringify(details)).not.toContain("private summary text");
  expect(renderedLines.every(line => visibleWidth(line) <= 60)).toBe(true);
  ```

  Cover both modes, partial/missing arguments, zero-message results, metadata-free historical results, error results even if metadata is present, expanded multiline output, Unicode, `NO_COLOR`, and a throwing theme. Legacy/error results display their original text rather than fabricated counts; partial results are not labeled completed. Use actual SDK callback invocation through registered tools for integration coverage.
- [ ] **Step 2: Demonstrate failure.** Run `pnpm exec vitest run tests/theme.test.ts tests/compress-render.test.ts tests/index.test.ts tests/sdk-contract.test.ts`; expect missing-renderer/metadata failures.
- [ ] **Step 3: Implement and register both-mode rendering.** Use Pi components that honor the render width: truncate collapsed rows and wrap expanded text. Add optional metadata only to normally completed compression results. Leave rejected approval/policy results with empty details. Keep result `content`, schemas, activation, execution mode, prompts, timing, and approval unchanged. Do not parse metric counts from human-readable legacy text or read live state to reconstruct historical results. Do not strip supported content types from fallback results.
- [ ] **Step 4: Verify the phase.** Run the step-2 command and `pnpm check`; expect exit `0`. Verify real Pi collapsed/expanded rendering in both configured modes, plus native approval. No model or network call is required for unit tests.
- [ ] **Step 5: Document and commit the usable result.** Document the compact tool presentation and host expansion behavior. Run `git diff --check`, stage phase files, and commit with `feat: render DCP compression calls and results`.

## Phase 3: Framed Single-List Overlay

**Files:** Create `src/tui/panel-render.ts` and `tests/panel-render.test.ts`. Modify `src/tui/panel.ts`; update `tests/panel.test.ts`. Consume phase 2's theme adapter and phase 1's formatters. Update README and CHANGELOG.

**Interfaces:**

- Retain `buildDcpPanelModel(input: DcpPanelModelInput): DcpPanelModel` and `openDcpPanel`'s existing arguments in this phase.
- Produce `DcpPanelView` with `selectedRowId?: string`, `offset: number`, and `lastActionMessage?: string`.
- Produce `DcpPanelRenderResult` with `lines: string[]`, `offset: number`, and `actionsVisible: boolean`.
- Produce `renderDcpPanel(model: DcpPanelModel, view: DcpPanelView, theme: DcpTheme, width: number, terminalRows: number): DcpPanelRenderResult`. It is a read-only renderer; component/controller own navigation and action execution.

- [ ] **Step 1: Add failing frame/controller tests.** Assert `ui.custom` receives `{ overlay: true, overlayOptions: { anchor: "center", width: "92%", maxHeight: "85%" } }`. Assert the frame uses heavy borders and two-column padding, every visible width is bounded at 60/80/120 columns, and rendered height is at most `max(1, floor(terminalRows * 0.85))`. Test many blocks, long Unicode topics, dynamic newlines, and resize while selection is near the end.

  ```ts
  expect(lines.join("\n")).toContain("┏");
  expect(lines.join("\n")).toContain("▸");
  expect(lines.length).toBeLessThanOrEqual(Math.max(1, Math.floor(rows * 0.85)));
  expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
  ```

  Preserve current action/controller characterization tests, updating presentation assertions such as the selection marker. Assert Esc/`q` completes exactly once, action rebuild retains stable selection and feedback, and tiny/render-failed views cannot execute unseen actions. A theme-method failure handled by phase 2's adapter may leave visible unthemed actions usable; update old whole-panel theme-failure expectations accordingly. Separately inject an unexpected renderer failure to prove the close-only/no-unseen-action fallback.
- [ ] **Step 2: Demonstrate failure.** Run `pnpm exec vitest run tests/panel-render.test.ts tests/panel.test.ts tests/panel-model.test.ts`; expect new shell/geometry assertions to fail.
- [ ] **Step 3: Extract and integrate the shell.** Adapt reference `overlay-render.ts` and `dashboard-layout.ts` behavior locally, without their palette/sidebar machinery. Frame the current header and single action/block list; use accent selection instead of inverse entire rows. Reserve the footer before the body, prioritize `Esc/q close` at compact widths, and keep selection in view. For widths below 7 or fewer than 9 capped rows, show a bounded compact close-only fallback; use `q` when even a close phrase cannot fit. Guard unexpected render exceptions with the existing no-unseen-action fallback. Keep the existing completion/rebuild action loop, lifetime loading, and non-TUI `dcp` rejection.
- [ ] **Step 4: Verify the phase.** Run the step-2 command, `tests/dcp-actions.test.ts`, and `pnpm check`; expect exit `0`. In real Pi with pi-status enabled, verify overlay placement, frame, resizing, scrolling, and manual/permission/sweep/block controls. Center against the terminal; no private sidebar-width lookup or offset adjustment.
- [ ] **Step 5: Document and commit the usable result.** Document the styled single-list overlay as this phase's shipped behavior, without advertising tabs yet. Run `git diff --check`, stage phase files, and commit with `feat: present DCP controls in a framed overlay`.

## Phase 4: Five Tabs and Matching Command Entry Points

**Files:** Modify `src/tui/panel-model.ts`, `src/tui/panel-render.ts`, `src/tui/panel.ts`, and `src/commands/register.ts`. Update `tests/panel-model.test.ts`, `tests/panel-render.test.ts`, `tests/panel.test.ts`, `tests/commands-register.test.ts`, `tests/commands-help.test.ts`, and relevant integration coverage. Update README and CHANGELOG.

**Interfaces:**

- Produce `DcpPanelTab = "overview" | "controls" | "blocks" | "statistics" | "help"`, in that display order.
- Replace the old top-level status/statistics/actions/blocks view shape with `DcpPanelModel.tabs: Record<DcpPanelTab, { title: string; rows: DcpPanelRow[] }>`. Keep row IDs stable: existing action IDs and `block:<id>`; informational rows get tab-qualified field IDs. Use rows without actions for fields and section headings. Remove the old production projections/render paths after migrating their callers/tests in this phase.
- Produce `DcpPanelNavigation` with `activeTab: DcpPanelTab` and `tabs: Record<DcpPanelTab, { selectedRowId?: string; offset: number }>`. Replace phase 3's `DcpPanelView.selectedRowId/offset` with `navigation: DcpPanelNavigation`; retain optional last-action feedback. Retain the render function signature and render-result fields, returning the active tab's fitted offset.
- Extend `DcpPanelComponentOptions` with `initialNavigation?: DcpPanelNavigation`; report navigation alongside completion through `onAction(action: DcpPanelAction, navigation: DcpPanelNavigation): void`. Existing one-argument callback implementations remain assignable; production controller captures both values.
- Extend `openDcpPanel(state, config, ctx, onStateChange, getActiveTools, initialTab?: DcpPanelTab): Promise<void>`, defaulting to Overview. Preserve the first five arguments and existing TUI rejection behavior.

- [ ] **Step 1: Add failing tab/model/routing tests.** Assert exact tab order and default Overview; Tab/Shift-Tab wraps in both directions; read-only tabs scroll; switching tabs restores independent selection/offset; Enter/Space on read-only or unavailable rows does nothing. Assert one permitted action rebuild retains tab, every tab's navigation, the selected stable ID, and last-action feedback. Missing selected IDs clamp to an existing row or an empty viewport.

  ```ts
  expect(Object.keys(model.tabs)).toEqual([
    "overview", "controls", "blocks", "statistics", "help",
  ]);
  expect(model.tabs.controls.rows.map(row => row.id)).toEqual([
    "toggle-manual", "cycle-permission", "sweep",
  ]);
  ```

  Test lifecycle precedence, numerically sorted IDs, consumed/inactive no-action rows, disabled reasons, and all existing informational metrics including `pruneTokenCounter`. Preserve unavailable context/model/lifetime data. Assert no projection/navigation operation mutates state or appends persistence entries. Assert lifetime loading occurs once across tab switches and actions.

  Test `dcp:context → overview`, `dcp:stats/dcp:lifetime → statistics`, `dcp:help → help`, and `dcp → overview` in TUI. Update existing informational text tests to explicitly use RPC/print/JSON or `hasUI: false`; each must notify plain text and never invoke custom UI. Mutating commands remain immediate notification-based shortcuts. Keep native approval tests and current-policy/callback/stale-block characterization; preserve implementation/callback exception propagation.
- [ ] **Step 2: Demonstrate failure.** Run `pnpm exec vitest run tests/panel-model.test.ts tests/panel-render.test.ts tests/panel.test.ts tests/commands-register.test.ts tests/commands-help.test.ts tests/dcp-actions.test.ts`; expect tab/navigation/routing assertions to fail before migration.
- [ ] **Step 3: Implement read-only projections.** Build all five tabs from existing state/config/context inputs. Use existing lifecycle facts without calling synchronization or graph mutation from the UI. Separate policy reasons from lifecycle state; omit actions on policy-disabled rows. Reuse `helpCommand()`'s command source rather than creating a second manually maintained command list. Preserve metric provenance: pruning savings are not compressed tokens or net compression savings.
- [ ] **Step 4: Implement component navigation and rendering.** Render the tab bar inside phase 3's shell, with active-tab visibility when labels cannot all fit. Clamp selection and offsets after resize/rebuild; informational rows scroll without creating actions. Use installed `matchesKey` APIs for Tab, Shift-Tab, arrows, Enter/Return, and Space; preserve `j`/`k` and Esc/`q`. Keep last-action feedback bounded above a close-capable footer. Remove the redundant Close row because close keys work from every tab.
- [ ] **Step 5: Integrate controller and command routing.** Carry the complete navigation snapshot through the existing custom-completion/action/reopen loop; dispatch only domain actions through `executeDcpAction`. Rebuild against current inputs after each normally completed action. Load lifetime once before the loop and display Unavailable on failure. Route informational commands only in TUI with UI; retain existing text builders for all other contexts. Do not fall back to rerunning an action after a custom-UI failure.
- [ ] **Step 6: Verify complete behavior.** Run the step-2 command, both notification suites, `tests/compress-render.test.ts`, `tests/sdk-contract.test.ts`, and `pnpm check`; expect exit `0`. Repeat width/height, tiny-terminal, Unicode, `NO_COLOR`, and theme-failure coverage for every tab. Test disabled/model-disabled/sub-agent states, permission-only denial, stale missing blocks, empty blocks, and failed lifetime loading.
- [ ] **Step 7: Document, inspect, and commit the usable result.** Update README's panel/command documentation to the five-tab UI and mode-dependent entrypoints; record the final changes in CHANGELOG. Visually verify all tabs and command entrypoints with pi-status enabled, including resize and action feedback. Run `git diff --check`, stage phase files, and commit with `feat: add tabbed DCP dashboard and command routing`.

## Final Acceptance and Handoff

- [ ] All five tabs and matching TUI command entrypoints work; non-TUI informational access still works.
- [ ] No existing context/statistics/help information is lost, and block lifecycle labels distinguish consumption from user deactivation.
- [ ] All notifications respect their configured gates; statuses are one line; both compression modes have useful collapsed/expanded/legacy/error rendering.
- [ ] Model-visible compression text, domain algorithms, tool-selection policy, statistics calculations, and snapshot formats are unchanged.
- [ ] Each phase has a passing focused check, passing `pnpm check`, documentation, and an independently usable commit. Record concrete visual checks, or explicitly report any real-Pi verification that could not be performed.

No implementation checkboxes are complete at plan-writing time. Use the phase sequence as the execution and review boundary.
