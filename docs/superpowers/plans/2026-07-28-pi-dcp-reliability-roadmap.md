# Pi DCP Reliability Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pi DCP session state, compression, pruning, configuration, and operator controls reliable across resume, fork, tree navigation, and compaction while preserving existing v0.4 commands and JSON configuration.

**Architecture:** Use Pi’s native append-only custom session entries instead of a second sidecar persistence system. Store versioned DCP snapshots on the active branch, restore them from `sessionManager.getBranch()`, and rebuild derived runtime indices from current messages. Keep compression and pruning as pure pipeline transformations with explicit tool-call ownership and user-turn age.

**Tech Stack:** TypeScript ESM, Pi ExtensionAPI 0.80.3-compatible APIs, TypeBox, Vitest, pnpm, Node standard-library filesystem and performance APIs. No new runtime dependencies.

---

## File Map

- `src/state/types.ts`, `src/state/state.ts`: durable/runtime state separation, snapshot types, user-turn metadata.
- `src/state/persistence.ts`: versioned snapshot serialization/validation and lifetime-session scanning; no session-state file writes.
- `src/index.ts`: Pi lifecycle integration, snapshot restore/append, project config loading, compression-tool registration.
- `src/messages/sync.ts`, `src/messages/inject.ts`: stable reference assignment, snapshot rehydration, stale-anchor cleanup.
- `src/compress/handler.ts`, `src/compress/search.ts`, `src/compress/state.ts`: tool-call ownership, token accounting, nested block relationships, batch timing.
- `src/messages/prune.ts`, `src/strategies/runner.ts`, `src/state/tool-cache.ts`: failed-input semantics, protected tools, user-turn protection, pair safety.
- `src/config.ts`, `src/config-schema.ts`, `src/commands/register.ts`, `src/commands/compress.ts`: project precedence, live config access, manual compression.
- `tests/`: focused regression tests for each task plus Pi lifecycle mocks.
- `scripts/benchmark.ts`, `package.json`, `README.md`, `dcp.schema.json`: deterministic benchmark, documentation, and generated schema.

## Compatibility Decisions

- Existing shared `{sessionDir}/dcp/state.json` files are left untouched and are never used to restore runtime state. They contain a random DCP ID rather than Pi’s session ID and cannot be safely attributed.
- New snapshots use `customType: "pi-dcp-state"` and `version: 1`.
- `turnProtection` is a new top-level number defaulting to `0`; `0` preserves current behavior.
- Existing `strategies.deduplication.turnProtection` remains valid and applies only to deduplication. Deduplication uses the larger of the legacy and top-level values.
- Default protected tools are `compress`, `write`, `edit`, and `subagent`.
- Project config is JSON, merged as defaults → global config → trusted `<ctx.cwd>/.pi/dcp.json`; nested objects merge and arrays replace.
- Benchmarks produce informational before/after evidence. No 10%/15% release gate is added without measured variance data.

### Task 1: Record provenance and establish verification baselines

**Files:**

- Create: `docs/superpowers/audits/2026-07-28-pi-dcp-provenance.md`
- Inspect: the four reference repositories listed in the comparative audit

- [ ] **Step 1: Write the provenance record**

  Record each repository’s commit, package version, declared license, corresponding modules, and the rule that external source is behavioral reference only. Record Pi’s `appendEntry`, `getBranch`, `getSessionId`, `session_tree`, `sendMessage`, and project-trust APIs as verified in the installed 0.80.3 dependency and reference 0.82.0 checkout.

- [ ] **Step 2: Capture the current baseline**

  Run:

  ```bash
  pnpm test
  pnpm typecheck
  pnpm lint
  git diff --check
  ```

  Record the passing test count, typecheck result, and existing lint-warning count. The audit baseline is 368 passing tests, successful typechecking, and 88 existing lint warnings; later verification must not add warnings.

- [ ] **Step 3: Commit the provenance record**

  ```bash
  git add docs/superpowers/audits/2026-07-28-pi-dcp-provenance.md
  git commit -m "docs: record pi-dcp provenance baseline"
  ```

### Task 2: Replace shared sidecar state with native Pi snapshots

**Files:**

- Modify: `src/state/types.ts`, `src/state/state.ts`, `src/state/persistence.ts`
- Modify: `src/index.ts`, `src/messages/sync.ts`, `src/messages/inject.ts`
- Test: `tests/persistence.test.ts`, `tests/integration.test.ts`, `tests/messages-inject.test.ts`

