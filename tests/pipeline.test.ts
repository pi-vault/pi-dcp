import { describe, it, expect } from "vitest";
import { runPipeline } from "../src/pipeline.ts";
import { createSessionState } from "../src/state/state.ts";
import {
  makeDefaultConfig,
  makeUserMessage,
  makeAssistantMessage,
} from "./helpers.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ContextUsage } from "../src/state/types.ts";
import { countTokens } from "../src/utils/tokens.ts";

describe("runPipeline", () => {
  it("returns messages unchanged when no pruning applies", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [
      makeUserMessage("Hello"),
      makeAssistantMessage("Hi there"),
    ];

    const result = runPipeline(state, config, messages, undefined);

    // Messages should still be present (message IDs injected but content preserved)
    expect(result.messages.length).toBe(2);
  });

  it("strips hallucinated DCP tags from assistant messages", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [
      makeUserMessage("Hello"),
      makeAssistantMessage(
        'Response <dcp-message-id ref="m0001" /> with hallucination',
      ),
    ];

    const result = runPipeline(state, config, messages, undefined);

    const assistantContent = (result.messages[1] as any).content as Array<{
      type: string;
      text: string;
    }>;
    const text = assistantContent[0].text;
    // The hallucinated ref should have been stripped and replaced with the correct sequential ref
    expect(text).not.toContain('ref="m0001"');
    // A legitimate message ID was injected (not the hallucinated one)
    expect(text).toContain("<dcp-message-id");
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
        content: [{ type: "toolCall", id: "call-1", name: "read_file", arguments: { path: "/a.ts" } }],
        stopReason: "toolUse",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
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
        content: [{ type: "toolCall", id: "call-2", name: "read_file", arguments: { path: "/a.ts" } }],
        stopReason: "toolUse",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
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
    ];

    state.currentTurn = 0;
    runPipeline(state, config, messages, undefined);

    state.currentTurn = 4;
    const result = runPipeline(state, config, messages, undefined);
    const assistant = result.messages.find(
      (message): message is Extract<AgentMessage, { role: "assistant" }> =>
        message.role === "assistant",
    );
    const toolCall = assistant?.content.find(
      (part) => part.type === "toolCall",
    );
    const errorResult = result.messages.find(
      (message): message is Extract<AgentMessage, { role: "toolResult" }> =>
        message.role === "toolResult",
    );

    expect(toolCall?.arguments).toEqual({
      __purged: "input removed due to failed tool call",
    });
    expect(errorResult?.content).toEqual([
      { type: "text", text: "command not found" },
    ]);
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
    const lastUser = (result.messages[result.messages.length - 1] as any)
      .content as Array<{ type: string; text: string }>;
    expect(lastUser[0].text).toContain("<dcp-system-reminder>");
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
      compressMessageIndex: 11,
      includedBlockIds: [],
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

    const messages: AgentMessage[] = [
      makeUserMessage("Hello"),
      makeAssistantMessage("Hi"),
    ];

    // Should not throw — sync handles stale blocks gracefully
    const result = runPipeline(state, config, messages, undefined);
    expect(result.messages.length).toBe(2);
  });

  it("is a pure function of its inputs (no Pi mock needed)", () => {
    const state1 = createSessionState();
    const state2 = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [
      makeUserMessage("Hello"),
      makeAssistantMessage("Hi"),
    ];

    const result1 = runPipeline(state1, config, messages, undefined);
    const result2 = runPipeline(state2, config, messages, undefined);

    // Same inputs produce same outputs
    expect(result1.messages.length).toBe(result2.messages.length);
  });
});
