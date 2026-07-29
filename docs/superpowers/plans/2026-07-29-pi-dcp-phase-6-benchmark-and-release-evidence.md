# Pi DCP Phase 6 Benchmark and Release Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce deterministic benchmark evidence and complete final release verification for the Pi DCP reliability roadmap.

**Architecture:** Add one maintainer-only benchmark harness that exercises the existing production pipeline, token estimator, snapshot parser, and state rehydration code. Fixtures are deterministic; each timed workload includes cloning, fresh-state setup, restoration where applicable, and pipeline execution. The CLI emits one JSON report, and the Node 24.15.0 result is retained at `benchmarks/result.json`.

**Tech Stack:** TypeScript ESM, Node `performance.now()`, Pi DCP state/pipeline helpers, Vitest, `tsx`, pnpm, Biome, and Node standard-library APIs.

---

## Readiness Audit and Boundaries

- The current branch is clean at `0dc5ec7`; Node 24.15.0 currently passes 442 tests, typecheck, package dry-run, and the established lint baseline of 58 warnings plus 1 info.
- The previous version of this plan was not implementation-ready: it referenced test-only `makeDefaultConfig()`, seeded state before `restoreDcpSnapshot()` cleared it, repeated Phase 5/roadmap work already completed, used a stale test count, and did not define an evidence artifact path.
- Use production `DEFAULT_CONFIG`; let real `compress` call/result messages rebuild `toolParameters` through `runPipeline()` after restoration. Do not manually seed runtime caches.
- Phase 6 changes no runtime behavior, schema fields, lifetime aggregation, package version, dependency, tag, or publish workflow. Benchmark output is informational; no timing or token-reduction release threshold is added.
- The original reliability roadmap at `docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md` must remain byte-for-byte unchanged. The phased index is already six phases and Phase 5 is already complete; do not redo those edits.
- The OpenCode DCP, Davidcreador, and complexthings repositories are behavioral/provenance references only. Pi core supplies native session/message contracts. Copy no source from those repositories.

## File Map

- Create `scripts/benchmark.ts`: deterministic fixtures, workload runner, statistics, report types, and import-safe CLI.
- Create `tests/benchmark.test.ts`: fixture correctness and report-shape tests without elapsed-time thresholds.
- Create `benchmarks/result.json`: committed Node 24.15.0 informational report; it remains outside the package through the existing `files` allowlist.
- Modify `package.json`, `README.md`, and `CHANGELOG.md` for the maintainer command and documentation.
- Modify the Phase 5 plan only to record its already-merged release commit; modify the Phase 6 plan and phased index only when Phase 6 verification is complete.

### Task 1: Add failing benchmark correctness tests

**Files:**

- Create: `tests/benchmark.test.ts`
- Test imports: `scripts/benchmark.ts`

- [ ] **Step 1: Define the report and workload imports in the test**

  Import `buildCleanWorkload`, `buildRepeatedToolWorkload`, `buildRestoredNestedWorkload`, `runBenchmarkSuite`, and `BenchmarkReport` from `../scripts/benchmark.ts`.

- [ ] **Step 2: Add clean and repeated-tool correctness tests**

  Assert that the clean workload returns exactly 2,000 messages and every output role is `user` or `assistant`.

  Assert that the repeated workload:
  - has fewer output than input estimated tokens;
  - retains at least one `write` tool result and its original content;
  - retains an error result whose text contains `stale error`;
  - contains no `toolResult` without a matching assistant owner.

  The projection must describe the transformed production messages; it must not implement a second pruning algorithm.

- [ ] **Step 3: Add the restored-nesting correctness test**

  Assert that the restored workload has 100 blocks, 10 active blocks, active outer IDs `10, 20, 30, 40, 50, 60, 70, 80, 90, 100`, and complete bidirectional relationships:

  ```ts
  for (const block of result.state.prune.messages.blocksById.values()) {
    for (const childId of block.consumedBlockIds) {
      expect(
        result.state.prune.messages.blocksById.get(childId)?.parentBlockIds,
      ).toContain(block.blockId);
    }
  }
  ```

- [ ] **Step 4: Add the report-shape test**

  Call `runBenchmarkSuite(1)` and assert the exact workload names:

  ```ts
  [
    "clean-2000-messages",
    "repeated-tool-pairs-2000",
    "restored-nested-blocks-100",
  ];
  ```

  Assert non-negative timing/token fields, `p95Ms >= medianMs`, and:

  ```ts
  reductionEstimatedTokens === inputEstimatedTokens - outputEstimatedTokens;
  ```

