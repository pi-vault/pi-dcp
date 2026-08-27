# Phase 5: Model-Specific DCP Controls Integrated Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the complete implementation, generated artifacts, documentation, and repository scope before handoff.

**Architecture:** Run the focused feature suite first, then the package's full check pipeline. Use an exact Git path comparison for documentation integrity and read-only status checks for the three reference repositories.

**Tech Stack:** TypeScript, Node.js `>=24.15.0`, TypeBox, Vitest, pnpm, Git.

**Spec:** `docs/superpowers/specs/2026-08-26-model-specific-dcp-controls-design.md`

## Global Constraints

- Do not modify Pi or either reference repository.
- Do not introduce dependencies or lockfile changes.
- Do not edit the design, parent plan, or phase plans while executing this verification phase.
- Do not commit unless the user explicitly requests a commit.

---

### Task 1: Verify runtime and configuration behavior

**Files:**

- Verify: all implementation and test files changed by Phases 1–4

**Interfaces:**

- Confirms exact per-model max/min limits, static disablement, live switching, command behavior, and transition hardening.

- [ ] **Step 1: Verify the Node.js precondition**

Run: `node --version`

Expected: Node.js `v24.15.0` or newer. Stop and report the environment mismatch if this requirement is not met.

- [ ] **Step 2: Run the focused feature suite**

Run: `pnpm vitest run tests/config.test.ts tests/context-limits.test.ts tests/commands-register.test.ts tests/commands-context.test.ts tests/index.test.ts`

Expected: PASS, including two different model-limit pairs and disabled-model transition cases.

- [ ] **Step 3: Run the full package checks**

Run: `pnpm check`

Expected: formatting, lint, TypeScript typecheck, and all Vitest tests pass.

### Task 2: Verify generated and documentation artifacts

**Files:**

- Verify: `config/dcp.schema.json`
- Verify: `README.md`
- Verify: `docs/superpowers/specs/2026-08-26-model-specific-dcp-controls-design.md`
- Verify: `docs/superpowers/plans/2026-08-26-model-specific-dcp-controls.md`
- Verify: `docs/superpowers/plans/2026-08-26-model-specific-dcp-controls/*.md`

**Interfaces:**

- Confirms generated schema consistency and preserves the reviewed planning documents during implementation.

- [ ] **Step 1: Regenerate the schema**

Run: `pnpm generate:schema`

Expected: `config/dcp.schema.json` contains `disabledModels` and no unrelated generated changes.

- [ ] **Step 2: Check whitespace**

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 3: Confirm planning documents were not edited during implementation**

Before Phase 1, record the planning-doc tree as a Git tree or stash-independent patch baseline. At this step, compare against that recorded baseline. If the plans were committed before implementation, run:

```bash
git diff --quiet HEAD -- \
  docs/superpowers/specs/2026-08-26-model-specific-dcp-controls-design.md \
  docs/superpowers/plans/2026-08-26-model-specific-dcp-controls.md \
  docs/superpowers/plans/2026-08-26-model-specific-dcp-controls
```

Expected: exit code 0. If the plans were intentionally left uncommitted, use the recorded pre-implementation baseline instead of `HEAD` and report that comparison method.

### Task 3: Verify repository scope and hand off

**Files:**

- Verify: current `pi-dcp` worktree
- Read only: `/Users/lanh/Developer/pi-packages/pi`
- Read only: `/Users/lanh/Developer/pi-packages/opencode-dynamic-context-pruning`
- Read only: `/Users/lanh/Developer/pi-packages/Snowy117-pi-dcp-migrate`

**Interfaces:**

- Confirms implementation changes are limited to `pi-dcp` and the three reference repositories remain untouched.

- [ ] **Step 1: Inspect the final `pi-dcp` scope**

Run: `git status --short --untracked-files=all`

Expected: only requested source, tests, README, generated schema, and reviewed documentation are changed. No dependency or lockfile changes exist.

- [ ] **Step 2: Inspect each reference repository without modifying it**

Run `git status --short --untracked-files=all` separately in:

- `/Users/lanh/Developer/pi-packages/pi`
- `/Users/lanh/Developer/pi-packages/opencode-dynamic-context-pruning`
- `/Users/lanh/Developer/pi-packages/Snowy117-pi-dcp-migrate`

Expected: each status matches the baseline recorded before Phase 1. Do not clean or alter pre-existing changes.

- [ ] **Step 3: Handoff without committing**

Report the focused suite, `pnpm check`, schema generation, whitespace check, planning-doc comparison, final changed-file scope, and reference-repository status. List any skipped check and its remaining risk. Do not claim implementation completion unless every required implementation phase and applicable verification step passed.
