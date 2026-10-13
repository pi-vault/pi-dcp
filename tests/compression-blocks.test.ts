import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  handleCompress,
  decompressBlock,
  recompressBlock,
  createCompressionBlockState,
  clearCompressionBlocks,
  restoreCompressionBlocks,
  recordCompressionDuration,
  type CompressArgs,
} from "../src/compress/blocks.ts";
import { createSessionState } from "../src/state/state.ts";
import { restoreDcpSnapshot, serializeDcpSnapshot } from "../src/state/persistence.ts";
import { runPipeline } from "../src/pipeline.ts";
import type { DcpConfig } from "../src/config.ts";
import type { CompressionBlock, DcpSnapshotBlockV1, SessionState } from "../src/state/types.ts";
import { countMessageTokens, countTokens } from "../src/utils/tokens.ts";
import {
  makeDefaultConfig,
  makeUserMessage,
  makeAssistantMessage,
  makeToolResultMessage,
  getMessageText,
  requireDefined,
} from "./helpers.ts";

const SESSION_ID = "block-lifecycle-test";

/** Compression-only config: unrelated automatic strategies are disabled. */
function compressionConfig(overrides: Partial<DcpConfig["compress"]> = {}): DcpConfig {
  const config = makeDefaultConfig(overrides);
  config.strategies = {
    deduplication: { enabled: false, protectedTools: [], turnProtection: 0 },
    purgeErrors: { enabled: false, turns: 4, protectedTools: [] },
  };
  return config;
}

/** A complete assistant compress owner call with a named tool-call part. */
function makeCompressOwner(toolCallId: string, timestamp: number): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: toolCallId, name: "compress", arguments: {} }],
    stopReason: "toolUse",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      totalTokens: 0,
    },
    timestamp,
  } as unknown as AgentMessage;
}

function pipelineText(state: SessionState, config: DcpConfig, messages: AgentMessage[]): string {
  return runPipeline(state, config, messages, undefined).messages.map(getMessageText).join("\n");
}

/** Snapshot every durable/derived field a rejected compression must not touch. */
function compressionSnapshot(state: SessionState) {
  return structuredClone({
    blocksById: state.prune.messages.blocksById,
    activeBlockIds: state.prune.messages.activeBlockIds,
    activeByAnchorIndex: state.prune.messages.activeByAnchorIndex,
    byMessageIndex: state.prune.messages.byMessageIndex,
    nextBlockId: state.prune.messages.nextBlockId,
    nextRunId: state.prune.messages.nextRunId,
    stats: { ...state.stats },
  });
}

/** Durable snapshot block fixture for owner-restoration tests. */
function durableBlock(overrides: Partial<DcpSnapshotBlockV1> = {}): DcpSnapshotBlockV1 {
  return {
    blockId: 7,
    runId: 3,
    deactivatedByUser: false,
    compressedTokens: 120,
    summaryTokens: 30,
    durationMs: 1_500,
    mode: "range",
    topic: "topic",
    compressToolCallId: "call",
    startKey: "user:1:0",
    endKey: "assistant:2:0",
    anchorKey: "user:1:0",
    consumedBlockIds: [],
    createdAt: 1_000,
    summary: "summary",
    ...overrides,
  };
}

/** Live in-memory block fixture for owner-operation tests. */
function storedBlock(blockId: number, overrides: Partial<CompressionBlock> = {}): CompressionBlock {
  return {
    blockId,
    runId: 1,
    active: true,
    deactivatedByUser: false,
    compressedTokens: 10,
    summaryTokens: 2,
    durationMs: 0,
    mode: "range",
    topic: "topic",
    batchTopic: undefined,
    startIndex: 0,
    endIndex: 0,
    anchorIndex: 0,
    compressToolCallId: "call",
    startKey: `start-${blockId}`,
    endKey: `end-${blockId}`,
    anchorKey: `anchor-${blockId}`,
    consumedBlockIds: [],
    parentBlockIds: [],
    directMessageIndices: [],
    directToolIds: [],
    effectiveMessageIndices: [],
    effectiveToolIds: [],
    createdAt: blockId,
    deactivatedAt: undefined,
    deactivatedByBlockId: undefined,
    summary: "summary",
    ...overrides,
  };
}

