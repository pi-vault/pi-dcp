# Phase 4: Unify the Compress Handler

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/compress/handler.ts` that handles both range and message compression through a single `handleCompress` function, eliminating the near-identical flow duplicated across `range.ts` and `message.ts`.

**Architecture:** `handleCompress` accepts `CompressArgs` with `mode: "range" | "message"`. Internally it normalizes both modes to a common form `Array<{ startIndex, endIndex, summary, messageCount }>`, then executes the shared loop (allocate IDs → wrap summary → count tokens → apply state). The two mode-specific files are deleted. `search.ts` and `state.ts` remain unchanged.

**Tech Stack:** TypeScript (strict mode), vitest, biome (lint)

**Behavior change:** None. Same compression logic, same error messages.

**Prerequisite:** Phase 3 complete.

---

## File Map

| Action | File                             | Responsibility                                 |
| ------ | -------------------------------- | ---------------------------------------------- |
| Create | `src/compress/handler.ts`        | Unified `handleCompress` + `CompressArgs` type |
| Modify | `tests/compress-range.test.ts`   | Update imports to `handleCompress`             |
| Modify | `tests/compress-message.test.ts` | Update imports to `handleCompress`             |
| Modify | `tests/compress-cycle.test.ts`   | Update imports to `handleCompress`             |
| Modify | `src/index.ts`                   | Import from handler.ts, unify execute bodies   |
| Delete | `src/compress/range.ts`          | Replaced by handler.ts                         |
| Delete | `src/compress/message.ts`        | Replaced by handler.ts                         |

---

### Task 1: Write failing tests for handleCompress

**Files:**

- Modify: `tests/compress-range.test.ts`
- Modify: `tests/compress-message.test.ts`
- Modify: `tests/compress-cycle.test.ts`

- [ ] **Step 1: Update compress-range.test.ts imports**

Replace:

```typescript
import { handleRangeCompress } from "../src/compress/range.ts";
```

With:

```typescript
import { handleCompress } from "../src/compress/handler.ts";
```

Update all test calls from `handleRangeCompress(state, config, messages, args)` to `handleCompress(state, config, messages, { ...args, mode: "range" })`.

- [ ] **Step 2: Update compress-message.test.ts imports**

Replace:

```typescript
import { handleMessageCompress } from "../src/compress/message.ts";
```

With:

```typescript
import { handleCompress } from "../src/compress/handler.ts";
```

Update all test calls from `handleMessageCompress(state, config, messages, args)` to `handleCompress(state, config, messages, { ...args, mode: "message" })`.

- [ ] **Step 3: Update compress-cycle.test.ts imports**

Replace:

```typescript
import { handleRangeCompress } from "../src/compress/range.ts";
```

With:

```typescript
import { handleCompress } from "../src/compress/handler.ts";
```

Update all calls from `handleRangeCompress(state, config, messages, args)` to `handleCompress(state, config, messages, { ...args, mode: "range" })`.

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm vitest run tests/compress-range.test.ts tests/compress-message.test.ts tests/compress-cycle.test.ts`
Expected: FAIL — module `../src/compress/handler.ts` does not exist

---

### Task 2: Implement handleCompress

**Files:**

- Create: `src/compress/handler.ts`

- [ ] **Step 1: Write the unified handler**

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { resolveBoundaryIndex, resolveSelection } from "./search.ts";
import {
  allocateBlockId,
  allocateRunId,
  applyCompressionState,
  wrapCompressedSummary,
  COMPRESSED_BLOCK_HEADER,
} from "./state.ts";
import { countTokens } from "../utils/tokens.ts";

export interface CompressArgs {
  topic: string;
  mode: "range" | "message";
  content?: Array<{
    startId: string;
    endId: string;
    summary: string;
  }>;
  targets?: Array<{
    messageId: string;
    summary: string;
  }>;
}

interface NormalizedEntry {
  startIndex: number;
  endIndex: number;
  summary: string;
  messageCount: number;
}

/**
 * Handle any compress tool call regardless of mode.
 * Normalizes input, resolves boundaries, applies compression state.
 */
export function handleCompress(
  state: SessionState,
  _config: DcpConfig,
  messages: AgentMessage[],
  args: CompressArgs,
): string {
  const entries = normalizeEntries(state, messages, args);
  const runId = allocateRunId(state);
  let totalCompressed = 0;

  for (const entry of entries) {
    const blockId = allocateBlockId(state);
    const wrappedSummary = wrapCompressedSummary(blockId, entry.summary);
    const summaryTokens = countTokens(wrappedSummary);
    const compressMessageIndex = messages.length - 1;

    applyCompressionState(state, {
      blockId,
      runId,
      topic: args.topic,
      batchTopic: args.topic,
      mode: args.mode,
      startIndex: entry.startIndex,
      endIndex: entry.endIndex,
      anchorIndex: entry.startIndex,
      compressMessageIndex,
      summary: wrappedSummary,
      summaryTokens,
      consumedBlockIds: [],
    });

    totalCompressed += entry.messageCount;
  }

  return `Compressed ${totalCompressed} messages into ${COMPRESSED_BLOCK_HEADER}.`;
}

