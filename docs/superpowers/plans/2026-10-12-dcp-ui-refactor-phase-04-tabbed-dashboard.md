# DCP UI Phase 4: Five Tabs and Matching Command Entry Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for these sequential changes) or superpowers:subagent-driven-development to implement this plan step-by-step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the complete five-tab DCP dashboard and matching-tab informational commands in TUI mode.

**Architecture:** Replace the single-list presentation with read-only tab projections and ephemeral per-tab navigation while retaining phase 3's frame. Carry navigation snapshots through the existing completion/action/rebuild controller and route informational command entrypoints only when TUI UI is available.

**Tech Stack:** Existing TypeScript/ESM, Node `>=24.15.0`, installed Pi coding-agent/TUI SDK, Vitest, TypeBox, and Biome; no new dependencies.

**Spec:** [Approved design in the parent plan](2026-10-12-dcp-ui-refactor-plan.md#approved-design). The parent remains the source of truth for the overall design; this file extracts its phase 4 implementation content.

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
| Policy or block eligibility changes after projection | Use fresh guarded execution; retain stale-block/callback behavior. | Step 1 controller characterization |
| Tab switches, action rebuilds, or resize | Retain active tab and independent stable selections/offsets; clamp missing rows. | Step 1 navigation cases |
| Read-only, policy-disabled, consumed, or inactive rows | Display facts and reasons without creating an executable action. | Step 1 projection/input cases |
| RPC/print/JSON/no-UI or failed lifetime loading | Preserve plain informational responses or Unavailable values; load lifetime once. | Step 1 mode/loading cases |
| Missing context/model, lifecycle precedence, or prune-token counter | Preserve every metric and distinguish user deactivation from consumption. | Step 1 model cases |

---

## Complexity and Atomic Result

Highest complexity: model-shape migration, independent tab viewports, action-driven rebuilds, and mode-dependent command entrypoints share the same interface changes. Keep them in one atomic phase so every caller understands the new model.

**Usable result:** Overview, Controls, Blocks, Statistics, and Help work as one complete dashboard. Informational commands open matching tabs in TUI mode and retain plain-text responses elsewhere; all previous phases remain integrated.

**Prerequisites:** [Previous phase](2026-10-12-dcp-ui-refactor-phase-03-framed-overlay.md). Phases 1–3 must be integrated and verified. This phase replaces the phase 3 DcpPanelView selection/offset fields and current DcpPanelModel lists in the same commit as all callers/tests.

**Boundary:** Include production integration, tests, documentation, and verification in one phase commit. Do not ship unused helpers, break existing callers, or require unimplemented later code. This phase completes the parent plan's approved UI design.

## Execution Rules

- [ ] Confirm a clean or understood worktree and the prerequisite implementation/checks before editing product code; follow the execution workflow's isolation rules.
- [ ] Run `pnpm check` as a fresh baseline. The parent's observation of 83 passing focused tests is historical evidence, not this phase's verification.
- [ ] Execute this phase sequentially. Demonstrate its expected test failures, integrate the complete behavior, and verify before committing.
- [ ] Record completed checkboxes and the phase commit only when implementation happens. All implementation steps are initially unchecked.

## Implementation Steps (Extracted from Parent Phase 4)

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

## Phase Completion and Rollback

- [ ] The usable result above works in production without future-phase scaffolding.
- [ ] The focused commands and `pnpm check` pass; document concrete visual checks or explain any real-Pi check that could not be performed.
- [ ] README/CHANGELOG describe this phase's actual delivered behavior, and the complete diff forms one atomic commit.
- [ ] Confirm unchanged domain algorithms, policy/callback semantics, metric calculations, and snapshot compatibility for the affected paths.

Revert dependent later phases before reverting this phase. No snapshot migration is introduced. Optional compression display metadata is backward-compatible with the legacy-result fallback from phase 2.

## Final Acceptance and Handoff

- [ ] All five tabs and matching TUI command entrypoints work; non-TUI informational access still works.
- [ ] No existing context/statistics/help information is lost, and block lifecycle labels distinguish consumption from user deactivation.
- [ ] All notifications respect their configured gates; statuses are one line; both compression modes have useful collapsed/expanded/legacy/error rendering.
- [ ] Model-visible compression text, domain algorithms, tool-selection policy, statistics calculations, and snapshot formats are unchanged.
- [ ] Each phase has a passing focused check, passing `pnpm check`, documentation, and an independently usable commit. Record concrete visual checks, or explicitly report any real-Pi verification that could not be performed.

No implementation checkboxes are complete at plan-writing time. Use the phase sequence as the execution and review boundary.