describe("compression block lifecycle", () => {
  it("compresses and restores original context through public operations", () => {
    const state = createSessionState();
    state.sessionId = SESSION_ID;
    const config = compressionConfig();
    const rawMessages: AgentMessage[] = [
      makeUserMessage("older user", 1000),
      makeAssistantMessage("older assistant", 1001),
      makeUserMessage("later user", 1002),
    ];
    runPipeline(state, config, rawMessages, undefined);

    const result = handleCompress(state, config, rawMessages, "compress-1", {
      topic: "older context",
      mode: "range",
      content: [{ startId: "m1", endId: "m2", summary: "older summary" }],
    });
    expect(result.blockIds).toEqual([1]);
    expect(result.messagesCompressed).toBe(2);

    rawMessages.push(makeCompressOwner("compress-1", 1003));
    rawMessages.push(makeToolResultMessage("compress-1", "compress", result.text, false, 1004));

    const text = () => pipelineText(state, config, rawMessages);
    expect(text()).toContain("[Compressed Block b1]");
    expect(text()).toContain("older summary");
    expect(text()).not.toContain("older user");

    expect(decompressBlock(state, "1")).toBe(
      "Block 1 deactivated. Original messages will be restored on next context pass.",
    );
    expect(text()).toContain("older user");

    expect(recompressBlock(state, "1")).toBe(
      "Block 1 reactivated. Compression will apply on next context pass.",
    );
    expect(text()).toContain("older summary");
    expect(text()).not.toContain("older user");
  });

  it("keeps a user-deactivated consumed child excluded after parent deactivation", () => {
    const state = createSessionState();
    state.sessionId = SESSION_ID;
    const config = compressionConfig();
    let raw: AgentMessage[] = [
      makeUserMessage("child user", 2000),
      makeAssistantMessage("child assistant", 2001),
      makeUserMessage("tail user", 2002),
    ];
    runPipeline(state, config, raw, undefined);

    handleCompress(state, config, raw, "compress-child", {
      topic: "child",
      mode: "range",
      content: [{ startId: "m1", endId: "m2", summary: "child summary" }],
    });
    raw = [
      ...raw,
      makeCompressOwner("compress-child", 2003),
      makeToolResultMessage("compress-child", "compress", "ok", false, 2004),
    ];
    runPipeline(state, config, raw, undefined);

    handleCompress(state, config, raw, "compress-parent", {
      topic: "parent",
      mode: "range",
      content: [{ startId: "b1", endId: "b1", summary: "parent summary" }],
    });
    raw = [
      ...raw,
      makeCompressOwner("compress-parent", 2005),
      makeToolResultMessage("compress-parent", "compress", "ok", false, 2006),
    ];
    runPipeline(state, config, raw, undefined);

    expect(state.prune.messages.blocksById.get(2)?.consumedBlockIds).toEqual([1]);
    expect(pipelineText(state, config, raw)).toContain("parent summary");

    decompressBlock(state, "2");
    runPipeline(state, config, raw, undefined);
    expect(pipelineText(state, config, raw)).toContain("child summary");

    decompressBlock(state, "1");
    runPipeline(state, config, raw, undefined);
    expect(pipelineText(state, config, raw)).toContain("child user");
    expect(pipelineText(state, config, raw)).not.toContain("child summary");

    recompressBlock(state, "2");
    runPipeline(state, config, raw, undefined);
    expect(pipelineText(state, config, raw)).toContain("parent summary");
    expect(pipelineText(state, config, raw)).not.toContain("child user");

    decompressBlock(state, "2");
    runPipeline(state, config, raw, undefined);
    expect(state.prune.messages.blocksById.get(1)?.deactivatedByUser).toBe(true);
    expect(state.prune.messages.blocksById.get(1)?.active).toBe(false);
    expect(pipelineText(state, config, raw)).not.toContain("child summary");
    expect(pipelineText(state, config, raw)).toContain("child user");
  });

  it("restores eligible consumed children", () => {
    const state = createSessionState();
    state.sessionId = SESSION_ID;
    const config = compressionConfig();
    let raw: AgentMessage[] = [
      makeUserMessage("child user", 3000),
      makeAssistantMessage("child assistant", 3001),
      makeUserMessage("tail user", 3002),
    ];
    runPipeline(state, config, raw, undefined);

    handleCompress(state, config, raw, "compress-child", {
      topic: "child",
      mode: "range",
      content: [{ startId: "m1", endId: "m2", summary: "child summary" }],
    });
    raw = [
      ...raw,
      makeCompressOwner("compress-child", 3003),
      makeToolResultMessage("compress-child", "compress", "ok", false, 3004),
    ];
    runPipeline(state, config, raw, undefined);

    handleCompress(state, config, raw, "compress-parent", {
      topic: "parent",
      mode: "range",
      content: [{ startId: "b1", endId: "b1", summary: "parent summary" }],
    });
    raw = [
      ...raw,
      makeCompressOwner("compress-parent", 3005),
      makeToolResultMessage("compress-parent", "compress", "ok", false, 3006),
    ];
    runPipeline(state, config, raw, undefined);

    decompressBlock(state, "2");
    runPipeline(state, config, raw, undefined);

    expect(state.prune.messages.blocksById.get(1)?.active).toBe(true);
    expect(pipelineText(state, config, raw)).toContain("child summary");
    expect(pipelineText(state, config, raw)).not.toContain("child user");
  });

  it("keeps recompressed children hidden by an active parent", () => {
    const state = createSessionState();
    state.sessionId = SESSION_ID;
    const config = compressionConfig();
    let raw: AgentMessage[] = [
      makeUserMessage("child user", 4000),
      makeAssistantMessage("child assistant", 4001),
      makeUserMessage("tail user", 4002),
    ];
    runPipeline(state, config, raw, undefined);

    handleCompress(state, config, raw, "compress-child", {
      topic: "child",
      mode: "range",
      content: [{ startId: "m1", endId: "m2", summary: "child summary" }],
    });
    raw = [
      ...raw,
      makeCompressOwner("compress-child", 4003),
      makeToolResultMessage("compress-child", "compress", "ok", false, 4004),
    ];
    runPipeline(state, config, raw, undefined);

    handleCompress(state, config, raw, "compress-parent", {
      topic: "parent",
      mode: "range",
      content: [{ startId: "b1", endId: "b1", summary: "parent summary" }],
    });
    raw = [
      ...raw,
      makeCompressOwner("compress-parent", 4005),
      makeToolResultMessage("compress-parent", "compress", "ok", false, 4006),
    ];
    runPipeline(state, config, raw, undefined);

    const before = compressionSnapshot(state);

    decompressBlock(state, "2");
    runPipeline(state, config, raw, undefined);
    decompressBlock(state, "1");
    runPipeline(state, config, raw, undefined);
    recompressBlock(state, "2");
    runPipeline(state, config, raw, undefined);

    // Recompress the child beneath its already-active parent.
    expect(recompressBlock(state, "1")).toBe(
      "Block 1 reactivated. Compression will apply on next context pass.",
    );
    const child = state.prune.messages.blocksById.get(1);
    expect(child?.deactivatedByUser).toBe(false);
    expect(child?.active).toBe(false);
    expect(child?.deactivatedByBlockId).toBe(2);

    runPipeline(state, config, raw, undefined);
    expect(pipelineText(state, config, raw)).toContain("parent summary");
    expect(pipelineText(state, config, raw)).not.toContain("child summary");

    decompressBlock(state, "2");
    runPipeline(state, config, raw, undefined);
    expect(pipelineText(state, config, raw)).toContain("child summary");

    const after = compressionSnapshot(state);
    expect(after.nextBlockId).toBe(before.nextBlockId);
    expect(after.nextRunId).toBe(before.nextRunId);
    expect(after.stats.messagesCompressed).toBe(before.stats.messagesCompressed);
    expect([...after.blocksById.values()].map((block) => [block.blockId, block.summary])).toEqual(
      [...before.blocksById.values()].map((block) => [block.blockId, block.summary]),
    );
  });

  it("validates the complete request before committing a run", () => {
    const config = compressionConfig();
    const messages: AgentMessage[] = [
      makeUserMessage("one", 5000),
      makeAssistantMessage("two", 5001),
      makeUserMessage("three", 5002),
      makeAssistantMessage("four", 5003),
    ];

    const cases: Array<{
      name: string;
      build: (state: SessionState) => CompressArgs;
      error: string;
      turnProtection?: number;
    }> = [
      {
        name: "empty range content",
        build: () => ({ topic: "t", mode: "range", content: [] }),
        error: "content array is required and must not be empty",
      },
      {
        name: "missing range content",
        build: () => ({ topic: "t", mode: "range" }),
        error: "content array is required and must not be empty",
      },
      {
        name: "empty message targets",
        build: () => ({ topic: "t", mode: "message", targets: [] }),
        error: "targets array is required and must not be empty",
      },
      {
        name: "unavailable boundary after a valid first entry",
        build: () => ({
          topic: "t",
          mode: "range",
          content: [
            { startId: "m1", endId: "m1", summary: "ok" },
            { startId: "m9999", endId: "m9999", summary: "bad" },
          ],
        }),
        error: "startId m9999 is not available",
      },
      {
        name: "reversed boundaries",
        build: () => ({
          topic: "t",
          mode: "range",
          content: [{ startId: "m2", endId: "m1", summary: "reversed" }],
        }),
        error: "startId appears after endId",
      },
      {
        name: "overlapping batch ranges",
        build: () => ({
          topic: "t",
          mode: "range",
          content: [
            { startId: "m1", endId: "m2", summary: "first" },
            { startId: "m2", endId: "m3", summary: "second" },
          ],
        }),
        error: "Overlapping compression selections are not allowed.",
      },
      {
        name: "protected range",
        build: () => ({
          topic: "t",
          mode: "range",
          content: [{ startId: "m1", endId: "m4", summary: "protected" }],
        }),
        error: "Compression overlaps the turnProtection protected window",
        turnProtection: 1,
      },
    ];

    for (const testCase of cases) {
      const state = createSessionState();
      state.sessionId = SESSION_ID;
      const caseConfig = { ...config, turnProtection: testCase.turnProtection ?? 0 };
      runPipeline(state, caseConfig, messages, undefined);
      const before = compressionSnapshot(state);

      expect(() =>
        handleCompress(state, caseConfig, messages, "compress-bad", testCase.build(state)),
      ).toThrow(testCase.error);

      expect(compressionSnapshot(state)).toEqual(before);
    }
  });

  it("preserves validation precedence after selection expansion", () => {
    // Protected-window check runs before the batch overlap check.
    const protectedConfig = compressionConfig();
    protectedConfig.turnProtection = 1;
    const protectedMessages: AgentMessage[] = [
      makeUserMessage("older", 6000),
      makeAssistantMessage("older reply", 6001),
      makeUserMessage("protected", 6002),
    ];
    const protectedState = createSessionState();
    protectedState.sessionId = SESSION_ID;
    runPipeline(protectedState, protectedConfig, protectedMessages, undefined);

    expect(() =>
      handleCompress(protectedState, protectedConfig, protectedMessages, "compress-1", {
        topic: "batch",
        mode: "range",
        content: [
          { startId: "m1", endId: "m1", summary: "first" },
          { startId: "m1", endId: "m3", summary: "overlapping protected" },
        ],
      }),
    ).toThrow(
      "Compression overlaps the turnProtection protected window; choose only older messages.",
    );

    // Active-block expansion turns two disjoint requests into an overlap.
    const state = createSessionState();
    state.sessionId = SESSION_ID;
    const config = compressionConfig();
    let raw: AgentMessage[] = [
      makeUserMessage("one", 6100),
      makeAssistantMessage("two", 6101),
      makeUserMessage("three", 6102),
    ];
    runPipeline(state, config, raw, undefined);
    handleCompress(state, config, raw, "compress-child", {
      topic: "child",
      mode: "range",
      content: [{ startId: "m1", endId: "m2", summary: "child summary" }],
    });
    raw = [
      ...raw,
      makeCompressOwner("compress-child", 6103),
      makeToolResultMessage("compress-child", "compress", "ok", false, 6104),
    ];
    runPipeline(state, config, raw, undefined);

    expect(() =>
      handleCompress(state, config, raw, "compress-2", {
        topic: "overlap",
        mode: "range",
        content: [
          { startId: "m1", endId: "m1", summary: "first" },
          { startId: "m2", endId: "m2", summary: "second" },
        ],
      }),
    ).toThrow("Overlapping compression selections are not allowed.");

    // Boundary errors precede either batch check.
    expect(() =>
      handleCompress(state, config, raw, "compress-3", {
        topic: "boundary",
        mode: "range",
        content: [
          { startId: "m1", endId: "m1", summary: "first" },
          { startId: "m9999", endId: "m9999", summary: "bad" },
        ],
      }),
    ).toThrow("startId m9999 is not available");
  });

  it("synchronizes orphaned owners and stale boundary references", () => {
    const isCompressOwner = (message: AgentMessage, id: string): boolean =>
      message.role === "assistant" &&
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "toolCall" && part.id === id);
    const isToolResult = (message: AgentMessage, id: string): boolean =>
      message.role === "toolResult" && message.toolCallId === id;

    // Fixture: child b1 over m1..m2, consuming parent b2 over b1..b1.
    function buildNested(): { state: SessionState; config: DcpConfig; raw: AgentMessage[] } {
      const state = createSessionState();
      state.sessionId = SESSION_ID;
      const config = compressionConfig();
      let raw: AgentMessage[] = [
        makeUserMessage("child user", 7000),
        makeAssistantMessage("child assistant", 7001),
        makeUserMessage("tail user", 7002),
      ];
      runPipeline(state, config, raw, undefined);
      handleCompress(state, config, raw, "compress-child", {
        topic: "child",
        mode: "range",
        content: [{ startId: "m1", endId: "m2", summary: "child summary" }],
      });
      raw = [
        ...raw,
        makeCompressOwner("compress-child", 7003),
        makeToolResultMessage("compress-child", "compress", "ok", false, 7004),
      ];
      runPipeline(state, config, raw, undefined);
      handleCompress(state, config, raw, "compress-parent", {
        topic: "parent",
        mode: "range",
        content: [{ startId: "b1", endId: "b1", summary: "parent summary" }],
      });
      raw = [
        ...raw,
        makeCompressOwner("compress-parent", 7005),
        makeToolResultMessage("compress-parent", "compress", "ok", false, 7006),
      ];
      runPipeline(state, config, raw, undefined);
      return { state, config, raw };
    }

    // Remove the owning assistant calls: the blocks disappear, content returns.
    const withoutOwner = buildNested();
    const dropOwner = withoutOwner.raw.filter(
      (message) =>
        !isCompressOwner(message, "compress-child") &&
        !isToolResult(message, "compress-child") &&
        !isCompressOwner(message, "compress-parent") &&
        !isToolResult(message, "compress-parent"),
    );
    runPipeline(withoutOwner.state, withoutOwner.config, dropOwner, undefined);
    expect(withoutOwner.state.prune.messages.blocksById.size).toBe(0);
    expect(withoutOwner.state.prune.messages.activeBlockIds.size).toBe(0);
    expect(pipelineText(withoutOwner.state, withoutOwner.config, dropOwner)).toContain(
      "child user",
    );

    // Remove the start boundary: the block cannot rebuild and is discarded.
    const withoutStart = buildNested();
    const droppedStart = withoutStart.raw.filter((_message, index) => index !== 0);
    const restored = runPipeline(withoutStart.state, withoutStart.config, droppedStart, undefined);
    expect(withoutStart.state.prune.messages.blocksById.size).toBe(0);
    expect(withoutStart.state.prune.messages.activeBlockIds.size).toBe(0);
    expect(withoutStart.state.prune.messages.activeByAnchorIndex.size).toBe(0);
    expect(withoutStart.state.prune.messages.byMessageIndex.size).toBe(0);
    const restoredText = restored.messages.map(getMessageText).join("\n");
    expect(restoredText).toContain("child assistant");
    expect(restoredText).not.toContain("[Compressed Block");

    // Replace the branch with nothing: every block and membership disappears.
    const emptied = buildNested();
    runPipeline(emptied.state, emptied.config, [], undefined);
    expect(emptied.state.prune.messages.blocksById.size).toBe(0);
    expect(emptied.state.prune.messages.activeBlockIds.size).toBe(0);
    expect(emptied.state.prune.messages.byMessageIndex.size).toBe(0);

    // Removing the consuming parent's owner reveals the child and clears the link.
    const orphanedParent = buildNested();
    const withoutParent = orphanedParent.raw.filter(
      (message) =>
        !isCompressOwner(message, "compress-parent") && !isToolResult(message, "compress-parent"),
    );
    runPipeline(orphanedParent.state, orphanedParent.config, withoutParent, undefined);
    expect(orphanedParent.state.prune.messages.blocksById.has(2)).toBe(false);
    expect(orphanedParent.state.prune.messages.blocksById.get(1)?.active).toBe(true);
    expect(orphanedParent.state.prune.messages.blocksById.get(1)?.parentBlockIds).toEqual([]);
    expect(pipelineText(orphanedParent.state, orphanedParent.config, withoutParent)).toContain(
      "child summary",
    );
    expect(orphanedParent.state.prune.messages.nextBlockId).toBe(3);
    expect(orphanedParent.state.prune.messages.nextRunId).toBe(3);
  });

  it("retains a block whose owner has no result yet", () => {
    const state = createSessionState();
    state.sessionId = SESSION_ID;
    const config = compressionConfig();
    const raw: AgentMessage[] = [
      makeUserMessage("child user", 8000),
      makeAssistantMessage("child assistant", 8001),
      makeUserMessage("tail user", 8002),
    ];
    runPipeline(state, config, raw, undefined);

    handleCompress(state, config, raw, "compress-1", {
      topic: "child",
      mode: "range",
      content: [{ startId: "m1", endId: "m2", summary: "child summary" }],
    });
    raw.push(makeCompressOwner("compress-1", 8003));
    runPipeline(state, config, raw, undefined);

    expect(state.prune.messages.blocksById.has(1)).toBe(true);
    expect(state.prune.messages.activeBlockIds.has(1)).toBe(true);
    expect(state.toolParameters.get("compress-1")?.status).toBe("pending");
    expect(pipelineText(state, config, raw)).toContain("child summary");

    raw.push(makeToolResultMessage("compress-1", "compress", "ok", false, 8004));
    runPipeline(state, config, raw, undefined);

    expect(state.prune.messages.blocksById.get(1)?.summary).toContain("child summary");
    expect(state.prune.messages.activeBlockIds.has(1)).toBe(true);
    expect(state.toolParameters.get("compress-1")?.status).toBe("completed");
  });

  it("allocates one run for a batch with distinct blocks", () => {
    const state = createSessionState();
    state.sessionId = SESSION_ID;
    const config = compressionConfig();
    const raw: AgentMessage[] = [
      makeUserMessage("one", 9000),
      makeAssistantMessage("two", 9001),
      makeUserMessage("three", 9002),
      makeAssistantMessage("four", 9003),
    ];
    runPipeline(state, config, raw, undefined);

    const result = handleCompress(state, config, raw, "batch-1", {
      topic: "batch",
      mode: "range",
      content: [
        { startId: "m1", endId: "m1", summary: "first summary" },
        { startId: "m2", endId: "m2", summary: "second summary" },
      ],
    });

    expect(result.blockIds).toEqual([1, 2]);
    const first = state.prune.messages.blocksById.get(1);
    const second = state.prune.messages.blocksById.get(2);
    if (!first || !second) throw new Error("expected two blocks");
    expect(first.runId).toBe(1);
    expect(second.runId).toBe(1);
    expect(state.prune.messages.nextBlockId).toBe(3);
    expect(state.prune.messages.nextRunId).toBe(2);

    expect(result.compressedTokens).toBe(first.compressedTokens + second.compressedTokens);
    expect(result.summaryTokens).toBe(first.summaryTokens + second.summaryTokens);
    expect(result.messagesCompressed).toBe(
      first.effectiveMessageIndices.length + second.effectiveMessageIndices.length,
    );

    raw.push(makeCompressOwner("batch-1", 9004));
    raw.push(makeToolResultMessage("batch-1", "compress", result.text, false, 9005));
    runPipeline(state, config, raw, undefined);

    const firstCompressedTokens = first.compressedTokens;
    const firstSummaryTokens = first.summaryTokens;
    const statsBefore = state.stats.messagesCompressed;

    const later = handleCompress(state, config, raw, "batch-2", {
      topic: "later",
      mode: "range",
      content: [{ startId: "m3", endId: "m3", summary: "later summary" }],
    });
    expect(later.blockIds).toEqual([3]);
    const third = state.prune.messages.blocksById.get(3);
    if (!third) throw new Error("expected third block");
    expect(third.runId).toBe(2);
    expect(state.prune.messages.nextBlockId).toBe(4);
    expect(state.prune.messages.nextRunId).toBe(3);
    expect(first.compressedTokens).toBe(firstCompressedTokens);
    expect(first.summaryTokens).toBe(firstSummaryTokens);
    expect(state.stats.messagesCompressed).toBe(statsBefore + later.messagesCompressed);
  });

  it("counts consumed summaries once through the production pipeline", () => {
    const state = createSessionState();
    state.sessionId = SESSION_ID;
    const config = compressionConfig();
    const raw: AgentMessage[] = [
      makeUserMessage("older user", 10_000),
      makeUserMessage("child user", 10_001),
      makeAssistantMessage("child assistant", 10_002),
      makeUserMessage("tail user", 10_003),
    ];
    runPipeline(state, config, raw, undefined);

    // Child consumes m2..m3.
    handleCompress(state, config, raw, "child-1", {
      topic: "child",
      mode: "range",
      content: [{ startId: "m2", endId: "m3", summary: "child summary" }],
    });
    raw.push(makeCompressOwner("child-1", 10_004));
    raw.push(makeToolResultMessage("child-1", "compress", "ok", false, 10_005));
    runPipeline(state, config, raw, undefined);

    const child = state.prune.messages.blocksById.get(1);
    if (!child) throw new Error("expected child block");

    // Parent covers an older direct message plus the child block.
    const parentResult = handleCompress(state, config, raw, "parent-1", {
      topic: "parent",
      mode: "range",
      content: [{ startId: "m1", endId: "b1", summary: "parent summary" }],
    });
    const parent = state.prune.messages.blocksById.get(parentResult.blockIds[0]);
    if (!parent) throw new Error("expected parent block");

    const directTokens = countMessageTokens(raw[0]);
    expect(parent.consumedBlockIds).toEqual([1]);
    expect(parent.directMessageIndices).toEqual([0]);
    expect(parent.compressedTokens).toBe(child.summaryTokens + directTokens);
    expect(parentResult.compressedTokens).toBe(parent.compressedTokens);
    expect(parent.summaryTokens).toBe(countTokens(parent.summary));
    expect(parent.summaryTokens).toBe(parentResult.summaryTokens);

    raw.push(makeCompressOwner("parent-1", 10_006));
    raw.push(makeToolResultMessage("parent-1", "compress", parentResult.text, false, 10_007));
    runPipeline(state, config, raw, undefined);

    const before = {
      childCompressed: child.compressedTokens,
      childSummary: child.summaryTokens,
      parentCompressed: parent.compressedTokens,
      parentSummary: parent.summaryTokens,
      messagesCompressed: state.stats.messagesCompressed,
    };

    decompressBlock(state, String(parent.blockId));
    runPipeline(state, config, raw, undefined);
    recompressBlock(state, String(parent.blockId));
    runPipeline(state, config, raw, undefined);

    expect(child.compressedTokens).toBe(before.childCompressed);
    expect(child.summaryTokens).toBe(before.childSummary);
    expect(parent.compressedTokens).toBe(before.parentCompressed);
    expect(parent.summaryTokens).toBe(before.parentSummary);
    expect(state.stats.messagesCompressed).toBe(before.messagesCompressed);
  });

  it("expands message-mode targets without splitting tool chains", () => {
    const state = createSessionState();
    state.sessionId = SESSION_ID;
    const config = compressionConfig({ mode: "message" });
    const raw: AgentMessage[] = [
      makeUserMessage("read it", 11_000),
      {
        role: "assistant",
        content: [
          { type: "text", text: "Reading the file now" },
          { type: "toolCall", id: "read-1", name: "read", arguments: { path: "/a.ts" } },
        ],
        stopReason: "toolUse",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
        timestamp: 11_001,
      } as unknown as AgentMessage,
      makeToolResultMessage("read-1", "read", "file contents", false, 11_002),
      makeUserMessage("thanks", 11_003),
    ];
    runPipeline(state, config, raw, undefined);

    // The assistant marker shown to the model is on the assistant message.
    const view = runPipeline(state, config, raw, undefined).messages.map(getMessageText).join("\n");
    const assistantMarker = requireDefined(view.match(/@m2(?::\d+)?@/)?.[0], "assistant marker");

    const result = handleCompress(state, config, raw, "compress-1", {
      topic: "tool pair",
      mode: "message",
      targets: [{ messageId: assistantMarker, summary: "read the file" }],
    });

    const block = state.prune.messages.blocksById.get(result.blockIds[0]);
    expect(block?.startIndex).toBe(1);
    expect(block?.endIndex).toBe(2);
    expect(result.messagesCompressed).toBe(2);

    raw.push(makeCompressOwner("compress-1", 11_004));
    raw.push(makeToolResultMessage("compress-1", "compress", result.text, false, 11_005));
    const compressed = runPipeline(state, config, raw, undefined)
      .messages.map(getMessageText)
      .join("\n");
    expect(compressed).toContain("read the file");
    expect(compressed).not.toContain("Reading the file now");
    expect(compressed).not.toContain("file contents");

    expect(decompressBlock(state, String(block?.blockId))).toContain("deactivated");
    const restored = runPipeline(state, config, raw, undefined)
      .messages.map(getMessageText)
      .join("\n");
    expect(restored).toContain("Reading the file now");
    expect(restored).toContain("file contents");

    expect(recompressBlock(state, String(block?.blockId))).toContain("reactivated");
    const again = runPipeline(state, config, raw, undefined)
      .messages.map(getMessageText)
      .join("\n");
    expect(again).toContain("read the file");
    expect(again).not.toContain("file contents");
  });

  it("restores nested consumption and user exclusion through the next context pass", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(13_000);
    onTestFinished(() => {
      clock.mockRestore();
    });
    const build = (): { state: SessionState; config: DcpConfig; raw: AgentMessage[] } => {
      const state = createSessionState();
      state.sessionId = SESSION_ID;
      const config = compressionConfig();
      let raw: AgentMessage[] = [
        makeUserMessage("child user", 12_000),
        makeAssistantMessage("child assistant", 12_001),
        makeUserMessage("tail user", 12_002),
      ];
      runPipeline(state, config, raw, undefined);
      handleCompress(state, config, raw, "compress-child", {
        topic: "child",
        mode: "range",
        content: [{ startId: "m1", endId: "m2", summary: "child summary" }],
      });
      raw = [
        ...raw,
        makeCompressOwner("compress-child", 12_003),
        makeToolResultMessage("compress-child", "compress", "ok", false, 12_004),
      ];
      runPipeline(state, config, raw, undefined);
      handleCompress(state, config, raw, "compress-parent", {
        topic: "parent",
        mode: "range",
        content: [{ startId: "b1", endId: "b1", summary: "parent summary" }],
      });
      raw = [
        ...raw,
        makeCompressOwner("compress-parent", 12_005),
        makeToolResultMessage("compress-parent", "compress", "ok", false, 12_006),
      ];
      runPipeline(state, config, raw, undefined);
      return { state, config, raw };
    };

    const blockView = (state: SessionState) => {
      const messages = state.prune.messages;
      return {
        activeBlockIds: [...messages.activeBlockIds].sort((a, b) => a - b),
        activeByAnchorIndex: [...messages.activeByAnchorIndex.entries()].sort(
          (a, b) => a[0] - b[0],
        ),
        coverage: [...messages.byMessageIndex.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([index, entry]) => ({
            index,
            blockIds: [...entry.blockIds].sort((a, b) => a - b),
            activeBlockIds: [...entry.activeBlockIds].sort((a, b) => a - b),
          })),
        blocks: [...messages.blocksById.values()]
          .sort((a, b) => a.blockId - b.blockId)
          .map((block) => ({
            blockId: block.blockId,
            runId: block.runId,
            active: block.active,
            deactivatedByUser: block.deactivatedByUser,
            consumedBlockIds: [...block.consumedBlockIds].sort((a, b) => a - b),
            parentBlockIds: [...block.parentBlockIds].sort((a, b) => a - b),
            summary: block.summary,
            compressedTokens: block.compressedTokens,
            summaryTokens: block.summaryTokens,
            durationMs: block.durationMs,
            startIndex: block.startIndex,
            endIndex: block.endIndex,
            anchorIndex: block.anchorIndex,
          })),
        nextBlockId: messages.nextBlockId,
        nextRunId: messages.nextRunId,
        stats: { ...state.stats },
      };
    };

    const assertParity = (built: {
      state: SessionState;
      config: DcpConfig;
      raw: AgentMessage[];
    }) => {
      const { state, config, raw } = built;
      const snapshot = requireDefined(serializeDcpSnapshot(state), "embedded snapshot");
      const restored = createSessionState();
      expect(restoreDcpSnapshot(snapshot, restored, SESSION_ID)).toBe(true);

      expect(restored.prune.messages.blocksById.size).toBe(2);
      for (const block of restored.prune.messages.blocksById.values()) {
        expect(block.active).toBe(false);
        expect(block.startIndex).toBe(-1);
        expect(block.endIndex).toBe(-1);
        expect(block.anchorIndex).toBe(-1);
        expect(block.parentBlockIds).toEqual([]);
        expect(block.directMessageIndices).toEqual([]);
        expect(block.effectiveMessageIndices).toEqual([]);
        expect(block.effectiveToolIds).toEqual([]);
      }
      expect(restored.prune.messages.byMessageIndex.size).toBe(0);
      expect(restored.prune.messages.activeBlockIds.size).toBe(0);
      expect(restored.prune.messages.activeByAnchorIndex.size).toBe(0);

      const uninterrupted = runPipeline(state, config, [...raw], undefined);
      const restoredPass = runPipeline(restored, config, [...raw], undefined);
      expect(restoredPass.messages).toEqual(uninterrupted.messages);
      expect(blockView(restored)).toEqual(blockView(state));

      // Deactivating the parent must expose the same eligible/excluded child either way.
      expect(decompressBlock(state, "2")).toContain("deactivated");
      expect(decompressBlock(restored, "2")).toContain("deactivated");
      const uninterruptedAfter = runPipeline(state, config, [...raw], undefined);
      const restoredAfter = runPipeline(restored, config, [...raw], undefined);
      expect(restoredAfter.messages).toEqual(uninterruptedAfter.messages);
      expect(blockView(restored)).toEqual(blockView(state));
      return {
        text: uninterruptedAfter.messages.map(getMessageText).join("\n"),
        state,
        restored,
      };
    };

    // Active parent with an eligible consumed child.
    const eligible = assertParity(build());
    expect(eligible.text).toContain("child summary");
    expect(eligible.text).not.toContain("child user");

    // Active parent with a user-deactivated child: deactivate parent, deactivate
    // child, then recompress the parent so only the child stays excluded.
    const excluded = build();
    decompressBlock(excluded.state, "2");
    runPipeline(excluded.state, excluded.config, excluded.raw, undefined);
    decompressBlock(excluded.state, "1");
    runPipeline(excluded.state, excluded.config, excluded.raw, undefined);
    recompressBlock(excluded.state, "2");
    runPipeline(excluded.state, excluded.config, excluded.raw, undefined);
    expect(excluded.state.prune.messages.blocksById.get(1)?.deactivatedByUser).toBe(true);
    expect(excluded.state.prune.messages.blocksById.get(2)?.active).toBe(true);

    const excludedParity = assertParity(excluded);
    expect(excludedParity.text).not.toContain("child summary");
    expect(excludedParity.text).toContain("child user");
    expect(excludedParity.restored.prune.messages.blocksById.get(1)?.deactivatedByUser).toBe(true);
    expect(excludedParity.restored.prune.messages.blocksById.get(1)?.active).toBe(false);
  });
});

