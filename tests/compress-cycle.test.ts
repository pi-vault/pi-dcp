import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createSessionState } from "../src/state/state.ts";
import { assignMessageRefs, injectMessageIds } from "../src/messages/inject.ts";
import { applyPruning } from "../src/messages/prune.ts";
import { syncCompressionBlocks } from "../src/messages/sync.ts";
import { syncToolCache } from "../src/state/tool-cache.ts";
import { handleCompress } from "../src/compress/handler.ts";
import { resolveBoundaryIndex } from "../src/compress/search.ts";
import {
  makeUserMessage as makeUser,
  makeAssistantMessage as makeAssistant,
  makeDefaultConfig,
} from "./helpers.ts";

/** Extract first text content from a message (skips TS union narrowing). */
function textOf(msg: AgentMessage): string {
  const content = (msg as unknown as { content: Array<{ type: string; text: string }> }).content;
  return content[0].text;
}

/**
 * Simulate the context pipeline as it runs in index.ts:
 * 1. assign refs (to raw messages)
 * 2. sync tool and compression state
 * 3. inject IDs (into raw messages)
 * 4. apply pruning (filter compressed ranges)
 *
 * Returns the filtered messages (as the model would see them).
 */
function runContextPipeline(
  state: ReturnType<typeof createSessionState>,
  rawMessages: AgentMessage[],
): AgentMessage[] {
  assignMessageRefs(state, rawMessages);
  syncToolCache(state, rawMessages);
  syncCompressionBlocks(state, rawMessages);
  let messages = injectMessageIds(state, rawMessages);
  messages = applyPruning(state, messages);
  return messages;
}