- [ ] **Step 1: Add failing snapshot contract tests**

  Add tests for the exact serialized shape and branch behavior:

  ```ts
  import type { CompressionBlock, DcpSnapshotV1 } from "../src/state/types.ts";
  import { createSessionState } from "../src/state/state.ts";
  import {
    restoreDcpSnapshot,
    serializeDcpSnapshot,
  } from "../src/state/persistence.ts";

  const makeActiveBlock = (blockId: number): CompressionBlock => ({
    blockId,
    runId: 1,
    active: true,
    deactivatedByUser: false,
    compressedTokens: 20,
    summaryTokens: 5,
    durationMs: 1,
    mode: "range",
    topic: "fixture",
    batchTopic: "fixture",
    startIndex: 0,
    endIndex: 1,
    anchorIndex: 0,
    compressToolCallId: "compress-call-1",
    includedBlockIds: [],
    consumedBlockIds: [],
    parentBlockIds: [],
    directMessageIndices: [0, 1],
    directToolIds: [],
    effectiveMessageIndices: [0, 1],
    effectiveToolIds: [],
    createdAt: 1,
    deactivatedAt: undefined,
    deactivatedByBlockId: undefined,
    summary: "[Compressed Block b1] fixture [End Block b1]",
  });

  const makeSnapshot = (ownerSessionId: string): DcpSnapshotV1 => {
    const fixture = createSessionState();
    fixture.prune.messages.blocksById.set(1, makeActiveBlock(1));
    return serializeDcpSnapshot(fixture, ownerSessionId);
  };

  const makeSnapshotWithMalformedBlock = (): DcpSnapshotV1 => {
    const snapshot = makeSnapshot("pi-session-1");
    snapshot.blocks.push({ blockId: "invalid" } as unknown as CompressionBlock);
    return snapshot;
  };

  it("round-trips durable state without runtime caches", () => {
    const state = createSessionState();
    state.stats.messagesCompressed = 2;
    state.prune.tools.set("call-1", 42);
    state.prune.messages.blocksById.set(1, makeActiveBlock(1));

    const snapshot = serializeDcpSnapshot(state, "pi-session-1");
    const restored = restoreDcpSnapshot(
      snapshot,
      createSessionState(),
      "pi-session-1",
    );

    expect(restored.stats.messagesCompressed).toBe(2);
    expect(restored.prune.tools.get("call-1")).toBe(42);
    expect(restored.prune.messages.blocksById.has(1)).toBe(true);
    expect(restored.toolParameters.size).toBe(0);
  });

  it("resets only statistics when restoring a fork-owned snapshot", () => {
    const restored = restoreDcpSnapshot(
      makeSnapshot("parent"),
      createSessionState(),
      "child",
    );
    expect(restored.prune.messages.blocksById.size).toBe(1);
    expect(restored.stats.toolsPruned).toBe(0);
  });

  it("ignores malformed blocks while retaining valid blocks", () => {
    const restored = restoreDcpSnapshot(
      makeSnapshotWithMalformedBlock(),
      createSessionState(),
      "pi-session-1",
    );
    expect(restored.prune.messages.blocksById.has(1)).toBe(true);
    expect(restored.prune.messages.blocksById.has(2)).toBe(false);
  });
  ```

- [ ] **Step 2: Define the durable snapshot type**

  Add this shape to `src/state/types.ts`:

  ```ts
  export interface DcpSnapshotV1 {
    version: 1;
    ownerSessionId: string;
    manualMode: false | "active";
    compressPermission: "allow" | "deny";
    stats: SessionStats;
    lastCompaction: number;
    pruneTools: Array<[string, number]>;
    blocks: CompressionBlock[];
    nextBlockId: number;
    nextRunId: number;
    messageIds: {
      byRawId: Record<string, string>;
      byRef: Record<string, string>;
      nextRefIndex: number;
    };
    nudges: {
      contextLimitAnchors: string[];
      turnAnchors: string[];
      iterationAnchors: string[];
    };
  }
  ```

  Do not serialize `toolParameters`, `toolIdList`, `byIndex`, `activeBlockIds`, `activeByAnchorIndex`, model metadata, timing maps, or sub-agent result caches; these are rebuilt or are ephemeral.

- [ ] **Step 3: Implement serializer and validator**

  Implement `serializeDcpSnapshot(state, ownerSessionId)` and `restoreDcpSnapshot(snapshot, state, currentSessionId)`. Serialize `state.compressPermission ?? "allow"`. Validate the root object, version, owner ID, finite numbers, arrays, map-entry shapes, and every compression block. Discard malformed blocks and send one warning per discarded block to the existing logger. Rebuild active block IDs, anchor mappings, and per-message block entries from valid blocks instead of trusting duplicated serialized sets.

