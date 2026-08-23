# DCP Reliability Troubleshooting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce DCP session-state amplification, repair malformed message-ID stripping, adopt explicit glob semantics, verify anchor cleanup, clarify statistics, and produce reproducible evidence for the ten supplied Pi sessions.

**Architecture:** Preserve snapshot v1 while separating full snapshot serialization from a semantic write fingerprint. Implement independent behavior changes in atomic phases, beginning with read-only evidence and ending with lifecycle persistence because it has the largest correctness surface. Use `/Users/lanh/Developer/pi-packages/pi` only as the extension/session lifecycle reference.

**Tech Stack:** TypeScript ESM, Node.js >=24.15.0, `node:path.matchesGlob`, Pi extension APIs, Vitest 4, pnpm, JSONL session files.

**Spec:** `docs/superpowers/specs/2026-08-22-dcp-troubleshooting-design.md`

## Global Constraints

- Do not modify `/Users/lanh/Developer/pi-packages/pi`.
- Do not add dependencies.
- Keep `DcpSnapshotV1` and snapshot version `1` unchanged.
- Do not copy or commit the ten external JSONL files.
- Preserve cumulative session statistics across compaction.
- Do not add nudge-anchor cleanup that duplicates `src/pipeline.ts`.
- Do not add a process-global singleton guard without reproducing duplicate loading in supported single-instance configuration.
- Do not treat provider/model failures, idle gaps, or user aborts as DCP bugs without deterministic evidence.
- Analyzer output must not contain message content, tool arguments, error text, or secrets.
- Every production behavior change starts with a focused failing test.
- Run the narrowest relevant test first; run `pnpm check` only after all phases pass focused checks.

---

## Phase Order

Each phase is independently useful and ends in a reviewable commit. Execute the linked phase plan, verify its acceptance criteria, then return here and mark the phase complete. Do not rewrite this parent plan while executing child plans; record implementation discoveries in the relevant child plan or final report.

### Phase 1: Establish Evidence and Diagnose Duplicate Writers

**Plan:** `docs/superpowers/plans/2026-08-22-dcp-reliability-troubleshooting/phase-01-evidence-and-duplicate-writers.md`

**Usable result:** A tested read-only JSONL analyzer, corrected baseline report, and evidence-backed classification of the 42 exact duplicate state pairs.

**Files:**

- Create: `scripts/analyze-sessions.ts`
- Create: `tests/session-analysis.test.ts`
- Modify: `package.json`
- Modify: `docs/analysis-report.md`

**Acceptance:**

- The exact ten-file corpus reports 692 states, about 5.45 MB of DCP entries, 594 message-ID-only transitions, 42 exact duplicate transitions, 56 semantic checkpoints, and zero compactions.
- Synthetic malformed lines and unmatched tool calls are reported without aborting analysis.
- Exact-duplicate evidence contains only state ordinals, entry adjacency, parent linkage, and timestamp deltas.
- No production DCP behavior changes.

- [ ] Complete Phase 1 and commit its files.

### Phase 2: Clarify Statistics and Lock Down Anchor Reconciliation

**Plan:** `docs/superpowers/plans/2026-08-22-dcp-reliability-troubleshooting/phase-02-stats-and-anchor-contracts.md`

**Usable result:** Operator output distinguishes active context from cumulative session totals, and existing stale-anchor cleanup has regression coverage.

**Files:**

- Modify: `src/commands/context.ts`
- Modify: `src/commands/stats.ts`
- Modify: `src/messages/inject.ts`
- Modify: `tests/commands-context.test.ts`
- Modify: `tests/commands-stats.test.ts`
- Modify: `tests/pipeline.test.ts`

**Acceptance:**

- `dcp:context` says `Currently pruned tool calls`.
- `dcp:stats` says `Tools pruned this session` and `Cumulative tokens saved by pruning`.
- A pipeline pass removes stale anchors and preserves surviving anchors.
- The obsolete stale-anchor TODO is removed without adding cleanup code.

- [ ] Complete Phase 2 and commit its files.

### Phase 3: Adopt Native Glob Semantics

**Plan:** `docs/superpowers/plans/2026-08-22-dcp-reliability-troubleshooting/phase-03-native-glob-semantics.md`

**Usable result:** Protected tool and file patterns support Node-native character classes while retaining existing wildcard behavior.

**Files:**

