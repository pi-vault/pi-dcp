# Pi DCP Phase 1 Pruning Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve failed-tool diagnostics while purging stale failed inputs, make lookup and shell output pruning effective by default, and record a trustworthy provenance and verification baseline.

**Architecture:** Retain the existing `syncToolCache → runStrategies → applyPruning` pipeline, shared `state.prune.tools` map, sidecar persistence, and configuration shape. Successful calls continue to use output replacement; failed calls use a separate assistant-argument transformation selected by cached error status. Error savings are estimated from the arguments actually removed.

**Tech Stack:** TypeScript ESM, Vitest, pnpm, TypeBox-generated schema, existing character-based token estimator, and Pi 0.80.3-compatible message types.

---

## Source and Boundaries

- Source roadmap: Tasks 1 and 4 in [2026-07-28-pi-dcp-reliability-roadmap.md](2026-07-28-pi-dcp-reliability-roadmap.md).
- Entry commit: `e68c236`; package baseline `v0.4.1` at `bfeeff0`.
- This plan supersedes the prior Phase 1 plan; leave the broader roadmap byte-for-byte unchanged.
- This phase does not add top-level turn protection, change compression blocks, replace persistence, add project config, add manual compression, or bump/tag/publish a package release.

## Stable Outcome

After this phase:

- A stale eligible failed call becomes `{ __purged: "input removed due to failed tool call" }` in the assistant tool-call arguments.
- The matching failed `toolResult` object and content remain unchanged.
- Successful pruned results retain the existing output marker.
- `read`, `grep`, `find`, `ls`, and `bash` calls may participate in deduplication, stale-error purging, and sweep.
- `compress`, `write`, `edit`, and `subagent` remain protected by default; configured protected patterns are additive.
- Reported error-pruning savings count only removed arguments.
- Provenance, schema wording, README behavior, and an Unreleased changelog entry describe the result without copying external source.

## Internal Interfaces

- Replace the internal `pruneToolErrors()` export with `pruneFailedInputs()` in `src/messages/prune.ts`.
- Export `PURGED_ERROR_INPUT` and `estimatePurgedInputSavings(parameters)` from `src/strategies/purge-errors.ts` for the pruning pass and strategy accounting.
- Keep `BASE_PROTECTED_TOOLS` exported from `src/config.ts`, with the exact value `['compress', 'write', 'edit', 'subagent']`.
- Do not add configuration fields, serialized state fields, runtime dependencies, or package entry points.

### Task 1: Record provenance and verification baselines

**Files:**

- Create: `docs/superpowers/audits/2026-07-28-pi-dcp-provenance.md`

- [ ] **Step 1: Write the provenance record**

  Record this table and the rules below in the new audit:

  ```markdown
  # Pi DCP Provenance Audit

  Date: 2026-07-28

  | Repository                                 | Commit                                  | Version                                   | License                                | Use in this project                      |
  | ------------------------------------------ | --------------------------------------- | ----------------------------------------- | -------------------------------------- | ---------------------------------------- |
  | `pi-vault/pi-dcp`                          | `e68c236` (`v0.4.1` baseline `bfeeff0`) | 0.4.1                                     | MIT                                    | Current implementation                   |
  | `earendil-works/pi` checkout               | `8eef62ed`                              | coding-agent 0.82.0; installed API 0.80.3 | MIT                                    | Pi lifecycle and extension API reference |
  | `opencode-dynamic-context-pruning`         | `85b6f5c`                               | 3.1.14                                    | AGPL-3.0-or-later                      | Behavioral comparison only               |
  | `Davidcreador/pi-dcp`                      | `7ae24be9`                              | 0.2.0                                     | AGPL-3.0-or-later                      | Behavioral comparison only               |
  | `complexthings/pi-dynamic-context-pruning` | `75e04cb`                               | 1.0.7                                     | No license file or package declaration | Behavioral comparison only               |

  ## Rules

  - Do not copy source from the AGPL or unlicensed repositories into the MIT package.
  - Record behavior and public interfaces in original words.
  - Treat Pi core as the authority for extension lifecycle, session, message, and tool APIs.
  - Verify `appendEntry`, `getBranch`, `getSessionId`, `session_tree`, `sendMessage`, `ctx.cwd`, and project trust against the installed Pi 0.80.3 types before later phases use them.

  ## Verification Baseline

  - Tests: 368 passing.
  - Typecheck: passing.
  - Lint: exits successfully with 88 warnings and 1 info.
  - Package dry-run: passing.
  - Local runtime: Node 23.11.0, below the package requirement of Node >=24.15.0; Node 24 CI is the merge gate.
  - Comparison suites: not executed because their local runtime dependencies were absent.
  ```

