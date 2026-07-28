# Pi DCP Phase 5 Operator and Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the reliability roadmap with trusted project configuration, live operator controls, manual compression, deterministic benchmark evidence, and release-ready documentation.

**Architecture:** Resolve effective configuration at session start from defaults, global JSON, and trusted project JSON. Keep handlers registered when global config is disabled, read current config at execution time, trigger manual compression through Pi’s follow-up message API, and reuse Phase 4 snapshot callbacks for durable command changes.

**Tech Stack:** TypeScript ESM, Pi ExtensionAPI 0.80.3-compatible trust and message APIs, TypeBox, Vitest, pnpm, `tsx`, and Node standard-library filesystem/performance APIs.

---

## Source, Prerequisite, and Boundaries

- Source roadmap: Task 5 and the benchmark/release portion of Task 6 in [2026-07-28-pi-dcp-reliability-roadmap.md](2026-07-28-pi-dcp-reliability-roadmap.md).
- Prerequisite: [Phase 4](2026-07-28-pi-dcp-phase-4-native-session-state.md) is released and its full verification passes.
- This phase uses Phase 4 native snapshots for command persistence; it does not add another state store.
- Benchmark results are informational. No percentage gate is introduced without measured variance data.

## Stable Outcome

After this phase:

- Effective config merges defaults → global config → trusted `<ctx.cwd>/.pi/dcp.json`.
- Nested objects merge and arrays replace.
- Untrusted project config is ignored.
- Commands and tool execution read the current effective config.
- Project config can enable DCP even when global config disables it.
- `/dcp:compress [focus]` triggers a Pi follow-up turn unless compression permission is denied.
- Deterministic benchmark workloads report token and timing evidence as JSON.
- README, schema, changelog, package contents, and release checks agree.

### Task 1: Merge trusted project configuration

**Files:**

- Modify: `src/config.ts`, `src/index.ts`
- Test: `tests/config.test.ts`, `tests/integration.test.ts`

- [ ] **Step 1: Add failing precedence and trust tests**

  Using temporary global and project files, cover:

  - defaults → global → project precedence;
  - recursive nested-object merging;
  - array replacement;
  - unknown-property cleanup and validation warnings;
  - missing/invalid files;
  - exclusion when `ctx.isProjectTrusted()` is false;
  - path resolution from `ctx.cwd`, not process cwd.

  Assert a trusted project can set `enabled: true` over global `enabled: false`.

- [ ] **Step 2: Confirm only global config is loaded**

  ```bash
  pnpm vitest run tests/config.test.ts tests/integration.test.ts -t "project config|trusted|precedence"
  ```

  Expected: FAIL because `loadConfig()` accepts one path and startup may return before project config is known.

- [ ] **Step 3: Extend the existing loader**

  Change:

  ```ts
  export function loadConfig(
    configFilePath: string,
    projectConfigPath?: string,
  ): { config: DcpConfig; warnings: string[] };
  ```

  Parse both with the current parser. Deep-merge plain objects, replace arrays, clean unknown properties, and validate the final merged value once. Do not add a general merge dependency.

- [ ] **Step 4: Resolve trusted project config at session start**

  Use:

  ```ts
  const projectConfigPath = ctx.isProjectTrusted()
    ? path.join(ctx.cwd, ".pi", "dcp.json")
    : undefined;
  ```

  Load effective config during `session_start` and retain it in the extension closure. Route warnings through the existing logger/notification behavior.

- [ ] **Step 5: Remove factory-time disablement**

  Remove the extension-factory `if (!config.enabled) return`. Lifecycle listeners and commands must exist long enough for trusted project config to enable DCP.

- [ ] **Step 6: Run config and lifecycle tests**

  ```bash
  pnpm vitest run tests/config.test.ts tests/integration.test.ts
  ```

  Expected: precedence, trust exclusion, cwd resolution, validation, and project-enabled startup pass.

- [ ] **Step 7: Commit trusted project config**

  ```bash
  git add src/config.ts src/index.ts tests/config.test.ts tests/integration.test.ts
  git commit -m "feat: load trusted project dcp config"
  ```

### Task 2: Register tools and commands against live config

**Files:**

- Modify: `src/index.ts`, `src/commands/register.ts`
- Test: `tests/commands-register.test.ts`, `tests/integration.test.ts`

- [ ] **Step 1: Add failing live-config tests**

  Start globally disabled and project enabled, then assert the configured compression mode is registered. Change effective config across `session_start` events and prove command behavior uses the new value instead of the first captured object.

