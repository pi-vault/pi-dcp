# Pi DCP Phase 6 Benchmark and Release Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce deterministic benchmark evidence and complete the final documentation, packaging, and release verification for the Pi DCP reliability roadmap.

**Architecture:** Reuse the production pipeline, token estimator, snapshot parser, and state rehydration code through a small standard-library benchmark harness. Each workload builds deterministic fixtures, each measured iteration receives fresh state and cloned messages, and the CLI emits one machine-readable JSON report. Benchmark code is maintainer-only and remains outside the published package contents.

**Tech Stack:** TypeScript ESM, Node `performance.now()`, Pi DCP pipeline/state helpers, Vitest, `tsx`, pnpm, Biome, and the Node standard library.

---

## Source, Prerequisite, and Boundaries

- Source requirements: the benchmark and release-documentation portions of Task 6 in [2026-07-28-pi-dcp-reliability-roadmap.md](2026-07-28-pi-dcp-reliability-roadmap.md).
- Prerequisite: [Phase 5](2026-07-28-pi-dcp-phase-5-operator-and-release-hardening.md) is released and its focused/full checks pass.
- Phase 4 already owns lifetime-session scanning; Phase 6 does not change snapshot schemas, lifetime aggregation, or runtime behavior.
- Benchmark output is informational. There is no elapsed-time, token-reduction, or percentage release gate.
- No package version bump, tag, publish, runtime dependency, or benchmark framework is added.
- The original reliability roadmap remains byte-for-byte unchanged.

## File Map

- `scripts/benchmark.ts`: deterministic fixture builders, workload runner, statistics, report types, and import-safe CLI entry point.
- `tests/benchmark.test.ts`: correctness assertions for all three workloads and report shape; no wall-clock assertions.
- `package.json`: maintainer-only `benchmark` script.
- `README.md`, `CHANGELOG.md`: benchmark interpretation and final Phase 6 release notes.
- `docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md`: six-phase index, ownership table, handoff, and completion status.
- `docs/superpowers/plans/2026-07-28-pi-dcp-phase-5-operator-and-release-hardening.md`: Phase 5 release record only after Phase 5 verification.

### Task 1: Define deterministic benchmark fixtures and correctness tests

**Files:**

- Create: `tests/benchmark.test.ts`
- Test imports: `scripts/benchmark.ts`

- [ ] **Step 1: Add the report and fixture contracts to the test**

  Import these planned exports:

  ```ts
  import {
    buildCleanWorkload,
    buildRepeatedToolWorkload,
    buildRestoredNestedWorkload,
    runBenchmarkSuite,
    type BenchmarkReport,
  } from "../scripts/benchmark.ts";
  ```

  The test must assert this report shape:

  ```ts
  type BenchmarkWorkloadReport = {
    name: string;
    medianMs: number;
    p95Ms: number;
    inputEstimatedTokens: number;
    outputEstimatedTokens: number;
    reductionEstimatedTokens: number;
  };

  type BenchmarkReport = {
    nodeVersion: string;
    iterations: number;
    workloads: BenchmarkWorkloadReport[];
  };
  ```

- [ ] **Step 2: Write failing correctness tests for clean and repeated-tool workloads**

  Add assertions that:

  ```ts
  it("reduces repeated stale output without removing protected writes", () => {
    const workload = buildRepeatedToolWorkload();
    const result = workload.run();
    expect(result.outputTokens).toBeLessThan(result.inputTokens);
    expect(result.projection.some((message) => message.toolName === "write")).toBe(true);
    expect(result.projection.some((message) => message.isError && message.contentText.includes("stale error"))).toBe(true);
    expect(result.projection.filter((message) => message.role === "toolResult" && !message.hasAssistantOwner)).toHaveLength(0);
  });

  it("leaves clean messages structurally valid", () => {
    const result = buildCleanWorkload().run();
    expect(result.messages).toHaveLength(2000);
    expect(result.messages.every((message) => message.role === "user" || message.role === "assistant")).toBe(true);
  });
  ```

  `run()` may return a test-only projection around production messages; it must not duplicate pruning logic.

