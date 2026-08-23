# Phase 6: Integrated Verification and Final Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the complete change set against focused tests, package checks, historical evidence, and Pi lifecycle behavior, then finalize the report with only demonstrated conclusions.

**Architecture:** Verify from narrow to broad, keep historical measurements separate from projected post-fix writes, and use an optional disposable Pi session for end-to-end lifecycle coverage. Production changes discovered during verification require a new failing regression before modification.

**Tech Stack:** pnpm, Vitest, TypeScript, Biome, package verification scripts, Pi interactive mode, JSONL analyzer.

**Spec:** `docs/superpowers/specs/2026-08-22-dcp-troubleshooting-design.md`

## Global Constraints

- Do not rewrite historical JSONL files.
- Do not claim runtime write reduction from a projection alone; label projected and observed results separately.
- Do not commit temporary Pi settings, traces, sessions, or packed artifacts.
- Do not make opportunistic production edits during verification.
- If a check cannot run, record the exact command, reason, and residual risk.

---

### Task 1: Run focused phase verification

**Files:**
- Verify all files changed in Phases 1–5.

**Interfaces:**
- Consumes: every phase's focused tests.
- Produces: one successful focused verification record.

- [ ] **Step 1: Run analysis and command tests**

```bash
pnpm vitest run tests/session-analysis.test.ts tests/commands-context.test.ts tests/commands-stats.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run glob and sanitization tests**

```bash
pnpm vitest run tests/protected-patterns.test.ts tests/strip.test.ts tests/message-end.test.ts tests/inject.test.ts tests/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run persistence and lifecycle tests**

```bash
pnpm vitest run tests/persistence.test.ts tests/stable-ids.test.ts tests/index.test.ts
```

Expected: PASS.

- [ ] **Step 4: Stop on any failure**

For each failure, run only the failing test by name, add a regression that expresses the required behavior if one is missing, apply the minimum correction, and rerun Tasks 1–3. Do not continue to broad checks with a known focused failure.

### Task 2: Run repository and package verification

**Files:**
- Verify repository configuration and packed file set.

**Interfaces:**
- Produces: complete quality and packaging evidence.

- [ ] **Step 1: Run the full repository check**

```bash
pnpm check
```

Expected: formatting, lint, typecheck, and all tests PASS with no errors; existing repository lint warnings may remain.

- [ ] **Step 2: Verify package contents**

```bash
pnpm run pack:verify
```

Expected: PASS and no analyzer scripts, plans, external logs, temporary traces, or local settings unexpectedly included in the published package.

- [ ] **Step 3: Inspect the diff**

```bash
git diff --check
git status --short
git diff --stat
git diff -- src tests scripts package.json README.md dcp.schema.json docs/analysis-report.md CHANGELOG.md
```

Expected: every changed production/test/report file belongs to a completed phase; no temporary diagnostic output remains.

### Task 3: Re-run historical evidence and final report

**Files:**
- Modify: `docs/analysis-report.md`

**Interfaces:**
- Consumes: `pnpm run analyze:sessions` and actual Phase 1–5 outcomes.
- Produces: final evidence-backed report.

- [ ] **Step 1: Run the exact ten-file corpus**

Run the exact corpus:

```bash
SESSION_FILES=(
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-plan--/2026-08-02T19-24-55-646Z_019fc3ef-b9de-7ec9-ac8e-09929b9260e9.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-plan--/2026-08-02T20-28-27-872Z_019fc429-e560-7e9d-ac45-08298f1617fd.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-plan--/2026-08-03T13-39-40-042Z_019fc7d9-fd8a-794e-8fc2-343882ec4fce.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-19T20-08-51-180Z_01a01ba4-0ceb-7723-a1c4-57b90ba3a425.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-19T21-05-32-576Z_01a01bd7-f3a0-71e1-bdc0-9d67f1c3fd97.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-20T03-22-14-675Z_01a01d30-d513-71be-a344-79eef133737a.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-20T05-21-15-146Z_01a01d9d-c98a-772f-98f0-080bcca01c29.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-20T23-12-54-846Z_01a02172-ec3e-7518-9e34-96579374fda5.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-21T01-38-06-722Z_01a021f7-db02-7b9e-9a60-b0dc5ffc6f4d.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-21T04-00-58-017Z_01a0227a-a4a1-7e8e-af49-33e6ec7b9bc7.jsonl"
)
pnpm run analyze:sessions -- "${SESSION_FILES[@]}"
```

Expected historical values remain:

```text
dcpStates: 692
dcpBytes: approximately 5451357
exactDuplicateTransitions: 42
messageIdOnlyTransitions: 594
semanticCheckpoints: 56
compactions: 0
unmatchedToolCalls: 0
unmatchedToolResults: 0
```

- [ ] **Step 2: Finalize the report classifications**

Ensure `docs/analysis-report.md` contains separate sections for:

