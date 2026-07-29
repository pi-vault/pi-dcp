import { describe, it, expect } from "vitest";
import { createSessionState } from "../src/state/state.ts";
import { getActiveSummaryTokenUsage } from "../src/compress/state.ts";
import type { CompressionBlock } from "../src/state/types.ts";
import {
  injectCompressNudges,
  assignMessageRefs,
} from "../src/messages/inject.ts";
import {
  makeUserMessage,
  makeAssistantMessage,
  makeDefaultConfig,
} from "./helpers.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

function makeBlock(overrides: Partial<CompressionBlock>): CompressionBlock {
  return {
    blockId: 1,
    runId: 1,
    active: true,
    deactivatedByUser: false,
    compressedTokens: 1000,
    summaryTokens: 200,
    durationMs: 0,
    mode: "range",
    topic: "test",
    batchTopic: undefined,
    startIndex: 0,
    endIndex: 5,
    anchorIndex: 5,
    compressToolCallId: "compress-call-1",
    startKey: "user:1000:0",
    endKey: "assistant:1001:0",
    anchorKey: "user:1000:0",
    consumedBlockIds: [],
    parentBlockIds: [],
    directMessageIndices: [],
    directToolIds: [],
    effectiveMessageIndices: [],
    effectiveToolIds: [],
    createdAt: Date.now(),
    deactivatedAt: undefined,
    deactivatedByBlockId: undefined,
    summary: "Summary",
    ...overrides,
  };
}

describe("getActiveSummaryTokenUsage", () => {
  it("returns 0 when no blocks exist", () => {
    const state = createSessionState();
    expect(getActiveSummaryTokenUsage(state)).toBe(0);
  });

  it("sums summaryTokens across active blocks", () => {
    const state = createSessionState();
    state.prune.messages.blocksById.set(
      1,
      makeBlock({ blockId: 1, active: true, summaryTokens: 200 }),
    );
    state.prune.messages.blocksById.set(
      2,
      makeBlock({ blockId: 2, active: true, summaryTokens: 350 }),
    );
    state.prune.messages.activeBlockIds.add(1);
    state.prune.messages.activeBlockIds.add(2);

    expect(getActiveSummaryTokenUsage(state)).toBe(550);
  });

  it("excludes inactive blocks", () => {
    const state = createSessionState();
    state.prune.messages.blocksById.set(
      1,
      makeBlock({ blockId: 1, active: true, summaryTokens: 200 }),
    );
    state.prune.messages.blocksById.set(
      2,
      makeBlock({ blockId: 2, active: false, summaryTokens: 350 }),
    );
    state.prune.messages.activeBlockIds.add(1);

    expect(getActiveSummaryTokenUsage(state)).toBe(200);
  });
});

describe("injectCompressNudges with summaryBuffer", () => {
  it("does not inject nudge when summary tokens push past threshold but buffer accounts for them", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      maxContextPercent: 80,
      minContextPercent: 50,
      summaryBuffer: true,
    });

    // Simulate 600 summary tokens from active blocks
    state.prune.messages.blocksById.set(
      1,
      makeBlock({ blockId: 1, active: true, summaryTokens: 600 }),
    );
    state.prune.messages.activeBlockIds.add(1);

    const messages: AgentMessage[] = [
      makeUserMessage("hello"),
      makeAssistantMessage("world"),
      makeUserMessage("question"),
    ];
    assignMessageRefs(state, messages);

    // Context at 82% — normally triggers CONTEXT_LIMIT_NUDGE.
    // But 600 summary tokens in a 10000-token window = 6%.
    // Effective threshold = 80% + 6% = 86%. So 82% < 86% — no urgent nudge.
    // However 82% > 50% and last message is user — TURN_NUDGE should fire.
    const result = injectCompressNudges(state, config, messages, {
      tokens: 8200,
      contextWindow: 10000,
      percent: 82,
    });

    // Should get TURN_NUDGE (not CONTEXT_LIMIT_NUDGE)
    const lastMsg = result[result.length - 1];
    const text = (lastMsg as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    expect(text).toContain("Evaluate the conversation");
    expect(text).not.toContain("CRITICAL WARNING");
  });

  it("still injects CONTEXT_LIMIT_NUDGE when percent exceeds buffer-adjusted max", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      maxContextPercent: 80,
      minContextPercent: 50,
      summaryBuffer: true,
    });

    state.prune.messages.blocksById.set(
      1,
      makeBlock({ blockId: 1, active: true, summaryTokens: 300 }),
    );
    state.prune.messages.activeBlockIds.add(1);

    const messages: AgentMessage[] = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);

    // Context at 85%. Summary buffer = 300/10000 = 3%. Effective max = 83%.
    // 85% > 83% — CONTEXT_LIMIT_NUDGE fires.
    const result = injectCompressNudges(state, config, messages, {
      tokens: 8500,
      contextWindow: 10000,
      percent: 85,
    });

    const text = (result[0] as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    expect(text).toContain("CRITICAL WARNING");
  });

  it("no buffer adjustment when summaryBuffer is disabled", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      maxContextPercent: 80,
      minContextPercent: 50,
      summaryBuffer: false,
    });

    state.prune.messages.blocksById.set(
      1,
      makeBlock({ blockId: 1, active: true, summaryTokens: 600 }),
    );
    state.prune.messages.activeBlockIds.add(1);

    const messages: AgentMessage[] = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);

    // Context at 82% — with buffer disabled, 82% >= 80% triggers CONTEXT_LIMIT_NUDGE
    const result = injectCompressNudges(state, config, messages, {
      tokens: 8200,
      contextWindow: 10000,
      percent: 82,
    });

    const text = (result[0] as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    expect(text).toContain("CRITICAL WARNING");
  });
});