- [ ] **Step 4: Restore from the active Pi branch**

  In `session_start` and `session_tree`, scan `ctx.sessionManager.getBranch()` from newest to oldest for `type === "custom" && customType === "pi-dcp-state"`. Restore the newest valid snapshot, then set `state.sessionId = ctx.sessionManager.getSessionId()`.

- [ ] **Step 5: Append snapshots after durable mutations**

  Add a closure in `src/index.ts`:

  ```ts
  const persistSnapshot = (ctx: ExtensionContext): void => {
    pi.appendEntry(
      "pi-dcp-state",
      serializeDcpSnapshot(state, ctx.sessionManager.getSessionId()),
    );
  };
  ```

  Add `durableStateFingerprint(state): string` as `JSON.stringify(serializeDcpSnapshot(state, "fingerprint"))`. Capture the fingerprint before each pipeline pass or command, and call `persistSnapshot(ctx)` only when the fingerprint changes after successful compression, strategy/nudge changes, sweep, manual/permission changes, decompress/recompress, compaction reset, or tree navigation.

- [ ] **Step 6: Rehydrate message indices in the pipeline**

  Reorder `runPipeline` so `assignMessageRefs(state, messages)` runs before compression-block restoration. Map each block’s stable boundary keys to current indices, deactivate blocks whose boundaries no longer exist, and remove nudge anchors whose keys are absent. Keep existing message-reference formats for compatibility.

- [ ] **Step 7: Run focused persistence tests**

  ```bash
  pnpm vitest run tests/persistence.test.ts tests/integration.test.ts tests/messages-inject.test.ts
  ```

  Expected: snapshot round-trip, fork ownership, malformed-block handling, stale-anchor cleanup, and session-entry restoration pass.

- [ ] **Step 8: Commit native persistence**

  ```bash
  git add src/state src/index.ts src/messages/sync.ts src/messages/inject.ts tests/persistence.test.ts tests/integration.test.ts tests/messages-inject.test.ts
  git commit -m "fix: persist dcp state in pi session entries"
  ```

### Task 3: Make compression ownership, nesting, and token accounting correct

**Files:**

- Modify: `src/state/types.ts`, `src/compress/handler.ts`, `src/compress/search.ts`, `src/compress/state.ts`
- Modify: `src/index.ts`, `src/messages/sync.ts`
- Test: `tests/compress-range.test.ts`, `tests/compress-cycle.test.ts`, `tests/compress-notification.test.ts`

- [ ] **Step 1: Add failing compression regressions**

  Cover these exact behaviors:

  ```ts
  import type { AgentMessage } from "@earendil-works/pi-agent-core";
  import {
    makeAssistantMessage,
    makeDefaultConfig,
    makeUserMessage,
  } from "./helpers.ts";
  import { createSessionState } from "../src/state/state.ts";

  const state = createSessionState();
  const config = makeDefaultConfig();
  const messages: AgentMessage[] = [
    makeUserMessage("one", 1000),
    makeAssistantMessage("two", 1001),
    makeUserMessage("three", 1002),
    makeAssistantMessage("four", 1003),
  ];
  state.messageIds.byIndex.set(0, "m0001");
  state.messageIds.byIndex.set(1, "m0002");
  state.messageIds.byIndex.set(2, "m0003");
  state.messageIds.byIndex.set(3, "m0004");

  it("reports nonzero incremental tokens", () => {
    const rangeArgs: CompressArgs = {
      mode: "range",
      topic: "fixture",
      content: [
        { startId: "m0001", endId: "m0002", summary: "fixture summary" },
      ],
    };
    const result = handleCompress(
      state,
      config,
      messages,
      "compress-call-1",
      rangeArgs,
    );
    expect(result.compressedTokens).toBeGreaterThan(0);
  });

  it("records every block created by a batch under one tool call", () => {
    const batchArgs: CompressArgs = {
      mode: "range",
      topic: "fixture",
      content: [
        { startId: "m0001", endId: "m0001", summary: "first" },
        { startId: "m0003", endId: "m0003", summary: "second" },
      ],
    };
    const result = handleCompress(
      state,
      config,
      messages,
      "compress-call-1",
      batchArgs,
    );
    expect(result.blockIds).toHaveLength(2);
    for (const id of result.blockIds) {
      expect(state.prune.messages.blocksById.get(id)?.compressToolCallId).toBe(
        "compress-call-1",
      );
    }
  });

  it("consumes a contained active block and restores original content after parent deactivation", () => {
    const childArgs: CompressArgs = {
      mode: "range",
      topic: "child",
      content: [{ startId: "m0002", endId: "m0002", summary: "child" }],
    };
    const parentArgs: CompressArgs = {
      mode: "range",
      topic: "parent",
      content: [{ startId: "m0001", endId: "m0003", summary: "parent" }],
    };
    const child = handleCompress(
      state,
      config,
      messages,
      "compress-child",
      childArgs,
    ).blockIds[0];
    const parent = handleCompress(
      state,
      config,
      messages,
      "compress-parent",
      parentArgs,
    ).blockIds[0];
    expect(
      state.prune.messages.blocksById.get(parent).consumedBlockIds,
    ).toContain(child);
    expect(decompressCommand(state, String(parent))).toContain("restored");
  });
  ```

