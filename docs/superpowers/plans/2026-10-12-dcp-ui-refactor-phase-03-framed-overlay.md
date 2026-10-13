# DCP UI Phase 3: Framed Single-List Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for these sequential changes) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the existing DCP controls in a centered, bounded, pi-status-style overlay with visible selection and persistent close instructions.

**Architecture:** Keep the current read-only panel projection and guarded action/reopen loop. Extract layout into a pure renderer, reuse the safe active-theme adapter, and let the component own selection, scrolling, completion, and readiness to activate the rendered selection. Five tabs and informational-command routing remain phase 4.

**Tech Stack:** Existing TypeScript/ESM, Node `>=24.15.0`, installed Pi coding-agent/TUI SDK `1.1.0`, Vitest, TypeBox, and Biome; no new dependencies.

**Spec:** [Approved design in the parent plan](2026-10-12-dcp-ui-refactor-plan.md#approved-design). This revision supplies implementation decisions for phase 3; the parent's extracted phase 3 steps are historical. The overall approved design and phase boundaries still apply.

## Global Constraints

- Both reference repositories are read-only inputs: `/Users/lanh/Developer/pi-packages/pi` and `/Users/lanh/Developer/pi-vault/pi-status`. No runtime imports from either checkout or dependency on pi-status.
- Use the active Pi theme through `createDcpTheme`; no palette presets, fixed ANSI colors, or editor. Match the heavy frame, two-column padding, accent selection marker, dim descriptions, compact metrics, and persistent keyboard footer. Tabs are deferred.
- Preserve command names/arguments, pruning/compression algorithms, policy, tool selection, model-visible content, statistics calculations, and compression result text.
- Preserve snapshot serialization version `2`, readers for versions `1`/`2`, persistence ordering, live state/config identities, and unexpected domain/callback exception propagation.
- Keep operator actions through `executeDcpAction`: fresh policy check, one callback after a normally completed permitted attempt, no callback after rejection or an implementation throw. Permission denial alone does not disable operator controls.
- Preserve phase 3's existing model behavior: policy-disabled rows retain their action plus an unavailable reason and are rejected by the guarded executor. Removing these actions and refining lifecycle labels belongs to phase 4.
- Keep compression approval through Pi's native `ui.confirm`, including RPC, cancellation, abort handling, and policy recheck after approval.
- No new configuration, dependencies, sidebar integration, search, drilldown, domain actions, package version bump, or future-phase scaffolding.
- Earlier UI/message compatibility requirements are superseded for presentation only. Domain and persistence contracts still apply.
- Ship production integration, relevant tests, README/CHANGELOG updates, verification, and one atomic implementation commit. Planning evidence is not implementation completion.

## Review Focus

| Input or condition                                            | Required behavior                                                                                                                     | Owning checks                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Overlay width and Pi's bottom clipping                        | Use the supplied width once; reserve frame/footer inside the 85% cap so Pi clips nothing.                                             | Task 2 geometry; Task 3 custom options      |
| Long block list, resize, or stale offset                      | Clamp offset, keep selected stable ID visible, and restore usable controls after enlargement.                                         | Task 2 viewport; Task 3 resize              |
| Enter before rendering, after movement, or after invalidation | No activation until that selection has rendered successfully at current terminal dimensions.                                          | Task 3 activation lifecycle                 |
| Long Unicode, whitespace, policy reason, or tiny terminal     | Bound all rows; preserve block identity and action/state when space allows; otherwise show close-only instructions.                   | Tasks 1–2 formatting and tiny cases         |
| Theme/renderer failure, rebuild, or domain/callback throw     | Theme failure can leave visible plain controls usable; renderer failure is close-only; guarded controller semantics remain unchanged. | Task 3 failure/rebuild; Task 4 action suite |

---

## Readiness Review — 2026-10-13

**Original verdict:** Not ready unchanged. The earlier steps did not allocate the ten existing header rows against the reference frame, settle compact panel metrics, define activation before/after rendering, or identify all presentation assertions needing migration.

**Current repository:** Clean branch `20261013-dcp-ui-refactor-phase-03-framed-overlay` at `e393efe`; phases 1 and 2 are merged. Node `v24.21.0`, pnpm `12.9.1`, installed coding-agent/TUI `1.1.0`. Fresh `pnpm check` exited `0`: formatting, lint, type checking, **65 test files / 1,070 tests passed**. Repeat this baseline at implementation time.

**Existing owners:** `src/tui/panel-model.ts` projects display strings and stable action/block IDs. `src/tui/panel.ts` renders inline and opens `ui.custom` without overlay options. It loads lifetime statistics once before its action/reopen loop, preserves selected IDs and feedback, and calls `executeDcpAction` outside the UI-failure catch. Keep those boundaries.

### Reference evidence

| Reference at inspected commit                                                                                                          | Contract to adapt locally                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pi-status `18d8354`, `src/tui/overlay-render.ts` and its tests                                                                         | `┏━┃┗` frame with four outer rows (top border, upper blank, lower blank, bottom border), two columns of padding on both sides, content width `width - 6`, and minimum frame width `7`.                                      |
| pi-status `src/tui/dashboard-layout.ts`, `src/tui/dashboard-render.ts`, and their tests                                                | Floor the 85% cap, budget chrome before content, clamp offset and keep selection visible, pad the viewport. Its eight-row chrome includes tabs; use DCP's explicit allocation below instead of copying the tabbed renderer. |
| pi-status `src/tui/dashboard.ts`                                                                                                       | Pass `{ overlay: true, overlayOptions: { anchor: "center", width: "92%", maxHeight: "85%" } }`. Omit its sidebar-derived `offsetX` and draft/save/search state. Its SDK dependencies are `0.84.4`.                          |
| Pi `7bd01fb92`, `packages/tui/src/tui.ts`, coding-agent `src/core/extensions/types.ts` and `src/modes/interactive/interactive-mode.ts` | `ui.custom` supports these options; Pi resolves percentage width, calls `component.render(resolvedWidth)`, clips excess rows from the bottom, and centers using actual rendered height.                                     |
| DCP-installed TUI `dist/tui.js` and coding-agent `dist/core/extensions/types.d.ts`                                                     | Confirmed the same width/clipping/custom contract in `1.1.0`. Installed types/runtime are authoritative if the source checkout changes. Use public APIs only.                                                               |

**Builder calls:** Keep the header order; shrink it before removing the last list row. Reserve feedback space even when empty so feedback does not move the frame. Require at least 20 inner columns for controls (26 total); narrower views are close-only. Format tokens at existing numeric projection boundaries, without parsing display strings or changing metric sources. These are implementation choices, not additional user requirements.

**Revised verdict:** Ready to implement against the recorded baseline. A fresh builder check found no unresolved product decisions and confirmed the layout arithmetic and task sequencing; its width-zero close-hint exception was clarified below. This is a planning verdict, not completion of phase 3 or a real-Pi visual check.

## Scope and File Responsibilities

**Prerequisites:** [Phase 1](2026-10-12-dcp-ui-refactor-phase-01-text-notifications.md) and [phase 2](2026-10-12-dcp-ui-refactor-phase-02-compression-rendering.md) integrated and verified.

**Usable result:** Manual mode, permission cycling, sweep, and existing block actions work in the framed single list with stable selection and feedback. The Close row remains. Informational commands retain phase 1 text responses. No phase 4 tabs, Space binding, or routing changes.

| File                                                                | Responsibility                                                                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tui/panel-model.ts`, `tests/panel-model.test.ts`               | Compact token display at numeric sources; unchanged projection signature, shape, labels, row IDs/order/actions and metric provenance. |
| `src/tui/panel-render.ts` (new), `tests/panel-render.test.ts` (new) | Pure frame, header/list/footer allocation, viewport, row styling, and close-only output. Keep single-use layout helpers private here. |
| `src/tui/panel.ts`, `tests/panel.test.ts`                           | Integrate renderer/theme/overlay options; retain selection/controller owners and activate only a rendered selection.                  |
| `README.md`, `CHANGELOG.md`                                         | Describe the shipped single-list overlay and compact metrics under Unreleased; leave released entries and package version unchanged.  |

Reuse `src/tui/formatters.ts` (`formatDcpTokens`, `flattenDcpLabel`) and `src/tui/theme.ts` (`DcpTheme`, `createDcpTheme`). Do not change those modules or the action executor.

## Rendering and Interaction Contracts

### Interfaces

- Retain `buildDcpPanelModel(input: DcpPanelModelInput): DcpPanelModel` and the existing five arguments of `openDcpPanel`.
- Export `DcpPanelView` with `selectedRowId?: string`, `offset: number`, `lastActionMessage?: string`.
- Export `DcpPanelRenderResult` with `lines: string[]`, `offset: number`, `actionsVisible: boolean`.
- Export `renderDcpPanel(model: DcpPanelModel, view: DcpPanelView, theme: DcpTheme, width: number, terminalRows: number): DcpPanelRenderResult`.
- Export `renderDcpPanelFallback(width: number, terminalRows: number): DcpPanelRenderResult` for the component's unexpected-render-error path. It uses no theme/model and returns bounded plain close instructions, `offset: 0`, and `actionsVisible: false`.
- Extend `DcpPanelComponentOptions` with required `getWidth: () => number`, returning **terminal columns** for activation invalidation. Keep `getHeight` returning terminal rows. Renderer `width` is already overlay width; never derive it from `getWidth` or multiply it by `0.92`.

### Geometry and viewport

- For positive integer SDK dimensions, `cap = max(1, floor(terminalRows * 0.85))` and `contentWidth = width - 6`. Do not apply 85% twice. Width `0` can return one empty line with actions disabled; no visible close hint is possible there.
- Normal interactive layout requires `width >= 26` and `cap >= 9`. This retains the reference's seven-column frame minimum while adding enough space to identify DCP controls. Below either threshold, return unframed close-only output with height at most `cap` and width at most `width`.
- Normal chrome is **8 rows**: four outer frame rows; title `DCP Panel`; one divider; one reserved feedback row; one key-hint row. No tab bar. Use the current nine information lines in their existing order: model, context, limits/mode, permission/manual, pipeline, compress tool, session metrics, lifetime saved/sessions, lifetime tools/messages.
- Let `rows = [...model.actions, ...model.blocks]`. `target = min(cap, 8 + 9 + max(1, rows.length))`; `headerCount = min(9, max(0, target - 8 - 1))`; `listHeight = target - 8 - headerCount`. A long list has three visible rows at a 24-row terminal (`cap = 20`); an 11-row terminal (`cap = 9`) retains one list row and no information lines.
- Compose inner content as title, fitted information lines, divider, list viewport, feedback/blank, key hints, then frame it. Normal lines have exactly the supplied visible width and height `target`; pad short viewports. The lower blank and bottom border are inside the cap.
- Offset counts **list rows**, excluding header/chrome. Clamp to `[0, max(0, rows.length - listHeight)]`, then move it just enough to reveal selection. Resolve absent/stale selected IDs to the first row; an empty list has offset `0` and actions disabled. Never mutate model, view, state, or configuration.
- Tiny/error fallback includes intact `Esc/q close` when width is at least `11`; otherwise use intact `q` at any positive width. Never truncate the close phrase into an incomplete hint. Explanatory text is optional and must leave room for close instructions.

### Presentation and activation

- Compact tokens in `panel-model.ts` using `formatDcpTokens`: context tokens, session pruning savings, lifetime savings, and block compressed tokens get `estimated: true`; context window and resolved limits stay bare; counts remain integer strings. Preserve percent/unknown/Unavailable behavior and label names. Examples: `~20k / 200k (10%)`, limits `100k`/`50k`, lifetime savings `~1k`, block detail `range · ~100 tokens · Deactivate`.
- Flatten every dynamic field/row/feedback value with `flattenDcpLabel` before composing one logical line. Use SDK `visibleWidth`/`truncateToWidth` for CJK, emoji, combining characters, and ANSI; no string-length clipping.
- Use `borderAccent` for heavy borders, `accent` for `▸` and selected labels/feedback, `text` for information/eligible labels, and `dim` for detail/reasons/unavailable labels/key hints. Do not inverse entire selected rows. Adapt current suffix allocation so block `bN` plus Deactivate/Reactivate/Inactive remains visible at 60/80/120 columns despite long topics or policy reasons.
- Choose the longest complete key hint fitting inner width from `↑/↓ j/k navigate · Enter run · Esc/q close`, `Enter run · Esc/q close`, `Esc/q close`, then `q`. Feedback is a separate bounded `Last action: ...` row.
- Renderer `actionsVisible` is true only for a normal view containing the resolved selected row's marker/label. It describes a visible list, not permission; inactive rows still permit navigation but have no activation action.
- Component starts without an activatable rendered selection; navigation may update selection before the first render. Successful rendering stores returned offset/visibility, selected stable ID, and terminal rows/columns. Movement clears activation readiness and requests rendering while allowing further movement; `invalidate()` clears readiness. After close-only/error rendering, disable navigation until a normal render succeeds. Enter/Return completes only when selection matches the last successfully rendered selection and terminal dimensions still match. Esc/`q` always works; completion is exactly once.
- A renderer throw clears readiness and returns `renderDcpPanelFallback`; Enter and movement cannot execute actions. Successful enlargement/re-render restores controls. A throwing/non-string theme method is handled by `createDcpTheme` and does not itself disable visible plain-text controls.

## Execution Rules

- [ ] Confirm a clean or understood worktree, phases 1–2 present, and execution-workflow isolation before product edits.
- [ ] Run `pnpm check` as a fresh baseline; the readiness counts above are historical by implementation time.
- [ ] Execute Tasks 1–4 sequentially; demonstrate each expected test failure before implementation and rerun relevant tests afterward.
- [ ] Leave implementation checkboxes unchecked until work occurs; record actual checks and commit IDs only afterward.

### Task 1: Compact Existing Panel Metrics

**Files:** Modify `src/tui/panel-model.ts`, `tests/panel-model.test.ts`; update token-copy expectations in `tests/panel.test.ts`.

**Interfaces:** Preserve existing public types and numeric owners; consume `formatDcpTokens` at those owners. No raw metric fields for the renderer or compact counts.

- [ ] **Step 1: Add failing projection assertions.** Replace raw-token expectations with the exact examples above. Cover zero/large estimates, unchanged integer counts, null tokens, unknown percentage, unavailable model/limits/lifetime, and block action suffixes. Retain current-policy, stable-ID ordering, live-input preference, and no-state-mutation assertions.
- [ ] **Step 2: Demonstrate failure.** Run `pnpm exec vitest run tests/panel-model.test.ts`; expect compact-token assertions to fail on raw numeric strings.
- [ ] **Step 3: Implement compact projection.** Format numeric values before making strings; keep missing-value handling and all actions/reasons unchanged. Any lifetime-formatting helper change stays private and limited to existing fields.
- [ ] **Step 4: Verify projection.** Run `pnpm exec vitest run tests/panel-model.test.ts tests/panel.test.ts`; migrate only component assertions affected by compact tokens now. Expect exit `0`; no controller/geometry change yet.

### Task 2: Pure Framed Renderer and Close-Only Fallback

**Files:** Create `src/tui/panel-render.ts`, `tests/panel-render.test.ts`.

**Interfaces:** Produce the view/result types and two renderer exports above. Consume existing `DcpPanelModel`, `DcpTheme`, and `flattenDcpLabel`; helpers remain local.

- [ ] **Step 1: Add failing renderer tests.** Pin heavy corners, two-column side padding, four outer frame rows, semantic role calls, accent selection without row inversion, and footer choices. Use identity/ANSI themes, widths `60/80/120`, heights `11/20/24/40`, models with zero/one/many blocks, feedback present/absent, and empty action/block arrays. Assert exact normal width/computed height, selected visible row, and a complete final bottom border.

  Pin `60 × 24` with forty blocks to `20` rows and three list rows; pin `60 × 11` to `9` rows and one list row. A tall terminal fits all nine information lines and existing metrics; smaller heights show the documented header prefix.

- [ ] **Step 2: Add failing viewport/boundary tests.** A late selected block stays visible through shrink/enlarge; negative/oversized offsets clamp; stale selected ID selects the first row; frozen inputs stay unchanged. Cover long CJK/emoji/combining topics and CR/LF/tabs in status, detail, reason, and feedback. At `60/80/120`, block identity and Deactivate/Reactivate/Inactive survive long topics/reasons.

  Cover widths `1/6/7/8/25/26` and terminal heights `1/10/11`: fallback at width `25` or cap `8`, normal at width `26` and cap `9`. Every fallback has `actionsVisible: false` and bounded lines; every positive-width fallback has an intact close hint. Directly verify `renderDcpPanelFallback` without theme/model. Width `0` is the sole close-hint exception and returns one empty line with actions disabled.

- [ ] **Step 3: Demonstrate failure.** Run `pnpm exec vitest run tests/panel-render.test.ts`; expect the module to be missing.
- [ ] **Step 4: Implement rendering.** Adapt reference frame/viewport behavior to the DCP budget. No input handling, live-state access, action execution, or domain-exception catches. Return fitted offset and close-only output at the documented thresholds.
- [ ] **Step 5: Verify rendering.** Run `pnpm exec vitest run tests/panel-render.test.ts tests/panel-model.test.ts`; expect exit `0`.

### Task 3: Integrate Overlay and Safe Component Activation

**Files:** Modify `src/tui/panel.ts`, `tests/panel.test.ts`.

**Interfaces:** Consume renderer/theme adapter. Preserve `onAction`, stable initial selection, action/reopen loop, lifetime-load timing, and `openDcpPanel` signature; wire the terminal-column getter in its factory.

- [ ] **Step 1: Add failing integration assertions.** Every `ui.custom` open/reopen receives exactly `{ overlay: true, overlayOptions: { anchor: "center", width: "92%", maxHeight: "85%" } }`, without sidebar offsets. Invoke its factory with rows/columns, render at the supplied width, and prove width is not reduced again. Retain non-TUI rejection and all action/controller characterization tests.
- [ ] **Step 2: Add failing activation tests.** Enter before first render does nothing; render then Enter runs once. Move then Enter before rendering does nothing; render the moved selection then Enter executes that row. Multiple moves before rendering still update selection. Invalidate or change terminal rows/columns before Enter: no action until rendering. Tiny/error view plus Enter/j/k: no action; enlarge/re-render: controls and selected ID recover. Esc/`q` completes once before rendering and in every failure state.

  Replace theme-throw-as-renderer-failure expectations: safe theme adaptation keeps plain controls usable, including `NO_COLOR=""` and a non-string theme return. Independently spy on `renderDcpPanel` to throw; assert bounded plain fallback, no action, and close. Restore the spy and verify recovery on a separate non-completed component.

- [ ] **Step 3: Demonstrate failure.** Run `pnpm exec vitest run tests/panel.test.ts`; expect absent-overlay-option and readiness failures.
- [ ] **Step 4: Integrate shell/readiness.** Remove obsolete inline header/row/fallback functions and duplicate whitespace helper. Delegate through `createDcpTheme`, consume offset/visibility, and track rendered selection/dimensions. Keep domain execution outside the UI-error catch; never retry an action after UI failure.
- [ ] **Step 5: Migrate presentation assertions.** Replace `startsWith("> ")` with frame-aware `▸` checks; use compact tokens and the 85% cap. Give block-label/long-topic tests enough list space (e.g. terminal height `40`) or select/scroll to their blocks; at height `24` the default viewport contains only three global-action rows. The old eight-row-terminal test now expects close-only fallback; use eleven rows for normal resized-selection coverage. Add terminal `columns` and `getWidth` to every component/factory fixture. Render before activation in input tests, including after movement. Preserve full callback/result-message assertions at sufficient feedback width (e.g. `160`), and test truncation separately. Add missing-initial-ID and once-per-invocation lifetime-loading checks across action rebuilds and load failure.
- [ ] **Step 6: Verify integration.** Run `pnpm exec vitest run tests/panel-render.test.ts tests/panel.test.ts tests/panel-model.test.ts tests/theme.test.ts tests/dcp-actions.test.ts tests/commands-register.test.ts`; expect exit `0`. Confirm approval remains untouched and policy is rechecked between projection and activation.

### Task 4: Documentation, Verification, and Atomic Commit

**Files:** Modify `README.md`, `CHANGELOG.md`; update this plan only with real implementation evidence.

- [ ] **Step 1: Document delivery.** Describe centered 92%-width/85%-height single-list frame, active theme/NO_COLOR, compact estimated metrics, scrolling, persistent close keys, and tiny close-only behavior. Short terminals prioritize controls over information. Keep Enter/direct commands; do not advertise tabs, Space, or informational-command overlay routing.
- [ ] **Step 2: Run the focused gate.** Run Task 3's step-6 command; expect exit `0`.
- [ ] **Step 3: Run the repository gate.** Run `pnpm check`; expect formatting, lint, type checking, and all tests to exit `0`.
- [ ] **Step 4: Inspect real Pi when available.** With pi-status enabled, inspect placement without sidebar adjustment at terminal widths `60/80/120`, resize from a selected late block, cross the tiny fallback boundary, and exercise manual/permission/sweep/block controls and Esc/`q`. Check feedback, footer, borders, theme/NO_COLOR, and reopen selection. Record dimensions/theme/observations. If interactive Pi is unavailable, record that limitation; component tests and SDK inspection do not constitute a visual check.
- [ ] **Step 5: Review scope and whitespace.** Run `git diff --check`; expect exit `0`. Confirm unchanged domain algorithms, metric sources, permission/approval, callback identities/counts, tool selection, persistence/schema, and dependencies. Only presentation and safe activation lifecycle change.
- [ ] **Step 6: Record evidence and commit.** Record baseline/final focused/full results, real-Pi status, and implementation commit only after they exist. Stage the eight production/test/documentation files above plus this plan explicitly and commit with `feat: present DCP controls in a framed overlay`.

## Phase Completion and Rollback

- [ ] Existing controls work through the guarded executor without future-phase code.
- [ ] Geometry, viewport, activation, fallback, theme, controller, and command tests pass with `pnpm check`/`git diff --check`; unperformed real-Pi inspection is explicit.
- [ ] README/CHANGELOG match delivery and the diff forms one atomic implementation commit.
- [ ] Domain/persistence invariants remain unchanged and evidence is recorded.

Continue with [phase 4](2026-10-12-dcp-ui-refactor-phase-04-tabbed-dashboard.md) after integration. Revert dependent later phases first. No snapshot migration; phase 2 compression metadata and legacy fallback remain unchanged.
