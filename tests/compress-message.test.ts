import { describe, expect, it } from "vitest";
import { handleCompress } from "../src/compress/handler.ts";
import { createSessionState } from "../src/state/state.ts";
import { assignMessageRefs } from "../src/messages/inject.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { makeUserMessage, makeAssistantMessage, makeDefaultConfig } from "./helpers.ts";

describe("handleCompress (message mode)", () => {
  it("compresses targeted messages", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });
    const messages = [
      makeUserMessage("hello"),
      makeAssistantMessage("long response..."),
      makeUserMessage("next"),
    ];
    assignMessageRefs(state, messages);

    const result = handleCompress(state, config, messages, "compress-call-1", {
      topic: "Greeting",
      targets: [
        { messageId: "m0001", summary: "User greeted" },
        { messageId: "m0002", summary: "Assistant responded with greeting" },
      ],
      mode: "message",
    });

    expect(result.text).toContain("Compressed 2 messages");
    expect(state.prune.messages.blocksById.size).toBe(2);

    // Verify blocks have mode "message" and startIndex === endIndex
    for (const [, block] of state.prune.messages.blocksById) {
      expect(block.mode).toBe("message");
      expect(block.startIndex).toBe(block.endIndex);
    }
  });

  it("throws for unknown message ID", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });
    const messages = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);

    expect(() =>
      handleCompress(state, config, messages, "compress-call-1", {
        topic: "test",
        targets: [{ messageId: "m9999", summary: "text" }],
        mode: "message",
      }),
    ).toThrow("m9999 is not available. It may have been pruned or compressed.");
  });

  it("throws for empty targets array", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });

    expect(() =>
      handleCompress(state, config, [], "compress-call-1", {
        topic: "test",
        targets: [],
        mode: "message",
      }),
    ).toThrow("targets array is required");
  });

  it("marks compressed messages in prune state", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });
    const messages = [makeUserMessage("hello"), makeAssistantMessage("world")];
    assignMessageRefs(state, messages);

    handleCompress(state, config, messages, "compress-call-1", {
      topic: "test",
      targets: [{ messageId: "m0001", summary: "User said hello" }],
      mode: "message",
    });

    const entry = state.prune.messages.byMessageIndex.get(0);
    expect(entry).toBeDefined();
    expect(entry?.activeBlockIds.length).toBeGreaterThan(0);
  });

  it("includes token savings in message mode", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });
    const messages = [makeUserMessage("hello"), makeAssistantMessage("world")];
    assignMessageRefs(state, messages);

    // Pre-populate token count for the target message
    state.prune.messages.byMessageIndex.set(0, {
      tokenCount: 120,
      blockIds: [],
      activeBlockIds: [],
    });

    const result = handleCompress(state, config, messages, "compress-call-1", {
      topic: "test",
      targets: [{ messageId: "m0001", summary: "greeting" }],
      mode: "message",
    });

    expect(result.text).toContain("~120 tokens");
    expect(result.text).toContain("Compressed 1 messages");
  });

  it("expands a tool-result target to its complete assistant/results group", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });
    const messages: AgentMessage[] = [
      makeUserMessage("read it"),
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
        stopReason: "toolUse",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
        timestamp: 0,
      } as unknown as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read",
        content: [{ type: "text", text: "contents" }],
        isError: false,
        timestamp: 0,
      } as AgentMessage,
    ];
    assignMessageRefs(state, messages);

    const result = handleCompress(state, config, messages, "compress-call-1", {
      topic: "tool result",
      mode: "message",
      targets: [{ messageId: "m0003", summary: "read file" }],
    });

    expect(result.messagesCompressed).toBe(2);
    const block = state.prune.messages.blocksById.get(result.blockIds[0]);
    expect(block?.startIndex).toBe(1);
    expect(block?.endIndex).toBe(2);
  });

  it("rejects overlapping expanded targets before allocating compression state", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });
    const messages: AgentMessage[] = [
      makeUserMessage("read it"),
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
        stopReason: "toolUse",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
        timestamp: 0,
      } as unknown as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read",
        content: [{ type: "text", text: "contents" }],
        isError: false,
        timestamp: 0,
      } as AgentMessage,
    ];
    assignMessageRefs(state, messages);

    expect(() =>
      handleCompress(state, config, messages, "compress-call-1", {
        topic: "tool pair",
        mode: "message",
        targets: [
          { messageId: "m0002", summary: "call" },
          { messageId: "m0003", summary: "result" },
        ],
      }),
    ).toThrow(/overlapping compression selections/i);

    expect(state.prune.messages.blocksById.size).toBe(0);
    expect(state.prune.messages.nextBlockId).toBe(1);
    expect(state.prune.messages.nextRunId).toBe(1);
    expect(state.stats.messagesCompressed).toBe(0);
  });

  it("rejects a message target in the protected window", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });
    config.turnProtection = 1;
    const messages = [
      makeUserMessage("older"),
      makeAssistantMessage("older reply"),
      makeUserMessage("protected"),
    ];
    assignMessageRefs(state, messages);

    expect(() =>
      handleCompress(state, config, messages, "compress-call-1", {
        topic: "test",
        mode: "message",
        targets: [{ messageId: "m0003", summary: "protected" }],
      }),
    ).toThrow(/turnProtection.*protected window/i);
  });
});