- [ ] **Step 2: Change block ownership and handler signatures**

  Extend `CompressionBlock` with `compressToolCallId: string` and remove `compressMessageIndex`. Change the handler signature to:

  ```ts
  export function handleCompress(
    state: SessionState,
    config: DcpConfig,
    messages: AgentMessage[],
    compressToolCallId: string,
    args: CompressArgs,
  ): CompressResult;
  ```

- [ ] **Step 3: Resolve complete, non-overlapping selections**

  Make `resolveSelection()` return `{ startIndex, endIndex, messageIndices, consumedBlockIds }`. Expand ranges until all referenced tool calls/results and all touched active blocks are complete. Reject two input entries that overlap after expansion before allocating any block ID or mutating state.

- [ ] **Step 4: Calculate incremental visible tokens**

  In `applyCompressionState`, count each uncompressed selected message with `countMessageTokens()`. For an active block consumed by the new block, count its current summary tokens once instead of counting its original messages again. Set `compressedTokens` to the visible tokens removed by the new block and `summaryTokens` to the replacement summary count.

- [ ] **Step 5: Attach timing to all blocks**

  Replace `callIdToBlockId: Map<string, number>` with `callIdToBlockIds: Map<string, number[]>`. In `tool_execution_end`, use the `CompressResult.blockIds` recorded by the tool execution and apply one duration to every block in the call. Delete the newest-block timestamp scan.

- [ ] **Step 6: Rehydrate and test compression cycles**

  Restore block indices after message refs are assigned, then run:

  ```bash
  pnpm vitest run tests/compress-range.test.ts tests/compress-cycle.test.ts tests/compress-notification.test.ts
  ```

  Expected: nonzero savings, atomic batches, nested consume/deactivate behavior, and all-block timing pass.

- [ ] **Step 7: Commit compression correctness**

  ```bash
  git add src/state/types.ts src/compress src/index.ts src/messages/sync.ts tests/compress-range.test.ts tests/compress-cycle.test.ts tests/compress-notification.test.ts
  git commit -m "fix: make compression state accurate and resumable"
  ```

### Task 4: Correct pruning semantics and user-turn protection

**Files:**

- Modify: `src/config.ts`, `src/config-schema.ts`, `src/state/types.ts`, `src/state/tool-cache.ts`
- Modify: `src/messages/prune.ts`, `src/strategies/runner.ts`, `src/compress/search.ts`, `src/compress/handler.ts`
- Test: `tests/config.test.ts`, `tests/tool-cache.test.ts`, `tests/prune.test.ts`, `tests/strategy-runner.test.ts`, `tests/turn-protection.test.ts`

- [ ] **Step 1: Add failing error-input tests**

  Assert that a stale failed call becomes:

  ```ts
  expect(toolCall.arguments).toEqual({
    __purged: "input removed due to failed tool call",
  });
  expect(errorResult.content).toEqual(originalErrorContent);
  ```

  Assert that successful pruned results still use the existing output marker.

- [ ] **Step 2: Implement failed-input pruning**

  Replace `pruneToolErrors()` with an assistant-content pass keyed by `state.toolParameters` entries whose status is `error` and whose IDs are in `state.prune.tools`. Leave all `toolResult` content unchanged.

- [ ] **Step 3: Add the top-level protection setting**

  Add this schema property:

  ```ts
  turnProtection: Type.Number({
    default: 0,
    minimum: 0,
    description: "Protect the newest N user turns from all automatic DCP transformations",
  }),
  ```

  Add it to `DEFAULT_CONFIG` and preserve existing nested deduplication configuration.

