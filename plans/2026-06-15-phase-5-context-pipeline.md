# Phase 5: Extract the Context Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the 8-step context processing pipeline from the `context` event handler in `src/index.ts` into a pure function `runPipeline` in `src/pipeline.ts`. The context handler collapses to ~12 lines of wiring. The pipeline becomes directly testable without mocking the Pi extension API.

**Architecture:** `runPipeline(state, config, messages, contextUsage)` is a pure function that takes state + config + messages + usage, runs the full transformation sequence, and returns `{ messages, strategyResult }`. State is mutated as a side effect (tool cache, prune marks, stats). Logging stays in `index.ts` (observability is a wiring concern) — the handler uses the returned `strategyResult` to log. UI status updates stay in `index.ts`.

**Tech Stack:** TypeScript (strict mode), vitest, biome (lint)

**Behavior change:** None. Same message transformations, same ordering.

**Prerequisite:** Phase 4 complete (all earlier phases provide clean imports the pipeline uses).

---

## File Map

| Action | File                        | Responsibility                                         |
| ------ | --------------------------- | ------------------------------------------------------ |
| Create | `src/pipeline.ts`           | `runPipeline` function — the full DCP context pipeline |
| Modify | `src/index.ts`              | Context handler calls `runPipeline`, keeps only wiring |
| Create | `tests/pipeline.test.ts`    | Direct pipeline tests (no Pi mock)                     |
| Keep   | `tests/integration.test.ts` | Wiring smoke tests (verify events reach pipeline)      |

---

### Task 1: Write failing tests for runPipeline

**Files:**

- Create: `tests/pipeline.test.ts`

- [ ] **Step 1: Write the pipeline test file**

```typescript
import { describe, it, expect } from "vitest";
import { runPipeline, type PipelineResult } from "../src/pipeline.ts";
import { createSessionState } from "../src/state/state.ts";
import {
  makeDefaultConfig,
  makeUserMessage,
  makeAssistantMessage,
} from "./helpers.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ContextUsage } from "../src/state/types.ts";

describe("runPipeline", () => {
  it("returns messages unchanged when no pruning applies", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [
      makeUserMessage("Hello"),
      makeAssistantMessage("Hi there"),
    ];

    const result = runPipeline(state, config, messages, undefined);

    // Messages should still be present (message IDs injected but content preserved)
    expect(result.messages.length).toBe(2);
  });

  it("strips hallucinated DCP tags from assistant messages", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [
      makeUserMessage("Hello"),
      makeAssistantMessage(
        'Response <dcp-message-id ref="m0001" /> with hallucination',
      ),
    ];

    const result = runPipeline(state, config, messages, undefined);

    const assistantContent = result.messages[1].content as Array<{
      type: string;
      text: string;
    }>;
    const text = assistantContent[0].text;
    expect(text).not.toContain("<dcp-message-id");
  });

  it("injects message IDs into user messages", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [
      makeUserMessage("Hello"),
      makeAssistantMessage("Hi"),
      makeUserMessage("How are you?"),
    ];

    const result = runPipeline(state, config, messages, undefined);

    // User messages should have message ID tags injected
    const firstUser = result.messages[0].content as Array<{
      type: string;
      text: string;
    }>;
    expect(firstUser[0].text).toContain("<dcp-message-id");
  });

  it("deduplicates tool outputs across turns", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 5;

    // Simulate tool results already tracked in state
    state.toolParameters.set("call-1", {
      tool: "read_file",
      parameters: { path: "/a.ts" },
      status: "completed",
      error: undefined,
      turn: 1,
      tokenCount: 100,
    });
    state.toolParameters.set("call-2", {
      tool: "read_file",
      parameters: { path: "/a.ts" },
      status: "completed",
      error: undefined,
      turn: 2,
      tokenCount: 100,
    });
    state.toolIdList = ["call-1", "call-2"];

    const messages: AgentMessage[] = [
      makeUserMessage("Read the file"),
      makeAssistantMessage("Here it is"),
    ];

    runPipeline(state, config, messages, undefined);

    // Deduplication should have pruned the older duplicate
    expect(state.prune.tools.has("call-1")).toBe(true);
    expect(state.prune.tools.has("call-2")).toBe(false);
  });

  it("injects compress nudges when context usage is high", () => {
    const state = createSessionState();
    // Default maxContextPercent is 80 — usage.percent of 80 triggers the nudge
    const config = makeDefaultConfig();

    const messages: AgentMessage[] = [
      makeUserMessage("Hello"),
      makeAssistantMessage("Hi"),
      makeUserMessage("Do something"),
    ];

    const usage: ContextUsage = {
      tokens: 80000,
      contextWindow: 100000,
      percent: 80,
    };

    const result = runPipeline(state, config, messages, usage);

    // Should have injected a nudge into the last user message
    const lastUser = result.messages[result.messages.length - 1]
      .content as Array<{ type: string; text: string }>;
    expect(lastUser[0].text).toContain("<dcp-system-reminder>");
  });

  it("syncs compression blocks before processing", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    // Simulate an active block pointing beyond new message count
    state.prune.messages.activeByAnchorIndex.set(10, 1);
    state.prune.messages.activeBlockIds.add(1);
    state.prune.messages.blocksById.set(1, {
      blockId: 1,
      runId: 1,
      active: true,
      deactivatedByUser: false,
      compressedTokens: 0,
      summaryTokens: 10,
      durationMs: 0,
      mode: "range",
      topic: "test",
      batchTopic: undefined,
      startIndex: 8,
      endIndex: 10,
      anchorIndex: 10,
      compressMessageIndex: 11,
      includedBlockIds: [],
      consumedBlockIds: [],
      parentBlockIds: [],
      directMessageIndices: [8, 9, 10],
      directToolIds: [],
      effectiveMessageIndices: [8, 9, 10],
      effectiveToolIds: [],
      createdAt: Date.now(),
      deactivatedAt: undefined,
      deactivatedByBlockId: undefined,
      summary: "[Compressed Block b1]\ntest\n[End Block b1]",
    });

    const messages: AgentMessage[] = [
      makeUserMessage("Hello"),
      makeAssistantMessage("Hi"),
    ];

    // Should not throw — sync handles stale blocks gracefully
    const result = runPipeline(state, config, messages, undefined);
    expect(result.messages.length).toBe(2);
  });

  it("is a pure function of its inputs (no Pi mock needed)", () => {
    const state1 = createSessionState();
    const state2 = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [
      makeUserMessage("Hello"),
      makeAssistantMessage("Hi"),
    ];

    const result1 = runPipeline(state1, config, messages, undefined);
    const result2 = runPipeline(state2, config, messages, undefined);

    // Same inputs produce same outputs
    expect(result1.messages.length).toBe(result2.messages.length);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/pipeline.test.ts`
