# DCP UI Phase 3: Framed Single-List Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for these sequential changes) or superpowers:subagent-driven-development to implement this plan step-by-step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the current DCP controls inside a safely sized pi-status-style centered overlay.

**Architecture:** Extract pure rendering from the panel component and reuse the existing domain projection and guarded action controller. Introduce the working frame and viewport shell around the current single-list interaction; five-tab navigation is deferred to phase 4.

**Tech Stack:** Existing TypeScript/ESM, Node `>=24.15.0`, installed Pi coding-agent/TUI SDK, Vitest, TypeBox, and Biome; no new dependencies.

**Spec:** [Approved design in the parent plan](2026-10-12-dcp-ui-refactor-plan.md#approved-design). The parent remains the source of truth for the overall design; this file extracts its phase 3 implementation content.

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

| Input or condition | Required behavior | Owning check |
| --- | --- | --- |
| Resize with selection near the end of a long block list | Clamp viewport and keep selection visible. | Step 1 resize cases |
| Long Unicode topics or embedded newlines | Every row stays within visible width and one logical row. | Step 1 dynamic-content cases |
| Tiny width/height or unexpected renderer failure | Show bounded close instructions; no unseen action may execute. | Step 1 fallback cases |
| Theme-method failure handled by the adapter | Visible plain-text controls may remain usable. | Step 1 theme expectation migration |
| Action rebuild, policy change, or callback/implementation throw | Preserve current guarded execution and controller semantics. | Step 1 characterization; Step 4 action suite |

---

## Complexity and Atomic Result

Higher complexity: terminal width, terminal height, body/footer budgets, scrolling, and component completion must work together. Keep current panel-model and controller contracts to bound the change.

**Usable result:** The current manual, permission, sweep, and block controls work in a centered framed overlay with retained selection and feedback. Informational commands still use their phase 1 text responses.

**Prerequisites:** [Previous phase](2026-10-12-dcp-ui-refactor-phase-02-compression-rendering.md). Phases 1 and 2 must be integrated and verified. Import the phase 1 formatters and DcpTheme/createDcpTheme from src/tui/theme.ts; DcpTheme = Pick<Theme, "fg" | "bg" | "bold" | "inverse"> and createDcpTheme(theme: Theme, env?: NodeJS.ProcessEnv): DcpTheme.

**Boundary:** Include production integration, tests, documentation, and verification in one phase commit. Do not ship unused helpers, break existing callers, or require unimplemented later code. After this complete commit, continue with [phase 4](2026-10-12-dcp-ui-refactor-phase-04-tabbed-dashboard.md).

## Execution Rules

- [ ] Confirm a clean or understood worktree and the prerequisite implementation/checks before editing product code; follow the execution workflow's isolation rules.
- [ ] Run `pnpm check` as a fresh baseline. The parent's observation of 83 passing focused tests is historical evidence, not this phase's verification.
- [ ] Execute this phase sequentially. Demonstrate its expected test failures, integrate the complete behavior, and verify before committing.
- [ ] Record completed checkboxes and the phase commit only when implementation happens. All implementation steps are initially unchecked.

## Implementation Steps (Extracted from Parent Phase 3)

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

## Phase Completion and Rollback

- [ ] The usable result above works in production without future-phase scaffolding.
- [ ] The focused commands and `pnpm check` pass; document concrete visual checks or explain any real-Pi check that could not be performed.
- [ ] README/CHANGELOG describe this phase's actual delivered behavior, and the complete diff forms one atomic commit.
- [ ] Confirm unchanged domain algorithms, policy/callback semantics, metric calculations, and snapshot compatibility for the affected paths.

Revert dependent later phases before reverting this phase. No snapshot migration is introduced. Optional compression display metadata is backward-compatible with the legacy-result fallback from phase 2.