/**
 * Normalize range or message args into a common form.
 * Validates input and resolves boundary IDs to indices.
 */
function normalizeEntries(
  state: SessionState,
  messages: AgentMessage[],
  args: CompressArgs,
): NormalizedEntry[] {
  if (args.mode === "range") {
    if (!args.content || args.content.length === 0) {
      throw new Error("content array is required and must not be empty");
    }

    return args.content.map((entry) => {
      if (!entry.startId || !entry.endId || !entry.summary) {
        throw new Error(
          "Each content entry requires startId, endId, and summary",
        );
      }

      const startIndex = resolveBoundaryIndex(state, entry.startId);
      if (startIndex === undefined) {
        throw new Error(
          `startId ${entry.startId} is not available. It may have been pruned or compressed. ` +
            `Choose a message ID (m0001) or block ref (b1) visible in the current context.`,
        );
      }

      const endIndex = resolveBoundaryIndex(state, entry.endId);
      if (endIndex === undefined) {
        throw new Error(
          `endId ${entry.endId} is not available. It may have been pruned or compressed. ` +
            `Choose a message ID (m0001) or block ref (b1) visible in the current context.`,
        );
      }

      const selection = resolveSelection(messages, startIndex, endIndex);
      return {
        startIndex: selection.startIndex,
        endIndex: selection.endIndex,
        summary: entry.summary,
        messageCount: selection.messageIndices.length,
      };
    });
  }

  // mode === "message"
  if (!args.targets || args.targets.length === 0) {
    throw new Error("targets array is required and must not be empty");
  }

  return args.targets.map((target) => {
    if (!target.messageId || !target.summary) {
      throw new Error("Each target requires messageId and summary");
    }

    const index = resolveBoundaryIndex(state, target.messageId);
    if (index === undefined) {
      throw new Error(
        `messageId ${target.messageId} is not available. It may have been pruned or compressed. ` +
          `Choose a message ID (m0001) visible in the current context.`,
      );
    }

    return {
      startIndex: index,
      endIndex: index,
      summary: target.summary,
      messageCount: 1,
    };
  });
}
```

- [ ] **Step 2: Run updated tests**

Run: `pnpm vitest run tests/compress-range.test.ts tests/compress-message.test.ts tests/compress-cycle.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Run full check**

Run: `pnpm check`
Expected: PASS (handler.ts compiles, old files still exist so index.ts still resolves)

---

### Task 3: Update index.ts and delete old files

**Files:**

- Modify: `src/index.ts`
- Delete: `src/compress/range.ts`
- Delete: `src/compress/message.ts`

- [ ] **Step 1: Update index.ts imports**

Replace:

```typescript
import {
  handleRangeCompress,
  type RangeCompressArgs,
} from "./compress/range.ts";
import {
  handleMessageCompress,
  type MessageCompressArgs,
} from "./compress/message.ts";
```

With:

```typescript
import { handleCompress, type CompressArgs } from "./compress/handler.ts";
```

- [ ] **Step 2: Unify tool registration execute bodies**

The `if/else` for schema selection stays (the model-facing JSON schema differs by mode). Only the execute implementations are unified.

Replace the message mode `execute` body (lines 69-76):

```typescript
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const typedArgs = params as unknown as MessageCompressArgs;
        const resultText = handleMessageCompress(state, config, latestMessages, typedArgs);
        return {
          content: [{ type: "text" as const, text: resultText }],
          details: {},
        };
      },
```

With:

```typescript
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const resultText = handleCompress(state, config, latestMessages, {
          ...(params as Record<string, unknown>),
          mode: "message",
        } as CompressArgs);
        return {
          content: [{ type: "text" as const, text: resultText }],
          details: {},
        };
      },
```

Replace the range mode `execute` body (lines 101-107):

```typescript
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const typedArgs = params as unknown as RangeCompressArgs;
        const resultText = handleRangeCompress(state, config, latestMessages, typedArgs);
        return {
          content: [{ type: "text" as const, text: resultText }],
          details: {},
        };
      },
```

With:

```typescript
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const resultText = handleCompress(state, config, latestMessages, {
          ...(params as Record<string, unknown>),
          mode: "range",
        } as CompressArgs);
        return {
          content: [{ type: "text" as const, text: resultText }],
          details: {},
        };
      },
```

- [ ] **Step 3: Delete old handler files**

```bash
rm src/compress/range.ts src/compress/message.ts
```

- [ ] **Step 4: Verify no dangling imports remain**

Run: `grep -r "compress/range\|compress/message" src/ tests/`
Expected: No matches (plan files in `plans/` are fine to ignore).

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Run integration tests**

Run: `pnpm vitest run tests/compress-cycle.test.ts tests/integration.test.ts`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: unify compress handlers into single handleCompress

Replace handleRangeCompress and handleMessageCompress with a single
handleCompress function that normalizes both modes to a common form
before executing the shared compression loop. Deletes range.ts and
message.ts. Tool registration execute bodies unified.

No behavior change.

Generated with [Devin](https://cli.devin.ai/docs)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```
