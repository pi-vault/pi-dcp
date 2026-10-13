# Ordinary Compression Block Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make compression run creation, user controls, and context synchronization share one block lifecycle owner.

**Architecture:** `blocks.ts` is the public interface; `block-graph.ts` is its private graph implementation. Move the existing compression handler and synchronization orchestration into the owner, preserving their algorithms. Versioned restoration, initialization/reset, compaction clearing, and timing remain working external writers until phase 4.

**Tech Stack:** Existing TypeScript/ESM, in-process state, Vitest, Biome; Node `>=24.15.0`.

**Spec:** [Approved design](../specs/2026-10-12-dcp-architecture-design.md). [Roadmap and shared constraints](2026-10-12-dcp-architecture-plan.md).

## Readiness review — 2026-10-12

The revised plan is ready to implement against the reviewed repository. The original ownership boundary is sound, but its child-deactivation fixture did not create the consumption relationship it claimed to test, and its pre-seeded compression owner skipped the production execution boundary. This revision corrects the fixtures, makes error ordering and token accounting explicit, and adds extension integration coverage. It preserves the approved design and public interface. This review completes no implementation checkbox.

- Reviewed DCP HEAD: `0df5fb3cb63bbc4d84b08abb483e47f1d9deeeae` (`0df5fb3`), initially clean. Phases 1 and 2 are merged: commands/panel use `executeDcpAction`, and `src/tool-selection.ts` owns selection transitions. Implement against this result, not the roadmap's historical `2258ca5` baseline.
- Current verification: `pnpm check` passed with `901` tests across `60` suites on Node `v24.21.0`; the ten suites in Step 1 passed with `160` tests. Rerun the baseline and final gates during implementation.
- No block owner exists yet. The compression handler, graph helpers, controls, and synchronization still occupy the five modules listed below. Their callers match the extraction scope; no phase-4 scaffold or runtime dependency is needed.
- `resolveSelection` consumes only active blocks. Deactivating a child before creating a parent over its raw messages produces `consumedBlockIds: []`; it does not test a user-deactivated consumed child. The revised tests first establish consumption, deactivate the parent to expose the child, deactivate the child, then reactivate the parent using its existing summary.
- Synchronization requires stable boundary/anchor keys and a cached owning assistant tool call, not a completed tool result. Missing boundary/anchor keys or an absent owner remove a block; a pending owner preserves it. Do not invent rejection of pending owners or removal on every missing interior message.
- Message markers are appended to existing user/assistant text parts, not tool results or tool-call-only assistant messages. A message-mode tool-chain fixture includes assistant text alongside the call and selects its visible marker; selection expands to include the matching result. Preserve this behavior rather than changing marker injection in this refactor.
- Read-only checks through the existing handler/controls and real `runPipeline` verified the corrected nested sequences, pending-owner retention, missing-owner removal, message-mode expansion from a visible assistant marker, and protection-before-overlap error ordering without committing snapshot/counter/statistic changes on rejection. These are characterization evidence, not phase-3 implementation tests.

### Pi reference and host boundary

Read-only reference: `/Users/lanh/Developer/pi-packages/pi`, clean at `7bd01fb92485c06f92ecfff7ccf3197148bc16af`. Its agent and coding-agent packages and DCP's installed counterparts report `1.1.0`. Installed package declarations/runtime remain authoritative for compilation; the checkout explains the host contract and adds no dependency.