- Modify: `src/strategies/protected-patterns.ts`
- Modify: `tests/protected-patterns.test.ts`
- Modify: `src/config-schema.ts`
- Modify: `README.md`

**Acceptance:**

- Exact, `*`, `**`, `?`, and `[abc]` patterns pass.
- Every tool pattern is evaluated through the matcher, including patterns without `*` or `?`.
- Malformed patterns do not crash context processing.
- Documentation names `node:path.matchesGlob` semantics.

- [ ] Complete Phase 3 and commit its files.

### Phase 4: Repair Orphan Message IDs and Consolidate Stripping

**Plan:** `docs/superpowers/plans/2026-08-22-dcp-reliability-troubleshooting/phase-04-message-id-sanitization.md`

**Usable result:** Orphan DCP message IDs are removed without deleting following prose, and one redundant context strip pass is gone.

**Files:**

- Modify: `src/messages/strip.ts`
- Modify: `src/pipeline.ts`
- Modify: `tests/strip.test.ts`
- Modify: `tests/message-end.test.ts`
- Modify: `tests/inject.test.ts`
- Modify: `tests/pipeline.test.ts`

**Acceptance:**

- `<dcp-message-id>m0001` is fully removed.
- Text after a valid orphan ID is preserved.
- Non-ID payload after an orphan opening tag is preserved.
- Stripping is idempotent.
- `message_end` and `injectMessageIds` remain sanitization boundaries.
- `runPipeline` no longer calls the redundant pipeline-wide assistant strip.

- [ ] Complete Phase 4 and commit its files.

### Phase 5: Reduce Snapshot Writes Without Breaking Lifecycle Stability

**Plan:** `docs/superpowers/plans/2026-08-22-dcp-reliability-troubleshooting/phase-05-persistence-lifecycle.md`

**Usable result:** Ordinary message growth does not append snapshots, while every semantic mutation and lifecycle recovery still persists exactly once.

**Files:**

- Modify: `src/state/persistence.ts`
- Modify: `src/index.ts` only if lifecycle tests require the approved `agent_settled` fallback
- Modify: `tests/persistence.test.ts`
- Modify: `tests/index.test.ts`
- Modify: lifecycle-focused tests if a new dedicated test file is clearer than extending `tests/index.test.ts`

**Acceptance:**

- Changing only `messageIds.byRawId` and `messageIds.nextRefIndex` leaves the fingerprint unchanged.
- Stats, prune tools, blocks, nudges, mode, permission, and compaction each change the fingerprint.
- Growing contexts with no semantic mutation append no state after baseline.
- Resume, fork, tree navigation, compaction/restart, and compressed boundaries preserve expected refs and owner statistics.
- Snapshot v1 serialization and parsing are unchanged.
- Use `agent_settled` only if the semantic projection fails a reference-stability test.

- [ ] Complete Phase 5 and commit its files.

### Phase 6: Integrated Verification and Final Report

**Plan:** `docs/superpowers/plans/2026-08-22-dcp-reliability-troubleshooting/phase-06-integrated-verification.md`

**Usable result:** A release-ready, evidence-backed change set with corrected report findings and explicit remaining risks.

**Files:**

- Modify: `docs/analysis-report.md`
- Modify: `CHANGELOG.md` only if the branch/release policy requires an unreleased entry
- No production files unless verification exposes a new deterministic regression and a new red/green task is approved

**Acceptance:**

- All focused tests pass.
- `pnpm check` passes.
- `pnpm run pack:verify` passes.
- The analyzer still reproduces the immutable historical baseline and reports the projected semantic write count separately.
- Optional Pi smoke testing covers multiple tool iterations, resume, tree navigation, manual compaction, and clean shutdown; skipped smoke coverage is documented as residual risk.
- The final report distinguishes fixed DCP defects, contract changes, historical duplicate loading, and external provider/user events.

- [ ] Complete Phase 6 and commit its documentation/evidence files if changed.

---

## Final Completion Checklist

- [ ] Review `git diff --stat` and confirm every changed file belongs to one phase.
- [ ] Confirm no external JSONL file, temporary trace, message content, or secret is staged.
- [ ] Run `pnpm check` and preserve the complete successful output.
- [ ] Run `pnpm run pack:verify` and preserve the successful output.
- [ ] Run the exact ten-file analyzer command in Phase 6 Task 3 Step 1 and preserve the aggregate output.
- [ ] Review `docs/analysis-report.md` against the approved spec and actual verification evidence.
- [ ] Request a final code review before integration.