Expected: FAIL — module `../src/pipeline.ts` does not exist

---

### Task 2: Implement runPipeline

**Files:**

- Create: `src/pipeline.ts`

- [ ] **Step 1: Write the pipeline module**

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState, ContextUsage } from "./state/types.ts";
import type { DcpConfig } from "./config.ts";
import { syncCompressionBlocks } from "./messages/sync.ts";
import { stripHallucinations } from "./messages/strip.ts";
import { syncToolCache, buildToolIdList } from "./state/tool-cache.ts";
import { runStrategies, type StrategyResult } from "./strategies/runner.ts";
import {
  assignMessageRefs,
  injectCompressNudges,
  injectMessageIds,
} from "./messages/inject.ts";
import { buildPriorityMap, type PriorityMap } from "./messages/priority.ts";
import { applyPruning } from "./messages/prune.ts";

export interface PipelineResult {
  messages: AgentMessage[];
  strategyResult: StrategyResult;
}

/**
 * Run the full DCP context processing pipeline.
 * Pure function of (state, config, messages, usage) → transformed messages.
 * State is mutated (tool cache, pruning marks, stats) as a side effect.
 */
export function runPipeline(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  contextUsage: ContextUsage | undefined,
): PipelineResult {
  // Step 0.5: Sync compression blocks (handle stale anchors)
  syncCompressionBlocks(state, messages.length);

  // Step 1: Strip hallucinated DCP tags from assistant messages
  let result = stripHallucinations(messages);

  // Step 2: Build tool caches
  syncToolCache(state, result);
  buildToolIdList(state, result);

  // Step 3: Run strategies (deduplication + purge errors)
  const strategyResult = runStrategies(state, config);

  // Step 4: Assign message refs (stable raw indices)
  assignMessageRefs(state, result);

  // Step 4.5: Build priority map for message-mode compression
  let priorityMap: PriorityMap | undefined;
  if (config.compress.mode === "message") {
    priorityMap = buildPriorityMap(state, result);
  }

  // Step 5: Inject message IDs (with priority attrs if message mode)
  result = injectMessageIds(state, result, priorityMap);

  // Step 6: Apply pruning (compressed ranges removed, tool outputs pruned)
  result = applyPruning(state, result);

  // Step 7: Inject nudges based on context usage
  result = injectCompressNudges(state, config, result, contextUsage);

  return { messages: result, strategyResult };
}
```

- [ ] **Step 2: Run pipeline tests**

Run: `pnpm vitest run tests/pipeline.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 4: Commit pipeline module**

