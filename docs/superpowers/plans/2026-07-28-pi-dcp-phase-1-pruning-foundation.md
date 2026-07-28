# Pi DCP Phase 1 Pruning Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish provenance and verification baselines, preserve failed-tool diagnostics while purging failed inputs, and enable lookup-output deduplication by default.

**Architecture:** Keep the current pipeline and sidecar unchanged in this phase. Split successful-output pruning from failed-input pruning, and narrow the built-in protected-tool list to mutation and orchestration tools.

**Tech Stack:** TypeScript ESM, Vitest, pnpm, existing character-based token estimator, and current Pi message types.

---

## Source and Boundaries

- Source roadmap: Tasks 1 and 4 in [2026-07-28-pi-dcp-reliability-roadmap.md](2026-07-28-pi-dcp-reliability-roadmap.md).
- Entry baseline: tag `v0.4.1` or commit `bfeeff0`, plus the planning commits.
- This phase does not add top-level turn protection, change compression blocks, replace persistence, add project config, or add manual compression.

## Stable Outcome

After this phase:

- Historical failed assistant arguments are replaced with a small marker object.
- Original failed `toolResult` diagnostics remain available to the model.
- Successful pruned outputs retain the existing output marker.
- `read`, `grep`, `find`, `ls`, and `bash` calls are eligible for deduplication.
- `compress`, `write`, `edit`, and `subagent` remain protected by default.
- Provenance and verification facts are recorded without copying AGPL source.

### Task 1: Record provenance and verification baselines

**Files:**

- Create: `docs/superpowers/audits/2026-07-28-pi-dcp-provenance.md`

- [ ] **Step 1: Create the provenance document**

  Write:

  ```markdown
  # Pi DCP Provenance Audit

  Date: 2026-07-28

  | Repository | Commit | Version | License | Use in this project |
  | --- | --- | --- | --- | --- |
  | `pi-vault/pi-dcp` | `bfeeff0` baseline | 0.4.1 | MIT | Current implementation |
  | `earendil-works/pi` checkout | `8eef62ed` | coding-agent 0.82.0; installed API 0.80.3 | MIT | Pi lifecycle and extension API reference |
  | `opencode-dynamic-context-pruning` | `85b6f5c` | 3.1.14 | AGPL-3.0-or-later | Behavioral comparison only |
  | `Davidcreador/pi-dcp` | `7ae24be9` | 0.2.0 | AGPL-3.0-or-later | Behavioral comparison only |
  | `complexthings/pi-dynamic-context-pruning` | `75e04cb` | 1.0.7 | No license file or package declaration found | Behavioral comparison only |

  ## Rules

  - Do not copy source from the AGPL repositories into the MIT package.
  - Record behavior and public interfaces in original words.
  - Treat Pi core as the authority for extension lifecycle, session, message, and tool APIs.
  - Verify `appendEntry`, `getBranch`, `getSessionId`, `session_tree`, `sendMessage`, `ctx.cwd`, and project trust against the installed Pi 0.80.3 types before implementation.

  ## Verification Baseline

  - Tests: 368 passing at audit time.
  - Typecheck: passing at audit time.
  - Lint: command succeeds with 88 existing warnings.
  - Comparison suites were not executed because their local runtime dependencies were absent.
  ```

- [ ] **Step 2: Verify the source facts**

  Run:

  ```bash
  sed -n '1,35p' LICENSE
  sed -n '1,70p' package.json
  git log -1 --oneline
  ```

  Expected: MIT license, package version 0.4.1, and the current planning branch commit.

- [ ] **Step 3: Capture a fresh local verification baseline**

  Run:

  ```bash
  pnpm test
  pnpm typecheck
  pnpm lint
  git diff --check
  ```

  Expected: tests and typecheck pass; lint exits successfully. If counts differ from the audit-time values, update only the “Verification Baseline” values with the observed output.