describe("full compression cycle", () => {
  it("refs correspond to raw indices after filtering, enabling correct second compression", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    // --- Context event #1: 5 messages, no compression yet ---
    const rawMessages = [
      makeUser("hello"),
      makeAssistant("hi there"),
      makeUser("do task A"),
      makeAssistant("task A done"),
      makeUser("do task B"),
    ];

    const filtered1 = runContextPipeline(state, rawMessages);

    // All 5 messages visible, each with correct ref tag
    expect(filtered1.length).toBe(5);
    expect(textOf(filtered1[0])).toContain("m0001");
    expect(textOf(filtered1[2])).toContain("m0003");
    expect(textOf(filtered1[4])).toContain("m0005");

    // --- Model calls compress: m0001..m0002 (hello + hi there) ---
    handleCompress(state, config, rawMessages, "compress-call-1", {
      topic: "Greeting",
      content: [{ startId: "m0001", endId: "m0002", summary: "User greeted, assistant responded" }],
      mode: "range",
    });

    // --- Context event #2: raw grows (tool call + result appended) ---
    const rawMessages2 = [
      ...rawMessages,
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "compress-call-1", name: "compress", arguments: {} }],
        timestamp: Date.now(),
      } as unknown as AgentMessage,
      makeUser("compress result"),
    ];

    const filtered2 = runContextPipeline(state, rawMessages2);

    // Indices 0-1 replaced by summary, indices 2-6 survive
    // Expected: [summary, do_task_A+m0003, task_A_done+m0004, do_task_B+m0005, compress_call+m0006, result+m0007]
    expect(filtered2.length).toBe(6);

    // Summary is a synthetic message (no m-ref tag, has block header)
    const summaryText = textOf(filtered2[0]);
    expect(summaryText).toContain("Compressed Block");
    expect(summaryText).not.toContain("<dcp-message-id>");

    // Surviving messages retain their original raw-index refs
    const msg1Text = textOf(filtered2[1]);
    expect(msg1Text).toContain("m0003"); // raw index 2 → "m0003"
    expect(msg1Text).toContain("do task A");

    const msg2Text = textOf(filtered2[2]);
    expect(msg2Text).toContain("m0004"); // raw index 3 → "m0004"

    // --- Model calls second compress: m0003..m0004 (do task A + task A done) ---
    // Verify these refs resolve to the correct RAW indices
    expect(resolveBoundaryIndex(state, "m0003")).toBe(2);
    expect(resolveBoundaryIndex(state, "m0004")).toBe(3);

    handleCompress(state, config, rawMessages2, "compress-call-2", {
      topic: "Task A",
      content: [
        {
          startId: "m0003",
          endId: "m0004",
          summary: "User asked for task A, assistant completed it",
        },
      ],
      mode: "range",
    });

    expect(state.prune.messages.blocksById.size).toBe(2);
    expect(state.prune.messages.activeBlockIds.size).toBe(2);

    // --- Context event #3: verify both blocks filter correctly ---
    const rawMessages3 = [
      ...rawMessages2,
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "compress-call-2", name: "compress", arguments: {} }],
        timestamp: Date.now(),
      } as unknown as AgentMessage,
      makeUser("second compress result"),
    ];

    const filtered3 = runContextPipeline(state, rawMessages3);

    // Block 1 covers raw [0,1], block 2 covers raw [2,3]
    // Survivors: summary_b1, summary_b2, raw4, raw5, raw6, raw7, raw8
    // (2 summaries + 5 surviving messages)
    expect(filtered3.length).toBe(7);

    // Both summaries are synthetic (no m-ref tags)
    expect(textOf(filtered3[0])).toContain("Compressed Block b1");
    expect(textOf(filtered3[1])).toContain("Compressed Block b2");

    // The remaining real messages have their original refs
    const task_b = textOf(filtered3[2]);
    expect(task_b).toContain("m0005");
    expect(task_b).toContain("do task B");
  });

  it("block refs (b1) resolve to correct anchor indices", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    const rawMessages = [
      makeUser("msg0"),
      makeAssistant("msg1"),
      makeUser("msg2"),
      makeAssistant("msg3"),
    ];

    runContextPipeline(state, rawMessages);

    // Compress m0001..m0002
    handleCompress(state, config, rawMessages, "compress-call-1", {
      topic: "First block",
      content: [{ startId: "m0001", endId: "m0002", summary: "Summary of msg0-msg1" }],
      mode: "range",
    });

    // b1 should resolve to the anchor index (raw index 0)
    expect(resolveBoundaryIndex(state, "b1")).toBe(0);

    // Simulate next event
    const rawMessages2 = [
      ...rawMessages,
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "compress-call-1", name: "compress", arguments: {} }],
        timestamp: Date.now(),
      } as unknown as AgentMessage,
    ];
    runContextPipeline(state, rawMessages2);

    // Can use b1 as a boundary for the next compression
    expect(resolveBoundaryIndex(state, "b1")).toBe(0);
  });

  it("records child and grandchild parent relationships for nested compressions", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const rawMessages = [makeUser("msg0"), makeAssistant("msg1")];

    runContextPipeline(state, rawMessages);
    handleCompress(state, config, rawMessages, "compress-call-1", {
      topic: "child",
      content: [{ startId: "m0001", endId: "m0001", summary: "child summary" }],
      mode: "range",
    });

    const withChildOwner = [
      ...rawMessages,
      { role: "assistant", content: [{ type: "toolCall", id: "compress-call-1" }] },
    ] as unknown as AgentMessage[];
    runContextPipeline(state, withChildOwner);
    handleCompress(state, config, withChildOwner, "compress-call-2", {
      topic: "parent",
      content: [{ startId: "b1", endId: "b1", summary: "parent summary" }],
      mode: "range",
    });

    const withParentOwner = [
      ...withChildOwner,
      { role: "assistant", content: [{ type: "toolCall", id: "compress-call-2" }] },
    ] as unknown as AgentMessage[];
    runContextPipeline(state, withParentOwner);
    handleCompress(state, config, withParentOwner, "compress-call-3", {
      topic: "grandparent",
      content: [{ startId: "b2", endId: "b2", summary: "grandparent summary" }],
      mode: "range",
    });

    expect(state.prune.messages.blocksById.get(1)?.parentBlockIds).toEqual([2]);
    expect(state.prune.messages.blocksById.get(2)?.parentBlockIds).toEqual([3]);
    expect(state.prune.messages.blocksById.get(3)?.consumedBlockIds).toEqual([2]);
    expect(state.prune.messages.blocksById.get(1)?.deactivatedByBlockId).toBe(3);
    expect(state.prune.messages.blocksById.get(3)?.active).toBe(true);
  });
});
