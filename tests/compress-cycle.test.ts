import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createSessionState } from "../src/state/state.ts";
import { assignMessageRefs, injectMessageIds } from "../src/messages/inject.ts";
import { applyPruning } from "../src/messages/prune.ts";
import { syncCompressionBlocks } from "../src/messages/sync.ts";
import { handleRangeCompress } from "../src/compress/range.ts";
import { resolveBoundaryIndex } from "../src/compress/search.ts";
import type { DcpConfig } from "../src/config.ts";

function makeDefaultConfig(): DcpConfig {
  return {
    enabled: true,
    debug: false,
    compress: {
      mode: "range",
      permission: "allow",
      maxContextPercent: 80,
      minContextPercent: 50,
      nudgeFrequency: 5,
      iterationNudgeThreshold: 15,
      nudgeForce: "soft",
      protectedTools: [],
      protectUserMessages: false,
      protectTags: false,
    },
    manualMode: { default: false, automaticStrategies: true },
    strategies: {
      deduplication: { enabled: true, protectedTools: [] },
      purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
    },
    protectedFilePatterns: [],
    nudgeNotification: "minimal",
  };
}

function makeUser(text: string): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() } as AgentMessage;
}

function makeAssistant(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
    timestamp: Date.now(),
  } as unknown as AgentMessage;
}

/**
 * Simulate the context pipeline as it runs in index.ts:
 * 1. sync compression blocks
 * 2. assign refs (to raw messages)
 * 3. inject IDs (into raw messages)
 * 4. apply pruning (filter compressed ranges)
 *
 * Returns the filtered messages (as the model would see them).
 */
function runContextPipeline(state: ReturnType<typeof createSessionState>, rawMessages: AgentMessage[]): AgentMessage[] {
  syncCompressionBlocks(state, rawMessages.length);
  assignMessageRefs(state, rawMessages);
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
    expect((filtered1[0].content as Array<{ type: string; text: string }>)[0].text).toContain("m0001");
    expect((filtered1[2].content as Array<{ type: string; text: string }>)[0].text).toContain("m0003");
    expect((filtered1[4].content as Array<{ type: string; text: string }>)[0].text).toContain("m0005");

    // --- Model calls compress: m0001..m0002 (hello + hi there) ---
    handleRangeCompress(state, config, rawMessages, {
      topic: "Greeting",
      content: [{ startId: "m0001", endId: "m0002", summary: "User greeted, assistant responded" }],
    });

    // --- Context event #2: raw grows (tool call + result appended) ---
    const rawMessages2 = [
      ...rawMessages,
      makeAssistant("compress tool called"),
      makeUser("compress result"),
    ];

    const filtered2 = runContextPipeline(state, rawMessages2);

    // Indices 0-1 replaced by summary, indices 2-6 survive
    // Expected: [summary, do_task_A+m0003, task_A_done+m0004, do_task_B+m0005, compress_call+m0006, result+m0007]
    expect(filtered2.length).toBe(6);

    // Summary is a synthetic message (no m-ref tag, has block header)
    const summaryText = (filtered2[0].content as Array<{ type: string; text: string }>)[0].text;
    expect(summaryText).toContain("Compressed Block");
    expect(summaryText).not.toContain("<dcp-message-id>");

    // Surviving messages retain their original raw-index refs
    const msg1Text = (filtered2[1].content as Array<{ type: string; text: string }>)[0].text;
    expect(msg1Text).toContain("m0003"); // raw index 2 → "m0003"
    expect(msg1Text).toContain("do task A");

    const msg2Text = (filtered2[2].content as Array<{ type: string; text: string }>)[0].text;
    expect(msg2Text).toContain("m0004"); // raw index 3 → "m0004"

    // --- Model calls second compress: m0003..m0004 (do task A + task A done) ---
    // Verify these refs resolve to the correct RAW indices
    expect(resolveBoundaryIndex(state, "m0003")).toBe(2);
    expect(resolveBoundaryIndex(state, "m0004")).toBe(3);

    handleRangeCompress(state, config, rawMessages2, {
      topic: "Task A",
      content: [{ startId: "m0003", endId: "m0004", summary: "User asked for task A, assistant completed it" }],
    });

    expect(state.prune.messages.blocksById.size).toBe(2);
    expect(state.prune.messages.activeBlockIds.size).toBe(2);

    // --- Context event #3: verify both blocks filter correctly ---
    const rawMessages3 = [
      ...rawMessages2,
      makeAssistant("second compress called"),
      makeUser("second compress result"),
    ];

    const filtered3 = runContextPipeline(state, rawMessages3);

    // Block 1 covers raw [0,1], block 2 covers raw [2,3]
    // Survivors: summary_b1, summary_b2, raw4, raw5, raw6, raw7, raw8
    // (2 summaries + 5 surviving messages)
    expect(filtered3.length).toBe(7);

    // Both summaries are synthetic (no m-ref tags)
    const s1 = (filtered3[0].content as Array<{ type: string; text: string }>)[0].text;
    const s2 = (filtered3[1].content as Array<{ type: string; text: string }>)[0].text;
    expect(s1).toContain("Compressed Block b1");
    expect(s2).toContain("Compressed Block b2");

    // The remaining real messages have their original refs
    const task_b = (filtered3[2].content as Array<{ type: string; text: string }>)[0].text;
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
    handleRangeCompress(state, config, rawMessages, {
      topic: "First block",
      content: [{ startId: "m0001", endId: "m0002", summary: "Summary of msg0-msg1" }],
    });

    // b1 should resolve to the anchor index (raw index 0)
    expect(resolveBoundaryIndex(state, "b1")).toBe(0);

    // Simulate next event
    const rawMessages2 = [...rawMessages, makeAssistant("tool result")];
    runContextPipeline(state, rawMessages2);

    // Can use b1 as a boundary for the next compression
    expect(resolveBoundaryIndex(state, "b1")).toBe(0);
  });
});