- [ ] **Step 4: Derive user-turn ordinals**

  Add `userTurn: number` to `ToolParameterEntry`. In `syncToolCache`, count raw `user` messages in order and assign each tool call the ordinal of the most recent user message. Remove `SessionState.currentTurn`, its `turn_end` increment, and its persistence.

- [ ] **Step 5: Apply one protection rule everywhere**

  Use `max(config.turnProtection, config.strategies.deduplication.turnProtection)` for deduplication and `config.turnProtection` for stale errors, sweep, and compression. Add this helper:

  ```ts
  export function getProtectedTurnStart(
    messages: AgentMessage[],
    turns: number,
  ): number | undefined {
    if (turns <= 0) return undefined;
    const userIndices = messages.flatMap((message, index) =>
      message.role === "user" ? [index] : [],
    );
    return userIndices[Math.max(0, userIndices.length - turns)];
  }
  ```

  With fewer than `turns` user messages, this returns the first user message index so every existing turn is protected.

- [ ] **Step 6: Keep Pi-compatible pair safety**

  Keep removal of orphan `toolResult` messages created by DCP. Do not remove unmatched assistant tool-call blocks; Pi’s provider transform inserts an error result for them. Ensure range expansion prevents DCP from creating either orphan direction.

- [ ] **Step 7: Change the default protected set**

  Set:

  ```ts
  export const BASE_PROTECTED_TOOLS = ["compress", "write", "edit", "subagent"];
  ```

- [ ] **Step 8: Run focused pruning tests and commit**

  ```bash
  pnpm vitest run tests/config.test.ts tests/tool-cache.test.ts tests/prune.test.ts tests/strategy-runner.test.ts tests/turn-protection.test.ts
  git add src/config.ts src/config-schema.ts src/state src/messages/prune.ts src/strategies/runner.ts src/compress/search.ts src/compress/handler.ts tests/config.test.ts tests/tool-cache.test.ts tests/prune.test.ts tests/strategy-runner.test.ts tests/turn-protection.test.ts
  git commit -m "fix: preserve errors and protect recent user turns"
  ```

### Task 5: Load trusted project configuration and add manual compression

**Files:**

- Modify: `src/config.ts`, `src/index.ts`, `src/commands/register.ts`
- Create: `src/commands/compress.ts`
- Test: `tests/config.test.ts`, `tests/commands-compress.test.ts`, `tests/commands-register.test.ts`, `tests/integration.test.ts`

- [ ] **Step 1: Add config precedence tests**

  Create temporary global and project JSON files and assert defaults → global → project precedence, recursive object merging, array replacement, invalid-value warnings, and project-file exclusion when `ctx.isProjectTrusted()` is false.

- [ ] **Step 2: Extend config loading**

  Change the signature to:

  ```ts
  export function loadConfig(
    configFilePath: string,
    projectConfigPath?: string,
  ): { config: DcpConfig; warnings: string[] };
  ```

  Parse both files with the existing JSON parser, deep-merge, clean unknown properties, and validate once.

- [ ] **Step 3: Load effective config during session start**

  Resolve the project path from `ctx.cwd` and only merge it when `ctx.isProjectTrusted()` is true. Remove the factory-time `if (!config.enabled) return`; command handlers and lifecycle listeners must remain available so project config can enable DCP.

- [ ] **Step 4: Register the compression tool after effective config is known**

  Register the mode-specific `compress` tool from the `session_start` handler after config load. Pi’s installed ExtensionAPI supports registering tools after the extension factory and refreshes the active tool registry. Keep the execute closure reading the current `config` variable.

- [ ] **Step 5: Make commands read live config and persist mutations**

  Change registration to:

  ```ts
  registerDcpCommands(
    pi: ExtensionAPI,
    state: SessionState,
    getConfig: () => DcpConfig,
    onStateChange: () => void,
  ): void;
  ```

  Use `getConfig()` inside sweep, manual, permission, and compression handlers. Call `onStateChange()` after every successful durable command mutation.

- [ ] **Step 6: Add the manual command**

  Implement `compressCommand(pi, state, args)` with this behavior:

  ```ts
  if ((state.compressPermission ?? "allow") === "deny") {
    return "Compression is denied by configuration.";
  }
  pi.sendMessage(
    {
      customType: "dcp-compress-trigger",
      content: args.trim()
        ? `Compress stale context now, focusing on: ${args.trim()}`
        : "Compress stale context now using the compress tool.",
      display: false,
    },
    { triggerTurn: true, deliverAs: "followUp" },
  );
  return "Compression triggered.";
  ```

  Register it as `dcp:compress`; deny without sending a message.

