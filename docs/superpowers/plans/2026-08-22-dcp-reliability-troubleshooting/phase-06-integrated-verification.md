# Phase 6: Integrated Verification and Final Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the complete change set against focused tests, package checks, historical evidence, and Pi lifecycle behavior, then finalize the report with only demonstrated conclusions.

**Architecture:** Verify from narrow to broad under the supported Node runtime, audit the committed Phase 1–5 range rather than only the working tree, keep historical measurements separate from projected post-fix writes, and use an isolated optional Pi session for end-to-end lifecycle coverage. Production changes discovered during verification require a new failing regression before modification.

**Tech Stack:** pnpm, Vitest, TypeScript, Biome, package verification scripts, Pi interactive mode, JSONL analyzer.

**Spec:** `docs/superpowers/specs/2026-08-22-dcp-troubleshooting-design.md`

## Global Constraints

- Run every repository command with Node.js `>=24.15.0`; record the runtime before the first check.
- Audit completed Phase 1–5 changes against commit `c173923` (the parent of the Phase 1 merge on this branch), not only against the current working tree.
- Do not rewrite historical JSONL files.
- Do not claim runtime write reduction from a projection alone; label projected and observed results separately.
- Do not commit temporary Pi settings, traces, sessions, or packed artifacts. Use a disposable npm cache for `pack:verify` when the user npm cache is not writable.
- Do not make opportunistic production edits during verification.
- If a check cannot run, record the exact command, reason, and residual risk.

---

### Task 0: Establish the verification runtime

**Files:**

- Verify: `package.json`, `/Users/lanh/Developer/pi-packages/pi/packages/coding-agent/package.json`

**Interfaces:**

- Consumes: the repository engine requirement and the Pi host version.
- Produces: one recorded, supported verification toolchain.

- [ ] **Step 1: Record the active toolchain and host versions**

Run:

```bash
node --version
pnpm --version
pi --version
git -C /Users/lanh/Developer/pi-packages/pi show -s --format='%H %s' HEAD
git -C /Users/lanh/Developer/pi-packages/pi show HEAD:packages/coding-agent/package.json | sed -n '1,8p'
```

Expected: Node.js is `>=24.15.0` and the Pi package reports version `0.84.2`.

- [ ] **Step 2: Stop before repository checks when the runtime is unsupported**

Run:

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) { console.error(`Node >=24.15.0 required, found ${process.versions.node}`); process.exit(1); }'
```

If this fails, activate an installed Node.js `>=24.15.0` runtime and rerun Task 0. Do not treat a passing check with an engine warning as supported evidence.

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
pnpm vitest run tests/protected-patterns.test.ts tests/protected-content.test.ts tests/strategy-runner.test.ts tests/strip.test.ts tests/message-end.test.ts tests/inject.test.ts tests/pipeline.test.ts
```

Expected: PASS, including every Phase 3 protected-pattern consumer and every Phase 4 sanitization boundary.

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
PACK_CACHE_DIR="$(mktemp -d)"
trap 'rm -rf "$PACK_CACHE_DIR"' EXIT
npm_config_cache="$PACK_CACHE_DIR" pnpm run pack:verify
```

Expected: PASS and no analyzer scripts, plans, external logs, temporary traces, or local settings unexpectedly included in the published package.

- [ ] **Step 3: Inspect the committed Phase 1–5 range and working tree**

```bash
PHASE_BASE=c173923
git diff --check "$PHASE_BASE..HEAD"
git status --short
git diff --stat "$PHASE_BASE..HEAD"
git diff "$PHASE_BASE..HEAD" -- src tests scripts package.json pnpm-lock.yaml README.md dcp.schema.json docs/analysis-report.md CHANGELOG.md
git diff -- docs/superpowers/plans/2026-08-22-dcp-reliability-troubleshooting/phase-06-integrated-verification.md
```

Expected: the history-aware diff contains only completed Phase 1–5 scope plus the planned report changes; the working tree contains no temporary artifacts; the Phase 6 plan diff is reviewed separately.

- [ ] **Step 4: Confirm the package check did not leave artifacts**

```bash
git status --short
```

Expected: no packed archive, npm cache, trace, session, or settings file is inside the repository.

<!-- `pack:verify` uses `npm pack --dry-run`; no archive is created.
-->

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

Expected historical totals remain exactly:

```text
dcpStates: 692
dcpBytes: 5451357
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
7. external MiniMax/provider/abort events not fixed in DCP,
8. Phase 6 command evidence, supported runtime, current Pi host evidence, and whether the optional smoke test ran.