- [ ] **Step 3: Write the failing restored-nesting test**

  Assert the restored fixture has exactly 100 blocks, ten active outer blocks, and complete bidirectional relationships:

  ```ts
  it("rehydrates ten nested chains without losing relationships", () => {
    const result = buildRestoredNestedWorkload().run();
    expect(result.state.prune.messages.blocksById.size).toBe(100);
    expect(result.state.prune.messages.activeBlockIds.size).toBe(10);
    for (const block of result.state.prune.messages.blocksById.values()) {
      for (const childId of block.consumedBlockIds) {
        expect(result.state.prune.messages.blocksById.get(childId)?.parentBlockIds).toContain(block.blockId);
      }
    }
  });
  ```

- [ ] **Step 4: Write the failing report test**

  ```ts
  it("returns all required informational metrics", () => {
    const report: BenchmarkReport = runBenchmarkSuite(1);
    expect(report.iterations).toBe(1);
    expect(report.workloads.map((workload) => workload.name)).toEqual([
      "clean-2000-messages",
      "repeated-tool-pairs-2000",
      "restored-nested-blocks-100",
    ]);
    for (const workload of report.workloads) {
      expect(workload.medianMs).toBeGreaterThanOrEqual(0);
      expect(workload.p95Ms).toBeGreaterThanOrEqual(workload.medianMs);
      expect(workload.inputEstimatedTokens).toBeGreaterThanOrEqual(0);
      expect(workload.outputEstimatedTokens).toBeGreaterThanOrEqual(0);
      expect(workload.reductionEstimatedTokens).toBe(
        workload.inputEstimatedTokens - workload.outputEstimatedTokens,
      );
    }
  });
  ```

- [ ] **Step 5: Run the tests and confirm the benchmark module is absent**

  ```bash
  pnpm vitest run tests/benchmark.test.ts
  ```

  Expected: FAIL because `scripts/benchmark.ts` and its workload exports do not exist.

### Task 2: Implement the benchmark harness and CLI

**Files:**

- Create: `scripts/benchmark.ts`
- Modify: `tests/benchmark.test.ts` only when assertions need the finalized projection type

- [ ] **Step 1: Define exported report and workload types**

  Add:

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

  Define the internal run contract used by all three builders:

  ```ts
  interface ProjectionEntry {
    role: string;
    toolName?: string;
    isError?: boolean;
    contentText: string;
    hasAssistantOwner: boolean;
  }

  interface WorkloadRunResult {
    messages: AgentMessage[];
    state: SessionState;
    projection: ProjectionEntry[];
    inputTokens: number;
    outputTokens: number;
  }

  interface BenchmarkWorkload {
    name: string;
    run(): WorkloadRunResult;
  }
  ```

  Keep fixture/result helper types internal except for the three named workload builders and `runBenchmarkSuite` used by Vitest.

- [ ] **Step 2: Implement the clean workload**

  `buildCleanWorkload()` must create exactly 2,000 deterministic messages alternating user and assistant roles. Use timestamps `1_000 + index`, fixed text (`clean message ${index}`), and a fresh `createSessionState()` per `run()`. Run the production `runPipeline` with `makeDefaultConfig()` and no context usage. Estimate input/output with the existing `countMessageTokens()` helper; do not introduce another estimator.

- [ ] **Step 3: Implement the repeated-tool workload**

  `buildRepeatedToolWorkload()` must create exactly 2,000 assistant tool-call/result pairs. Insert a deterministic user message before every 20-pair group so stale-error age is observable. Repeat `read` arguments/results often enough for deduplication, mark every tenth read result as an error containing `stale error`, and use `write` for every 25th pair with unique output. Configure pruning with `turnProtection: 0`, enabled deduplication, and the existing purge-error threshold. `run()` must return the transformed messages plus a projection containing tool names, error flags/text, and assistant-owner presence for assertions.

