# Phase 1 — Pi DCP Maintenance and Cache Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repository checks warning-free, remove confirmed dead state, document provenance, and collect privacy-safe prompt-cache evidence without changing pruning policy.

**Architecture:** First turn the existing lint warnings into typed test helpers and explicit control flow, then enforce zero warnings. Remove the orphaned Pi adaptation state while preserving the version-1 snapshot wire shape and recording factual provenance. Extend the streaming session analyzer with every Pi 1.0.1 usage carrier, separate usage/latency diagnostics, and identifier-free reports; incremental pruning remains untouched.

**Tech Stack:** Node.js, TypeScript 7, Pi session JSONL format, Vitest 5, Biome 2, GitHub Actions, pnpm

**Spec:** `docs/superpowers/specs/2026-10-03-pi-dcp-improvement-roadmap-design.md`

## Global Constraints

- Execute this phase first from v0.6.0.
- Resolve warnings with types and control flow; do not add blanket Biome suppressions or weaken rules.
- Session reports must never retain message text, tool arguments, IDs, summaries, credentials, or reversible hashes of them.
- Session reports must also omit input paths, basenames, provider/model names, usage kinds, and notes; files are identified only by one-based input order.
- Do not change incremental pruning timing or strategy eligibility in this release.
- Lower `engines.node` only after the full suite passes on exact Node 22.19.0 and current Node 24.
- Treat Pi checkout `83692682f` (released v1.0.1 tag `a7229ddc`) as the session/API authority. Treat OpenCode DCP `85b6f5c` and reviewed checkout `f8232fd` as AGPL behavioral/provenance references only.

## Review Focus

- Required assistant or standalone usage that is absent or invalid increments `malformedUsage` once without corrupting later totals; Task 3 adds mixed valid/invalid records.
- Optional tool-result, compaction, and branch-summary usage is counted when valid, ignored when absent, and diagnosed when supplied but invalid; Task 3 covers every carrier.
- Zero-valued required, optional, and cost fields are valid; missing optional `cacheWrite1h` and `reasoning` remain absent from totals until at least one call reports them; Task 3 pins both cases.
- Invalid or out-of-order candidate timestamps increment `malformedLatency`, never `malformedUsage`, and never create negative latency; Task 3 tests both conditions.
- A Node 22.19.0 CI failure leaves the engine floor unchanged; Task 4 separates compatibility evidence from release metadata.

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
Exercise `requireDefined` through required lookups in `tests/priority.test.ts` and
`getMessageText` through string and multipart content assertions in `tests/inject.test.ts`; do not
create a helper-only test file.

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

Expected: all commands pass with zero lint warnings and at least 52 test files / 514 tests.

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
- Test: `tests/commands-manual.test.ts`
- Test: `tests/persistence.test.ts`

**Interfaces:**

- Consumes: runtime and persistence references to `SessionState`.
- Produces: `manualMode: false | "active"` with no pending-trigger state, unchanged version-1 snapshot compatibility, and a factual provenance record.

- [ ] **Step 1: Prove the pending state is unused**

Run: `rg -n "compress-pending|pendingManualTrigger|PendingManualTrigger" src tests`

Expected: matches in `src/state/types.ts`, `src/state/state.ts`, and the stale behavioral test in
`tests/commands-manual.test.ts`; no command, handler, serializer, or restorer consumes it. Record
that persistence already normalizes runtime state to `false | "active"`.

- [ ] **Step 2: Write narrowed-state and compatibility tests**

In `tests/commands-manual.test.ts`, remove the stale `compress-pending` behavior test, add a no-arg
`false` assertion that reports `off`, and use `expectTypeOf<SessionState["manualMode"]>()` to pin the
union to `false | "active"`. In `tests/persistence.test.ts`, use version-1 fixtures with
`manualMode: false` and `manualMode: "active"`; assert both parse, restore, and serialize unchanged.

- [ ] **Step 3: Run tests to verify the stale state still exists**

Run: `pnpm vitest run tests/commands-manual.test.ts tests/persistence.test.ts && pnpm typecheck`

Expected: FAIL because `SessionState["manualMode"]` still includes `"compress-pending"`; existing
runtime tests otherwise remain green.

- [ ] **Step 4: Remove the orphaned type and fields**

Narrow `SessionState.manualMode`, remove `pendingManualTrigger` and its interface, and remove the
initialization/reset assignments. Do not remove `pruneTokenCounter` or other statistics in this
task because they have live command output.

- [ ] **Step 5: Write the provenance document**

