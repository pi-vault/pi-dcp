# Phase 3: Summary Buffer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent cascading compressions by excluding active summary tokens from the context usage threshold comparison.

**Architecture:** Add a `summaryBuffer` config toggle (default: `true`). When enabled, compute the total token count of active compression summaries and extend the effective max threshold by that amount. This means summaries don't push context usage past the compression trigger.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File                           | Responsibility                             |
| ------------------------------ | ------------------------------------------ |
| `src/config.ts`                | Add `summaryBuffer` to `CompressConfig`    |
| `src/compress/state.ts`        | Add `getActiveSummaryTokenUsage` utility   |
| `src/messages/inject.ts`       | Adjust threshold in `injectCompressNudges` |
| `tests/summary-buffer.test.ts` | Unit tests for summary buffer logic        |

---

### Task 1: Add `summaryBuffer` config and `getActiveSummaryTokenUsage`

**Files:**

- Modify: `src/config.ts`
- Modify: `src/compress/state.ts`
- Test: `tests/summary-buffer.test.ts` (create)

- [ ] **Step 1: Write failing test for `getActiveSummaryTokenUsage`**

Create `tests/summary-buffer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createSessionState } from "../src/state/state.ts";
import { getActiveSummaryTokenUsage } from "../src/compress/state.ts";
import type { CompressionBlock } from "../src/state/types.ts";

function makeBlock(overrides: Partial<CompressionBlock>): CompressionBlock {
  return {
    blockId: 1,
    runId: 1,
    active: true,
    deactivatedByUser: false,
    compressedTokens: 1000,
    summaryTokens: 200,
    durationMs: 0,
    mode: "range",
    topic: "test",
    batchTopic: undefined,
    startIndex: 0,
    endIndex: 5,
    anchorIndex: 5,
    compressMessageIndex: 7,
    includedBlockIds: [],
    consumedBlockIds: [],
    parentBlockIds: [],
    directMessageIndices: [],
    directToolIds: [],
    effectiveMessageIndices: [],
    effectiveToolIds: [],
    createdAt: Date.now(),
    deactivatedAt: undefined,
    deactivatedByBlockId: undefined,
    summary: "Summary",
    ...overrides,
  };
}

describe("getActiveSummaryTokenUsage", () => {
  it("returns 0 when no blocks exist", () => {
    const state = createSessionState();
    expect(getActiveSummaryTokenUsage(state)).toBe(0);
  });

  it("sums summaryTokens across active blocks", () => {
    const state = createSessionState();
    state.prune.messages.blocksById.set(
      1,
      makeBlock({ blockId: 1, active: true, summaryTokens: 200 }),
    );
    state.prune.messages.blocksById.set(
      2,
      makeBlock({ blockId: 2, active: true, summaryTokens: 350 }),
    );
    state.prune.messages.activeBlockIds.add(1);
    state.prune.messages.activeBlockIds.add(2);

    expect(getActiveSummaryTokenUsage(state)).toBe(550);
  });

  it("excludes inactive blocks", () => {
    const state = createSessionState();
    state.prune.messages.blocksById.set(
      1,
      makeBlock({ blockId: 1, active: true, summaryTokens: 200 }),
    );
    state.prune.messages.blocksById.set(
      2,
      makeBlock({ blockId: 2, active: false, summaryTokens: 350 }),
    );
    state.prune.messages.activeBlockIds.add(1);

    expect(getActiveSummaryTokenUsage(state)).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/summary-buffer.test.ts`

Expected: FAIL — `getActiveSummaryTokenUsage` does not exist.

- [ ] **Step 3: Implement `getActiveSummaryTokenUsage` in `compress/state.ts`**

In `src/compress/state.ts`, add:

```typescript
/**
 * Sum the summaryTokens of all active compression blocks.
 * Used by the summary buffer feature to extend the effective threshold.
 */
export function getActiveSummaryTokenUsage(state: SessionState): number {
  let total = 0;
  for (const blockId of state.prune.messages.activeBlockIds) {
    const block = state.prune.messages.blocksById.get(blockId);
    if (block?.active) {
      total += block.summaryTokens;
    }
  }
  return total;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/summary-buffer.test.ts`

Expected: All PASS.

- [ ] **Step 5: Add `summaryBuffer` to `CompressConfig`**

In `src/config.ts`, add to the `CompressConfig` interface:

```typescript
summaryBuffer: boolean;
```

Add to `DEFAULT_CONFIG.compress`:

```typescript
    summaryBuffer: true,
```

Add `"summaryBuffer"` to `KNOWN_COMPRESS_KEYS`.

Add parsing in `mergeConfig` inside the `if (source.compress ...)` block:

```typescript
if (typeof c.summaryBuffer === "boolean")
  target.compress.summaryBuffer = c.summaryBuffer;
```

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/config.ts src/compress/state.ts tests/summary-buffer.test.ts
git commit -m "feat(buffer): add summaryBuffer config and getActiveSummaryTokenUsage"
```

---

### Task 2: Adjust threshold in `injectCompressNudges`

**Files:**

- Modify: `src/messages/inject.ts`
- Test: `tests/summary-buffer.test.ts`

- [ ] **Step 1: Write failing test for buffer-adjusted threshold**

Add to `tests/summary-buffer.test.ts`:

```typescript
import {
  injectCompressNudges,
  assignMessageRefs,
} from "../src/messages/inject.ts";
import {
  makeUserMessage,
  makeAssistantMessage,
  makeDefaultConfig,
} from "./helpers.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("injectCompressNudges with summaryBuffer", () => {
  it("does not inject nudge when summary tokens push past threshold but buffer accounts for them", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      maxContextPercent: 80,
      minContextPercent: 50,
      summaryBuffer: true,
    });

    // Simulate 600 summary tokens from active blocks
    state.prune.messages.blocksById.set(
      1,
      makeBlock({ blockId: 1, active: true, summaryTokens: 600 }),
    );
    state.prune.messages.activeBlockIds.add(1);

    const messages: AgentMessage[] = [
      makeUserMessage("hello"),
      makeAssistantMessage("world"),
      makeUserMessage("question"),
    ];
    assignMessageRefs(state, messages);

    // Context at 82% — normally triggers CONTEXT_LIMIT_NUDGE.
    // But 600 summary tokens in a 10000-token window = 6%.
    // Effective threshold = 80% + 6% = 86%. So 82% < 86% — no urgent nudge.
    // However 82% > 50% and last message is user — TURN_NUDGE should fire.
    const result = injectCompressNudges(state, config, messages, {
      tokens: 8200,
      contextWindow: 10000,
      percent: 82,
    });

    // Should get TURN_NUDGE (not CONTEXT_LIMIT_NUDGE)
    const lastMsg = result[result.length - 1];
    const text = (lastMsg as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    expect(text).toContain("Evaluate the conversation");
    expect(text).not.toContain("CRITICAL WARNING");
  });

  it("still injects CONTEXT_LIMIT_NUDGE when percent exceeds buffer-adjusted max", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      maxContextPercent: 80,
      minContextPercent: 50,
      summaryBuffer: true,
    });

    state.prune.messages.blocksById.set(
      1,
      makeBlock({ blockId: 1, active: true, summaryTokens: 300 }),
    );
    state.prune.messages.activeBlockIds.add(1);

    const messages: AgentMessage[] = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);

    // Context at 85%. Summary buffer = 300/10000 = 3%. Effective max = 83%.
    // 85% > 83% — CONTEXT_LIMIT_NUDGE fires.
    const result = injectCompressNudges(state, config, messages, {
      tokens: 8500,
      contextWindow: 10000,
      percent: 85,
    });

    const text = (result[0] as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    expect(text).toContain("CRITICAL WARNING");
  });

  it("no buffer adjustment when summaryBuffer is disabled", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      maxContextPercent: 80,
      minContextPercent: 50,
      summaryBuffer: false,
    });

    state.prune.messages.blocksById.set(
      1,
      makeBlock({ blockId: 1, active: true, summaryTokens: 600 }),
    );
    state.prune.messages.activeBlockIds.add(1);

    const messages: AgentMessage[] = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);

    // Context at 82% — with buffer disabled, 82% >= 80% triggers CONTEXT_LIMIT_NUDGE
    const result = injectCompressNudges(state, config, messages, {
      tokens: 8200,
      contextWindow: 10000,
      percent: 82,
    });

    const text = (result[0] as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    expect(text).toContain("CRITICAL WARNING");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/summary-buffer.test.ts`

Expected: FAIL — nudge logic doesn't account for summary buffer yet.

- [ ] **Step 3: Modify `injectCompressNudges` to account for summary buffer**

In `src/messages/inject.ts`, add the import:

```typescript
import { getActiveSummaryTokenUsage } from "../compress/state.ts";
```

Replace the threshold comparison section (lines 88-92) with:

```typescript
const percent = contextUsage.percent;

// Summary buffer: extend effective max threshold by summary token percentage
let effectiveMaxPercent = config.compress.maxContextPercent;
if (config.compress.summaryBuffer && contextUsage.contextWindow > 0) {
  const summaryTokens = getActiveSummaryTokenUsage(state);
  const summaryPercent = (summaryTokens / contextUsage.contextWindow) * 100;
  effectiveMaxPercent += summaryPercent;
}

const overMax = percent >= effectiveMaxPercent;
const overMin = percent >= config.compress.minContextPercent;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/summary-buffer.test.ts`

Expected: All PASS.

- [ ] **Step 5: Run full check**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npm run check`

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/messages/inject.ts tests/summary-buffer.test.ts
git commit -m "feat(buffer): adjust nudge threshold to account for active summary tokens"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `npm run check` passes
- [ ] `summaryBuffer: true` is the default in config
- [ ] Unknown key validation includes `summaryBuffer`
- [ ] `getActiveSummaryTokenUsage` correctly sums only active blocks
- [ ] Threshold adjustment only applies to `overMax` (not `overMin`)
- [ ] Buffer disabled path works (no adjustment when `summaryBuffer: false`)
- [ ] Existing nudge tests still pass (they don't set up blocks, so buffer = 0)