- [ ] **Step 2: Confirm stale registration behavior**

  ```bash
  pnpm vitest run tests/commands-register.test.ts tests/integration.test.ts -t "live config|register"
  ```

  Expected: FAIL because the compression tool or command closures capture factory-time config.

- [ ] **Step 3: Register the compression tool after config load**

  Register the mode-specific `compress` tool from `session_start` after effective config is known. Pi’s installed API refreshes the active tool registry when `registerTool()` is called after the extension factory.

  Keep the execute closure reading the current `config` variable. When effective config is disabled, keep lifecycle and commands active but skip DCP pipeline transformations and compression execution.

- [ ] **Step 4: Change command registration to a getter**

  Extend the Phase 4 signature:

  ```ts
  registerDcpCommands(
    pi: ExtensionAPI,
    state: SessionState,
    getConfig: () => DcpConfig,
    onStateChange: () => void,
  ): void;
  ```

  Call `getConfig()` inside sweep, manual, permission, context, and compression handlers. Preserve the Phase 4 `onStateChange()` calls after successful durable mutations.

- [ ] **Step 5: Run registration tests**

  ```bash
  pnpm vitest run tests/commands-register.test.ts tests/integration.test.ts
  ```

  Expected: startup enable/disable, mode-specific tool registration, and current-config command behavior pass without duplicate observable handlers.

- [ ] **Step 6: Commit live config use**

  ```bash
  git add src/index.ts src/commands/register.ts tests/commands-register.test.ts tests/integration.test.ts
  git commit -m "fix: read current config in tools and commands"
  ```

### Task 3: Add `/dcp:compress [focus]`

**Files:**

- Create: `src/commands/compress.ts`
- Modify: `src/commands/register.ts`
- Create: `tests/commands-compress.test.ts`
- Test: `tests/integration.test.ts`

- [ ] **Step 1: Add failing command tests**

  Cover:

  - empty args send a generic hidden trigger;
  - nonempty args include the trimmed focus;
  - permission `deny` sends nothing;
  - idle execution uses a triggered follow-up turn;
  - streaming execution queues the same follow-up;
  - the command does not mutate durable state.

- [ ] **Step 2: Confirm the command is absent**

  ```bash
  pnpm vitest run tests/commands-compress.test.ts tests/integration.test.ts -t "dcp:compress|compression triggered"
  ```

  Expected: FAIL because the command and trigger message do not exist.

- [ ] **Step 3: Implement the minimum command**

  In `src/commands/compress.ts`:

  ```ts
  export function compressCommand(
    pi: ExtensionAPI,
    state: SessionState,
    args: string,
  ): string {
    if ((state.compressPermission ?? "allow") === "deny") {
      return "Compression is denied by configuration.";
    }

    const focus = args.trim();
    pi.sendMessage(
      {
        customType: "dcp-compress-trigger",
        content: focus
          ? `Compress stale context now, focusing on: ${focus}`
          : "Compress stale context now using the compress tool.",
        display: false,
      },
      { triggerTurn: true, deliverAs: "followUp" },
    );
    return "Compression triggered.";
  }
  ```

  Register it as `dcp:compress`. Permission denial returns before `sendMessage()`.

- [ ] **Step 4: Run command tests**

  ```bash
  pnpm vitest run tests/commands-compress.test.ts tests/integration.test.ts
  ```

  Expected: focus, empty, denied, idle, and streaming cases pass with the exact Pi message options.

- [ ] **Step 5: Commit manual compression**

  ```bash
  git add src/commands/compress.ts src/commands/register.ts tests/commands-compress.test.ts tests/integration.test.ts
  git commit -m "feat: add manual compression trigger"
  ```

### Task 4: Add deterministic informational benchmarks

**Files:**

