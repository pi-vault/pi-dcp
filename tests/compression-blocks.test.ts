import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  handleCompress,
  decompressBlock,
  recompressBlock,
  type CompressArgs,
} from "../src/compress/blocks.ts";
import { createSessionState } from "../src/state/state.ts";
import { runPipeline } from "../src/pipeline.ts";
import type { DcpConfig } from "../src/config.ts";
import type { SessionState } from "../src/state/types.ts";
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
    runPipeline(withoutStart.state, withoutStart.config, droppedStart, undefined);
    expect(withoutStart.state.prune.messages.blocksById.has(1)).toBe(false);

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
});