- [ ] **Step 2: Verify the source facts**

  Run:

  ```bash
  sed -n '1,35p' LICENSE
  sed -n '1,70p' package.json
  git log -1 --oneline
  node --version
  ```

  Expected: MIT license, package version 0.4.1, current commit `e68c236`, and the local runtime recorded above.

- [ ] **Step 3: Capture the baseline checks**

  Run:

  ```bash
  pnpm test
  pnpm typecheck
  pnpm lint
  pnpm pack --dry-run
  git diff --check
  ```

  Expected: 368 tests pass, typecheck passes, lint exits with the recorded diagnostics, package dry-run succeeds, and no whitespace errors are reported. Update only observed baseline values if they differ.

- [ ] **Step 4: Commit the provenance record**

  ```bash
  git add docs/superpowers/audits/2026-07-28-pi-dcp-provenance.md
  git commit -m "docs: record pi-dcp provenance baseline"
  ```

### Task 2: Preserve failed results and purge failed inputs

**Files:**

- Modify: `src/messages/prune.ts`, `src/strategies/purge-errors.ts`, `src/strategies/runner.ts`
- Modify wording: `src/index.ts`, `src/commands/context.ts`
- Test: `tests/prune.test.ts`, `tests/pipeline.test.ts`, `tests/strategy-runner.test.ts`

- [ ] **Step 1: Replace obsolete unit assertions with a failing argument-purge test**

  Remove the `pruneToolErrors` tests and add a test that seeds an error entry and asserts the assistant argument marker while retaining the same result object/content:

  ```ts
  import type { AgentMessage } from "@earendil-works/pi-agent-core";
  import { applyPruning } from "../src/messages/prune.ts";
  import { createSessionState } from "../src/state/state.ts";
  import { makeToolResultMessage } from "./helpers.ts";

  function makeAssistantWithToolCall(
    id: string,
    name: string,
    arguments_: Record<string, unknown>,
  ): AgentMessage {
    return {
      role: "assistant",
      content: [{ type: "toolCall", id, name, arguments: arguments_ }],
      stopReason: "toolUse",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        totalTokens: 0,
      },
      timestamp: 1,
    } as unknown as AgentMessage;
  }

  it("purges failed arguments while preserving the diagnostic result", () => {
    const state = createSessionState();
    state.prune.tools.set("failed-1", 40);
    state.toolParameters.set("failed-1", {
      tool: "custom_tool",
      parameters: { command: "very long invalid command" },
      status: "error",
      error: "command not found",
      turn: 0,
      tokenCount: 40,
      assistantIndex: 0,
      resultIndex: 1,
    });
    const errorResult = makeToolResultMessage(
      "failed-1",
      "custom_tool",
      "command not found",
      true,
    );
    const messages = [
      makeAssistantWithToolCall("failed-1", "custom_tool", {
        command: "very long invalid command",
      }),
      errorResult,
    ];

    const result = applyPruning(state, messages);
    const toolCall = (
      result[0] as Extract<AgentMessage, { role: "assistant" }>
    ).content.find((part) => part.type === "toolCall");

    expect(toolCall?.arguments).toEqual({
      __purged: "input removed due to failed tool call",
    });
    expect(result[1]).toBe(errorResult);
    expect(
      (result[1] as Extract<AgentMessage, { role: "toolResult" }>).content,
    ).toEqual(errorResult.content);
  });
  ```

- [ ] **Step 2: Run the unit regression and confirm the old behavior fails**

  ```bash
  pnpm vitest run tests/prune.test.ts -t "purges failed arguments"
  ```

  Expected: FAIL because the current implementation changes failed result content and does not rewrite assistant arguments.

