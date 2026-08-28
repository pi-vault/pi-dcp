# Phase 5: Model-Specific DCP Controls Integrated Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the complete Phase 1–4 implementation, generated schema, documentation, and repository scope before handoff.

**Architecture:** Establish the supported runtime and repository baselines first, then run focused and full checks from narrow to broad. Verify the generated schema against the committed artifact, audit the committed implementation range separately from the current worktree, and confirm the reference APIs and repositories without modifying them.

**Tech Stack:** TypeScript, Node.js `>=24.15.0`, TypeBox, Vitest, pnpm, mise, Git.

**Spec:** `docs/superpowers/specs/2026-08-26-model-specific-dcp-controls-design.md`

## Global Constraints

- Run every Node.js and pnpm command through `mise exec node@24.15.0 --`; the default login shell selects unsupported Node.js `v23.11.0`.
- Do not modify Pi or any of the three reference repositories.
- Do not introduce dependencies or lockfile changes.
- Do not edit production code, tests, the design, the parent plan, or Phases 1–4 during verification. The approved Phase 5 replan may remain as the only pre-existing worktree change.
- Do not commit unless the user explicitly requests a commit.
- Stop and report a failed check. Any corrective implementation requires a separately scoped failing regression and plan update.
- If a check cannot run, record the exact command, reason, and remaining risk.

---

### Task 0: Establish the runtime and baselines

**Files:**

- Verify: `package.json`
- Verify: current `pi-dcp` worktree and commit history
- Read only: `/Users/lanh/Developer/pi-packages/pi`
- Read only: `/Users/lanh/Developer/pi-packages/opencode-dynamic-context-pruning`
- Read only: `/Users/lanh/Developer/pi-packages/Snowy117-pi-dcp-migrate`

**Interfaces:**

- Produces the supported runtime, committed implementation base, and start-state evidence used by every later task.

- [ ] **Step 1: Verify and record the supported toolchain**

Run:

```bash
mise exec node@24.15.0 -- node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 24 || (major === 24 && minor < 15)) {
  console.error(`Node >=24.15.0 required, found ${process.versions.node}`);
  process.exit(1);
}
console.log(process.version);
'
mise exec node@24.15.0 -- pnpm --version
```

Expected: Node.js reports `v24.15.0` or newer and pnpm is available. Stop on failure.

- [ ] **Step 2: Record the implementation commit and worktree baseline**

Run:

```bash
git merge-base --is-ancestor fbef8d6585b02622f28fbcf4b1f56a202674c66a HEAD
git show -s --format='%H %s' HEAD
git status --short --untracked-files=all
```

Expected: the ancestor check exits `0`. At plan review, the completed Phase 1–4 HEAD is `7351f9fa7b6084579a3b3bbadc3087fe6ca2fb56`; if HEAD has advanced, record the observed commit and audit the same `fbef8d6..HEAD` range. The worktree is either clean or contains only this approved Phase 5 plan rewrite.

- [ ] **Step 3: Record the three reference-repository baselines**

Run:

```bash
git -C /Users/lanh/Developer/pi-packages/pi show -s --format='%H %s' HEAD
git -C /Users/lanh/Developer/pi-packages/pi status --short --untracked-files=all
git -C /Users/lanh/Developer/pi-packages/opencode-dynamic-context-pruning show -s --format='%H %s' HEAD
git -C /Users/lanh/Developer/pi-packages/opencode-dynamic-context-pruning status --short --untracked-files=all
git -C /Users/lanh/Developer/pi-packages/Snowy117-pi-dcp-migrate show -s --format='%H %s' HEAD
git -C /Users/lanh/Developer/pi-packages/Snowy117-pi-dcp-migrate status --short --untracked-files=all
```

Expected: record each HEAD and status verbatim. At plan review, all three worktrees are clean. These snapshots prove Phase 5 leaves them unchanged; no recorded pre-Phase-1 snapshot exists, so do not claim this step independently proves their entire historical state.

### Task 1: Verify feature and package behavior

**Files:**

- Verify: `tests/config.test.ts`
- Verify: `tests/context-limits.test.ts`
- Verify: `tests/commands-register.test.ts`
- Verify: `tests/commands-context.test.ts`
- Verify: `tests/index.test.ts`
- Verify: `tests/integration.test.ts`
- Verify: all files included by `pnpm check`

**Interfaces:**

- Confirms exact per-model limits, config validation and merging, static disablement, live switching, transition hardening, command behavior, and extension integration.

