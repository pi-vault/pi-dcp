# Pi DCP Phase 3 Compression Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make in-session compression ownership, batch mutation, nesting, visible-token accounting, and timing deterministic and accurate.

**Architecture:** Normalize every requested range into a complete selection before changing state. Attribute all resulting blocks to the real compression tool call, model consumed blocks explicitly, and calculate savings from the visible context replaced by each new summary.

**Tech Stack:** TypeScript ESM, Vitest, pnpm, Pi message types, and the existing token estimator.

---

## Source, Prerequisite, and Boundaries

- Source roadmap: Task 3 in [2026-07-28-pi-dcp-reliability-roadmap.md](2026-07-28-pi-dcp-reliability-roadmap.md).
- Prerequisite: [Phase 2](2026-07-28-pi-dcp-phase-2-turn-and-pair-safety.md) is released and its full verification passes.
- This phase guarantees correctness within the current process. Resume, fork, tree, and compaction restoration belong to Phase 4.
- This phase does not add project config, manual compression, lifetime scanning, or benchmarks.

## Stable Outcome

After this phase:

- Every block records the actual compression tool-call ID.
- A batch either validates completely and applies completely or leaves state unchanged.
- Selections expand to complete tool pairs and complete active blocks.
- Parent blocks record all consumed blocks and restore their children when deactivated.
- `compressedTokens` measures the visible context replaced at creation time.
- Tool timing applies to every block created by the call.
- Stable message boundaries are available for Phase 4 rehydration.

### Task 1: Define final block ownership and stable boundaries

**Files:**

- Modify: `src/state/types.ts`
- Modify: `tests/helpers.ts`
- Test: `tests/compress-range.test.ts`, `tests/compress-cycle.test.ts`

- [ ] **Step 1: Add failing ownership assertions**

  Extend block fixtures and compression tests:

  ```ts
  expect(block.compressToolCallId).toBe("compress-call-1");
  expect(block.startKey).toBe("m0001");
  expect(block.endKey).toBe("m0003");
  expect(block.anchorKey).toBe("m0001");
  ```

  Add a type-level fixture without `compressMessageIndex`; it must compile after the change.

- [ ] **Step 2: Confirm the old ownership shape**

  ```bash
  pnpm vitest run tests/compress-range.test.ts tests/compress-cycle.test.ts
  pnpm typecheck
  ```

  Expected: FAIL because blocks are owned by `compressMessageIndex` and lack stable boundary keys.

- [ ] **Step 3: Change the block contract**

  In `CompressionBlock`, remove `compressMessageIndex` and add:

  ```ts
  compressToolCallId: string;
  startKey: string;
  endKey: string;
  anchorKey: string;
  consumedBlockIds: number[];
  ```

  Keep current numeric indices as runtime fields for fast pipeline access. Do not create a second block type; Phase 4 will serialize selected fields from this one.

- [ ] **Step 4: Change the handler contract**

  Use the real ID supplied by Pi:

  ```ts
  export function handleCompress(
    state: SessionState,
    config: DcpConfig,
    messages: AgentMessage[],
    compressToolCallId: string,
    args: CompressArgs,
  ): CompressResult;
  ```

  Update the tool execute callback and test helpers to pass `toolCallId` directly.

- [ ] **Step 5: Run ownership tests**

  ```bash
  pnpm vitest run tests/compress-range.test.ts tests/compress-cycle.test.ts
  pnpm typecheck
  ```

  Expected: block fixtures compile and every new block records its actual call ID and stable keys.

- [ ] **Step 6: Commit the block contract**

  ```bash
  git add src/state/types.ts src/compress/handler.ts src/index.ts tests/helpers.ts tests/compress-range.test.ts tests/compress-cycle.test.ts
  git commit -m "refactor: give compression blocks stable ownership"
  ```

### Task 2: Resolve batches before mutating state

**Files:**

- Modify: `src/compress/search.ts`, `src/compress/handler.ts`
- Test: `tests/compress-range.test.ts`

- [ ] **Step 1: Add failing active-block atomicity tests**

  Retain the Phase 2 regressions for invalid later entries, protected turns, and tool-pair-expanded overlaps. Add a batch whose entries become overlapping only after active-block expansion:

  ```ts
  const before = snapshotCompressionState(state);
  expect(() =>
    handleCompress(state, config, messages, "compress-call-1", args),
  ).toThrow(/overlap|invalid/i);
  expect(snapshotCompressionState(state)).toEqual(before);
  ```

  The snapshot assertion must include block IDs, counters, active sets, and statistics.

- [ ] **Step 2: Confirm active blocks are not expanded**

  ```bash
  pnpm vitest run tests/compress-range.test.ts -t "atomic"
  ```

  Expected: FAIL because Phase 2 expands tool pairs and validates the batch atomically, but `resolveSelection()` does not yet include touched active blocks.