- [ ] **Step 3: Add the argument-savings helper**

  In `src/strategies/purge-errors.ts`, add:

  ```ts
  import { countTokens } from "../utils/tokens.ts";

  export const PURGED_ERROR_INPUT = "input removed due to failed tool call";

  export function estimatePurgedInputSavings(parameters: unknown): number {
    const original = JSON.stringify(parameters);
    const replacement = JSON.stringify({ __purged: PURGED_ERROR_INPUT });
    if (original === undefined || replacement === undefined) return 0;
    return Math.max(0, countTokens(original) - countTokens(replacement));
  }
  ```

- [ ] **Step 4: Implement failed-input pruning and apply it after output pruning**

  In `src/messages/prune.ts`, import `PURGED_ERROR_INPUT`, remove `PRUNED_ERROR_INPUT_TEXT` and `pruneToolErrors()`, and add:

  ```ts
  export function pruneFailedInputs(
    state: SessionState,
    messages: AgentMessage[],
  ): AgentMessage[] {
    if (state.prune.tools.size === 0) return messages;

    const failedIds = new Set(
      [...state.prune.tools.keys()].filter(
        (id) => state.toolParameters.get(id)?.status === "error",
      ),
    );
    if (failedIds.size === 0) return messages;

    return messages.map((message) => {
      if (message.role !== "assistant" || !Array.isArray(message.content)) {
        return message;
      }

      let changed = false;
      const content = message.content.map((part) => {
        if (part.type !== "toolCall" || !failedIds.has(part.id)) return part;
        changed = true;
        return { ...part, arguments: { __purged: PURGED_ERROR_INPUT } };
      });

      return changed ? { ...message, content } : message;
    });
  }
  ```

  Make `applyPruning()` call `pruneToolOutputs()` followed by `pruneFailedInputs()`.

- [ ] **Step 5: Make stale-error accounting match the transformation**

  In the purge-errors loop in `src/strategies/runner.ts`, replace `entry.tokenCount` with `estimatePurgedInputSavings(entry.parameters)` when setting the prune map and accumulating `tokensSaved`. Keep deduplication and sweep result-token accounting unchanged.

  Update the combined strategy fixture and assertion as follows:

  ```ts
  const failedParameters = { command: "x".repeat(400) };
  // Use failedParameters in the seeded error entry.
  expect(result.tokensSaved).toBe(
    100 + estimatePurgedInputSavings(failedParameters),
  );
  ```

- [ ] **Step 6: Add a real pipeline regression**

  In `tests/pipeline.test.ts`, add a fixture containing one user message, one assistant `custom_tool` call with `{ command: "x".repeat(400) }`, and one failed `toolResult`. Run the same messages twice:

  ```ts
  state.currentTurn = 0;
  runPipeline(state, config, messages, undefined);

  state.currentTurn = 4;
  const result = runPipeline(state, config, messages, undefined);
  const assistant = result.messages.find(
    (message): message is Extract<AgentMessage, { role: "assistant" }> =>
      message.role === "assistant",
  );
  const toolCall = assistant?.content.find((part) => part.type === "toolCall");
  const errorResult = result.messages.find(
    (message): message is Extract<AgentMessage, { role: "toolResult" }> =>
      message.role === "toolResult",
  );

  expect(toolCall?.arguments).toEqual({
    __purged: "input removed due to failed tool call",
  });
  expect(errorResult?.content).toEqual([
    { type: "text", text: "command not found" },
  ]);
  expect(result.strategyResult.tokensSaved).toBeGreaterThan(0);
  ```

- [ ] **Step 7: Correct internal labels and run focused tests**

  Change internal log/context labels that say “pruned tool outputs” to “pruned tool calls” or “pruned items.” Run:

  ```bash
  pnpm vitest run tests/prune.test.ts tests/pipeline.test.ts tests/purge-errors.test.ts tests/strategy-runner.test.ts
  pnpm typecheck
  ```

  Expected: all focused tests and typecheck pass.