| Reference file and symbols                                                                                                          | Contract and consequence                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent/src/agent-loop.ts` — `streamAssistantResponse`, `runLoop`                                                           | Context transformation runs before the next model request. The assistant compression call is generated afterward, and tool results are appended after execution. Do not require the current call to be present in DCP's previous context cache before creating its blocks.                                                 |
| `packages/coding-agent/src/core/sdk.ts` — `transformContext`; `packages/coding-agent/src/core/extensions/runner.ts` — `emitContext` | Pi clones request messages and invokes conversation `context` handlers without system messages. DCP stores its incoming conversation as `latestMessages` and returns a transformed view. Tests must keep raw history separate from returned summaries/markers and must not feed that transformed view back as raw history. |
| `packages/agent/src/agent-loop.ts` — `executeToolCallsSequential`, `emitToolExecutionEnd`                                           | Completion is emitted before the tool-result message is added to history. Keep DCP's completion timing/persistence adapter working before the following context pass; synchronization can retain an owning call whose result is still pending.                                                                             |
| `packages/coding-agent/src/core/extensions/types.ts` — `ToolDefinition.executionMode`, `ToolExecutionEndEvent`                      | DCP registers `compress` with `executionMode: "sequential"`. Keep registration, per-call approval/policy rechecks, and completion handling in `index.ts`; extracting the synchronous handler must not add tool-selection writes or change those contracts.                                                                 |

`createExtensionHarness.executeTool` directly invokes a registered definition; it does not generate assistant calls, append results, emit completion, or transform context automatically. Integration tests arrange those events explicitly in Pi's order with unique timestamps and matching call IDs. No harness rewrite or new host adapter is required.

## Global constraints

- Start with completed phases 1 and 2; no phase-4 interface is needed to run this phase.
- Preserve compression selection/validation order, turn protection, overlap errors, protected-content enrichment, summary wrapping, token accounting, and block/run identifiers.
- Preserve current decompression/recompression argument parsing and messages, including `Number.parseInt` behavior; this is not an input-validation redesign.
- Preserve active, consumed, and user-deactivated block behavior and synchronization's removal of orphaned/stale blocks.
- Production callers use only `blocks.ts`; private allocation/storage/rebuild helpers are not part of its external interface.
- Snapshot/read-model shapes remain unchanged. Meaningful internal graph algorithm tests can cross the private implementation seam; broad caller tests should exercise public operations.
- Keep Node `>=24.15.0`, current dependencies, snapshot serialization version `2`, and reading versions `1` and `2`. Introduce no configuration option, package version bump, or changed approval/tool-selection behavior.

## Review focus

- Parent deactivation reveals eligible consumed children but never a user-deactivated child.
- Recompressing a child beneath an active parent restores eligibility without forcing visibility.
- Invalid/overlapping/protected selections leave allocation counters and compression statistics unchanged, preserving current error ordering.
- Absent owning tool calls or missing boundary/anchor keys remove blocks rather than leaving dangling visibility; pending owners remain valid.
- A second compression resolves the message references actually shown by the production pipeline.

## Task 1: Move ordinary transitions and integrate every caller

**Files:**

- Create: `src/compress/blocks.ts`, `src/compress/block-graph.ts`, `tests/compression-blocks.test.ts`.
- Move existing handler implementation from `src/compress/handler.ts` into `blocks.ts` and graph implementation from `src/compress/state.ts` into `block-graph.ts`.
- Move synchronization from `src/messages/sync.ts` and block-control logic from `src/commands/decompress.ts` and `src/commands/recompress.ts` into the owner.
- Modify: `src/index.ts`, `src/pipeline.ts`, `src/messages/inject.ts`, `src/commands/actions.ts`.
- Update existing tests: `tests/compress-range.test.ts`, `tests/compress-message.test.ts`, `tests/compress-cycle.test.ts`, `tests/compress-state.test.ts`, `tests/sync.test.ts`, `tests/prune.test.ts`, `tests/pipeline.test.ts`, `tests/summary-buffer.test.ts`, `tests/compression-timing.test.ts`, `tests/protected-content-integration.test.ts`, `tests/pi-contract.test.ts`, `tests/dcp-actions.test.ts`.
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
export function syncCompressionBlocks(
  state: SessionState,
  messages: AgentMessage[],
): void;
export function getActiveSummaryTokenUsage(state: SessionState): number;
```

Move `CompressArgs` and `CompressResult` unchanged from the existing handler to this public module. Their fields are fixed: args have `topic`, `mode: "range" | "message"`, optional range `content` with `startId/endId/summary`, and optional `targets` with `messageId/summary`; result has `text`, `messagesCompressed`, `compressedTokens`, `summaryTokens`, `blockIds`, and `topic`.

`toggleBlock` reproduces the old panel dispatch: look up the current block by the supplied numeric ID, then call decompression if active or recompression otherwise using `String(blockId)`. Missing/stale IDs keep the old domain error and permitted-attempt semantics through phase 1's executor.

Move allocation, summary wrapping, storage, eligibility collection, and rebuilding helpers into `block-graph.ts` as internal implementation operations. Do not re-export them from `blocks.ts`. Its production imports are limited to `blocks.ts`; retain only meaningful graph-algorithm tests as direct internal consumers.

