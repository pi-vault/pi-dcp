# Ordinary Compression Block Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make compression run creation, user controls, and context synchronization share one block lifecycle owner.

**Architecture:** `blocks.ts` is the public interface; `block-graph.ts` is its private graph implementation. Move the existing compression handler and synchronization orchestration into the owner, preserving their algorithms. Versioned restoration, initialization/reset, compaction clearing, and timing remain working external writers until phase 4.

**Tech Stack:** Existing TypeScript/ESM, in-process state, Vitest, Biome; Node `>=24.15.0`.

**Spec:** [Approved design](../specs/2026-10-12-dcp-architecture-design.md). [Roadmap and shared constraints](2026-10-12-dcp-architecture-plan.md).

## Global constraints

- Start with completed phases 1 and 2; no phase-4 interface is needed to run this phase.
- Preserve compression selection/validation order, turn protection, overlap errors, protected-content enrichment, summary wrapping, token accounting, and block/run identifiers.
- Preserve current decompression/recompression argument parsing and messages, including `Number.parseInt` behavior; this is not an input-validation redesign.
- Preserve active, consumed, and user-deactivated block behavior and synchronization's removal of orphaned/stale blocks.
- Production callers use only `blocks.ts`; private allocation/storage/rebuild helpers are not part of its external interface.
- Snapshot/read-model shapes remain unchanged. Meaningful internal graph algorithm tests can cross the private implementation seam; broad caller tests should exercise public operations.

## Review focus

- Parent deactivation reveals eligible consumed children but never a user-deactivated child.
- Recompressing a child beneath an active parent restores eligibility without forcing visibility.
- Invalid/overlapping/protected selections leave allocation counters and compression statistics unchanged, preserving current error ordering.
- Stale owning tool calls or missing message keys remove blocks rather than leaving dangling visibility.
- A second compression resolves the message references actually shown by the production pipeline.

## Task 1: Move ordinary transitions and integrate every caller

**Files:**

- Create: `src/compress/blocks.ts`, `src/compress/block-graph.ts`, `tests/compression-blocks.test.ts`.
- Move existing handler implementation from `src/compress/handler.ts` into `blocks.ts` and graph implementation from `src/compress/state.ts` into `block-graph.ts`.
- Move synchronization from `src/messages/sync.ts` and block-control logic from `src/commands/decompress.ts` and `src/commands/recompress.ts` into the owner.
- Modify: `src/index.ts`, `src/pipeline.ts`, `src/messages/inject.ts`, `src/commands/actions.ts`.
- Update existing tests: `tests/compress-range.test.ts`, `tests/compress-message.test.ts`, `tests/compress-cycle.test.ts`, `tests/compress-state.test.ts`, `tests/sync.test.ts`, `tests/prune.test.ts`, `tests/pipeline.test.ts`, `tests/summary-buffer.test.ts`, `tests/compression-timing.test.ts`, `tests/protected-content-integration.test.ts`.
- Rename/update: `tests/commands-decompress.test.ts` to `tests/compression-block-controls.test.ts`.
- Delete the five obsolete production source files above only after their callers and tests have moved; leave no forwarding files.

**Interfaces:**

Produce these public exports in `src/compress/blocks.ts`:

```typescript
export function handleCompress(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  compressToolCallId: string,
  args: CompressArgs,
): CompressResult;

export function decompressBlock(state: SessionState, args: string): string;
export function recompressBlock(state: SessionState, args: string): string;
export function toggleBlock(state: SessionState, blockId: number): string;
export function syncCompressionBlocks(state: SessionState, messages: AgentMessage[]): void;
export function getActiveSummaryTokenUsage(state: SessionState): number;
```

Move `CompressArgs` and `CompressResult` unchanged from the existing handler to this public module. Their fields are fixed: args have `topic`, `mode: "range" | "message"`, optional range `content` with `startId/endId/summary`, and optional `targets` with `messageId/summary`; result has `text`, `messagesCompressed`, `compressedTokens`, `summaryTokens`, `blockIds`, and `topic`.

`toggleBlock` reproduces the old panel dispatch: look up the current block by the supplied numeric ID, then call decompression if active or recompression otherwise using `String(blockId)`. Missing/stale IDs keep the old domain error and permitted-attempt semantics through phase 1's executor.

Move allocation, summary wrapping, storage, eligibility collection, and rebuilding helpers into `block-graph.ts` as internal implementation operations. Do not re-export them from `blocks.ts`. Its production imports are limited to `blocks.ts`; retain only meaningful graph-algorithm tests as direct internal consumers.

- [ ] **Step 1: Establish the current block baseline.** Run `pnpm exec vitest run tests/compress-range.test.ts tests/compress-message.test.ts tests/compress-cycle.test.ts tests/commands-decompress.test.ts tests/sync.test.ts tests/pipeline.test.ts tests/persistence.test.ts tests/compression-timing.test.ts`; expect exit `0`. Preserve those outcomes throughout the move.

- [ ] **Step 2: Write public-seam tests.** Create `tests/compression-blocks.test.ts` using `createSessionState`, `makeDefaultConfig`, existing message helpers, and `runPipeline`. A fixture contains raw older user/assistant messages, an assistant `compress` call with a matching tool result, and a later user message, with distinct timestamps. Run the pipeline before calling compression so references and tool ownership are real. Add these cases:

| Test name | Assertions |
| --- | --- |
| `compresses and restores original context through public operations` | Compress `m1` through `m2`; the next pipeline contains the summary and omits the original text; `decompressBlock(state, "1")` exposes the original text; recompression restores the same summary. |
| `keeps a user-deactivated child excluded after parent removal` | Create child, deactivate it, create a consuming parent, deactivate parent; child summary stays absent and original child content is available. |
| `restores eligible consumed children` | Create child then consuming parent; deactivate parent; child's summary becomes visible and its original content remains covered. |
| `keeps recompressed children hidden by an active parent` | Recompression removes user exclusion; parent remains the visible summary until deactivated. |
| `rejects overlapping and protected selections without committing a run` | Exact existing error strings; serialized block facts/counters/statistics match the before snapshot. |
| `synchronizes orphaned owners and stale references` | Remove the owning tool call or a referenced raw message, then run the pipeline; no orphan summary or active membership remains. |
| `allocates one run for a batch with distinct blocks` | A two-entry request returns two distinct IDs sharing one run; a later request advances IDs and run number without changing token totals. |

For the basic public lifecycle, use these assertions around the real fixture:

```typescript
const result = handleCompress(state, config, rawMessages, "compress-1", {
  topic: "older context",
  mode: "range",
  content: [{ startId: "m1", endId: "m2", summary: "older summary" }],
});
expect(result.blockIds).toEqual([1]);
expect(result.messagesCompressed).toBe(2);
const text = () => runPipeline(state, config, rawMessages, undefined)
  .messages.map(getMessageText).join("\n");
expect(text()).toContain("[Compressed Block b1]");
expect(text()).not.toContain("older user");
expect(decompressBlock(state, "1")).toBe(
  "Block 1 deactivated. Original messages will be restored on next context pass.",
);
expect(text()).toContain("older user");
expect(recompressBlock(state, "1")).toBe(
  "Block 1 reactivated. Compression will apply on next context pass.",
);
expect(text()).toContain("older summary");
```

- [ ] **Step 3: Run the new tests red.** Run `pnpm exec vitest run tests/compression-blocks.test.ts`; expect the missing `blocks.ts` interface or lifecycle assertions to fail. No phase-4 scaffold is introduced to make them compile.

- [ ] **Step 4: Implement the owner and private graph implementation.** Move existing code with its validation, preparation, allocation, commit, and rebuild ordering intact. Place all ordinary graph writes inside these two files. The owner constructs complete blocks internally; callers no longer store a block then patch memberships or flags. Keep `search.ts`, `protected-content.ts`, token estimation, and message-reference computations as their existing read/computation dependencies.

- [ ] **Step 5: Integrate production callers.** The extension imports compression args/results/handler from `blocks.ts`; the pipeline imports synchronization from it; nudge injection imports active summary usage from it. Phase-1 actions call its decompression/recompression/toggle operations instead of importing old command files or inspecting active block state to choose a transition. Remove the old production modules once all imports move.

- [ ] **Step 6: Replace parallel test orchestration and obsolete fixtures.** `compress-cycle.test.ts` calls the real `runPipeline` rather than assigning refs, syncing caches/blocks, injecting, and pruning in its own helper. Keep compression-only fixtures free of unrelated automatic-pruning candidates or explicitly configure those unrelated strategies off when the assertion is solely about compression. Replace broad callers' use of allocation/storage/rebuild helpers with public compression or decoded snapshot fixtures. Move synthetic multi-parent graph-algorithm assertions into the owner implementation's existing `compress-state.test.ts` suite; retain them rather than dropping meaningful coverage. Update all listed handler/summary/control imports, then remove helper-only tests that duplicate the new observable coverage.

- [ ] **Step 7: Verify the phase-3 stopping point.** Run `pnpm exec vitest run tests/compression-blocks.test.ts tests/compression-block-controls.test.ts tests/compress-state.test.ts tests/compress-range.test.ts tests/compress-message.test.ts tests/compress-cycle.test.ts tests/sync.test.ts tests/prune.test.ts tests/pipeline.test.ts tests/summary-buffer.test.ts tests/persistence.test.ts tests/compression-timing.test.ts tests/protected-content-integration.test.ts tests/dcp-actions.test.ts tests/benchmark.test.ts`; expect exit `0`. This must prove existing restore, reset, and timing still work before phase 4 exists.

- [ ] **Step 8: Audit imports and run the complete gate.** Search for imports of `compress/handler.ts`, `compress/state.ts`, `messages/sync.ts`, `commands/decompress.ts`, and `commands/recompress.ts`; there must be no production or test import to a deleted path. Production imports of `block-graph.ts` come only from `blocks.ts`. Run `pnpm check` and `git diff --check`; both exit `0`.

- [ ] **Step 9: Commit the entire phase.** Stage the new owner/private implementation, all migrated callers/tests, and the deleted old source files. Commit as `refactor: own ordinary compression block transitions`.

## Atomic exit and remaining writers

Both compression modes, operator controls, synchronization, and the production pipeline work through the owner. Existing snapshots and timing remain usable. Only these live-block write paths intentionally remain outside it:

- `src/state/state.ts`: initial block-state creation and full reset.
- `src/state/persistence.ts`: decoded block materialization and restored allocation counters.
- `src/index.ts`: compaction clearing and block duration writes.

These are explicit phase-4 work, not missing implementations in this phase. Session statistics, tool pruning, message references, nudges, and start-time tracking are separate state concerns. Revert the complete phase-3 commit to restore the old block modules without affecting phases 1 and 2.