- [ ] **Step 4: Commit the provenance record**

  ```bash
  git add docs/superpowers/audits/2026-07-28-pi-dcp-provenance.md
  git commit -m "docs: record pi-dcp provenance baseline"
  ```

### Task 2: Preserve failed results and purge failed inputs

**Files:**

- Modify: `src/messages/prune.ts`
- Test: `tests/prune.test.ts`, `tests/pipeline.test.ts`

- [ ] **Step 1: Add a failing failed-input regression**

  Add to `tests/prune.test.ts`:

  ```ts
  import type { AgentMessage } from "@earendil-works/pi-agent-core";
  import { applyPruning } from "../src/messages/prune.ts";
  import { createSessionState } from "../src/state/state.ts";

  it("purges failed arguments while preserving the diagnostic result", () => {
    const state = createSessionState();
    state.prune.tools.set("failed-1", 40);
    state.toolParameters.set("failed-1", {
      tool: "bash",
      parameters: { command: "very long invalid command" },
      status: "error",
      error: "command not found",
      turn: 0,
      tokenCount: 40,
      assistantIndex: 0,
      resultIndex: 1,
    });
    const originalErrorContent = [
      { type: "text" as const, text: "bash: command not found" },
    ];
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "failed-1",
            name: "bash",
            arguments: { command: "very long invalid command" },
          },
        ],
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId: "failed-1",
        toolName: "bash",
        content: originalErrorContent,
        isError: true,
        timestamp: 2,
      },
    ] as unknown as AgentMessage[];

    const result = applyPruning(state, messages);
    const assistant = result[0] as Extract<AgentMessage, { role: "assistant" }>;
    const toolCall = assistant.content.find((part) => part.type === "toolCall");
    const errorResult = result[1] as Extract<
      AgentMessage,
      { role: "toolResult" }
    >;

    expect(toolCall?.arguments).toEqual({
      __purged: "input removed due to failed tool call",
    });
    expect(errorResult.content).toEqual(originalErrorContent);
  });
  ```

- [ ] **Step 2: Run the regression and confirm the old behavior**

  ```bash
  pnpm vitest run tests/prune.test.ts -t "purges failed arguments"
  ```

  Expected: FAIL because the assistant arguments are unchanged and the error result is replaced.

- [ ] **Step 3: Replace error-result pruning with failed-input pruning**

  In `src/messages/prune.ts`, replace `PRUNED_ERROR_INPUT_TEXT` and `pruneToolErrors()` with:

  ```ts
  const PURGED_ERROR_INPUT = "input removed due to failed tool call";

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
        return {
          ...part,
          arguments: { __purged: PURGED_ERROR_INPUT },
        };
      });

      return changed ? { ...message, content } : message;
    });
  }
  ```

  Change `applyPruning()` to:

  ```ts
  export function applyPruning(
    state: SessionState,
    messages: AgentMessage[],
  ): AgentMessage[] {
    let result = filterCompressedRanges(state, messages);
    result = pruneToolOutputs(state, result);
    result = pruneFailedInputs(state, result);
    return result;
  }
  ```

- [ ] **Step 4: Update the existing error assertion**

  In `tests/pipeline.test.ts`, replace the assertion expecting error-result placeholder content with assertions that the assistant tool-call arguments contain `__purged` and the original result text remains unchanged.

- [ ] **Step 5: Run focused pruning tests**

  ```bash
  pnpm vitest run tests/prune.test.ts tests/pipeline.test.ts
  ```

  Expected: all pruning and pipeline tests pass.

- [ ] **Step 6: Commit failed-input pruning**

  ```bash
  git add src/messages/prune.ts tests/prune.test.ts tests/pipeline.test.ts
  git commit -m "fix: preserve failed tool diagnostics"
  ```

### Task 3: Narrow the built-in protected-tool policy

**Files:**

- Modify: `src/config.ts`
- Test: `tests/strategy-runner.test.ts`