- [ ] **Step 1: Establish the current block baseline.** Confirm a clean or understood worktree and merged phases 1 and 2. Run `pnpm exec vitest run tests/compress-range.test.ts tests/compress-message.test.ts tests/compress-cycle.test.ts tests/commands-decompress.test.ts tests/sync.test.ts tests/pipeline.test.ts tests/persistence.test.ts tests/compression-timing.test.ts tests/pi-contract.test.ts tests/dcp-actions.test.ts`; expect exit `0`. Preserve those outcomes throughout the move.

- [ ] **Step 2: Write public-seam tests.** Create `tests/compression-blocks.test.ts` using `createSessionState`, `makeDefaultConfig`, existing message helpers, and `runPipeline`. Set `state.sessionId = "block-lifecycle-test"` so snapshot comparisons cannot silently compare two `undefined` values. Use deterministic, distinct timestamps and complete assistant tool-call parts (`type`, `id`, `name: "compress"`, `arguments`), plus matching `makeToolResultMessage` results.

For the initial fixture, raw history contains older user/assistant text and a later user message, with no current compression owner. Run the pipeline to establish references, call `handleCompress` on that raw history, then append its assistant owner and matching result before the next pipeline pass. Each later compression follows the same order; retain every earlier owner while its block is expected to survive. Always pass raw messages to the handler/pipeline, never the pipeline's transformed output. Configure unrelated deduplication/purge-errors off for compression-only fixtures, or prove the fixture has no candidates. The dedicated protection tests set `turnProtection = 1`; other lifecycle tests leave it at `0`.

Add these cases:

| Test name                                                                    | Assertions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compresses and restores original context through public operations`         | Compress `m1` through `m2`; the next pipeline contains the summary and omits the original text; `decompressBlock(state, "1")` exposes the original text; recompression restores the same summary.                                                                                                                                                                                                                                                                                                                   |
| `keeps a user-deactivated consumed child excluded after parent deactivation` | Create child `b1` over `m1..m2`, synchronize its owner, then create parent `b2` over `b1..b1` and synchronize. Assert parent consumes `[1]`. Deactivate parent, deactivate the exposed child, reactivate parent, then deactivate parent again, running the pipeline after each operation. Child remains user-deactivated; its summary stays absent and original child content is available.                                                                                                                         |
| `restores eligible consumed children`                                        | Create child then consuming parent; deactivate parent; child's summary becomes visible and its original content remains covered.                                                                                                                                                                                                                                                                                                                                                                                    |
| `keeps recompressed children hidden by an active parent`                     | Establish real child/parent consumption, deactivate parent then child, and reactivate parent. Recompress child beneath that active parent: user exclusion clears, child stays inactive with `deactivatedByBlockId === 2`, and only parent summary is visible. Deactivate parent; child summary becomes visible. No new block/run, summary, or compression-statistic change occurs during controls.                                                                                                                  |
| `validates the complete request before committing a run`                     | Separate cases for an empty range/message request, a valid first entry followed by unavailable `m9999`, reversed boundaries, overlapping batch ranges, and a protected range. Assert current exact error strings and unchanged durable snapshot plus derived block maps/sets. No partial block/run or statistic allocation.                                                                                                                                                                                         |
| `preserves validation precedence after selection expansion`                  | A request that both overlaps and selects the newest protected turn reports `Compression overlaps the turnProtection protected window; choose only older messages.`; ordinary expanded overlap reports `Overlapping compression selections are not allowed.`. A valid first entry followed by unavailable `m9999` reports the boundary error before either batch check. Preserve expansion-induced overlap through a real active child block and tool-call/result-chain expansion cases in the existing mode suites. |
| `synchronizes orphaned owners and stale boundary references`                 | Separate fixtures remove the owning assistant call, remove the start/end boundary, or replace the branch with `[]`, then run the pipeline. Blocks and derived memberships/anchors disappear; surviving original content is visible. Removing a consuming parent's owner reveals an eligible surviving child and removes its dangling parent link. IDs/counters are not reset or reused.                                                                                                                             |
| `retains a block whose owner has no result yet`                              | Create a block, append only its matching assistant call, then run the pipeline. Its summary remains active with owner status `pending`; appending the matching result on a later pass preserves the same block and summary.                                                                                                                                                                                                                                                                                         |
| `allocates one run for a batch with distinct blocks`                         | Two disjoint entries return IDs `[1, 2]` with run `1`, correct wrappers and next counters `3`/`2`. Result token totals equal sums of those blocks' token fields; `messagesCompressed` equals their effective membership count. A later disjoint compression gets block `3`, run `2`, and counters `4`/`3`; earlier token fields stay unchanged and `state.stats.messagesCompressed` increases by the later result's count.                                                                                          |
| `counts consumed summaries once through the production pipeline`             | Child covers `m1..m2`; parent covers `b1` plus an uncovered older message. Parent `compressedTokens` equals child `summaryTokens` plus tokens of the uncovered direct messages, with no repeated raw-child charge; summary tokens include the wrapped, enriched text. Controls/synchronization leave stored token totals and `state.stats` unchanged.                                                                                                                                                               |
| `expands message-mode targets without splitting tool chains`                 | Use `makeDefaultConfig({ mode: "message" })`, a completed ordinary tool call/result pair with assistant text alongside the call, and a later user turn. Select the marker actually emitted for that assistant; its block covers both call and result. The next pipeline contains its summary and neither original call nor result. Decompression/recompression restores the pair/summary. Retain existing protection and block-expansion checks.                                                                    |

For the basic public lifecycle, use these assertions around the fixture described above. Append the matching `compress-1` assistant call and result after `handleCompress` returns and before the first `text()` call:

```typescript
const result = handleCompress(state, config, rawMessages, "compress-1", {
  topic: "older context",
  mode: "range",
  content: [{ startId: "m1", endId: "m2", summary: "older summary" }],
});
expect(result.blockIds).toEqual([1]);
expect(result.messagesCompressed).toBe(2);
const text = () =>
  runPipeline(state, config, rawMessages, undefined)
    .messages.map(getMessageText)
    .join("\n");
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

