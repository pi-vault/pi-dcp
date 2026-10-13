import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createSessionState } from "../src/state/state.ts";
import { runPipeline } from "../src/pipeline.ts";
import { handleCompress } from "../src/compress/blocks.ts";
import { makeDefaultConfig, getMessageText } from "./helpers.ts";

function compressionConfig(overrides?: Parameters<typeof makeDefaultConfig>[0]) {
  const config = makeDefaultConfig(overrides);
  config.strategies = {
    deduplication: { enabled: false, protectedTools: [], turnProtection: 0 },
    purgeErrors: { enabled: false, turns: 4, protectedTools: [] },
  };
  return config;
}

let nextTimestamp = 20_000;
function makeUser(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: nextTimestamp++,
  } as AgentMessage;
}

function makeAssistant(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      totalTokens: 0,
    },
    timestamp: nextTimestamp++,
  } as unknown as AgentMessage;
}

function makeOwner(toolCallId: string): AgentMessage {
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
    timestamp: nextTimestamp++,
  } as unknown as AgentMessage;
}

function makeResult(toolCallId: string, text: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "compress",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: nextTimestamp++,
  } as AgentMessage;
}

describe("full compression cycle", () => {
  it("refs correspond to raw indices after filtering, enabling correct second compression", () => {
    const state = createSessionState();
    state.sessionId = "compress-cycle-test";
    const config = compressionConfig();

    // --- Context event #1: 5 messages, no compression yet ---
    const rawMessages: AgentMessage[] = [
      makeUser("hello"),
      makeAssistant("hi there"),
      makeUser("do task A"),
      makeAssistant("task A done"),
      makeUser("do task B"),
    ];

    const filtered1 = runPipeline(state, config, rawMessages, undefined).messages;
    expect(filtered1.length).toBe(5);
    expect(getMessageText(filtered1[0])).toContain("@m1@");
    expect(getMessageText(filtered1[2])).toContain("@m3@");
    expect(getMessageText(filtered1[4])).toContain("@m5@");

    // --- Model calls compress with the markers it was shown: @m1@..@m2@ ---
    const first = handleCompress(state, config, rawMessages, "compress-call-1", {
      topic: "Greeting",
      content: [{ startId: "@m1@", endId: "@m2@", summary: "User greeted, assistant responded" }],
      mode: "range",
    });

    // --- Context event #2: raw grows with the owner call and its result ---
    const rawMessages2: AgentMessage[] = [
      ...rawMessages,
      makeOwner("compress-call-1"),
      makeResult("compress-call-1", first.text),
    ];

    const filtered2 = runPipeline(state, config, rawMessages2, undefined).messages;

    // Indices 0-1 replaced by the summary; the rest survive.
    expect(getMessageText(filtered2[0])).toContain("Compressed Block b1");
    expect(filtered2.map(getMessageText).join("\n")).not.toContain("hello");
    expect(getMessageText(filtered2[1])).toContain("do task A");

    // The surviving markers are the actual references shown by the production pass.
    const visibleText = filtered2.map(getMessageText).join("\n");
    const startMarker = visibleText.match(/@m3(?::\d+)?@/)?.[0];
    const endMarker = visibleText.match(/@m4(?::\d+)?@/)?.[0];
    if (!startMarker || !endMarker) throw new Error("expected surviving m3/m4 markers");

    handleCompress(state, config, rawMessages2, "compress-call-2", {
      topic: "Task A",
      content: [
        {
          startId: startMarker,
          endId: endMarker,
          summary: "User asked for task A, assistant completed it",
        },
      ],
      mode: "range",
    });

    expect(state.prune.messages.blocksById.size).toBe(2);
    expect(state.prune.messages.activeBlockIds.size).toBe(2);

    // --- Context event #3: verify both blocks filter correctly ---
    const rawMessages3: AgentMessage[] = [
      ...rawMessages2,
      makeOwner("compress-call-2"),
      makeResult("compress-call-2", "second compress result"),
    ];

    const filtered3 = runPipeline(state, config, rawMessages3, undefined).messages;
    const filteredText = filtered3.map(getMessageText).join("\n");

    expect(filteredText).toContain("Compressed Block b1");
    expect(filteredText).toContain("Compressed Block b2");
    expect(filteredText).toContain("do task B");
  });

  it("records child and grandchild parent relationships for nested compressions", () => {
    const state = createSessionState();
    state.sessionId = "compress-cycle-test";
    const config = compressionConfig();
    let raw: AgentMessage[] = [makeUser("msg0"), makeAssistant("msg1")];

    runPipeline(state, config, raw, undefined);
    handleCompress(state, config, raw, "compress-call-1", {
      topic: "child",
      content: [{ startId: "m1", endId: "m1", summary: "child summary" }],
      mode: "range",
    });
    raw = [...raw, makeOwner("compress-call-1"), makeResult("compress-call-1", "ok")];
    runPipeline(state, config, raw, undefined);

    handleCompress(state, config, raw, "compress-call-2", {
      topic: "parent",
      content: [{ startId: "b1", endId: "b1", summary: "parent summary" }],
      mode: "range",
    });
    raw = [...raw, makeOwner("compress-call-2"), makeResult("compress-call-2", "ok")];
    runPipeline(state, config, raw, undefined);

    handleCompress(state, config, raw, "compress-call-3", {
      topic: "grandparent",
      content: [{ startId: "b2", endId: "b2", summary: "grandparent summary" }],
      mode: "range",
    });
    raw = [...raw, makeOwner("compress-call-3"), makeResult("compress-call-3", "ok")];
    runPipeline(state, config, raw, undefined);

    expect(state.prune.messages.blocksById.get(1)?.parentBlockIds).toEqual([2]);
    expect(state.prune.messages.blocksById.get(2)?.parentBlockIds).toEqual([3]);
    expect(state.prune.messages.blocksById.get(3)?.consumedBlockIds).toEqual([2]);
    expect(state.prune.messages.blocksById.get(1)?.deactivatedByBlockId).toBe(3);
    expect(state.prune.messages.blocksById.get(3)?.active).toBe(true);
  });
});