- [ ] **Step 5: Confirm the red state**

  Run `pnpm vitest run tests/benchmark.test.ts`.

  Expected: failure because `scripts/benchmark.ts` does not yet exist.

### Task 2: Implement the benchmark harness

**Files:**

- Create: `scripts/benchmark.ts`
- Modify: `tests/benchmark.test.ts` only if the finalized projection type requires narrower assertions.

- [ ] **Step 1: Add the report and internal run contracts**

  Export:

  ```ts
  export interface BenchmarkWorkloadReport {
    name: string;
    medianMs: number;
    p95Ms: number;
    inputEstimatedTokens: number;
    outputEstimatedTokens: number;
    reductionEstimatedTokens: number;
  }

  export interface BenchmarkReport {
    nodeVersion: string;
    iterations: number;
    workloads: BenchmarkWorkloadReport[];
  }
  ```

  Keep projection, run-result, and workload interfaces internal except for the named builders and `runBenchmarkSuite` used by Vitest.

- [ ] **Step 2: Implement the clean workload**

  Build exactly 2,000 alternating user/assistant messages with timestamps `1_000 + index` and text `clean message ${index}`. Each `run()` must clone the fixture, create a fresh `createSessionState()`, use a cloned `DEFAULT_CONFIG`, call `runPipeline(state, config, messages, undefined)`, and count input/output with `countMessageTokens()`.

- [ ] **Step 3: Implement the repeated-tool workload**

  Build exactly 2,000 assistant/tool-result pairs. Insert one user message before every 20-pair group. For pair index `i`:
  - `i % 25 === 0`: use protected `write` with unique arguments and output;
  - otherwise: use repeated `read` arguments across five stable paths and a large repeated result;
  - for non-write `i % 10 === 0`: mark the result as an error containing `stale error` and use a large repeated argument payload.

  Configure enabled deduplication and purge-errors with top-level `turnProtection: 0`; use the production `runPipeline`. Return transformed messages, state, token counts, and a projection containing tool name, error flag, result text, and owner presence.

- [ ] **Step 4: Implement the restored nested workload**

  Build ten chains of ten blocks. For each chain, create ten user messages followed by real completed `compress` assistant/tool-result pairs. For block IDs `chain * 10 + level + 1`:
  - use stable message keys for the chain’s first user, the current user, and the owner call;
  - use deterministic summary text and non-negative token counters;
  - set `consumedBlockIds` to only the immediately previous block ID for levels after the first;
  - make the outer block the newest block in each chain.

  Create a valid `DcpSnapshotV1` with `nextBlockId` and `nextRunId` set to 101, restore it into a fresh state with `restoreDcpSnapshot()`, then call `runPipeline()` so production cache and relationship rebuilding are exercised.

- [ ] **Step 5: Add standard-library statistics and suite execution**

  Implement median and nearest-rank p95 using sorted copies of duration arrays. For each workload, run one untimed warm-up, then exactly `iterations` timed calls with `performance.now()` immediately before and after `workload.run()`. Use the first timed result for token counts; do not average token counts.

- [ ] **Step 6: Add the import-safe CLI**

  Use `pathToFileURL(process.argv[1])` to detect the entry point. When invoked directly, write exactly one serialized `BenchmarkReport` plus a newline to stdout. Imports from Vitest must not execute any benchmark.

- [ ] **Step 7: Run focused verification**

  Run `mise exec node@24.15.0 -- pnpm vitest run tests/benchmark.test.ts` and `mise exec node@24.15.0 -- pnpm typecheck`.

  Expected: all benchmark tests pass and typecheck reports no errors.

- [ ] **Step 8: Commit the harness**

  ```bash
  git add scripts/benchmark.ts tests/benchmark.test.ts
  git commit -m "test: add deterministic dcp benchmarks"
  ```

### Task 3: Add command, artifact, and documentation

**Files:**

- Modify: `package.json`, `README.md`, `CHANGELOG.md`
- Create: `benchmarks/result.json`

- [ ] **Step 1: Add the maintainer command**

  Add exactly:

  ```json
  "benchmark": "tsx scripts/benchmark.ts"
  ```

  Do not add a runtime dependency or change the existing package `files` list.

