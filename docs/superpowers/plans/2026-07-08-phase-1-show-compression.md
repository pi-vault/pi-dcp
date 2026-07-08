# Phase 1: showCompression Config

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `showCompression` boolean config that controls whether compression summaries are injected into context or silently omitted.

**Architecture:** Thread a `showCompression` boolean from config through the pruning pipeline. When false, `filterCompressedRanges` still removes compressed messages but skips injecting the synthetic summary user message.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Update test helpers

**Files:**
- Modify: `tests/helpers.ts`

- [ ] **Step 1: Add showCompression to makeDefaultConfig**

Add `showCompression: true` to the compress defaults in `makeDefaultConfig`:

```ts
// In tests/helpers.ts, inside makeDefaultConfig's compress object, after protectTags:
showCompression: true,
```

The full compress block in `makeDefaultConfig` should now include:

```ts
compress: {
  mode: "range",
  permission: "allow",
  maxContextPercent: 80,
  minContextPercent: 50,
  nudgeFrequency: 5,
  iterationNudgeThreshold: 15,
  nudgeForce: "soft",
  protectedTools: [],
  protectUserMessages: false,
  protectTags: false,
  showCompression: true,
  summaryBuffer: true,
  maxContextLimit: undefined,
  minContextLimit: undefined,
  modelMaxLimits: undefined,
  modelMinLimits: undefined,
  ...overrides,
},
```

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `pnpm test`
Expected: All tests pass. The new field with default `true` preserves existing behavior.

- [ ] **Step 3: Commit**

```bash
git add tests/helpers.ts
git commit -m "test: add showCompression to makeDefaultConfig"
```

---

### Task 2: Add showCompression to config

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Add showCompression to CompressConfig interface**

In `src/config.ts`, add `showCompression` to the `CompressConfig` interface after line 30 (`protectTags: boolean;`):

```ts
export interface CompressConfig {
  mode: "range" | "message";
  permission: "allow" | "deny";
  maxContextPercent: number;
  minContextPercent: number;
  nudgeFrequency: number;
  iterationNudgeThreshold: number;
  nudgeForce: "strong" | "soft";
  protectedTools: string[];
  protectUserMessages: boolean;
  protectTags: boolean;
  /** When false, compressed ranges are silently removed without injecting summary blocks. */
  showCompression: boolean;
  /** When true, active summary tokens are excluded from the max-threshold comparison to prevent cascading compressions. */
  summaryBuffer: boolean;
  maxContextLimit: number | string | undefined;
  minContextLimit: number | string | undefined;
  modelMaxLimits: Record<string, number | string> | undefined;
  modelMinLimits: Record<string, number | string> | undefined;
}
```

- [ ] **Step 2: Add default value**

In `DEFAULT_CONFIG.compress`, add `showCompression: true` after `protectTags: false`:

```ts
compress: {
  mode: "range",
  permission: "allow",
  maxContextPercent: 80,
  minContextPercent: 50,
  nudgeFrequency: 5,
  iterationNudgeThreshold: 15,
  nudgeForce: "soft",
  protectedTools: ["compress"],
  protectUserMessages: false,
  protectTags: false,
  showCompression: true,
  summaryBuffer: true,
  maxContextLimit: 200000,
  minContextLimit: 100000,
  modelMaxLimits: undefined,
  modelMinLimits: undefined,
},
```

- [ ] **Step 3: Add to KNOWN_COMPRESS_KEYS**

Add `"showCompression"` to the `KNOWN_COMPRESS_KEYS` set:

```ts
const KNOWN_COMPRESS_KEYS = new Set([
  "mode", "permission", "maxContextPercent", "minContextPercent",
  "nudgeFrequency", "iterationNudgeThreshold", "nudgeForce",
  "protectedTools", "protectUserMessages", "protectTags", "showCompression", "summaryBuffer",
  "maxContextLimit", "minContextLimit", "modelMaxLimits", "modelMinLimits",
]);
```

- [ ] **Step 4: Add merge logic**

In the `mergeConfig` function, inside the `if (source.compress && typeof source.compress === "object")` block, add after the `protectTags` check:

```ts
    if (typeof c.showCompression === "boolean")
      target.compress.showCompression = c.showCompression;
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no type errors)

- [ ] **Step 6: Commit**

```bash
git add src/config.ts
git commit -m "feat(config): add showCompression to CompressConfig"
```

---

### Task 3: Thread showCompression through pruning

**Files:**
- Modify: `src/messages/prune.ts`
- Modify: `src/pipeline.ts`

- [ ] **Step 1: Write failing test**

Create `tests/show-compression.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { filterCompressedRanges, applyPruning } from "../src/messages/prune.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeUserMessage, makeAssistantMessage, resetTestTimestamp } from "./helpers.ts";