- [ ] **Step 3: Extend Phase 2 complete selections**

  Make `resolveSelection()` return:

  ```ts
  interface SelectionResult {
    startIndex: number;
    endIndex: number;
    messageIndices: number[];
    toolIds: string[];
    consumedBlockIds: number[];
  }
  ```

  Preserve Phase 2 tool-pair expansion and extend it to a fixed point:

  1. Include both sides of every touched assistant-call/result pair.
  2. Include the complete effective range of every touched active block.
  3. Repeat until neither rule changes the range.
  4. Apply the Phase 2 protected-turn rejection.

- [ ] **Step 4: Reuse Phase 2 batch validation**

  Resolve every input into a local array, then keep the existing Phase 2 `entriesByStart` adjacent-overlap check before `runId`, block-ID, or state mutation. Run it after active-block expansion so newly overlapping selections are rejected by the same path.

  Do not silently merge overlapping user inputs because each input carries its own summary.

- [ ] **Step 5: Run range tests**

  ```bash
  pnpm vitest run tests/compress-range.test.ts
  ```

  Expected: invalid and expanded-overlap batches leave state byte-for-byte equivalent; valid disjoint batches create every requested block.

- [ ] **Step 6: Commit atomic selection**

  ```bash
  git add src/compress/search.ts src/compress/handler.ts tests/compress-range.test.ts
  git commit -m "fix: validate compression batches atomically"
  ```

### Task 3: Model nested block consumption and restoration

**Files:**

- Modify: `src/compress/search.ts`, `src/compress/state.ts`
- Modify: `src/commands/decompress.ts`, `src/commands/recompress.ts`
- Test: `tests/compress-cycle.test.ts`, `tests/commands-decompress.test.ts`

- [ ] **Step 1: Add failing nested-cycle tests**

  Create child, parent, and grandparent blocks. Assert:

  ```ts
  expect(parent.consumedBlockIds).toEqual([child.blockId]);
  expect(child.parentBlockIds).toContain(parent.blockId);
  expect(grandparent.consumedBlockIds).toEqual(
    expect.arrayContaining([parent.blockId]),
  );
  ```

  Then deactivate the parent and verify the child becomes active again unless another active parent still consumes it. Add a recompress case that reconstructs the same relationships.

- [ ] **Step 2: Confirm incomplete nesting**

  ```bash
  pnpm vitest run tests/compress-cycle.test.ts tests/commands-decompress.test.ts
  ```

  Expected: FAIL because contained active blocks or their reverse relationships are incomplete.

- [ ] **Step 3: Apply explicit relationships**

  When a block is created:

  - set `consumedBlockIds` from the resolved selection;
  - deactivate each consumed block with `deactivatedByBlockId`;
  - add the new block ID to each consumed block’s `parentBlockIds`;
  - keep direct message/tool membership separate from effective membership.

  When a parent is deactivated, reactivate a child only when no other active parent consumes it and the child was not deactivated by the user.

- [ ] **Step 4: Rebuild derived indices after each command**

  Reuse the existing compression-state rebuild helper for `activeBlockIds`, anchor mappings, and per-message block membership. Do not update the same derived collection in multiple command handlers.

- [ ] **Step 5: Run nested-cycle tests**

  ```bash
  pnpm vitest run tests/compress-cycle.test.ts tests/commands-decompress.test.ts
  ```

  Expected: child, parent, and grandparent creation/deactivation cycles preserve original content and consistent relationships.

- [ ] **Step 6: Commit nesting behavior**

  ```bash
  git add src/compress/search.ts src/compress/state.ts src/commands/decompress.ts src/commands/recompress.ts tests/compress-cycle.test.ts tests/commands-decompress.test.ts
  git commit -m "fix: preserve nested compression relationships"
  ```

### Task 4: Count incremental visible tokens

**Files:**

- Modify: `src/compress/handler.ts`, `src/compress/state.ts`
- Test: `tests/compress-range.test.ts`, `tests/compress-cycle.test.ts`

- [ ] **Step 1: Add failing accounting tests**

  Assert that:

  - a raw-message range reports nonzero `compressedTokens`;
  - a parent counts a consumed child’s visible summary once, not the child’s hidden original messages;
  - a disjoint batch reports the sum of its blocks;
  - reported savings equal `compressedTokens - summaryTokens`.

- [ ] **Step 2: Confirm current accounting is wrong**

  ```bash
  pnpm vitest run tests/compress-range.test.ts tests/compress-cycle.test.ts -t "tokens"
  ```

  Expected: FAIL with zero or double-counted compressed tokens.