- [ ] **Step 8: Commit the semantic and accounting fix**

  ```bash
  git add src/messages/prune.ts src/strategies/purge-errors.ts src/strategies/runner.ts src/index.ts src/commands/context.ts tests/prune.test.ts tests/pipeline.test.ts tests/strategy-runner.test.ts
  git commit -m "fix: preserve failed tool diagnostics"
  ```

### Task 3: Narrow the built-in protected-tool policy

**Files:**

- Modify: `src/config.ts`
- Test: `tests/config.test.ts`, `tests/strategy-runner.test.ts`, `tests/commands-sweep.test.ts`

- [ ] **Step 1: Add failing policy tests**

  Add these tests to `tests/strategy-runner.test.ts`:

  ```ts
  import { BASE_PROTECTED_TOOLS } from "../src/config.ts";

  it("protects mutation and orchestration tools by default", () => {
    expect(BASE_PROTECTED_TOOLS).toEqual([
      "compress",
      "write",
      "edit",
      "subagent",
    ]);
  });

  it.each([
    ["read", { path: "same" }],
    ["grep", { pattern: "same" }],
    ["find", { pattern: "same" }],
    ["ls", { path: "same" }],
    ["bash", { command: "same" }],
  ] as const)(
    "allows repeated %s output to deduplicate",
    (tool, parameters) => {
      const state = createSessionState();
      state.currentTurn = 10;
      seedToolCache(state, [
        {
          id: `${tool}-1`,
          tool,
          parameters,
          status: "completed",
          turn: 1,
          tokenCount: 20,
        },
        {
          id: `${tool}-2`,
          tool,
          parameters,
          status: "completed",
          turn: 2,
          tokenCount: 20,
        },
      ]);

      runStrategies(state, makeDefaultConfig());

      expect(state.prune.tools.has(`${tool}-1`)).toBe(true);
      expect(state.prune.tools.has(`${tool}-2`)).toBe(false);
    },
  );

  it("keeps write output protected", () => {
    const state = createSessionState();
    state.currentTurn = 10;
    seedToolCache(state, [
      {
        id: "write-1",
        tool: "write",
        parameters: { path: "same" },
        status: "completed",
        turn: 1,
        tokenCount: 20,
      },
      {
        id: "write-2",
        tool: "write",
        parameters: { path: "same" },
        status: "completed",
        turn: 2,
        tokenCount: 20,
      },
    ]);

    runStrategies(state, makeDefaultConfig());

    expect(state.prune.tools.size).toBe(0);
  });
  ```

- [ ] **Step 2: Update the existing conflicting test**

  Change the current `skips protected tools (BASE_PROTECTED_TOOLS)` fixture from `bash` to `write`; its expected result remains zero.

- [ ] **Step 3: Replace the default list**

  In `src/config.ts`, set:

  ```ts
  export const BASE_PROTECTED_TOOLS = ["compress", "write", "edit", "subagent"];
  ```

  Preserve the existing additive merges for user-configured protected tools.

- [ ] **Step 4: Cover sweep behavior and run the strategy suite**

  Add this sweep regression to `tests/commands-sweep.test.ts`:

  ```ts
  it("sweeps lookup and shell results but protects mutations", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.toolParameters.set("bash-1", {
      tool: "bash",
      parameters: { command: "same" },
      status: "completed",
      error: undefined,
      turn: 1,
      tokenCount: 20,
      assistantIndex: undefined,
      resultIndex: undefined,
    });
    state.toolParameters.set("write-1", {
      tool: "write",
      parameters: { path: "same" },
      status: "completed",
      error: undefined,
      turn: 1,
      tokenCount: 20,
      assistantIndex: undefined,
      resultIndex: undefined,
    });

    sweepCommand(state, config);

    expect(state.prune.tools.has("bash-1")).toBe(true);
    expect(state.prune.tools.has("write-1")).toBe(false);
  });
  ```

  Run:

  ```bash
  pnpm vitest run tests/config.test.ts tests/strategy-runner.test.ts tests/commands-sweep.test.ts
  pnpm typecheck
  ```

  Expected: all policy tests and typecheck pass.

- [ ] **Step 5: Commit the policy change**

  ```bash
  git add src/config.ts tests/config.test.ts tests/strategy-runner.test.ts tests/commands-sweep.test.ts
  git commit -m "fix: enable lookup output pruning"
  ```