describe("showCompression", () => {
  beforeEach(() => {
    resetTestTimestamp();
  });

  function setupCompressedState() {
    const state = createSessionState();
    const messages = [
      makeUserMessage("hello"),
      makeAssistantMessage("world"),
      makeUserMessage("more"),
    ];

    // Simulate block covering messages 0-1, anchored at 0
    state.prune.messages.blocksById.set(1, {
      blockId: 1,
      runId: 1,
      active: true,
      deactivatedByUser: false,
      compressedTokens: 100,
      summaryTokens: 20,
      durationMs: 0,
      mode: "range",
      topic: "test",
      batchTopic: undefined,
      startIndex: 0,
      endIndex: 1,
      anchorIndex: 0,
      compressMessageIndex: 2,
      includedBlockIds: [],
      consumedBlockIds: [],
      parentBlockIds: [],
      directMessageIndices: [0, 1],
      directToolIds: [],
      effectiveMessageIndices: [0, 1],
      effectiveToolIds: [],
      createdAt: Date.now(),
      deactivatedAt: undefined,
      deactivatedByBlockId: undefined,
      summary: "[Compressed Block b1]\nSummary text\n[End Block b1]",
    });
    state.prune.messages.activeBlockIds.add(1);
    state.prune.messages.activeByAnchorIndex.set(0, 1);
    state.prune.messages.byMessageIndex.set(0, {
      tokenCount: 50,
      blockIds: [1],
      activeBlockIds: [1],
    });
    state.prune.messages.byMessageIndex.set(1, {
      tokenCount: 50,
      blockIds: [1],
      activeBlockIds: [1],
    });

    return { state, messages };
  }

  it("injects summary when showCompression is true (default)", () => {
    const { state, messages } = setupCompressedState();
    const result = filterCompressedRanges(state, messages, true);
    // Should have: summary message + message[2] ("more")
    expect(result.length).toBe(2);
    expect(result[0].role).toBe("user");
    expect((result[0].content as Array<{ type: string; text: string }>)[0].text).toContain(
      "Summary text",
    );
    expect(result[1].role).toBe("user"); // message[2]
  });

  it("omits summary when showCompression is false", () => {
    const { state, messages } = setupCompressedState();
    const result = filterCompressedRanges(state, messages, false);
    // Should have only message[2] ("more") — no summary injected
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("user");
    expect((result[0].content as Array<{ type: string; text: string }>)[0].text).toBe("more");
  });

  it("applyPruning threads showCompression correctly", () => {
    const { state, messages } = setupCompressedState();
    const result = applyPruning(state, messages, false);
    // No summary injected, compressed messages removed
    expect(result.length).toBe(1);
    expect((result[0].content as Array<{ type: string; text: string }>)[0].text).toBe("more");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/show-compression.test.ts`
Expected: FAIL — `filterCompressedRanges` does not accept a third parameter.

- [ ] **Step 3: Update filterCompressedRanges signature**

In `src/messages/prune.ts`, update `filterCompressedRanges` to accept `showCompression`:

```ts
export function filterCompressedRanges(
  state: SessionState,
  messages: AgentMessage[],
  showCompression = true,
): AgentMessage[] {
  if (state.prune.messages.activeBlockIds.size === 0) return messages;

  const result: AgentMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    // Check if there's a summary to inject at this anchor point
    const blockId = state.prune.messages.activeByAnchorIndex.get(i);
    if (blockId !== undefined && showCompression) {
      const block = state.prune.messages.blocksById.get(blockId);
      if (block?.active && block.summary) {
        result.push({
          role: "user",
          content: [{ type: "text", text: block.summary }],
          timestamp: Date.now(),
        } as AgentMessage);
      }
    }

    // Skip messages that are covered by active blocks
    const entry = state.prune.messages.byMessageIndex.get(i);
    if (entry && entry.activeBlockIds.length > 0) {
      continue;
    }

    result.push(messages[i]);
  }

  // Safety net: remove orphaned toolResult messages
  return removeOrphanedToolResults(result);
}
```

- [ ] **Step 4: Update applyPruning signature**

In `src/messages/prune.ts`, update `applyPruning` to accept and pass `showCompression`:

```ts
export function applyPruning(
  state: SessionState,
  messages: AgentMessage[],
  showCompression = true,
): AgentMessage[] {
  let result = filterCompressedRanges(state, messages, showCompression);
  result = pruneToolOutputs(state, result);
  result = pruneToolErrors(state, result);
  return result;
}
```

- [ ] **Step 5: Update pipeline to pass showCompression**

In `src/pipeline.ts`, update the `applyPruning` call at line 64 to pass the config value:

```ts
  // Step 6: Apply pruning (compressed ranges removed, tool outputs pruned)
  result = applyPruning(state, result, config.compress.showCompression);
```

- [ ] **Step 6: Run tests**

Run: `pnpm check`
Expected: All tests pass including new `show-compression.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/messages/prune.ts src/pipeline.ts tests/show-compression.test.ts
git commit -m "feat: add showCompression config to toggle summary injection"
```
