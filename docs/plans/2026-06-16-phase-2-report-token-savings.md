# Phase 2: Report Token Savings in Compress Response

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The compress tool's return string includes actual token savings (original tokens vs summary tokens), giving the model visibility into compression effectiveness.

**Architecture:** `applyCompressionState` already computes `block.compressedTokens` by summing `entry.tokenCount` for messages in the range, and stores `summaryTokens` on the block. With Phase 1 in place, these token counts are now non-zero. After calling `applyCompressionState`, read the stored block from `blocksById` to accumulate totals, then format them into the response string.

**Tech Stack:** Vitest, TypeScript

**Depends on:** Phase 1 (token counts must be populated for non-zero reporting)

---

### Task 1: Add token counts to `NormalizedEntry` and report in handler response

**Files:**
- Modify: `src/compress/handler.ts:28-74`
- Test: `tests/compress-range.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/compress-range.test.ts`:

```typescript
import { createSessionState } from "../src/state/state.ts";
import { handleCompress } from "../src/compress/handler.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("handleCompress token reporting", () => {
  it("includes token savings in response when tokens are known", () => {
    const state = createSessionState();
    // Set up message IDs so boundaries resolve
    state.messageIds.byRef.set("m0001", 0);
    state.messageIds.byRef.set("m0003", 2);

    // Pre-populate byMessageIndex with token counts (simulating sync having run)
    state.prune.messages.byMessageIndex.set(0, {
      tokenCount: 150,
      blockIds: [],
      activeBlockIds: [],
    });
    state.prune.messages.byMessageIndex.set(1, {
      tokenCount: 200,
      blockIds: [],
      activeBlockIds: [],
    });
    state.prune.messages.byMessageIndex.set(2, {
      tokenCount: 100,
      blockIds: [],
      activeBlockIds: [],
    });

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "msg 0" }], timestamp: Date.now() } as AgentMessage,
      { role: "assistant", content: [{ type: "text", text: "msg 1" }], timestamp: Date.now() } as unknown as AgentMessage,
      { role: "user", content: [{ type: "text", text: "msg 2" }], timestamp: Date.now() } as AgentMessage,
    ];

    const config = makeDefaultConfig();
    const result = handleCompress(state, config, messages, {
      topic: "test",
      mode: "range",
      content: [{ startId: "m0001", endId: "m0003", summary: "short summary" }],
    });

    // Total original = 150 + 200 + 100 = 450
    expect(result).toContain("~450 tokens");
    expect(result).toContain("Compressed 3 messages");
  });

  it("omits token savings when token counts are zero", () => {
    const state = createSessionState();
    state.messageIds.byRef.set("m0001", 0);
    state.messageIds.byRef.set("m0002", 1);

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "msg" }], timestamp: Date.now() } as AgentMessage,
      { role: "assistant", content: [{ type: "text", text: "response" }], timestamp: Date.now() } as unknown as AgentMessage,
    ];

    const config = makeDefaultConfig();
    const result = handleCompress(state, config, messages, {
      topic: "test",
      mode: "range",
      content: [{ startId: "m0001", endId: "m0002", summary: "summary" }],
    });

    // No token info injected when byMessageIndex has no entries (all tokenCount = 0)
    expect(result).not.toContain("tokens");
    expect(result).toContain("Compressed 2 messages");
  });
});
```

(Ensure `makeDefaultConfig` is imported from `./helpers.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/compress-range.test.ts`

Expected: First test FAILS because the response does not contain "~450 tokens".

- [ ] **Step 3: Implement the token reporting in `handleCompress`**

Modify `src/compress/handler.ts` — update the `handleCompress` function to collect token stats from the blocks and include them in the response:

```typescript
export function handleCompress(
  state: SessionState,
  _config: DcpConfig,
  messages: AgentMessage[],
  args: CompressArgs,
): string {
  const entries = normalizeEntries(state, messages, args);
  const runId = allocateRunId(state);
  let totalCompressed = 0;
  let totalCompressedTokens = 0;
  let totalSummaryTokens = 0;

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

    // Read back the block's computed compressedTokens
    const block = state.prune.messages.blocksById.get(blockId);
    if (block) {
      totalCompressedTokens += block.compressedTokens;
      totalSummaryTokens += block.summaryTokens;
    }
  }

  const savings =
    totalCompressedTokens > 0
      ? ` (~${totalCompressedTokens} tokens replaced by ~${totalSummaryTokens} token summary)`
      : "";
  return `Compressed ${totalCompressed} messages into ${COMPRESSED_BLOCK_HEADER}${savings}.`;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run tests/compress-range.test.ts`

Expected: All tests pass, including the two new ones.

- [ ] **Step 5: Run full check**

Run: `pnpm run check`

Expected: lint, typecheck, and all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/compress/handler.ts tests/compress-range.test.ts
git commit -m "feat: report token savings in compress tool response

When compressedTokens are available (Phase 1 populates them),
the compress response now includes '(~N tokens replaced by ~M token summary)'
giving the model visibility into compression effectiveness."
```