- [ ] **Step 3: Count the selected visible context**

  Before mutating blocks:

  1. Add `summaryTokens` once for each active consumed block.
  2. Mark that block’s effective raw message indices as already represented.
  3. Add `countMessageTokens(message)` for each remaining selected visible message.
  4. Store the total as the new block’s `compressedTokens`.
  5. Count the replacement summary with the existing estimator.

  Pass the calculated values into the state mutation function. Do not make state code reach back into mutable message history.

- [ ] **Step 4: Run accounting tests**

  ```bash
  pnpm vitest run tests/compress-range.test.ts tests/compress-cycle.test.ts
  ```

  Expected: every new block has nonzero input tokens when it replaces visible content, and nested blocks are not double-counted.

- [ ] **Step 5: Commit visible-token accounting**

  ```bash
  git add src/compress/handler.ts src/compress/state.ts tests/compress-range.test.ts tests/compress-cycle.test.ts
  git commit -m "fix: count incremental compression savings"
  ```

### Task 5: Apply tool timing to every block in a batch

**Files:**

- Modify: `src/state/types.ts`, `src/index.ts`
- Test: `tests/compress-notification.test.ts`, `tests/integration.test.ts`

- [ ] **Step 1: Add a failing batch timing test**

  Execute one two-range compression call, emit `tool_execution_end`, and assert:

  ```ts
  expect(blockOne.durationMs).toBe(duration);
  expect(blockTwo.durationMs).toBe(duration);
  ```

- [ ] **Step 2: Confirm only one block is updated**

  ```bash
  pnpm vitest run tests/compress-notification.test.ts -t "every block"
  ```

  Expected: FAIL because timing maps one call to one block or scans only the newest block.

- [ ] **Step 3: Store all result block IDs**

  Replace:

  ```ts
  callIdToBlockId: Map<string, number>;
  ```

  with:

  ```ts
  callIdToBlockIds: Map<string, number[]>;
  ```

  After a successful `handleCompress()`, record its `result.blockIds` under the real tool call ID. On `tool_execution_end`, compute one duration, assign it to each recorded block still present, then delete the timing entry.

  Remove the newest-block timestamp scan.

- [ ] **Step 4: Run timing and notification tests**

  ```bash
  pnpm vitest run tests/compress-notification.test.ts tests/integration.test.ts
  ```

  Expected: every block in a batch receives the same call duration and the user notification reports aggregate block/token data.

- [ ] **Step 5: Commit batch timing**

  ```bash
  git add src/state/types.ts src/index.ts tests/compress-notification.test.ts tests/integration.test.ts
  git commit -m "fix: time every block in compression batches"
  ```

### Task 6: Document and release Phase 3

**Files:**

- Modify: `README.md`, `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md`

- [ ] **Step 1: Document corrected behavior**

  Describe atomic batches, full-range pair/block expansion, incremental visible-token savings, nested decompression behavior, and batch timing. Do not promise cross-session restoration until Phase 4.

- [ ] **Step 2: Run focused compression verification**

  ```bash
  pnpm vitest run tests/compress-range.test.ts tests/compress-cycle.test.ts tests/compress-notification.test.ts tests/commands-decompress.test.ts
  ```

  Expected: all ownership, atomicity, nesting, accounting, command-cycle, and timing tests pass.

- [ ] **Step 3: Run full phase verification**

  ```bash
  pnpm test
  pnpm typecheck
  pnpm lint
  pnpm pack --dry-run
  git diff --check
  git diff --exit-code HEAD -- docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md
  ```

  Expected: all commands pass; lint adds no diagnostics above baseline; the source roadmap remains unchanged.

- [ ] **Step 4: Prove the phase is independently usable**

  In one running session, create a disjoint batch containing a nested active block, observe nonzero savings and timing for every result block, deactivate the parent, and verify the child/original content returns correctly.

- [ ] **Step 5: Commit the Phase 3 release**

  ```bash
  git add README.md CHANGELOG.md docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md
  git commit -m "docs: release compression correctness"
  ```

## Acceptance Criteria

- Real tool-call ownership replaces message-index ownership.
- Invalid or overlapping batches cannot partially mutate state.
- Tool-pair and active-block expansion reaches a complete fixed point.
- Nested consume/deactivate/recompress cycles retain coherent relationships.
- Token accounting measures the visible context replaced and avoids double-counting.
- Timing covers every block from a batch.
- Focused and full verification pass without Phase 4 or Phase 5 code.
- Documentation clearly limits guarantees to the running session.

## Handoff to Phase 4

Phase 4 may serialize and rehydrate:

- `compressToolCallId`;
- `startKey`, `endKey`, and `anchorKey`;
- direct/effective memberships and nested block relationships;
- stable token counts and durations.

Phase 4 must rebuild numeric indices and derived maps from current messages rather than trusting stale runtime caches.

## Release Record

- Status: not started
- Release commit or tag: not recorded
- Verification date: not recorded