describe("compression block owner lifecycle", () => {
  it("creates current empty block state", () => {
    const first = createCompressionBlockState();
    const second = createCompressionBlockState();
    expect(first.byMessageIndex.size).toBe(0);
    expect(first.blocksById.size).toBe(0);
    expect(first.activeBlockIds.size).toBe(0);
    expect(first.activeByAnchorIndex.size).toBe(0);
    expect(first.nextBlockId).toBe(1);
    expect(first.nextRunId).toBe(1);
    expect(first.byMessageIndex).not.toBe(second.byMessageIndex);
    expect(first.blocksById).not.toBe(second.blocksById);
    expect(first.activeBlockIds).not.toBe(second.activeBlockIds);
    expect(first.activeByAnchorIndex).not.toBe(second.activeByAnchorIndex);
  });

  it("distinguishes compaction clearing from session reset", () => {
    const state = createSessionState();
    state.sessionId = "keep-session";
    state.stats.totalPruneTokens = 42;
    state.prune.messages.byMessageIndex.set(0, {
      tokenCount: 1,
      blockIds: [1],
      activeBlockIds: [1],
    });
    state.prune.messages.blocksById.set(1, storedBlock(1));
    state.prune.messages.activeBlockIds.add(1);
    state.prune.messages.activeByAnchorIndex.set(0, 1);
    state.prune.messages.nextBlockId = 8;
    state.prune.messages.nextRunId = 4;

    const container = state.prune.messages;
    const blockMap = container.blocksById;
    const messageIndex = container.byMessageIndex;
    const activeIds = container.activeBlockIds;
    const anchorIndex = container.activeByAnchorIndex;

    clearCompressionBlocks(state, "compaction");
    expect(state.prune.messages.nextBlockId).toBe(8);
    expect(state.prune.messages.nextRunId).toBe(4);
    expect(state.prune.messages.blocksById.size).toBe(0);
    expect(state.prune.messages.byMessageIndex.size).toBe(0);
    expect(state.prune.messages.activeBlockIds.size).toBe(0);
    expect(state.prune.messages.activeByAnchorIndex.size).toBe(0);
    expect(state.prune.messages).toBe(container);
    expect(state.prune.messages.blocksById).toBe(blockMap);
    expect(state.prune.messages.byMessageIndex).toBe(messageIndex);
    expect(state.prune.messages.activeBlockIds).toBe(activeIds);
    expect(state.prune.messages.activeByAnchorIndex).toBe(anchorIndex);
    expect(state.sessionId).toBe("keep-session");
    expect(state.stats.totalPruneTokens).toBe(42);

    state.prune.messages.byMessageIndex.set(1, {
      tokenCount: 1,
      blockIds: [2],
      activeBlockIds: [2],
    });
    state.prune.messages.blocksById.set(2, storedBlock(2));
    state.prune.messages.activeBlockIds.add(2);
    state.prune.messages.activeByAnchorIndex.set(1, 2);

    clearCompressionBlocks(state, "session");
    expect(state.prune.messages.nextBlockId).toBe(1);
    expect(state.prune.messages.nextRunId).toBe(1);
    expect(state.prune.messages.blocksById.size).toBe(0);
    expect(state.prune.messages.byMessageIndex.size).toBe(0);
    expect(state.prune.messages.activeBlockIds.size).toBe(0);
    expect(state.prune.messages.activeByAnchorIndex.size).toBe(0);
    expect(state.prune.messages).toBe(container);
    expect(state.prune.messages.blocksById).toBe(blockMap);
    expect(state.prune.messages.byMessageIndex).toBe(messageIndex);
    expect(state.prune.messages.activeBlockIds).toBe(activeIds);
    expect(state.prune.messages.activeByAnchorIndex).toBe(anchorIndex);
    expect(state.sessionId).toBe("keep-session");
    expect(state.stats.totalPruneTokens).toBe(42);
  });

  it("restores decoded facts before runtime visibility", () => {
    const state = createSessionState();
    state.sessionId = "keep-session";
    state.stats.totalPruneTokens = 42;
    state.prune.messages.byMessageIndex.set(0, {
      tokenCount: 1,
      blockIds: [99],
      activeBlockIds: [99],
    });
    state.prune.messages.blocksById.set(99, storedBlock(99));
    state.prune.messages.activeBlockIds.add(99);
    state.prune.messages.activeByAnchorIndex.set(0, 99);
    state.prune.messages.nextBlockId = 100;
    state.prune.messages.nextRunId = 50;

    const container = state.prune.messages;
    const blockMap = container.blocksById;
    const messageIndex = container.byMessageIndex;
    const activeIds = container.activeBlockIds;
    const anchorIndex = container.activeByAnchorIndex;

    const child = durableBlock({ blockId: 7, runId: 3, deactivatedByUser: true });
    const parent = durableBlock({
      blockId: 8,
      runId: 3,
      consumedBlockIds: [7],
      mode: "message",
    });
    restoreCompressionBlocks(state, {
      blocks: [child, parent],
      nextBlockId: 9,
      nextRunId: 4,
    });

    expect(state.prune.messages.blocksById.has(99)).toBe(false);
    expect(state.prune.messages.blocksById.size).toBe(2);
    expect(state.prune.messages).toBe(container);
    expect(state.prune.messages.blocksById).toBe(blockMap);
    expect(state.prune.messages.byMessageIndex).toBe(messageIndex);
    expect(state.prune.messages.activeBlockIds).toBe(activeIds);
    expect(state.prune.messages.activeByAnchorIndex).toBe(anchorIndex);

    const restoredChild = requireDefined(state.prune.messages.blocksById.get(7), "restored child");
    expect(restoredChild.active).toBe(false);
    expect(restoredChild.startIndex).toBe(-1);
    expect(restoredChild.endIndex).toBe(-1);
    expect(restoredChild.anchorIndex).toBe(-1);
    expect(restoredChild.parentBlockIds).toEqual([]);
    expect(restoredChild.directMessageIndices).toEqual([]);
    expect(restoredChild.directToolIds).toEqual([]);
    expect(restoredChild.effectiveMessageIndices).toEqual([]);
    expect(restoredChild.effectiveToolIds).toEqual([]);
    expect(restoredChild.deactivatedAt).toBeUndefined();
    expect(restoredChild.deactivatedByBlockId).toBeUndefined();
    expect(restoredChild.summary).toBe(child.summary);
    expect(restoredChild.compressedTokens).toBe(child.compressedTokens);
    expect(restoredChild.durationMs).toBe(child.durationMs);
    expect(restoredChild.deactivatedByUser).toBe(true);

    const restoredParent = requireDefined(
      state.prune.messages.blocksById.get(8),
      "restored parent",
    );
    expect(restoredParent.active).toBe(false);
    expect(restoredParent.deactivatedByUser).toBe(false);
    expect(restoredParent.consumedBlockIds).toEqual([7]);

    expect(state.prune.messages.byMessageIndex.size).toBe(0);
    expect(state.prune.messages.activeBlockIds.size).toBe(0);
    expect(state.prune.messages.activeByAnchorIndex.size).toBe(0);
    expect(state.sessionId).toBe("keep-session");
    expect(state.stats.totalPruneTokens).toBe(42);
    // Block-only restoration does not rebuild unrelated reference caches.
    expect(state.messageIds.byRawId.size).toBe(0);
    expect(state.messageIds.byIndex.size).toBe(0);
  });

  it("repairs restored allocation counters without altering durable facts", () => {
    const state = createSessionState();
    const block = durableBlock({
      blockId: 7,
      runId: 3,
      deactivatedByUser: true,
      durationMs: 1_500,
      consumedBlockIds: [],
    });

    restoreCompressionBlocks(state, { blocks: [block], nextBlockId: 2, nextRunId: 2 });

    expect(state.prune.messages.nextBlockId).toBe(8);
    expect(state.prune.messages.nextRunId).toBe(4);
    const restored = requireDefined(state.prune.messages.blocksById.get(7), "restored block");
    expect(restored.summary).toBe(block.summary);
    expect(restored.durationMs).toBe(1_500);
    expect(restored.deactivatedByUser).toBe(true);
    expect(restored.consumedBlockIds).toEqual([]);
  });

  it("uses decoded counters when restoring empty or lower-ID state", () => {
    const state = createSessionState();
    state.prune.messages.nextBlockId = 50;
    state.prune.messages.nextRunId = 40;

    restoreCompressionBlocks(state, {
      blocks: [durableBlock({ blockId: 7, runId: 3 })],
      nextBlockId: 2,
      nextRunId: 2,
    });
    expect(state.prune.messages.nextBlockId).toBe(8);
    expect(state.prune.messages.nextRunId).toBe(4);

    restoreCompressionBlocks(state, { blocks: [], nextBlockId: 8, nextRunId: 4 });
    expect(state.prune.messages.blocksById.size).toBe(0);
    expect(state.prune.messages.byMessageIndex.size).toBe(0);
    expect(state.prune.messages.activeBlockIds.size).toBe(0);
    expect(state.prune.messages.activeByAnchorIndex.size).toBe(0);
    expect(state.prune.messages.nextBlockId).toBe(8);
    expect(state.prune.messages.nextRunId).toBe(4);

    // Repeating an empty restore proves no stale state survives.
    state.prune.messages.blocksById.set(42, storedBlock(42));
    restoreCompressionBlocks(state, { blocks: [], nextBlockId: 8, nextRunId: 4 });
    expect(state.prune.messages.blocksById.size).toBe(0);
    expect(state.prune.messages.nextBlockId).toBe(8);
    expect(state.prune.messages.nextRunId).toBe(4);

    // Decoded counters higher than any restored ID are retained.
    restoreCompressionBlocks(state, {
      blocks: [durableBlock({ blockId: 2, runId: 1 })],
      nextBlockId: 30,
      nextRunId: 20,
    });
    expect(state.prune.messages.nextBlockId).toBe(30);
    expect(state.prune.messages.nextRunId).toBe(20);
  });

  it("records duration for every block owned by a call", () => {
    const state = createSessionState();
    const first = storedBlock(1, { compressToolCallId: "call-a", durationMs: 0 });
    const second = storedBlock(2, {
      compressToolCallId: "call-a",
      durationMs: 0,
      active: false,
      deactivatedByUser: true,
    });
    const control = storedBlock(3, { compressToolCallId: "call-b", durationMs: 30 });
    state.prune.messages.blocksById.set(1, first);
    state.prune.messages.blocksById.set(2, second);
    state.prune.messages.blocksById.set(3, control);
    state.prune.messages.nextBlockId = 4;
    state.prune.messages.nextRunId = 2;
    state.stats.messagesCompressed = 5;

    recordCompressionDuration(state, "call-a", 75);

    expect(first.durationMs).toBe(75);
    expect(second.durationMs).toBe(75);
    expect(control.durationMs).toBe(30);
    expect(state.prune.messages.nextBlockId).toBe(4);
    expect(state.prune.messages.nextRunId).toBe(2);
    expect(state.stats.messagesCompressed).toBe(5);
  });
});
