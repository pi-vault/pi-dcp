# Phase 1 — Pi DCP Maintenance and Cache Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repository checks warning-free, remove confirmed dead state, document provenance, and collect privacy-safe prompt-cache evidence without changing pruning policy.

**Architecture:** First turn the existing lint warnings into typed test helpers and explicit control flow, then enforce zero warnings. Extend the existing privacy-preserving session analyzer with raw Pi usage totals and adjacent-response latency summaries. Treat the analyzer as evidence gathering only; incremental pruning remains untouched.

**Tech Stack:** Node.js, TypeScript 7, Pi session JSONL format, Vitest 5, Biome 2, GitHub Actions, pnpm

**Spec:** `docs/superpowers/specs/2026-10-03-pi-dcp-improvement-roadmap-design.md`

## Global Constraints

- Execute this phase first from v0.6.0.
- Resolve warnings with types and control flow; do not add blanket Biome suppressions or weaken rules.
- Session reports must never retain message text, tool arguments, IDs, summaries, credentials, or reversible hashes of them.
- Do not change incremental pruning timing or strategy eligibility in this release.
- Lower `engines.node` only after the full suite passes on Node 22.19 and Node 24.

## Review Focus

- An assistant message with missing or malformed usage must increment diagnostics without corrupting valid totals; Task 3 adds mixed valid/invalid records.
- Cache and cost fields that are zero must be counted as valid rather than treated as absent; Task 3 pins zero-valued usage.
- Out-of-order timestamps must not create negative latency; Task 3 tests that the sample is skipped and counted malformed.
- Analyzer output must not contain raw model text, tool-call IDs, or error text; Task 3 extends the existing privacy assertion.
- A Node 22.19 CI failure must leave the published engine floor unchanged rather than claiming unsupported compatibility; Task 4 defines this release gate.

---

### Task 1: Eliminate and enforce zero Biome warnings

**Files:**

- Modify: `src/messages/priority.ts`
- Modify: `tests/helpers.ts`
- Modify: `tests/compress-range.test.ts`
- Modify: `tests/context-limits.test.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/inject.test.ts`
- Modify: `tests/integration.test.ts`
- Modify: `tests/persistence.test.ts`
- Modify: `tests/pipeline.test.ts`
- Modify: `tests/priority.test.ts`
- Modify: `tests/prune.test.ts`
- Modify: `tests/tool-cache.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: current AgentMessage test fixtures and Biome's recommended rules.
- Produces: `requireDefined<T>(value: T | undefined, label: string): T` and `getMessageText(message: AgentMessage): string` test helpers, plus a lint command that fails on warnings.

- [ ] **Step 1: Record the warning baseline**

Run: `pnpm biome lint --max-diagnostics=none .`

Expected: 57 warnings across the production priority map and the listed tests. Save the output in
the implementation review notes; do not commit generated diagnostics.

- [ ] **Step 2: Add typed test assertion helpers**

In `tests/helpers.ts`, add `requireDefined` that throws a label-specific error for `undefined`, and
`getMessageText` that safely narrows user, assistant, and tool-result content and joins text parts.
Add focused helper tests if `tests/helpers.test.ts` exists; otherwise exercise both helpers from the
first migrated test.

- [ ] **Step 3: Remove production and test non-null assertions**

Carry `ref` forward in the sortable entry inside `buildPriorityMap` so production code does not
perform a second asserted lookup. Replace test non-null assertions with `requireDefined`; use
optional property assertions only where `undefined` is the behavior under test. A missing required
fixture value must fail with a readable test error.

- [ ] **Step 4: Remove explicit `any`, unused imports, and stale suppressions**

Use `getMessageText` and typed AgentMessage narrowing in index, injection, integration, pipeline,
and prune tests. Remove the unused context-limit and nudge imports and the ineffective prune-test
suppression. Do not replace `any` with `unknown` followed by an equally broad unchecked cast.

- [ ] **Step 5: Verify zero warnings before changing the script**

Run: `pnpm biome lint --max-diagnostics=none .`

Expected: `Found 0 warnings` or equivalent successful output with no diagnostics.

- [ ] **Step 6: Make warnings fatal**

Change the `lint` script to `biome lint --error-on-warnings .`. Run `pnpm lint && pnpm typecheck && pnpm test`.

Expected: all commands pass and the test count is at least the v0.6.0 baseline.

- [ ] **Step 7: Commit warning cleanup**

```bash
git add src/messages/priority.ts tests/helpers.ts tests/compress-range.test.ts tests/context-limits.test.ts tests/index.test.ts tests/inject.test.ts tests/integration.test.ts tests/persistence.test.ts tests/pipeline.test.ts tests/priority.test.ts tests/prune.test.ts tests/tool-cache.test.ts package.json
git commit -m "chore: enforce warning-free checks"
```

### Task 2: Remove dead state and document provenance

**Files:**

- Modify: `src/state/types.ts`
- Modify: `src/state/state.ts`
- Create: `docs/provenance.md`
- Test: `tests/persistence.test.ts`

**Interfaces:**

- Consumes: runtime and persistence references to `SessionState`.
- Produces: `manualMode: false | "active"` with no pending-trigger state, and a durable provenance record.

- [ ] **Step 1: Prove the pending state is unused**

Run: `rg -n "compress-pending|pendingManualTrigger|PendingManualTrigger" src tests`

Expected: matches only in `src/state/types.ts`, `src/state/state.ts`, and any test fixture explicitly
checking defaults; no command, handler, serializer, or restorer consumes it.

- [ ] **Step 2: Add the narrowed-state regression assertion**

In `tests/persistence.test.ts`, retain a v1 fixture with `manualMode: false` and one with
`manualMode: "active"`; assert both restore and serialize unchanged. Typecheck must reject any new
attempt to assign `"compress-pending"`.

- [ ] **Step 3: Remove the dead type and fields**

Narrow `SessionState.manualMode`, remove `pendingManualTrigger` and its interface, and remove the
initialization/reset assignments. Do not remove `pruneTokenCounter` or other statistics in this
task because they have live command output.

- [ ] **Step 4: Write the provenance document**

Document the independently implemented Pi architecture, the audited OpenCode DCP v3.1.14 baseline
at commit `85b6f5c`, the current Pi API reference, the behavioral-comparison-only rule, and the MIT
license of this repository. Replace the ambiguous “Adapted from” state comment with a pointer to
`docs/provenance.md`.

- [ ] **Step 5: Run state, persistence, and type checks**

Run: `pnpm vitest run tests/persistence.test.ts tests/commands-manual.test.ts && pnpm typecheck && pnpm lint`

Expected: PASS with zero warnings and unchanged v1 persistence behavior.

- [ ] **Step 6: Commit dead-state and provenance cleanup**

```bash
git add src/state/types.ts src/state/state.ts tests/persistence.test.ts docs/provenance.md
git commit -m "refactor: remove dead manual trigger state"
```

### Task 3: Add privacy-safe cache and latency evidence

**Files:**

- Modify: `scripts/analyze-sessions.ts`
- Modify: `tests/session-analysis.test.ts`
- Create: `docs/cache-evaluation.md`

**Interfaces:**

- Consumes: Pi assistant-message `usage`, standalone `usage` entries, and adjacent session-entry timestamps.
- Produces: `UsageTotals`, `LatencySummary`, and expanded `SessionCounts` fields `usage`, `responseLatency`, and `malformedUsage` from `analyzeSessionFiles(files: string[]): Promise<SessionCorpusReport>`.

- [ ] **Step 1: Define failing usage-total tests**

Add a session fixture containing one assistant message and one standalone usage entry using Pi's
current fields: `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, and cost components.
Assert per-file and corpus totals sum every numeric field exactly, including zeros, without double
counting the assistant entry.

