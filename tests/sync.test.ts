import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { handleCompress, syncCompressionBlocks } from "../src/compress/blocks.ts";
import { createSessionState } from "../src/state/state.ts";
import { runPipeline } from "../src/pipeline.ts";
import { assignMessageRefs } from "../src/messages/inject.ts";
import { syncToolCache } from "../src/state/tool-cache.ts";
import { makeDefaultConfig, makeUserMessage } from "./helpers.ts";

function compressionConfig() {
  const config = makeDefaultConfig();
  config.strategies = {
    deduplication: { enabled: false, protectedTools: [], turnProtection: 0 },
    purgeErrors: { enabled: false, turns: 4, protectedTools: [] },
  };
  return config;
}

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

/** Seed a real block through the public compression operation. */
function seedBlock(
  state: ReturnType<typeof createSessionState>,
  config: ReturnType<typeof makeDefaultConfig>,
  messages: AgentMessage[],
  ownerId = "compress-call-1",
) {
  runPipeline(state, config, messages, undefined);
  return handleCompress(state, config, messages, ownerId, {
    topic: "test",
    mode: "range",
    content: [{ startId: "m1", endId: "m1", summary: "summary" }],
  });
}

describe("syncCompressionBlocks", () => {
  it("rehydrates durable keys and discards blocks missing current boundaries", () => {
    const state = createSessionState();
    state.sessionId = "owner";
    const config = compressionConfig();
    const messages: AgentMessage[] = [makeUserMessage("one", 1), makeCompressOwner("owner-1", 2)];

    seedBlock(state, config, messages, "owner-1");
    const block = state.prune.messages.blocksById.get(1);
    if (!block) throw new Error("expected block");
    block.startIndex = -1;

    syncCompressionBlocks(state, messages);

    expect(state.prune.messages.blocksById.get(1)?.startIndex).toBe(0);
    expect(state.prune.messages.activeBlockIds).toEqual(new Set([1]));

    // Removing the start boundary leaves no anchor to rebuild from.
    const withoutStart = messages.filter((_message, index) => index !== 0);
    assignMessageRefs(state, withoutStart);
    syncToolCache(state, withoutStart);
    syncCompressionBlocks(state, withoutStart);

    expect(state.prune.messages.blocksById.has(1)).toBe(false);
  });

  it("discards restored blocks when the current context is empty", () => {
    const state = createSessionState();
    state.sessionId = "owner";
    const config = compressionConfig();
    const messages: AgentMessage[] = [makeUserMessage("one", 1), makeCompressOwner("owner-1", 2)];

    seedBlock(state, config, messages, "owner-1");
    expect(state.prune.messages.blocksById.has(1)).toBe(true);

    assignMessageRefs(state, []);
    syncCompressionBlocks(state, []);

    expect(state.prune.messages.blocksById.has(1)).toBe(false);
    expect(state.prune.messages.activeBlockIds.has(1)).toBe(false);
  });
});
