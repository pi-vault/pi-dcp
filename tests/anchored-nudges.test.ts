import { describe, it, expect, beforeEach } from "vitest";
import { createSessionState } from "../src/state/state.ts";
import {
  assignMessageRefs,
  injectCompressNudges,
} from "../src/messages/inject.ts";
import { makeDefaultConfig, resetTestTimestamp } from "./helpers.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

function userMsg(text: string, ts: number): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: ts,
  } as AgentMessage;
}

function assistantMsg(text: string, ts: number): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0 },
    timestamp: ts,
  } as unknown as AgentMessage;
}

describe("anchored nudge system", () => {
  beforeEach(() => resetTestTimestamp());

  it("anchors nudge to specific message and persists anchor", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      nudgeFrequency: 1,
    });

    const messages: AgentMessage[] = [
      userMsg("msg1", 1000),
      assistantMsg("msg2", 2000),
      userMsg("msg3", 3000),
    ];
    assignMessageRefs(state, messages);

    // Trigger turn nudge (last message is user, percent between min and max)
    injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    // Anchor should be stored using the key format "role:timestamp:counter"
    expect(state.nudges.turnAnchors.size).toBe(1);
    expect(state.nudges.turnAnchors.has("user:3000:0")).toBe(true);
  });

  it("does not add anchor within nudgeFrequency distance of existing anchor", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      nudgeFrequency: 5,
    });

    const messages: AgentMessage[] = [
      userMsg("msg1", 1000),
      assistantMsg("msg2", 2000),
      userMsg("msg3", 3000),
      assistantMsg("msg4", 4000),
      userMsg("msg5", 5000),
    ];
    assignMessageRefs(state, messages);

    // Pre-set an anchor at the 3rd message (index 2)
    state.nudges.turnAnchors.add("user:3000:0");

    // Last message (index 4) is only 2 messages from existing anchor (index 2).
    // nudgeFrequency=5 means no new anchor.
    injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    expect(state.nudges.turnAnchors.size).toBe(1); // Still just the original
  });

  it("adds new anchor when distance exceeds nudgeFrequency", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      nudgeFrequency: 2,
    });

    const messages: AgentMessage[] = [
      userMsg("msg1", 1000),
      assistantMsg("msg2", 2000),
      assistantMsg("msg3", 3000),
      userMsg("msg4", 4000),
    ];
    assignMessageRefs(state, messages);

    state.nudges.turnAnchors.add("user:1000:0");

    // Last message (index 3) is 3 messages from anchor at index 0. nudgeFrequency=2, so OK.
    injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    expect(state.nudges.turnAnchors.size).toBe(2);
    expect(state.nudges.turnAnchors.has("user:4000:0")).toBe(true);
  });

  it("injects nudge text at all anchored positions", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      nudgeFrequency: 1,
    });

    const messages: AgentMessage[] = [
      userMsg("msg1", 1000),
      assistantMsg("msg2", 2000),
      userMsg("msg3", 3000),
    ];
    assignMessageRefs(state, messages);

    // Pre-anchor at two positions
    state.nudges.turnAnchors.add("user:1000:0");
    state.nudges.turnAnchors.add("user:3000:0");

    const result = injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    // Both anchored messages should have nudge text
    const text0 = (result[0] as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    const text2 = (result[2] as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    expect(text0).toContain("dcp-system-reminder");
    expect(text2).toContain("dcp-system-reminder");
  });

  it("context limit nudge always anchors regardless of frequency", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      nudgeFrequency: 100,
    });

    const messages: AgentMessage[] = [userMsg("msg1", 1000)];
    assignMessageRefs(state, messages);

    injectCompressNudges(state, config, messages, {
      tokens: 90000,
      contextWindow: 100000,
      percent: 90,
    });

    // Context limit nudge ignores frequency — always anchors
    expect(state.nudges.contextLimitAnchors.size).toBe(1);
  });

  it("does not inject into messages that already have nudge text", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 });

    const messages: AgentMessage[] = [
      userMsg("already has <dcp-system-reminder>nudge</dcp-system-reminder>", 1000),
    ];
    assignMessageRefs(state, messages);
    state.nudges.turnAnchors.add("user:1000:0");

    const result = injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    // Should not double-inject
    const text = (result[0] as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    const matches = text.match(/<dcp-system-reminder>/g);
    expect(matches).toHaveLength(1);
  });

  it("stale anchors that no longer map to current messages are skipped silently", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 });

    // Simulate an anchor from a previous (now-compacted) message
    state.nudges.turnAnchors.add("user:9999:0");

    const messages: AgentMessage[] = [userMsg("msg1", 1000)];
    assignMessageRefs(state, messages);

    const result = injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    // Stale anchor should not crash anything; new anchor should be added
    expect(state.nudges.turnAnchors.has("user:1000:0")).toBe(true);
    // The text should have nudge on message at index 0
    const text = (result[0] as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    expect(text).toContain("dcp-system-reminder");
  });
});
