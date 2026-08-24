import { describe, it, expect } from "vitest";
import { runPipeline } from "../src/pipeline.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig, makeUserMessage, makeAssistantMessage } from "./helpers.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ContextUsage } from "../src/state/types.ts";
import { applyCompressionState, allocateBlockId, allocateRunId } from "../src/compress/state.ts";
import { countTokens, extractMessageText } from "../src/utils/tokens.ts";
import { restoreDcpSnapshot, serializeDcpSnapshot } from "../src/state/persistence.ts";

describe("runPipeline", () => {
  it("returns messages unchanged when no pruning applies", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [makeUserMessage("Hello"), makeAssistantMessage("Hi there")];

    const result = runPipeline(state, config, messages, undefined);

    // Messages should still be present (message IDs injected but content preserved)
    expect(result.messages.length).toBe(2);
  });

  it("removes stale nudge anchors and preserves surviving anchors", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.nudges.turnAnchors.add("user:1:0");
    state.nudges.turnAnchors.add("user:999:0");
    state.nudges.contextLimitAnchors.add("assistant:2:0");
    state.nudges.iterationAnchors.add("assistant:998:0");
    const messages = [makeUserMessage("kept user", 1), makeAssistantMessage("kept assistant", 2)];

    runPipeline(state, config, messages, undefined);

    expect(state.nudges.turnAnchors).toEqual(new Set(["user:1:0"]));
    expect(state.nudges.contextLimitAnchors).toEqual(new Set(["assistant:2:0"]));
    expect(state.nudges.iterationAnchors).toEqual(new Set());
  });

  it("sanitizes a persisted transposed message-id suffix before canonical injection", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [
      makeUserMessage("Hello"),
      makeAssistantMessage("**Creating the GitHub PR**m0112</dpc-message-id>"),
    ];

    const result = runPipeline(state, config, messages, undefined);
    const text = extractMessageText(result.messages[1]);

    expect(text).toContain("**Creating the GitHub PR**");
    expect(text).not.toContain("m0112");
    expect(text).not.toContain("dpc-message-id");
    expect(text.match(/<dcp-message-id/g)).toHaveLength(1);
    expect(text).toContain("m0002");
  });

  it("injects message IDs into user messages", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [
      makeUserMessage("Hello"),
      makeAssistantMessage("Hi"),
      makeUserMessage("How are you?"),
    ];

    const result = runPipeline(state, config, messages, undefined);

    // User messages should have message ID tags injected
    const firstUser = (result.messages[0] as any).content as Array<{
      type: string;
      text: string;
    }>;
    expect(firstUser[0].text).toContain("<dcp-message-id");
  });

  it("deduplicates tool outputs across turns", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    // Two read_file calls with identical arguments — dedup should prune the first
    const messages: AgentMessage[] = [
      makeUserMessage("Read the file"),
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call-1", name: "read_file", arguments: { path: "/a.ts" } },
        ],
        stopReason: "toolUse",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
        timestamp: Date.now(),
      } as unknown as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read_file",
        content: [{ type: "text", text: "export const x = 1;" }],
        isError: false,
        timestamp: Date.now(),
      } as unknown as AgentMessage,
      makeAssistantMessage("I read it."),
      makeUserMessage("Read it again"),
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call-2", name: "read_file", arguments: { path: "/a.ts" } },
        ],
        stopReason: "toolUse",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
        timestamp: Date.now(),
      } as unknown as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "call-2",
        toolName: "read_file",
        content: [{ type: "text", text: "export const x = 1;" }],
        isError: false,
        timestamp: Date.now(),
      } as unknown as AgentMessage,
      makeAssistantMessage("Here it is"),
    ];

    runPipeline(state, config, messages, undefined);

    // Deduplication should have pruned the older duplicate (call-1)
    expect(state.prune.tools.has("call-1")).toBe(true);
    expect(state.prune.tools.has("call-2")).toBe(false);
  });

  it("purges stale failed inputs while preserving their diagnostics", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const parameters = { command: "x".repeat(400) };
    const messages: AgentMessage[] = [
      makeUserMessage("Run the command"),
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "failed-1",
            name: "custom_tool",
            arguments: parameters,
          },
        ],
        stopReason: "toolUse",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
        timestamp: Date.now(),
      } as unknown as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "failed-1",
        toolName: "custom_tool",
        content: [{ type: "text", text: "command not found" }],
        isError: true,
        timestamp: Date.now(),
      } as AgentMessage,
      makeUserMessage("Try another approach"),
      makeUserMessage("Try a third approach"),
      makeUserMessage("Try a fourth approach"),
      makeUserMessage("Try a fifth approach"),
    ];

    const result = runPipeline(state, config, messages, undefined);
    const assistant = result.messages.find(
      (message): message is Extract<AgentMessage, { role: "assistant" }> =>
        message.role === "assistant",
    );
    const toolCall = assistant?.content.find((part) => part.type === "toolCall");
    const errorResult = result.messages.find(
      (message): message is Extract<AgentMessage, { role: "toolResult" }> =>
        message.role === "toolResult",
    );

    expect(toolCall?.arguments).toEqual({
      __purged: "input removed due to failed tool call",
    });
    expect(errorResult?.content).toEqual([{ type: "text", text: "command not found" }]);
    expect(result.strategyResult.tokensSaved).toBe(
      countTokens(JSON.stringify(parameters)) -
        countTokens(
          JSON.stringify({
            __purged: "input removed due to failed tool call",
          }),
        ),
    );
  });

  it("injects compress nudges when context usage is high", () => {
    const state = createSessionState();
    // Default maxContextPercent is 80 — usage.percent of 80 triggers the nudge
    const config = makeDefaultConfig();

    const messages: AgentMessage[] = [
      makeUserMessage("Hello"),
      makeAssistantMessage("Hi"),
      makeUserMessage("Do something"),
    ];

    const usage: ContextUsage = {
      tokens: 80000,
      contextWindow: 100000,
      percent: 80,
    };

    const result = runPipeline(state, config, messages, usage);

    // Should have injected a nudge into the last user message
    const lastUser = (result.messages[result.messages.length - 1] as any).content as Array<{
      type: string;
      text: string;
    }>;
    expect(lastUser[0].text).toContain("<dcp-system-reminder>");
  });

  it("keeps anchored nudges on their raw message when compression prunes earlier messages", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages = [
      makeUserMessage("compressed user", 1),
      makeAssistantMessage("compressed assistant", 2),
      makeUserMessage("nudge target", 3),
      {
        ...makeAssistantMessage("", 4),
        content: [
          {
            type: "toolCall",
            id: "compress-owner",
            name: "compress",
            arguments: {},
          },
        ],
      } as AgentMessage,
    ];
    runPipeline(state, config, messages, undefined);
    applyCompressionState(state, {
      blockId: allocateBlockId(state),
      runId: allocateRunId(state),
      topic: "earlier context",
      mode: "range",
      startIndex: 0,
      endIndex: 1,
      anchorIndex: 0,
      compressToolCallId: "compress-owner",
      startKey: "user:1:0",
      endKey: "assistant:2:0",
      anchorKey: "user:1:0",
      summary: "compressed summary",
      summaryTokens: 2,
      consumedBlockIds: [],
    });
    state.nudges.contextLimitAnchors.add("user:3:0");

    const result = runPipeline(state, config, messages, {
      tokens: 50,
      contextWindow: 100,
      percent: 50,
    });
    const target = result.messages.find(
      (message) => message.role === "user" && extractMessageText(message).includes("nudge target"),
    );
    const owner = result.messages.find(
      (message) =>
        message.role === "assistant" &&
        message.content.some((part) => part.type === "toolCall" && part.id === "compress-owner"),
    );

    expect(target && extractMessageText(target)).toContain("<dcp-system-reminder>");
    expect(owner && extractMessageText(owner)).not.toContain("<dcp-system-reminder>");
  });

  it("ignores pruned nudge anchors when enforcing frequency", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 5 });
    const messages = [
      makeUserMessage("covered anchor", 1),
      makeAssistantMessage("covered assistant", 2),
      {
        ...makeAssistantMessage("", 3),
        content: [
          {
            type: "toolCall",
            id: "compress-owner",
            name: "compress",
            arguments: {},
          },
        ],
      } as AgentMessage,
      makeUserMessage("visible target", 4),
    ];
    runPipeline(state, config, messages, undefined);
    applyCompressionState(state, {
      blockId: allocateBlockId(state),
      runId: allocateRunId(state),
      topic: "earlier context",
      mode: "range",
      startIndex: 0,
      endIndex: 1,
      anchorIndex: 0,
      compressToolCallId: "compress-owner",
      startKey: "user:1:0",
      endKey: "assistant:2:0",
      anchorKey: "user:1:0",
      summary: "compressed summary",
      summaryTokens: 2,
      consumedBlockIds: [],
    });
    state.nudges.turnAnchors.add("user:1:0");

    const result = runPipeline(state, config, messages, {
      tokens: 60,
      contextWindow: 100,
      percent: 60,
    });
    const target = result.messages.find(
      (message) =>
        message.role === "user" && extractMessageText(message).includes("visible target"),
    );

    expect(state.nudges.turnAnchors.has("user:4:0")).toBe(true);
    expect(target && extractMessageText(target)).toContain("<dcp-system-reminder>");
  });

  it("syncs compression blocks before processing", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    // Simulate an active block pointing beyond new message count
    state.prune.messages.activeByAnchorIndex.set(10, 1);
    state.prune.messages.activeBlockIds.add(1);
    state.prune.messages.blocksById.set(1, {
      blockId: 1,
      runId: 1,
      active: true,
      deactivatedByUser: false,
      compressedTokens: 0,
      summaryTokens: 10,
      durationMs: 0,
      mode: "range",
      topic: "test",
      batchTopic: undefined,
      startIndex: 8,
      endIndex: 10,
      anchorIndex: 10,
      compressToolCallId: "compress-call-1",
      startKey: "user:1000:0",
      endKey: "assistant:1001:0",
      anchorKey: "user:1000:0",
      consumedBlockIds: [],
      parentBlockIds: [],
      directMessageIndices: [8, 9, 10],
      directToolIds: [],
      effectiveMessageIndices: [8, 9, 10],
      effectiveToolIds: [],
      createdAt: Date.now(),
      deactivatedAt: undefined,
      deactivatedByBlockId: undefined,
      summary: "[Compressed Block b1]\ntest\n[End Block b1]",
    });

    const messages: AgentMessage[] = [makeUserMessage("Hello"), makeAssistantMessage("Hi")];

    // Should not throw — sync handles stale blocks gracefully
    const result = runPipeline(state, config, messages, undefined);
    expect(result.messages.length).toBe(2);
  });

  it("rebuilds compression boundaries after omitted ID-only checkpoints", () => {
    const config = makeDefaultConfig();
    const initial: AgentMessage[] = [
      makeUserMessage("old user", 1),
      makeAssistantMessage("old assistant", 2),
      {
        ...makeAssistantMessage("", 3),
        content: [{ type: "toolCall", id: "compress-call", name: "compress", arguments: {} }],
      } as AgentMessage,
    ];
    const uninterrupted = createSessionState();
    uninterrupted.sessionId = "owner";
    runPipeline(uninterrupted, config, initial, undefined);
    applyCompressionState(uninterrupted, {
      blockId: allocateBlockId(uninterrupted),
      runId: allocateRunId(uninterrupted),
      topic: "old context",
      mode: "range",
      startIndex: 0,
      endIndex: 1,
      anchorIndex: 0,
      compressToolCallId: "compress-call",
      startKey: "user:1:0",
      endKey: "assistant:2:0",
      anchorKey: "user:1:0",
      summary: "compressed summary",
      summaryTokens: 2,
      consumedBlockIds: [],
    });
    const checkpoint = serializeDcpSnapshot(uninterrupted);
    if (!checkpoint) throw new Error("expected checkpoint");
    const later = [...initial, makeUserMessage("later user", 4)];

    const uninterruptedResult = runPipeline(uninterrupted, config, later, undefined);
    const uninterruptedBlock = uninterrupted.prune.messages.blocksById.get(1);

    const restored = createSessionState();
    expect(restoreDcpSnapshot(checkpoint, restored, "owner")).toBe(true);
    const restoredResult = runPipeline(restored, config, later, undefined);
    const restoredBlock = restored.prune.messages.blocksById.get(1);

    expect(restoredBlock).toMatchObject({
      startIndex: uninterruptedBlock?.startIndex,
      endIndex: uninterruptedBlock?.endIndex,
      anchorIndex: uninterruptedBlock?.anchorIndex,
      effectiveMessageIndices: uninterruptedBlock?.effectiveMessageIndices,
    });
    expect(restoredResult.messages.map(extractMessageText)).toEqual(
      uninterruptedResult.messages.map(extractMessageText),
    );
  });

  it("is a pure function of its inputs (no Pi mock needed)", () => {
    const state1 = createSessionState();
    const state2 = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [makeUserMessage("Hello"), makeAssistantMessage("Hi")];

    const result1 = runPipeline(state1, config, messages, undefined);
    const result2 = runPipeline(state2, config, messages, undefined);

    // Same inputs produce same outputs
    expect(result1.messages.length).toBe(result2.messages.length);
  });
});