- [ ] **Step 4: Implement the restored nested workload**

  `buildRestoredNestedWorkload()` must create deterministic raw messages and a valid `DcpSnapshotV1` containing 100 blocks in ten chains of ten. Each block must have stable `startKey`, `endKey`, `anchorKey`, `compressToolCallId`, deterministic summaries, and `consumedBlockIds` pointing only to its immediate child. Seed the fresh state’s `toolParameters` with a completed entry for every compression owner so `syncCompressionBlocks()` accepts every block. Each chain’s outer block is the only active block after `restoreDcpSnapshot()` and `syncCompressionBlocks()` rebuilds derived state. `run()` must restore a fresh state, run the production pipeline, and return the state plus transformed messages.

- [ ] **Step 5: Implement statistics without a dependency**

  Add standard-library helpers:

  ```ts
  function percentile(values: number[], fraction: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
  }

  function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  }
  ```

  Run one untimed warm-up, then exactly `iterations` timed runs per workload. Start `performance.now()` immediately before `workload.run()` and stop it immediately after. Use one canonical run’s token counts for the report; do not average token counts across timings.

- [ ] **Step 6: Implement the import-safe CLI**

  Export `runBenchmarkSuite(iterations = 30)` and execute it only when the file is the entry point:

  ```ts
  import { pathToFileURL } from "node:url";

  const isMain = process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(process.argv[1]).href;

  if (isMain) {
    process.stdout.write(`${JSON.stringify(runBenchmarkSuite())}\n`);
  }
  ```

  The CLI must emit exactly one JSON object to stdout and no progress logging. Vitest imports must not execute the benchmark.

- [ ] **Step 7: Run benchmark correctness tests**

  ```bash
  pnpm vitest run tests/benchmark.test.ts
  ```

  Expected: all fixture, relationship, token-reduction, and report-shape assertions pass without timing thresholds.

- [ ] **Step 8: Commit the benchmark harness**

  ```bash
  git add scripts/benchmark.ts tests/benchmark.test.ts
  git commit -m "test: add deterministic dcp benchmarks"
  ```

### Task 3: Add maintainer command and release documentation

**Files:**