- [ ] **Step 1: Run the complete focused feature suite**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run \
  tests/config.test.ts \
  tests/context-limits.test.ts \
  tests/commands-register.test.ts \
  tests/commands-context.test.ts \
  tests/index.test.ts \
  tests/integration.test.ts
```

Expected at plan review: six test files and 120 tests PASS.

- [ ] **Step 2: Run the full package checks**

Run:

```bash
mise exec node@24.15.0 -- pnpm check
```

Expected at plan review: formatting, lint, TypeScript typecheck, and all 51 Vitest files with 508 tests exit `0`. Biome currently reports warnings but no lint errors; record the warning count in the handoff and do not fix unrelated warnings during verification.

### Task 2: Verify generated, documentation, and committed artifacts

**Files:**

- Verify: `dcp.schema.json`
- Verify: `README.md`
- Verify: `docs/superpowers/specs/2026-08-26-model-specific-dcp-controls-design.md`
- Verify: `docs/superpowers/plans/2026-08-26-model-specific-dcp-controls.md`
- Verify: `docs/superpowers/plans/2026-08-26-model-specific-dcp-controls/phase-01-config-contract.md`
- Verify: `docs/superpowers/plans/2026-08-26-model-specific-dcp-controls/phase-02-static-model-disablement.md`
- Verify: `docs/superpowers/plans/2026-08-26-model-specific-dcp-controls/phase-03-live-model-switching.md`
- Verify: `docs/superpowers/plans/2026-08-26-model-specific-dcp-controls/phase-04-transition-hardening.md`

**Interfaces:**

- Confirms the generated schema is current, the committed Phase 1–4 range is reviewable, and the reviewed contract documents remain unchanged during Phase 5.

- [ ] **Step 1: Regenerate and compare the root schema**

Run:

```bash
mise exec node@24.15.0 -- pnpm generate:schema
git diff --exit-code HEAD -- dcp.schema.json
git grep -n '"disabledModels"' -- dcp.schema.json
```

Expected: generation exits `0`, `dcp.schema.json` is byte-for-byte unchanged from HEAD, and the schema contains the top-level `disabledModels` property. In a restricted Codex sandbox, `tsx` may fail with `listen EPERM` on a `tsx-*.pipe`; rerun the same generation command with sandbox escalation rather than changing the script.

- [ ] **Step 2: Check committed and worktree whitespace**

Run:

```bash
git diff --check fbef8d6585b02622f28fbcf4b1f56a202674c66a..HEAD
git diff --check
```

Expected: both commands produce no output and exit `0`.

- [ ] **Step 3: Audit the committed Phase 1–4 scope**

Run:

```bash
git diff --name-status fbef8d6585b02622f28fbcf4b1f56a202674c66a..HEAD
git diff --stat fbef8d6585b02622f28fbcf4b1f56a202674c66a..HEAD
git diff --exit-code fbef8d6585b02622f28fbcf4b1f56a202674c66a..HEAD -- \
  package.json pnpm-lock.yaml pnpm-workspace.yaml
```

Expected: no dependency or workspace file changed. The committed range contains only `README.md`, `dcp.schema.json`, the model-specific spec/parent plan/Phases 1–4, five source files (`src/commands/context.ts`, `src/commands/register.ts`, `src/config-schema.ts`, `src/config.ts`, `src/index.ts`), and seven test files (`tests/commands-context.test.ts`, `tests/commands-register.test.ts`, `tests/config.test.ts`, `tests/context-limits.test.ts`, `tests/helpers.ts`, `tests/index.test.ts`, `tests/integration.test.ts`).

- [ ] **Step 4: Confirm reviewed contract documents stayed unchanged during Phase 5**

Run:

```bash
git diff --exit-code HEAD -- \
  docs/superpowers/specs/2026-08-26-model-specific-dcp-controls-design.md \
  docs/superpowers/plans/2026-08-26-model-specific-dcp-controls.md \
  docs/superpowers/plans/2026-08-26-model-specific-dcp-controls/phase-01-config-contract.md \
  docs/superpowers/plans/2026-08-26-model-specific-dcp-controls/phase-02-static-model-disablement.md \
  docs/superpowers/plans/2026-08-26-model-specific-dcp-controls/phase-03-live-model-switching.md \
  docs/superpowers/plans/2026-08-26-model-specific-dcp-controls/phase-04-transition-hardening.md
git diff -- docs/superpowers/plans/2026-08-26-model-specific-dcp-controls/phase-05-integrated-verification.md
```

Expected: the first command exits `0`. The second command shows only this approved Phase 5 replan when it has not been committed before execution.

- [ ] **Step 5: Review contract consistency**

Run:

```bash
git grep -n -e 'disabledModels' -e 'modelMaxLimits' -e 'modelMinLimits' -- \
  README.md \
  dcp.schema.json \
  docs/superpowers/specs/2026-08-26-model-specific-dcp-controls-design.md \
  docs/superpowers/plans/2026-08-26-model-specific-dcp-controls.md