- [ ] **Step 2: Define failing latency and malformed-input tests**

For an assistant immediately following a user or tool-result message, assert the timestamp delta is
recorded in `responseLatency: { count, totalMs, minMs, maxMs }`. Add missing usage, nonnumeric cost,
and an earlier assistant timestamp; assert `malformedUsage` increments and no negative latency is
recorded while later valid entries still count.

- [ ] **Step 3: Extend the privacy test**

Put unique secrets in message text, model errors, tool arguments, and tool-call IDs. Assert the
serialized report contains none of them and exposes only counts, numeric usage/cost values, stop
reasons, and existing non-reversible transition evidence.

- [ ] **Step 4: Run analyzer tests and verify the new metrics are absent**

Run: `pnpm vitest run tests/session-analysis.test.ts`

Expected: FAIL because the current analyzer ignores usage and response latency.

- [ ] **Step 5: Implement numeric usage and latency aggregation**

Mirror Pi's `Usage` shape in `UsageTotals`, validate every required numeric field as finite and
nonnegative, and aggregate assistant and standalone usage as separate real calls into the same
totals. Track only the immediately preceding valid entry timestamp and accept latency samples only
when the preceding entry is a user/tool-result message and the delta is nonnegative.

- [ ] **Step 6: Document the comparison protocol**

In `docs/cache-evaluation.md`, define two fixed-session corpora, the analyzer command, and the raw
metrics to compare: cache read/write, uncached input, output, total cost, and latency summary. State
that no pruning-policy change is justified without comparable model/provider workloads and a clear
cost or latency improvement.

- [ ] **Step 7: Run analyzer and complete checks**

Run: `pnpm vitest run tests/session-analysis.test.ts && pnpm analyze:sessions -- /absolute/path/to/redacted-session.jsonl` when a redacted local fixture is available; otherwise run only the committed synthetic fixtures.

Expected: tests pass, CLI emits valid JSON, and no report contains raw session content.

- [ ] **Step 8: Commit cache evidence tooling**

```bash
git add scripts/analyze-sessions.ts tests/session-analysis.test.ts docs/cache-evaluation.md
git commit -m "feat: report privacy-safe prompt cache evidence"
```

### Task 4: Verify Node support and prepare v0.6.1

**Files:**

- Modify: `.github/workflows/quality.yml`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: the warning-free check command and current Pi minimum Node requirement.
- Produces: CI evidence for Node 22.19 and 24, with truthful package engine metadata.

- [ ] **Step 1: Add the Node compatibility matrix**

Change the quality job to a matrix containing exact `22.19.0` and major `24`, and use the matrix
value in `actions/setup-node`. Keep one pnpm install and `pnpm check` per matrix entry.

- [ ] **Step 2: Run the full local release checks**

Run: `pnpm check && pnpm run pack:dry-run && pnpm benchmark`

Expected: exit 0 with zero lint warnings and all three current benchmark workloads completing.

- [ ] **Step 3: Resolve the engine floor from CI evidence**

If both matrix jobs pass unchanged, set `engines.node` to `>=22.19.0` and document parity with Pi.
If Node 22.19 fails, keep the current floor and document the exact failing API/toolchain constraint;
do not add a compatibility shim in this maintenance release.

- [ ] **Step 4: Update release metadata**

Add v0.6.1 notes covering warning enforcement, dead-state removal, provenance, cache reporting, and
the verified Node support result. Set the package version to `0.6.1`.

- [ ] **Step 5: Review and commit v0.6.1**

Run: `git diff --check && git status --short`

```bash
git add .github/workflows/quality.yml package.json README.md CHANGELOG.md
git commit -m "chore: prepare pi-dcp 0.6.1"
```