- Modify: `package.json`, `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Add the source-checkout benchmark command**

  Add this package script without adding a runtime dependency:

  ```json
  "benchmark": "tsx scripts/benchmark.ts"
  ```

  Keep `scripts/benchmark.ts` outside the existing published `files` list. The command is maintainer-only, like the repository’s test/check scripts, and README must say it is run from a source checkout.

- [ ] **Step 2: Document benchmark interpretation**

  Add a README development section stating that benchmark fixtures are deterministic, timing varies by machine/Node version, output is informational, and before/after comparisons must use the same machine and Node version. Document the three workload names and the JSON metrics.

- [ ] **Step 3: Document final Phase 6 behavior**

  Add Unreleased changelog entries for deterministic benchmark evidence, trusted operator controls, and native-session release verification. Do not bump `package.json.version`, create a tag, or publish.

- [ ] **Step 4: Run command and packaging smoke checks**

  ```bash
  pnpm vitest run tests/benchmark.test.ts
  pnpm run benchmark
  pnpm pack --dry-run
  ```

  Expected: benchmark stdout parses as one JSON report containing all three workloads; pack output includes runtime sources and excludes `scripts/benchmark.ts` and `tests/`.

- [ ] **Step 5: Commit command and docs**

  ```bash
  git add package.json README.md CHANGELOG.md
  git commit -m "docs: record dcp benchmark release evidence"
  ```

### Task 4: Update the six-phase index and complete release verification

**Files:**

- Modify: `docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md`
- Modify: `docs/superpowers/plans/2026-07-28-pi-dcp-phase-5-operator-and-release-hardening.md`

- [ ] **Step 1: Split the phase index**

  Change the parent index to six phases:

  ```text
  Phase 4: native lifecycle persistence
      ↓
  Phase 5: trusted operator controls
      ↓
  Phase 6: benchmark and release evidence
  ```

  Phase 5’s independently usable result is trusted project configuration, trust-safe prompts, live command behavior, and manual compression. Phase 6’s result is deterministic evidence and final release verification. Move “Deterministic informational benchmarks” and “Final README, schema, package, and release checks” to Phase 6 ownership. Add the Phase 5 → Phase 6 handoff and the new detailed-plan link. Keep the source roadmap link and immutability command unchanged.

- [ ] **Step 2: Record Phase 5 completion without completing Phase 6**

  Confirm the Phase 5 plan contains its focused/full verification results and change only Phase 5’s status to `complete` after its release commit. Leave Phase 6 `not started` until this plan’s checks pass.

- [ ] **Step 3: Regenerate and verify the schema**

  ```bash
  pnpm run generate:schema
  git diff --exit-code -- dcp.schema.json
  ```

  Expected: schema regeneration produces no diff because Phases 5–6 add no configuration fields.

- [ ] **Step 4: Run the focused Phase 6 verification**

  ```bash
  pnpm vitest run tests/benchmark.test.ts
  pnpm run benchmark
  ```

  Expected: benchmark correctness passes and stdout is valid JSON with all required fields and workloads.

- [ ] **Step 5: Run the full Node 24.15+ release gate**

  ```bash
  pnpm test
  pnpm typecheck
  pnpm lint
  pnpm run generate:schema
  pnpm run benchmark
  pnpm pack --dry-run
  git diff --check
  git diff --exit-code HEAD -- docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md
  ```

  Expected: all tests and typechecking pass, lint does not exceed the Phase 5 entry baseline of 58 warnings and 1 info, schema is stable, benchmark JSON is complete, package contents are correct, whitespace is clean, and the original roadmap is unchanged.

- [ ] **Step 6: Perform the operator smoke flow**

  In a trusted project with global DCP disabled and project DCP enabled, verify the mode-specific tool appears, `/dcp:compress database migrations` queues a hidden follow-up, compression persists across resume, and `dcp:lifetime` counts the owning session once. Save the benchmark JSON beside the release evidence. If Pi TUI execution is unavailable, the Phase 5 integration tests are the required automated substitute and the limitation must be recorded in the release record.

- [ ] **Step 7: Mark the roadmap complete**

  After every Phase 6 acceptance criterion passes, change only Phase 6’s status to `complete`, record the verification date and release commit in this plan, and update the parent completion section to show all six phases complete. Do not change the original reliability roadmap.

  ```bash
  git add docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md docs/superpowers/plans/2026-07-29-pi-dcp-phase-6-benchmark-and-release-evidence.md
  git commit -m "docs: complete dcp reliability roadmap"
  ```

## Acceptance Criteria

- Three deterministic workloads run with fresh state, fixed inputs, and no benchmark side effects during test imports.
- Benchmark JSON contains one report object, all three workloads, median/p95 timing, input/output token estimates, and absolute reduction.
- Tests verify behavior and relationships without wall-clock thresholds.
- Benchmark and test artifacts are excluded from the package tarball.
- README, changelog, schema, package contents, and runtime behavior agree.
- Full Node 24.15+ verification passes without new lint diagnostics above the Phase 5 entry baseline.
- The original reliability roadmap remains unchanged.
- All six phase statuses, handoffs, and release records are accurate.

## Final Handoff

- Phase 5 supplies trusted effective configuration and manual-command contracts.
- Phase 6 supplies benchmark JSON and final release verification evidence.
- No version bump, tag, or publish is performed by this plan; those remain a separate release action.

## Release Record

- Status: not started
- Release commit or tag: not recorded
- Verification date: not recorded