- Create: `scripts/benchmark.ts`, `tests/benchmark.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add failing correctness tests**

  Import deterministic fixture runners and assert:

  - repeated stale tool output reduces estimated tokens;
  - protected tools remain;
  - failed-result text remains;
  - no orphan `toolResult` remains;
  - restored nested blocks retain active/parent/consumed relationships.

  Do not assert elapsed milliseconds in Vitest.

- [ ] **Step 2: Confirm benchmark helpers are absent**

  ```bash
  pnpm vitest run tests/benchmark.test.ts
  ```

  Expected: FAIL because the benchmark module does not exist.

- [ ] **Step 3: Implement three fixed workloads**

  In `scripts/benchmark.ts`, create:

  1. 2,000 clean messages;
  2. 2,000 repeated tool pairs including stale errors;
  3. restored state with 100 active/nested blocks.

  Use deterministic timestamps, IDs, text, and config. Run 30 iterations with `performance.now()`. Emit one JSON object containing workload name, median/p95 milliseconds, input/output estimated tokens, and token reduction.

  Reuse production pipeline helpers and the existing estimator. Do not add a benchmark framework.

- [ ] **Step 4: Add the package command**

  In `package.json`:

  ```json
  "benchmark": "tsx scripts/benchmark.ts"
  ```

- [ ] **Step 5: Run correctness and smoke checks**

  ```bash
  pnpm vitest run tests/benchmark.test.ts
  pnpm run benchmark
  ```

  Expected: correctness assertions pass and stdout is valid JSON containing all three workloads and all required metrics.

- [ ] **Step 6: Commit benchmark evidence**

  ```bash
  git add scripts/benchmark.ts tests/benchmark.test.ts package.json
  git commit -m "test: add deterministic dcp benchmarks"
  ```

### Task 5: Finish operator and release documentation

**Files:**

- Modify: `README.md`, `CHANGELOG.md`, `dcp.schema.json`
- Modify: `docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md`

- [ ] **Step 1: Document the complete operator contract**

  Cover:

  - global and trusted project paths;
  - precedence, recursive object merge, and array replacement;
  - untrusted-project exclusion;
  - top-level and legacy turn protection;
  - `/dcp:compress [focus]` and permission denial;
  - native session snapshot/recovery and lifetime totals;
  - benchmark invocation and informational interpretation;
  - legacy sidecars being ignored but not deleted.

- [ ] **Step 2: Regenerate and verify schema**

  ```bash
  pnpm run generate:schema
  git diff --exit-code -- dcp.schema.json
  ```

  Expected: regeneration is clean after the intended Phase 2 schema field is present; no undocumented configuration appears.

- [ ] **Step 3: Run focused Phase 5 verification**

  ```bash
  pnpm vitest run tests/config.test.ts tests/commands-register.test.ts tests/commands-compress.test.ts tests/integration.test.ts tests/benchmark.test.ts tests/commands-lifetime.test.ts
  pnpm run benchmark
  ```

  Expected: trusted config, live handlers, manual trigger, lifecycle integration, benchmark correctness, and lifetime reporting pass; benchmark emits valid JSON.

- [ ] **Step 4: Run full release verification**

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

  Expected: all tests and typechecking pass; lint adds no diagnostics above the recorded baseline; schema regeneration is stable; benchmark JSON contains every workload; package dry-run succeeds; the source roadmap remains unchanged.

- [ ] **Step 5: Prove the complete release behavior**

  In a trusted project with global DCP disabled and project DCP enabled:

  1. confirm the configured compression mode is registered;
  2. run `/dcp:compress database migrations`;
  3. observe the hidden follow-up trigger and resulting compression;
  4. resume the session and verify the block persists;
  5. run lifetime reporting and confirm the owning session is counted once;
  6. run the benchmark command and retain its JSON with release evidence.

- [ ] **Step 6: Mark Phase 5 complete and commit**

  Update only Phase 5’s status after every acceptance criterion passes:

  ```bash
  git add README.md CHANGELOG.md dcp.schema.json docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md
  git commit -m "docs: complete dcp reliability roadmap"
  ```

## Acceptance Criteria

- Trusted project config uses `ctx.cwd`, follows documented precedence, and cannot load when the project is untrusted.
- Tools and commands consume current effective config; project config can enable a globally disabled extension.
- `/dcp:compress [focus]` uses Pi’s hidden follow-up message API and honors permission denial.
- New command mutations reuse Phase 4 persistence behavior.
- Benchmark fixtures are deterministic, test behavior rather than wall-clock thresholds, and emit complete JSON metrics.
- README, schema, changelog, package contents, and runtime behavior agree.
- Focused and full verification pass.
- The original reliability roadmap remains unchanged.
- All five phases are independently releasable and the parent index can be marked complete.

## Final Handoff

The reliability roadmap is complete when:

- all five phase statuses are `complete`;
- each phase’s acceptance criteria and full checks passed on its release commit;
- no legacy sidecar is used for runtime restoration;
- no runtime dependency was added;
- provenance rules remain satisfied;
- benchmark output and release verification are retained with the release record.

## Release Record

- Status: not started
- Release commit or tag: not recorded
- Verification date: not recorded
