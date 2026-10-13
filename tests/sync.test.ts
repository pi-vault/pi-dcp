import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { handleCompress, syncCompressionBlocks } from "../src/compress/blocks.ts";
import { createSessionState } from "../src/state/state.ts";
import { runPipeline } from "../src/pipeline.ts";
import { assignMessageRefs } from "../src/messages/inject.ts";
import { syncToolCache } from "../src/state/tool-cache.ts";
import {
  makeDefaultConfig,
  makeUserMessage,
  makeAssistantMessage,
  makeToolResultMessage,
  getMessageText,
} from "./helpers.ts";

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

  it.each([
    { boundary: "start", index: 0, surviving: "older reply" },
    { boundary: "end", index: 1, surviving: "older user" },
  ])("clears block visibility when the $boundary boundary disappears", ({ index, surviving }) => {
    const state = createSessionState();
    const config = compressionConfig();
    const messages: AgentMessage[] = [
      makeUserMessage("older user", 1),
      makeAssistantMessage("older reply", 2),
      makeUserMessage("current user", 3),
    ];
    runPipeline(state, config, messages, undefined);
    handleCompress(state, config, messages, "owner-1", {
      topic: "older context",
      mode: "range",
      content: [{ startId: "m1", endId: "m2", summary: "older summary" }],
    });
    messages.push(
      makeCompressOwner("owner-1", 4),
      makeToolResultMessage("owner-1", "compress", "ok", false, 5),
    );
    runPipeline(state, config, messages, undefined);
    expect(state.prune.messages.activeBlockIds).toEqual(new Set([1]));

    const withoutBoundary = messages.filter((_message, messageIndex) => messageIndex !== index);
    const result = runPipeline(state, config, withoutBoundary, undefined);

    expect(state.prune.messages.blocksById.size).toBe(0);
    expect(state.prune.messages.activeBlockIds.size).toBe(0);
    expect(state.prune.messages.activeByAnchorIndex.size).toBe(0);
    expect(state.prune.messages.byMessageIndex.size).toBe(0);
    expect(state.prune.messages.nextBlockId).toBe(2);
    expect(state.prune.messages.nextRunId).toBe(2);
    const text = result.messages.map(getMessageText).join("\n");
    expect(text).toContain(surviving);
    expect(text).not.toContain("[Compressed Block b1]");
  });

  it("rebuilds direct membership by excluding consumed child ranges", () => {
    const state = createSessionState();
    const config = compressionConfig();
    const messages: AgentMessage[] = [
      makeUserMessage("child user", 1),
      makeAssistantMessage("child reply", 2),
      makeUserMessage("uncovered user", 3),
    ];
    runPipeline(state, config, messages, undefined);
    handleCompress(state, config, messages, "child-owner", {
      topic: "child",
      mode: "range",
      content: [{ startId: "m1", endId: "m2", summary: "child summary" }],
    });
    messages.push(
      makeCompressOwner("child-owner", 4),
      makeToolResultMessage("child-owner", "compress", "ok", false, 5),
    );
    runPipeline(state, config, messages, undefined);
    handleCompress(state, config, messages, "parent-owner", {
      topic: "parent",
      mode: "range",
      content: [{ startId: "b1", endId: "m3", summary: "parent summary" }],
    });
    messages.push(
      makeCompressOwner("parent-owner", 6),
      makeToolResultMessage("parent-owner", "compress", "ok", false, 7),
    );

    runPipeline(state, config, messages, undefined);

    expect(state.prune.messages.blocksById.get(2)?.effectiveMessageIndices).toEqual([0, 1, 2]);
    expect(state.prune.messages.blocksById.get(2)?.directMessageIndices).toEqual([2]);
    expect(state.prune.messages.blocksById.get(1)?.parentBlockIds).toEqual([2]);
  });
});