### Task 4: Correct public documentation and schema wording

**Files:**

- Modify: `README.md`, `CHANGELOG.md`, `src/config-schema.ts`
- Regenerate: `dcp.schema.json`

- [ ] **Step 1: Update README behavior and configuration wording**

  Replace the overview and workflow wording with:

  ```markdown
  - **Prunes automatically** — deduplicates repeated tool outputs and purges stale failed tool inputs while preserving diagnostics.

  **Default:** install it and let DCP prune duplicates and stale failed inputs automatically.
  ```

  Replace the `purgeErrors` configuration descriptions with:

  ```markdown
  - `purgeErrors.enabled` — enable or disable stale failed-input purging.
  - `purgeErrors.turns` — age threshold for failed tool-input purging.
  - `purgeErrors.protectedTools` — tool names excluded from failed-input purging.
  ```

  Add this paragraph below the strategy configuration bullets:

  ```markdown
  DCP preserves failed tool diagnostics and purges only the historical arguments of eligible stale failures. Repeated `read`, `grep`, `find`, `ls`, and `bash` calls may be deduplicated or swept. `compress`, `write`, `edit`, and `subagent` remain protected by default; configured protected-tool patterns are additive.
  ```

- [ ] **Step 2: Update schema descriptions and regenerate the shipped schema**

  Change the purge-errors descriptions in `src/config-schema.ts` to refer to failed tool inputs, then run:

  ```bash
  pnpm run generate:schema
  ```

  Confirm the generated `dcp.schema.json` contains the same wording and a second generation produces no diff.

- [ ] **Step 3: Add merge-ready changelog notes**

  Add this section at the top of `CHANGELOG.md`, without changing the package version:

  ```markdown
  ## [Unreleased]

  ### Fixed

  - Preserve failed tool diagnostics while removing stale failed inputs.
  - Allow lookup and shell outputs to participate in pruning.
  - Keep compression, file mutations, and sub-agent results protected by default.
  - Record source provenance and the verification baseline.
  ```

- [ ] **Step 4: Run final verification and commit documentation**

  ```bash
  pnpm vitest run tests/prune.test.ts tests/pipeline.test.ts tests/strategy-runner.test.ts tests/config.test.ts
  pnpm test
  pnpm typecheck
  pnpm lint
  pnpm pack --dry-run
  pnpm run generate:schema
  git diff --check
  git diff --exit-code e68c236 -- docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md
  ```

  Expected: all tests pass, typecheck succeeds, lint adds no diagnostics beyond 88 warnings and 1 info, package dry-run succeeds, schema generation is stable, whitespace checks pass, and the source roadmap is unchanged. Node 24 CI must also pass before merge.

  ```bash
  git add README.md CHANGELOG.md src/config-schema.ts dcp.schema.json
  git commit -m "docs: describe pruning foundation behavior"
  ```

## Acceptance Criteria

- Failed tool-call arguments are replaced by `{ __purged: "input removed due to failed tool call" }` only for marked error calls.
- Failed `toolResult` objects and content remain unchanged.
- Successful pruned results retain the existing output marker.
- Error savings reflect removed arguments, not preserved result content.
- Repeated lookup and shell tools can deduplicate and sweep.
- `compress`, `write`, `edit`, and `subagent` are protected by default.
- Configured protected tools remain additive.
- Provenance, README, schema, and changelog describe the new semantics.
- Focused and full verification pass without relying on Phase 2–5 code.
- The phase is merge-ready but not versioned, tagged, or published.

## Handoff to Phase 2

Phase 2 may rely on:

- `pruneFailedInputs()` as the only failed-call transformation.
- `pruneToolOutputs()` as the successful-output transformation.
- `BASE_PROTECTED_TOOLS` containing only `compress`, `write`, `edit`, and `subagent`.
- Argument-based stale-error token accounting.
- The provenance, test, typecheck, lint, and schema baselines recorded by this phase.

## Release Record

- Status: not started
- Release commit or tag: not applicable; Phase 1 ends merge-ready
- Verification date: not recorded