- [ ] **Step 3: Run the new tests red.** Run `pnpm exec vitest run tests/compression-blocks.test.ts`; expect the missing `blocks.ts` interface to fail. The fixtures describe current behavior: after the module exists, a lifecycle failure calls for checking the fixture/move, not silently changing the approved algorithm. No phase-4 scaffold is introduced to make them compile.

- [ ] **Step 4: Implement the owner and private graph implementation.** Move existing code with its validation, preparation, allocation, commit, and rebuild ordering intact. Place all ordinary graph writes inside these two files. The owner constructs complete blocks internally; callers no longer store a block then patch memberships or flags. Keep `search.ts`, `protected-content.ts`, token estimation, and message-reference computations as their existing read/computation dependencies.

- [ ] **Step 5: Integrate production callers.** The extension imports compression args/results/handler from `blocks.ts`; the pipeline imports synchronization from it; nudge injection imports active summary usage from it. Phase-1 actions call its decompression/recompression/toggle operations instead of importing old command files or inspecting active block state to choose a transition. Remove the old production modules once all imports move.

Keep pipeline ordering unchanged: strip hallucinations, assign references, synchronize the tool cache/list and stale reference/nudge state, synchronize blocks, run strategies, calculate priorities, inject IDs/nudges, then prune. The owner consumes already-current reference/tool caches; it neither runs the pipeline nor changes tool selection. Keep policy/approval, `latestMessages`, timing start/completion, notifications, and persistence in the extension adapter.

Add `creates and controls blocks across real extension context passes` in `tests/pi-contract.test.ts`, parameterized for range and message modes using its existing temporary config setup and `createExtensionHarness`. Emit `session_start`, then a `context` event over a clone of raw older messages. Append the generated assistant call to host raw history without emitting another context event, then execute `compress` with markers from the returned view and `toolCallId: "compress-1"`; DCP's cached context still lacks the current owner. Assert the existing result text, emit `tool_execution_end` with the returned result and `isError: false`, then append the matching tool result before the next context event. Confirm summary visibility, unchanged original message contents, and a version-2 checkpoint with the correct owner ID. Run `dcp:decompress` then `dcp:recompress` with intervening context events: original content and the same summary return respectively, while block/run counters and compression statistics do not advance. Retain existing per-call approval, denial, timing, persistence, and selection tests.