Replace predicted implementation language with actual test and command evidence. Keep the historical 692/594/42/56 numbers labeled as historical analysis and a projection input, not post-fix runtime measurements. State explicitly that the accepted fingerprint projects 56 semantic checkpoints from this corpus while duplicate-writer behavior remains a separate historical finding.

- [ ] **Step 3: Record current Pi and OpenCode reference evidence**

Run:

```bash
git -C /Users/lanh/Developer/pi-packages/pi show -s --format='%H %s' HEAD
git -C /Users/lanh/Developer/pi-packages/pi show HEAD:packages/coding-agent/package.json | sed -n '1,8p'
git -C /Users/lanh/Developer/pi-packages/pi grep -n -E 'session_tree|session_compact|agent_settled|transformContext|appendMessage' -- packages/agent/src/agent-loop.ts packages/coding-agent/src/core/agent-session.ts packages/coding-agent/src/core/extensions/runner.ts
git -C /Users/lanh/Developer/pi-packages/opencode-dynamic-context-pruning show -s --format='%H %s' HEAD
git -C /Users/lanh/Developer/pi-packages/opencode-dynamic-context-pruning grep -n -E 'assignMessageRefs|syncCompressionBlocks|saveSessionState' -- lib/hooks.ts lib/message-ids.ts lib/messages/sync.ts
```

Expected: Pi is `0.84.2`; its lifecycle ordering supports the Phase 5 reconstruction tests; OpenCode DCP uses host-stable message IDs and rebuilds compression relationships from current messages. Do not copy OpenCode's sidecar persistence model or change Pi snapshot-v1 fields. Preserve the original historical baseline section and do not add a changelog entry in this non-release verification phase.

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

- Consumes: the locally installed DCP extension and Pi 0.84.2 extension lifecycle.
- Produces: observed state-entry counts for a real run.

- This task is optional and is not required to declare Phase 6 complete. If credentials, terminal access, or a reproducible lifecycle sequence are unavailable, skip it and record the exact reason and residual risk in `docs/analysis-report.md`.

- [ ] **Step 1: Confirm the host supports isolated extension loading**

Read but do not edit the active Pi settings. The smoke command below must use Pi's `--no-extensions` flag plus one explicit `--extension` path. Pi's CLI contract keeps explicit `-e` paths enabled when discovery is disabled, and its resource loader canonicalizes duplicate paths.

- [ ] **Step 2: Create isolated disposable state**

Run these commands in one shell so the cleanup trap remains active:

```bash
SMOKE_CWD="$(mktemp -d)"
SMOKE_AGENT_DIR="$(mktemp -d)"
SMOKE_MARKER="$(mktemp)"
trap 'rm -rf "$SMOKE_CWD" "$SMOKE_AGENT_DIR" "$SMOKE_MARKER"' EXIT
```

Do not use the normal `~/.pi/agent` directory for this run.

- [ ] **Step 3: Exercise ordinary growth with one explicit DCP source**

Start Pi from the disposable working directory:

```bash
(
  cd "$SMOKE_CWD"
  PI_CODING_AGENT_DIR="$SMOKE_AGENT_DIR" \
    pi --no-extensions \
      --extension /Users/lanh/Developer/pi-vault/pi-dcp/src/index.ts \
      --session-dir "$SMOKE_AGENT_DIR/sessions"
)
```