In `docs/provenance.md`, record this repository at baseline `2471ec2` under MIT; Pi checkout
`83692682f` and released v1.0.1 tag `a7229ddc` under MIT as the API authority; OpenCode DCP v3.1.14
at `85b6f5c` plus reviewed checkout `f8232fd` under AGPL-3.0-or-later as behavioral/provenance
references; and the earlier provenance audit at pi-dcp commit `75008c7`. Describe the historical
adaptation neutrally, prohibit future copying from AGPL source into this MIT package, and state that
the document is not a legal or clean-room determination. Replace the state-file “Adapted from”
comment with a pointer to this document rather than an independence claim.

- [ ] **Step 6: Run state, persistence, and type checks**

Run: `pnpm vitest run tests/persistence.test.ts tests/commands-manual.test.ts && pnpm typecheck && pnpm lint`

Expected: PASS with zero warnings and unchanged v1 persistence behavior.

- [ ] **Step 7: Commit dead-state and provenance cleanup**

```bash
git add src/state/types.ts src/state/state.ts tests/commands-manual.test.ts tests/persistence.test.ts docs/provenance.md
git commit -m "refactor: remove dead manual trigger state"
```

### Task 3: Add privacy-safe cache and latency evidence

**Files:**

- Modify: `scripts/analyze-sessions.ts`
- Modify: `tests/session-analysis.test.ts`
- Create: `docs/cache-evaluation.md`

**Interfaces:**

- Consumes: Pi 1.0.1 usage on assistant messages, standalone usage entries, optional tool-result messages, compactions, and branch summaries, plus adjacent session-entry timestamps.
- Produces: `UsageTotals`, `LatencySummary`, and expanded `SessionCounts` fields `usage: UsageTotals`, `responseLatency: LatencySummary`, `malformedUsage: number`, and `malformedLatency: number` from `analyzeSessionFiles(files: string[]): Promise<SessionCorpusReport>`. `SessionFileReport` exposes `fileIndex: number`, never the input path.

- [ ] **Step 1: Define the exact report types in the tests**

Write assertions for this exact shape:

```ts
interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

interface LatencySummary {
  count: number;
  totalMs: number;
  minMs: number | null;
  maxMs: number | null;
}
```

Assert that each per-file report has a one-based `fileIndex` and no `file` property, and that
`report.totals` contains the same nested aggregate types plus `files`.

- [ ] **Step 2: Add failing coverage for every Pi usage carrier**

Build a two-file corpus containing valid usage on an assistant message, standalone `usage` entry,
tool-result message, compaction, and branch summary. Use distinct positive values for every required
token and cost field, include `cacheWrite1h` on one call and `reasoning` on another, and include one
all-zero usage object. Assert exact per-file and corpus sums. Missing optional usage on a tool result,
compaction, or branch summary must not increment `malformedUsage`.

- [ ] **Step 3: Add failing malformed-usage tests**

Add required assistant and standalone entries with missing usage, plus supplied usage objects with a
negative, nonnumeric, infinite, or missing required value. Assert `malformedUsage` increments once
per invalid usage object, no partial values enter totals, and later valid entries still aggregate.
When `cacheWrite1h` or `reasoning` is absent from every valid usage, assert the corresponding total
property is absent; a reported zero must create the property with value zero.

- [ ] **Step 4: Add failing latency tests**

Assert that an assistant immediately following a user and one immediately following a tool result
produce `responseLatency: { count, totalMs, minMs, maxMs }`. An invalid timestamp or negative delta
for an otherwise eligible pair increments `malformedLatency`, records no sample, and does not affect
`malformedUsage`. An assistant following any other valid entry is not a latency candidate. With no
samples, both extrema are `null`.

- [ ] **Step 5: Extend the privacy test**

Put unique secrets in the input directory and filename, session/message/tool-call IDs, provider and
model, standalone usage kind and note, message text, model errors, tool arguments, summaries, and DCP
state. Assert the serialized report contains none of them and exposes only one-based file ordinals,
counts, numeric usage/cost values, normalized stop reasons, and existing non-reversible transition
evidence.

- [ ] **Step 6: Run analyzer tests and verify the new contract is absent**

Run: `pnpm vitest run tests/session-analysis.test.ts`

Expected: FAIL because the current analyzer ignores usage and response latency and emits input paths.

- [ ] **Step 7: Implement strict usage parsing and aggregation**