```

Expected: the artifacts consistently describe a top-level exact, case-sensitive `provider/modelId` disable list; independent max/min limit maps; invalid-list reset behavior; live `compress` removal/restoration; and retained DCP state.

### Task 3: Verify reference compatibility and hand off

**Files:**

- Verify: installed `@earendil-works/pi-coding-agent` package metadata
- Read only: `/Users/lanh/Developer/pi-packages/pi/packages/coding-agent`
- Read only: `/Users/lanh/Developer/pi-packages/opencode-dynamic-context-pruning/lib`
- Verify: final repository statuses

**Interfaces:**

- Confirms the Pi host APIs and OpenCode limit-map semantics used by the implementation, then produces the final evidence-backed handoff.

- [ ] **Step 1: Verify the Pi coding-agent API contract**

Run:

```bash
mise exec node@24.15.0 -- node -p \
  "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version"
sed -n '1,12p' /Users/lanh/Developer/pi-packages/pi/packages/coding-agent/package.json
git -C /Users/lanh/Developer/pi-packages/pi grep -n -F \
  -e 'type: "model_select"' \
  -e 'getActiveTools(): string[]' \
  -e 'setActiveTools(toolNames: string[]): void' -- \
  packages/coding-agent/src/core/extensions/types.ts
sed -n '1576,1618p' \
  /Users/lanh/Developer/pi-packages/pi/packages/coding-agent/src/core/agent-session.ts
```

Expected at plan review: the installed dependency is `0.84.2`; the reference checkout is `0.84.3`; `model_select` is emitted after the model changes; and `getActiveTools()`/`setActiveTools()` remain synchronous coding-agent APIs. Do not confuse the separate `packages/agent` harness event names with the coding-agent extension API targeted by `pi-dcp`.

- [ ] **Step 2: Verify the OpenCode exact-limit reference contract**

Run:

```bash
git -C /Users/lanh/Developer/pi-packages/opencode-dynamic-context-pruning grep -n \
  -e 'modelMaxLimits' \
  -e 'modelMinLimits' \
  -e 'providerModelId' -- \
  lib/config.ts lib/messages/inject/utils.ts
```

Expected: model limit maps remain keyed by exact `providerID/modelID`, per-model values take precedence over global limits, and project overrides replace the whole model-limit map. OpenCode DCP does not provide model-specific full disablement to copy.

- [ ] **Step 3: Confirm final worktree and reference scope**

Run:

```bash
git diff --exit-code HEAD -- . \
  ':(exclude)docs/superpowers/plans/2026-08-26-model-specific-dcp-controls/phase-05-integrated-verification.md'
git status --short --untracked-files=all
git -C /Users/lanh/Developer/pi-packages/pi show -s --format='%H %s' HEAD
git -C /Users/lanh/Developer/pi-packages/pi status --short --untracked-files=all
git -C /Users/lanh/Developer/pi-packages/opencode-dynamic-context-pruning show -s --format='%H %s' HEAD
git -C /Users/lanh/Developer/pi-packages/opencode-dynamic-context-pruning status --short --untracked-files=all
git -C /Users/lanh/Developer/pi-packages/Snowy117-pi-dcp-migrate show -s --format='%H %s' HEAD
git -C /Users/lanh/Developer/pi-packages/Snowy117-pi-dcp-migrate status --short --untracked-files=all
```

Expected: no `pi-dcp` file except the approved Phase 5 plan differs from HEAD, unless that plan was committed before execution. Each reference HEAD and status exactly matches the Task 0 snapshot.

- [ ] **Step 4: Hand off without committing**

Report:

1. supported Node.js and pnpm versions;
2. focused-suite and full-check file/test counts;
3. Biome warning count and absence of lint errors;
4. schema generation and exact-diff result;
5. `fbef8d6..HEAD` scope and dependency-file result;
6. documentation consistency and unchanged-file result;
7. installed/reference Pi versions and API evidence;
8. OpenCode exact-limit evidence;
9. final `pi-dcp` and reference-repository statuses;
10. every skipped or failed check and its remaining risk.

Do not claim implementation completion unless every applicable step passed. State explicitly that the Phase 5 start/end snapshots prove the references were untouched during Phase 5, while the absent pre-Phase-1 reference snapshot prevents an independent historical proof from this phase alone.