```bash
git add src/pipeline.ts tests/pipeline.test.ts
git commit -m "feat: extract context pipeline into src/pipeline.ts

runPipeline is a pure function testable without Pi mocks.
Runs the full 7-step transformation: sync → strip → cache →
strategies → refs → inject → prune → nudge.

Generated with [Devin](https://cli.devin.ai/docs)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 3: Collapse index.ts context handler

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Add pipeline import**

Add to imports:

```typescript
import { runPipeline } from "./pipeline.ts";
```

Remove now-unused imports:

```typescript
// Remove these (pipeline.ts imports them internally):
import { syncCompressionBlocks } from "./messages/sync.ts";
import { stripHallucinations } from "./messages/strip.ts";
import { syncToolCache, buildToolIdList } from "./state/tool-cache.ts";
import { runStrategies } from "./strategies/runner.ts";
import { buildPriorityMap, type PriorityMap } from "./messages/priority.ts";
import { applyPruning } from "./messages/prune.ts";
import {
  assignMessageRefs,
  injectCompressNudges,
  injectMessageIds,
} from "./messages/inject.ts";
```

Note: Keep `injectCompressNudges` and `injectMessageIds` ONLY if they're used elsewhere (check first). The `assignMessageRefs` import likely only exists for the context handler, so it can be removed.

Actually, check: `assignMessageRefs` is exported from `inject.ts` and only used in the context handler. `injectCompressNudges` and `injectMessageIds` are also only used there. So all three can be removed from index.ts imports.

Keep:

```typescript
import { registerDcpCommands } from "./commands/register.ts";
import { loadConfig } from "./config.ts";
import { handleCompress, type CompressArgs } from "./compress/handler.ts";
import { COMPRESS_MESSAGE_PROMPT } from "./prompts/compress-message.ts";
import { Logger } from "./logger.ts";
import { DCP_SYSTEM_PROMPT } from "./prompts/system.ts";
import { createSessionState, resetSessionState } from "./state/state.ts";
import { saveSessionState, loadSessionState } from "./state/persistence.ts";
import { runPipeline } from "./pipeline.ts";
```

- [ ] **Step 2: Replace context handler body**

Replace the entire `pi.on("context", ...)` handler (lines 185-253) with:

```typescript
pi.on("context", async (event, ctx) => {
  if (!config.enabled) return;

  const usage = ctx.getContextUsage();
  if (usage) state.modelContextWindow = usage.contextWindow;
  latestMessages = event.messages;

  const result = runPipeline(
    state,
    config,
    event.messages,
    usage
      ? {
          tokens: usage.tokens,
          contextWindow: usage.contextWindow,
          percent: usage.percent,
        }
      : undefined,
  );

  if (result.strategyResult.pruned > 0) {
    logger.info("strategies", "pruned tool outputs", {
      count: result.strategyResult.pruned,
      tokens: result.strategyResult.tokensSaved,
    });
  }

  if (ctx.hasUI && state.stats.totalPruneTokens > 0) {
    ctx.ui.setStatus(
      "dcp",
      `DCP: ${state.stats.totalPruneTokens} tokens saved`,
    );
  }

  return { messages: result.messages };
});
```

- [ ] **Step 3: Remove unused PriorityMap type import if present**

Check for `type PriorityMap` in imports — remove if no longer referenced.

- [ ] **Step 4: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `pnpm vitest run`
Expected: All tests PASS

---

### Task 4: Verify integration tests still pass

**Files:**

- Keep: `tests/integration.test.ts`

The integration tests (2 tests, ~170 lines) already serve as lightweight wiring smoke tests — they verify that Pi extension events reach the pipeline and results propagate back through the mock API. The pipeline tests cover logic; the integration tests cover wiring. There is minimal overlap, so keep them as-is.

- [ ] **Step 1: Run all tests**

Run: `pnpm vitest run`
Expected: All tests PASS (both pipeline and integration)

- [ ] **Step 2: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/index.ts src/pipeline.ts tests/pipeline.test.ts
git commit -m "refactor: collapse context handler to pipeline call

index.ts context handler is now ~15 lines of wiring. All logic
lives in runPipeline. Strategy logging preserved via returned
strategyResult.

No behavior change.

Generated with [Devin](https://cli.devin.ai/docs)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```