Add `UsageTotals`, `LatencySummary`, `usageTotals(): UsageTotals`,
`latencySummary(): LatencySummary`, `parseUsage(value: unknown): UsageTotals | undefined`, and
`addUsage(target: UsageTotals, usage: UsageTotals): void` in `scripts/analyze-sessions.ts`. Required
numeric fields and all cost components must be finite and nonnegative. Validate optional
`cacheWrite1h` and `reasoning` only when present; preserve their absence until at least one valid call
reports them. Do not require `totalTokens` or `cost.total` to equal component sums because Pi
preserves provider-reported totals.

Count required usage on assistant and standalone entries. Count optional usage on tool-result,
compaction, and branch-summary entries only when present. A required missing usage or supplied
invalid usage increments `malformedUsage` once; optional absence is ignored.

- [ ] **Step 8: Implement identifier-free file reports and latency aggregation**

Change the private signature to
`analyzeFile(file: string, fileIndex: number): Promise<SessionFileReport>`, pass `index + 1` from
`analyzeSessionFiles`, emit `fileIndex`, and never retain the path in the returned report. Track the
immediately preceding structurally valid entry independently from DCP state-transition timestamps.
Only user/tool-result-to-assistant pairs are candidates; invalid or negative deltas increment
`malformedLatency` and are skipped.

- [ ] **Step 9: Run analyzer tests**

Run: `pnpm vitest run tests/session-analysis.test.ts`

Expected: PASS with exact per-file/corpus totals, separated diagnostics, nullable empty extrema, and
no secret strings in serialized output.

- [ ] **Step 10: Document the comparison protocol**

In `docs/cache-evaluation.md`, define paired control/treatment corpora that use the same tasks,
provider/model version, system prompt, toolset, cache-retention setting, region, and warm/cold cache
condition. Document the analyzer command and raw metrics: uncached input, output, cache read/write,
optional one-hour cache write and reasoning totals, provider-reported total tokens, each cost
component, total cost, and latency summary. State that no pruning-policy change is justified without
comparable workloads and a clear cost or latency improvement. Do not commit raw sessions or reports.

- [ ] **Step 11: Exercise the CLI and complete focused checks**

Run: `pnpm vitest run tests/session-analysis.test.ts && pnpm typecheck && pnpm lint`

Also run the CLI through the existing test's temporary synthetic JSONL fixture. Local private
sessions are optional and must never be committed. Expected: tests pass, CLI output parses as JSON,
and no report contains raw session identifiers or content.

- [ ] **Step 12: Commit cache evidence tooling**

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
- Produces: CI evidence for exact Node 22.19.0 and current Node 24, followed by truthful package engine and v0.6.1 metadata.

- [ ] **Step 1: Add the Node compatibility matrix without lowering the engine floor**

Change the quality job to a matrix containing exact `22.19.0` and major `24`, and use the matrix
value in `actions/setup-node`. Keep one pnpm install and `pnpm check` per matrix entry. Leave
`engines.node` at `>=24.15.0` in this commit so the metadata does not claim unverified support.

- [ ] **Step 2: Commit the CI evidence gate**

```bash
git add .github/workflows/quality.yml
git commit -m "ci: test Node 22 and 24"
```

- [ ] **Step 3: Run the full local release checks**

Run: `pnpm check && pnpm run pack:dry-run && pnpm benchmark`

Expected: exit 0 with zero lint warnings and all three current benchmark workloads completing.

- [ ] **Step 4: Resolve the engine floor from CI evidence**

Push or otherwise run the branch workflow and inspect both matrix jobs. If exact Node 22.19.0 and
Node 24 pass unchanged, set `engines.node` to `>=22.19.0` and update the README badge to match Pi.
If Node 22.19.0 fails, keep `>=24.15.0` and document the exact failing API or toolchain constraint;
do not add a compatibility shim in this maintenance release. Do not continue to release metadata
until one of these evidence branches is recorded.

- [ ] **Step 5: Update release metadata**

Add v0.6.1 notes covering warning enforcement, dead-state removal, provenance, cache reporting, and
the verified Node support result. Set the package version to `0.6.1`. Update the README's “What's
new” section and Node badge only with the outcome established in Step 4.

- [ ] **Step 6: Run the complete release verification**

Run:

```bash
pnpm check
pnpm generate:schema
git diff --exit-code -- dcp.schema.json
pnpm run pack:dry-run
pnpm benchmark
git diff --check
```

Expected: 52 or more test files and 514 or more tests pass, lint emits zero warnings, schema
generation creates no diff, packaging succeeds, all three benchmark workloads complete, and the diff
has no whitespace errors.

- [ ] **Step 7: Review and commit v0.6.1**

Run: `git diff --check && git status --short`

```bash
git add package.json README.md CHANGELOG.md
git commit -m "chore: prepare pi-dcp 0.6.1"
```