- [ ] **Step 2: Document interpretation and artifact retention**

  In README development documentation, state that fixtures are deterministic but whole-workload timings vary by machine and Node version; comparisons must use the same machine and Node version. Document all three workload names, all report fields, and `benchmarks/result.json`.

  Add only a benchmark evidence entry to the Unreleased changelog. Do not duplicate the existing Phase 4 native-state or Phase 5 operator-control entries.

- [ ] **Step 3: Generate the retained report**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm benchmark > benchmarks/result.json
  ```

  Parse the file as one JSON object and confirm it has Node `v24.15.0`, 30 iterations, and the three required workload names.

- [ ] **Step 4: Verify package exclusion**

  Run `mise exec node@24.15.0 -- pnpm pack --dry-run`.

  Expected: runtime sources and user-facing docs are listed; `scripts/benchmark.ts`, `tests/`, and `benchmarks/result.json` are absent.

- [ ] **Step 5: Commit command and docs**

  ```bash
  git add package.json README.md CHANGELOG.md benchmarks/result.json
  git commit -m "docs: record dcp benchmark evidence"
  ```

### Task 4: Record release evidence and complete the roadmap

**Files:**

- Modify: `docs/superpowers/plans/2026-07-28-pi-dcp-phase-5-operator-and-release-hardening.md`
- Modify: `docs/superpowers/plans/2026-07-29-pi-dcp-phase-6-benchmark-and-release-evidence.md`
- Modify: `docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md` only after all Phase 6 checks pass.

- [x] **Step 1: Record the already-merged Phase 5 commit**

  The Phase 5 release record now contains commit `0dc5ec7`, status `complete`, and its existing verification date. No Phase 6 work is marked complete.

- [ ] **Step 2: Run the full Node 24.15.0 release gate**

  ```bash
  mise exec node@24.15.0 -- pnpm test
  mise exec node@24.15.0 -- pnpm typecheck
  mise exec node@24.15.0 -- pnpm lint
  mise exec node@24.15.0 -- pnpm run generate:schema
  git diff --exit-code -- dcp.schema.json
  mise exec node@24.15.0 -- pnpm benchmark > /tmp/pi-dcp-phase-6.json
  mise exec node@24.15.0 -- pnpm pack --dry-run
  git diff --check
  git diff --exit-code 0dc5ec7 -- docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md
  ```

  Expected: 442 baseline tests plus benchmark tests pass; typecheck succeeds; lint remains at or below 58 warnings and 1 info; schema is unchanged; temporary benchmark JSON parses; package contents exclude maintainer artifacts; and the original roadmap matches the base commit.

- [ ] **Step 3: Run the existing automated operator substitute**

  Run the Phase 5 configuration, command, integration, lifecycle, and persistence tests. Do not require a live TUI or paid model call because Phase 6 adds no runtime behavior.

- [ ] **Step 4: Record Phase 6 completion**

  After every acceptance criterion passes, set Phase 6 to `complete`, record the verification date, Node version, release commit, and `benchmarks/result.json` path in this plan, then update the phased index’s completion section. Do not modify the original reliability roadmap.

  ```bash
  git add docs/superpowers/plans/2026-07-28-pi-dcp-phase-5-operator-and-release-hardening.md \
    docs/superpowers/plans/2026-07-29-pi-dcp-phase-6-benchmark-and-release-evidence.md \
    docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md
  git commit -m "docs: complete dcp reliability roadmap"
  ```

## Acceptance Criteria

- Three deterministic workloads run with fresh state and no benchmark side effects during test imports.
- Timed whole-workload results include median/p95, input/output token estimates, and exact token delta.
- Tests verify pruning, protected writes, preserved errors, no orphan results, nested block relationships, and report shape without timing thresholds.
- `benchmarks/result.json` is a valid Node 24.15.0 report and is excluded from the package tarball.
- README and CHANGELOG describe the benchmark without duplicating existing release notes.
- Schema generation is stable and no new lint diagnostics exceed the established baseline.
- Existing Phase 5 automated operator coverage passes.
- The original reliability roadmap remains unchanged.
- Phase 5 and Phase 6 release records and the six-phase index are accurate.

## Final Handoff

- Phase 5 supplies trusted effective configuration and manual-compression contracts.
- Phase 6 supplies the retained benchmark JSON and final verification record.
- Version bump, tag, publish, and any live Pi/model smoke test remain outside this plan.

## Release Record

- Status: not started
- Release commit or tag: not recorded
- Verification date: not recorded
- Benchmark artifact: `benchmarks/result.json`