- [ ] **Step 7: Test lifecycle and command behavior**

  ```bash
  pnpm vitest run tests/config.test.ts tests/commands-compress.test.ts tests/commands-register.test.ts tests/integration.test.ts
  ```

  Expected: trusted project precedence, live config reads, disabled/enabled startup, idle trigger, streaming follow-up, and denied permission pass.

- [ ] **Step 8: Commit lifecycle and controls**

  ```bash
  git add src/config.ts src/index.ts src/commands src/config-schema.ts tests/config.test.ts tests/commands-compress.test.ts tests/commands-register.test.ts tests/integration.test.ts dcp.schema.json
  git commit -m "feat: add trusted project config and manual compression"
  ```

### Task 6: Make lifetime reporting, benchmarks, and release documentation accurate

**Files:**

- Modify: `src/state/persistence.ts`, `src/commands/lifetime.ts`, `README.md`, `dcp.schema.json`, `package.json`
- Create: `scripts/benchmark.ts`, `tests/benchmark.test.ts`, `tests/commands-lifetime.test.ts`

- [ ] **Step 1: Add session-file lifetime fixtures**

  Create JSONL fixtures containing Pi session headers and `pi-dcp-state` custom entries. Assert that `loadAllSessionStats()` scans actual session files, selects the latest snapshot per owner session, resets fork-inherited statistics, and ignores legacy `dcp/state.json` files.

- [ ] **Step 2: Implement true session lifetime scanning**

  Scan session JSONL files under the supplied sessions parent directory with Node’s standard-library filesystem APIs. Parse only custom entries with `customType === "pi-dcp-state"`, select the newest entry per `ownerSessionId`, and sum its session statistics. Skip malformed lines and files without valid snapshots.

- [ ] **Step 3: Add deterministic benchmark workloads**

  Create `scripts/benchmark.ts` with three fixed fixtures: 2,000 clean messages, 2,000 repeated tool pairs with stale errors, and a restored state containing 100 active/nested blocks. Run 30 iterations with `performance.now()`, report median/p95, input/output tokens, and token reduction as JSON. Do not assert wall-clock timing in Vitest.

- [ ] **Step 4: Add benchmark correctness tests**

  Assert that the pruning fixture reduces estimated tokens, retains protected tools, preserves error text, and produces no orphaned results. Assert that the restored nested fixture rehydrates the same active blocks and relationships.

- [ ] **Step 5: Add the benchmark command and documentation**

  Add:

  ```json
  "benchmark": "tsx scripts/benchmark.ts"
  ```

  Document that benchmark output is informational and should be captured before and after reliability changes on the same machine and Node version.

- [ ] **Step 6: Regenerate schema and run release checks**

  ```bash
  pnpm test
  pnpm typecheck
  pnpm lint
  pnpm run generate:schema
  pnpm run benchmark
  pnpm pack --dry-run
  git diff --check
  ```

  Expected: all tests pass, typecheck succeeds, lint reports no new diagnostics beyond the recorded baseline, generated schema is unchanged except for intentional fields, benchmark JSON contains all workloads, and package dry-run succeeds.

- [ ] **Step 7: Commit final reporting changes**

  ```bash
  git add src/state/persistence.ts src/commands/lifetime.ts scripts/benchmark.ts tests/benchmark.test.ts tests/commands-lifetime.test.ts README.md package.json dcp.schema.json
  git commit -m "test: add session lifetime and dcp benchmarks"
  ```

## Self-Review Checklist

- Pi-native persistence replaces the shared sidecar and covers resume, fork, tree navigation, and compaction.
- Snapshot ownership prevents fork statistics from being counted twice.
- Compression state includes real tool-call ownership, nonzero token accounting, nested relationships, and batch timing.
- Failed-input pruning preserves diagnostics.
- User-turn protection is opt-in and applies consistently across strategies and compression.
- Project configuration uses Pi’s cwd and trust state, and commands read live configuration.
- Manual compression uses the verified `sendMessage` API.
- Lifetime statistics scan Pi sessions rather than project sidecars.
- Benchmarks are deterministic and informational rather than an unsupported hard gate.
- No task copies source from AGPL repositories or adds a runtime dependency.
- All code-changing tasks include focused tests, commands, expected outcomes, and a commit boundary.