- [ ] **Step 1: Add failing protected-tool policy tests**

  Add to `tests/strategy-runner.test.ts`:

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

  it.each(["read", "grep", "find", "ls", "bash"])(
    "allows repeated %s output to deduplicate",
    (tool) => {
      const state = createSessionState();
      state.currentTurn = 10;
      seedToolCache(state, [
        {
          id: `${tool}-1`,
          tool,
          parameters: { path: "same" },
          status: "completed",
          turn: 1,
          tokenCount: 20,
        },
        {
          id: `${tool}-2`,
          tool,
          parameters: { path: "same" },
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
  ```

- [ ] **Step 2: Run the policy tests**

  ```bash
  pnpm vitest run tests/strategy-runner.test.ts -t "protects mutation|allows repeated"
  ```

  Expected: FAIL because lookup and shell tools are currently protected.

- [ ] **Step 3: Replace the default list**

  In `src/config.ts`, set:

  ```ts
  export const BASE_PROTECTED_TOOLS = [
    "compress",
    "write",
    "edit",
    "subagent",
  ];
  ```

  Keep user-configured protected tools additive.

- [ ] **Step 4: Run the strategy suite**

  ```bash
  pnpm vitest run tests/strategy-runner.test.ts
  ```

  Expected: all strategy tests pass.

- [ ] **Step 5: Commit the policy change**

  ```bash
  git add src/config.ts tests/strategy-runner.test.ts
  git commit -m "fix: enable lookup output deduplication"
  ```

### Task 4: Document and release the pruning foundation

**Files:**

- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Update pruning documentation**

  In the README strategy section, state:

  ```markdown
  DCP keeps failed tool diagnostics and removes only the failed call's historical
  arguments after the configured age. Repeated `read`, `grep`, `find`, `ls`, and
  `bash` outputs may be deduplicated. `compress`, `write`, `edit`, and `subagent`
  remain protected by default; configured protected-tool patterns are additive.
  ```

- [ ] **Step 2: Add release notes**

  Add a new top entry to `CHANGELOG.md`:

  ```markdown
  ## 2026-07-28 — Pruning foundation

  - Preserve failed tool diagnostics while removing stale failed inputs.
  - Allow lookup and shell outputs to participate in deduplication.
  - Protect compression, file mutations, and sub-agent results by default.
  - Record source provenance and the verification baseline.
  ```

- [ ] **Step 3: Run focused and full verification**

  ```bash
  pnpm vitest run tests/prune.test.ts tests/pipeline.test.ts tests/strategy-runner.test.ts
  pnpm test
  pnpm typecheck
  pnpm lint
  pnpm pack --dry-run
  git diff --check
  git diff --exit-code HEAD -- docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md
  ```

  Expected: all tests and typecheck pass; lint adds no diagnostics beyond the recorded baseline; package dry-run succeeds; the original roadmap is unchanged.

- [ ] **Step 4: Commit phase documentation**

  ```bash
  git add README.md CHANGELOG.md
  git commit -m "docs: describe pruning foundation behavior"
  ```

## Acceptance Criteria

- Failed tool-call arguments are replaced by `{ __purged: "input removed due to failed tool call" }`.
- Failed `toolResult` content is unchanged.
- Successful pruned results retain the existing output marker.
- Repeated lookup and shell tools deduplicate.
- `compress`, `write`, `edit`, and `subagent` are protected by default.
- Configured protected tools remain additive.
- Provenance facts and baseline checks are committed.
- README and changelog describe the released behavior.
- Focused and full verification pass without relying on Phase 2–5 code.

## Handoff to Phase 2

Phase 2 may rely on:

- `pruneFailedInputs()` as the only failed-call transformation.
- `pruneToolOutputs()` as the successful-output transformation.
- `BASE_PROTECTED_TOOLS` containing only `compress`, `write`, `edit`, and `subagent`.
- The provenance and lint/test baselines recorded by this phase.

## Release Record

- Status: not started
- Release commit or tag: not recorded
- Verification date: not recorded