Use this prompt, then wait for a clean response before exiting:

```text
Work only in this empty disposable directory. Use at least three separate tool calls in order: list the directory, write dcp-smoke.txt containing exactly smoke, and read dcp-smoke.txt back. Do not compact or prune during this prompt.
```

If the model does not produce at least three tool calls, discard that observation and repeat the disposable run.

- [ ] **Step 4: Resume and exercise lifecycle transitions**

Locate the session created after the marker:

```bash
SMOKE_SESSION="$(find "$SMOKE_AGENT_DIR/sessions" -type f -name '*.jsonl' -newer "$SMOKE_MARKER" -print | sort | tail -1)"
test -n "$SMOKE_SESSION"
```

Resume that exact file with the same isolated loader:

```bash
(
  cd "$SMOKE_CWD"
  PI_CODING_AGENT_DIR="$SMOKE_AGENT_DIR" \
    pi --no-extensions \
      --extension /Users/lanh/Developer/pi-vault/pi-dcp/src/index.ts \
      --session-dir "$SMOKE_AGENT_DIR/sessions" \
      --session "$SMOKE_SESSION"
)
```

In the resumed session, finish one clean response, use `/tree` to move to an earlier leaf and return to the latest leaf, trigger `/compact` and wait for it to complete, then exit cleanly.

Verify message refs remain stable for surviving messages and state restoration does not throw.

- [ ] **Step 5: Verify the session header and analyze the disposable session**

Verify that the analyzed file belongs to the disposable cwd; the analyzer intentionally does not expose the raw `cwd` field:

```bash
node --input-type=module -e '
import fs from "node:fs";
const [file, expectedCwd] = process.argv.slice(1);
const header = JSON.parse(fs.readFileSync(file, "utf8").split("\n", 1)[0]);
if (header.type !== "session" || header.cwd !== expectedCwd) {
  console.error(`unexpected session header cwd: ${header.cwd}`);
  process.exit(1);
}
' "$SMOKE_SESSION" "$SMOKE_CWD"
pnpm run analyze:sessions -- "$SMOKE_SESSION"
```

Expected: no exact duplicate snapshots and no message-ID-only state transitions under the accepted projection design. Record the observed counts and the Pi version in the report.

- [ ] **Step 6: Confirm cleanup and repository isolation**

```bash
git status --short
```

The shell trap removes only the three explicitly created temporary paths. The repository and normal Pi settings must remain unchanged.

### Task 5: Final review and phase commit

**Files:**

- Modify: `docs/analysis-report.md`

**Interfaces:**

- Produces: final report and integration-ready branch.

- [ ] **Step 1: Review acceptance criteria**

Confirm:

- Node.js `>=24.15.0` was used without an engine warning,
- focused and full checks passed,
- package verification passed,
- package verification used a disposable npm cache,
- the history-aware `c173923..HEAD` diff was reviewed,
- the exact historical corpus totals remain `692 / 5451357 / 42 / 594 / 56`,
- current Pi `0.84.2` lifecycle evidence and the OpenCode reference boundary are recorded,
- snapshot v1 stayed unchanged,
- no dependency was added,
- no Pi reference file changed,
- no external JSONL or temporary trace is staged,
- the optional smoke result or its exact skip reason is stated,
- `CHANGELOG.md` remains untouched because this is not a release phase.

- [ ] **Step 2: Commit final evidence**

```bash
git add docs/analysis-report.md
git commit -m "docs: finalize dcp reliability findings"
```

- [ ] **Step 3: Request code review**

Request review focused on:

- snapshot write semantics and lifecycle stability,
- sanitizer over-deletion risks,
- native glob compatibility,
- absence of duplicate cleanup/schema changes,
- accuracy of historical versus observed claims.