In `tests/dcp-actions.test.ts`, retain policy rejection, stale missing-block permitted attempts, callback identity/count, and exception propagation. Add a real nested-block toggle case using the public compression operation and real pipeline: a hidden consumed child toggle reports `Block 1 was not deactivated by user. Cannot reactivate.` and still invokes the callback once; toggling the active parent exposes the child. Execution uses current block state even when the panel's displayed row is stale.

- [ ] **Step 6: Replace parallel test orchestration and obsolete fixtures.** `compress-cycle.test.ts` calls the real `runPipeline` rather than assigning refs, syncing caches/blocks, injecting, and pruning in its own helper. Replace its user-message stand-ins for compression results with matching `toolResult` messages, and its incomplete owner messages with complete named tool-call parts and distinct timestamps. Assert the second compression uses the actual surviving markers shown by the first production pass; include nested `b1`/`b2` consumption. Keep compression-only fixtures free of unrelated automatic-pruning candidates or explicitly configure those unrelated strategies off when the assertion is solely about compression.

Replace broad callers' use of allocation/storage/rebuild helpers with public compression or existing decoded snapshot fixtures. Use restored snapshots where a test intentionally needs a different anchor, missing key, or inactive runtime indices; phase 3 does not introduce the phase-4 restoration interface. Move both synthetic graph cases from `sync.test.ts` (multiple parents and an eligible grandparent with an ineligible intermediate parent) into `compress-state.test.ts` and import private helpers there only. The latter case retains the intermediate block; do not change it into missing-owner synchronization, which has different semantics. Retain coverage of graph relationships and visibility, then remove helper-only tests only where equivalent observable coverage exists.

Rename the control suite and imports to `decompressBlock`/`recompressBlock`. Preserve exact usage, missing/invalid/active/inactive/non-user-deactivated messages for both controls. Pin `Number.parseInt` compatibility with whitespace, `"1suffix"`, `"1.9"`, `"b1"`, and missing numeric IDs, plus toggle dispatch for active, user-deactivated, consumed, and missing blocks. Controls do not change stored summary/tokens, block/run counters, or compression statistics.

- [ ] **Step 7: Verify the phase-3 stopping point.** Run `pnpm exec vitest run tests/compression-blocks.test.ts tests/compression-block-controls.test.ts tests/compress-state.test.ts tests/compress-range.test.ts tests/compress-message.test.ts tests/compress-cycle.test.ts tests/sync.test.ts tests/prune.test.ts tests/pipeline.test.ts tests/summary-buffer.test.ts tests/persistence.test.ts tests/compression-timing.test.ts tests/protected-content-integration.test.ts tests/dcp-actions.test.ts tests/pi-contract.test.ts tests/index.test.ts tests/state.test.ts tests/compress-permission.test.ts tests/benchmark.test.ts`; expect exit `0`. This must prove existing restore, reset, timing, guarded callbacks, and host execution still work before phase 4 exists.

- [ ] **Step 8: Audit imports and run the complete gate.** Search for imports of `compress/handler.ts`, `compress/state.ts`, `messages/sync.ts`, `commands/decompress.ts`, and `commands/recompress.ts`, including sibling-relative imports; there must be no production or test import to a deleted path. Production imports of `block-graph.ts` come only from `blocks.ts`; direct test imports occur only in `compress-state.test.ts`. Audit writes to block records, membership/anchor maps, active IDs, and allocation counters against the exception list below; adapters must not keep ordinary transitions. Run `pnpm check` and `git diff --check`; both exit `0`.

- [ ] **Step 9: Commit the entire phase.** Stage the new owner/private implementation, all migrated callers/tests, and the deleted old source files. Commit as `refactor: own ordinary compression block transitions`.

## Atomic exit and remaining writers

Both compression modes, operator controls, synchronization, and the production pipeline work through the owner. Existing snapshots and timing remain usable. Only these live-block write paths intentionally remain outside it:

- `src/state/state.ts`: initial block-state creation and full reset.
- `src/state/persistence.ts`: decoded block materialization and restored allocation counters.
- `src/index.ts`: compaction clearing and block duration writes.

These are explicit phase-4 work, not missing implementations in this phase. Session statistics, tool pruning, message references, nudges, and start-time tracking are separate state concerns. Revert the complete phase-3 commit to restore the old block modules without affecting phases 1 and 2.