1. fixed state-write amplification,
2. duplicate-writer diagnosis and whether it was configuration, historical, or unresolved,
3. fixed orphan message-ID stripping,
4. intentional native glob contract expansion,
5. existing anchor cleanup now covered by tests,
6. compaction statistics wording without schema change,
7. external MiniMax/provider/abort events not fixed in DCP.

Replace predicted implementation language with actual test and command evidence. Keep the historical 692/594/42/56 numbers labeled as historical analysis, not post-fix runtime measurements.

- [ ] **Step 3: Add changelog entry only when policy requires it**

If this branch targets a release and `CHANGELOG.md` has an `[Unreleased]` section, append under `### Fixed`:

```markdown
- Reduced redundant DCP session-state snapshots, repaired orphan message-ID sanitization, and clarified protected-pattern and statistics behavior.
```

If there is no `[Unreleased]` section or branch policy excludes changelog changes, leave `CHANGELOG.md` untouched and record that decision in the final summary.

- [ ] **Step 4: Re-run documentation-sensitive checks**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
git diff --check
```

Expected: PASS.

### Task 4: Optional Pi lifecycle smoke test

**Files:**
- Create only disposable session/config data outside the repository.
- Do not modify `/Users/lanh/Developer/pi-packages/pi`.

**Interfaces:**
- Consumes: locally installed DCP extension and Pi extension lifecycle.
- Produces: observed state-entry counts for a real run.

- [ ] **Step 1: Record current extension configuration**

Read but do not edit the active Pi package/extension configuration. Confirm only one DCP source is enabled for the smoke test. If isolation cannot be guaranteed, skip the smoke test and record duplicate-loading as residual risk.

- [ ] **Step 2: Start a disposable Pi session**

Create an isolated working directory and marker, then start Pi with the local extension:

```bash
export SMOKE_CWD="$(mktemp -d)"
export SMOKE_MARKER="$(mktemp)"
cd "$SMOKE_CWD"
pi -e /Users/lanh/Developer/pi-vault/pi-dcp/src/index.ts
```

Do not open or modify a production project session.

- [ ] **Step 3: Exercise ordinary growth**

Run one prompt that causes at least three tool iterations without pruning or nudges. Inspect the resulting JSONL and verify ordinary message-ID growth does not create one DCP state per context pass.

- [ ] **Step 4: Exercise lifecycle transitions**

In the disposable session:

1. finish a clean assistant response,
2. resume the session,
3. navigate the tree and return,
4. trigger manual compaction,
5. exit cleanly.

Verify message refs remain stable for surviving messages and state restoration does not throw.

- [ ] **Step 5: Analyze the disposable session**

After exiting Pi, locate the session created after the marker and analyze it:

```bash
export SMOKE_SESSION="$(find ~/.pi/agent/sessions -type f -name '*.jsonl' -newer "$SMOKE_MARKER" -print | sort | tail -1)"
test -n "$SMOKE_SESSION"
cd /Users/lanh/Developer/pi-vault/pi-dcp
pnpm run analyze:sessions -- "$SMOKE_SESSION"
```

If other Pi sessions ran concurrently, verify the reported header `cwd` equals `$SMOKE_CWD`; otherwise discard this observation and rerun in isolation. Expected: no exact duplicate snapshots under single-instance configuration and no message-ID-only state transitions under the accepted projection design. Under the fallback design, expect at most one ordinary checkpoint per settled agent run.

- [ ] **Step 6: Remove disposable artifacts**

Delete only the temporary working directory, marker, and verified smoke-session file:

```bash
test -n "$SMOKE_CWD" && rm -rf "$SMOKE_CWD"
test -n "$SMOKE_MARKER" && rm -f "$SMOKE_MARKER"
test -n "$SMOKE_SESSION" && rm -f "$SMOKE_SESSION"
```

Do not alter normal Pi sessions or settings.

### Task 5: Final review and phase commit

**Files:**
- Modify: `docs/analysis-report.md`
- Modify: `CHANGELOG.md` only if Task 3 requires it.

**Interfaces:**
- Produces: final report and integration-ready branch.

- [ ] **Step 1: Review acceptance criteria**

Confirm:

- focused and full checks passed,
- package verification passed,
- snapshot v1 stayed unchanged,
- no dependency was added,
- no Pi reference file changed,
- no external JSONL or temporary trace is staged,
- skipped optional verification is stated.

- [ ] **Step 2: Commit final evidence**

If only the report changed:

```bash
git add docs/analysis-report.md
git commit -m "docs: finalize dcp reliability findings"
```

If an approved changelog entry also changed:

```bash
git add docs/analysis-report.md CHANGELOG.md
git commit -m "docs: finalize dcp reliability findings"
```

- [ ] **Step 3: Request code review**

Request review focused on:

- snapshot write semantics and lifecycle stability,
- sanitizer over-deletion risks,
- native glob compatibility,
- absence of duplicate cleanup/schema changes,
- accuracy of historical versus observed claims.
