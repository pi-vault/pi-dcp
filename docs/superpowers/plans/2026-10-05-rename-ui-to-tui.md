# Rename UI Directory to TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the complete `src/ui` directory to `src/tui` and update its consumers and documentation.

**Architecture:** Move the three existing modules together and update direct import paths. Preserve their implementations, exports, and relative imports within the directory; package discovery already includes all of `src`.

**Tech Stack:** TypeScript, Node.js, Pi extension/TUI APIs, Vitest, Biome, pnpm, Git.

**Spec:** The bounded in-chat design titled “Rename `src/ui` to `src/tui`,” reproduced below. No separate spec file is required for this rename; the user subsequently requested this written plan.

## Design

Move `notification.ts`, `panel.ts`, and `panel-model.ts` into `src/tui`. Update source imports, imports in the four affected test files, and the two source-path references in the Phase 5 implementation plan. Preserve filenames, exported functions, types, test names, and runtime behavior. Use direct import updates without compatibility files at the old paths.

## Global Constraints

- Rename the whole directory, including notifications; do not split or reorganize its modules.
- Preserve existing behavior, exports, commands, permissions, persistence, and test assertions.
- Add no dependencies, compatibility re-exports, package-version changes, or new behavior tests.
- Keep package metadata unchanged: its `files` list includes `src`, and its extension entrypoint remains `src/index.ts`.
- Limit documentation edits to correcting the two paths in the existing Phase 5 plan.
- Do not publish; implementation commits must contain only this rename and its reference updates.

## Review Focus

- Extension startup must resolve the moved notification module; verify through the full suite.
- Command registration must resolve the moved panel; verify through panel/controller tests.
- The panel must still resolve its sibling view model; verify through panel/model tests.
- Package contents must include all three moved modules and omit the old directory; verify through the package dry-run.
- Consumers and Phase 5 documentation must contain no stale paths; verify through the scoped reference search.

---

### Task 1: Move the terminal presentation directory and update references

**Files:**

- Rename: `src/ui/notification.ts` → `src/tui/notification.ts` — notification formatting.
- Rename: `src/ui/panel.ts` → `src/tui/panel.ts` — terminal component and controller.
- Rename: `src/ui/panel-model.ts` → `src/tui/panel-model.ts` — panel data and guarded actions.
- Modify: `src/index.ts`, `src/commands/register.ts` — notification and panel imports.
- Modify/Test: `tests/notification.test.ts`, `tests/compress-notification.test.ts`, `tests/panel.test.ts`, `tests/panel-model.test.ts` — imports only.
- Modify: `docs/superpowers/plans/2026-10-03-phase-05-pi-dcp-permission-panel-ux.md` — the two module-path references.

**Interfaces:**

- Consumes: the existing module exports and their current callers/tests.
- Produces: the same exports and signatures at `src/tui/notification.ts`, `src/tui/panel.ts`, and `src/tui/panel-model.ts`; no new interfaces or aliases.

- [ ] **Step 1: Establish the targeted test baseline**

Run: `pnpm vitest run tests/notification.test.ts tests/compress-notification.test.ts tests/panel.test.ts tests/panel-model.test.ts`

Expected: all four files pass before any edits. Investigate baseline failures before proceeding.

- [ ] **Step 2: Update test imports to the destination paths**

In the four listed test files, replace `../src/ui/` with `../src/tui/`. Preserve all test names, assertions, and fixtures.

- [ ] **Step 3: Verify the new imports fail before the move**

Run the Step 1 command.

Expected: module-resolution failures for `src/tui` imports because the destination modules do not exist yet.

- [ ] **Step 4: Perform the directory rename and update source consumers**

Run: `git mv src/ui src/tui`

Change `./ui/notification.ts` to `./tui/notification.ts` in `src/index.ts`, and `../ui/panel.ts` to `../tui/panel.ts` in `src/commands/register.ts`. Relative imports within the moved modules remain valid and require no edits.

- [ ] **Step 5: Correct the Phase 5 documentation paths**

In the listed Phase 5 plan, replace `src/ui/panel-model.ts` and `src/ui/panel.ts` with their `src/tui` equivalents. Preserve all other plan content.

- [ ] **Step 6: Verify targeted tests pass after the move**

Run the Step 1 command.

Expected: all four files pass with their original assertions.

- [ ] **Step 7: Run the full automated checks**

Run: `pnpm check`

Expected: formatting, warning-free lint, type checking, and all existing tests pass. The reviewed starting baseline is 819 tests across 58 files; this rename adds or removes no tests.

- [ ] **Step 8: Verify package contents**

Run: `pnpm run pack:dry-run`

Expected: exit 0; the listing includes all three `src/tui` modules and contains no `src/ui` files.

- [ ] **Step 9: Check stale references and diff scope**

Run: `rg -n 'src/ui|\./ui/|\.\./ui/' src tests scripts README.md CHANGELOG.md package.json docs/superpowers/plans/2026-10-03-phase-05-pi-dcp-permission-panel-ux.md`

Expected: no matches, with ripgrep exit 1. This rename plan intentionally retains old paths to describe the migration and is excluded from the search.

Run: `git diff HEAD --check` and `git diff HEAD --stat`.

Expected: no whitespace errors; only the three moves, import updates in six source/test files, and two Phase 5 documentation references. Inspect the full diff to confirm module bodies and assertions are unchanged.

- [ ] **Step 10: Commit the verified rename**

Stage only the listed files and moves. Commit with: `refactor: rename ui directory to tui`.

## Execution Handoff

Native execution is recommended: this is one tightly coupled task with mechanical edits and existing coverage. Review this saved plan and select Native or Subagent-driven execution before implementation. No implementation is included in the plan-writing task.
