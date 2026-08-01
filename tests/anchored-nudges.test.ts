import { describe, it, expect, beforeEach } from "vitest";
import { createSessionState } from "../src/state/state.ts";
import { assignMessageRefs, injectCompressNudges } from "../src/messages/inject.ts";
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
    const text0 = (result[0] as unknown as { content: Array<{ text: string }> }).content[0].text;
    const text2 = (result[2] as unknown as { content: Array<{ text: string }> }).content[0].text;
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
    const text = (result[0] as unknown as { content: Array<{ text: string }> }).content[0].text;
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
    const text = (result[0] as unknown as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain("dcp-system-reminder");
  });

  it("context limit nudge injects when last message is toolResult", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 });

    const messages: AgentMessage[] = [
      userMsg("user message", 1000),
      assistantMsg("assistant response", 2000),
      {
        role: "toolResult",
        content: [{ type: "text", text: "tool output" }],
        toolCallId: "call-123",
      } as unknown as AgentMessage,
    ];
    assignMessageRefs(state, messages);

    // Context over max → context limit nudge should fire
    const result = injectCompressNudges(state, config, messages, {
      tokens: 90000,
      contextWindow: 100000,
      percent: 90,
    });

    // Should anchor at the last user/assistant message (index 1, the assistant message)
    expect(state.nudges.contextLimitAnchors.has("assistant:2000:0")).toBe(true);
    // And inject nudge text there
    const text = (result[1] as unknown as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain("dcp-system-reminder");
    // toolResult at index 2 should be unchanged
    expect(result[2]).toBe(messages[2]);
  });

  it("existing anchors render even when no new nudge type fires", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 });

    // Pre-populate a turn anchor from a previous pass
    state.nudges.turnAnchors.add("user:1000:0");

    // Last injectable message is assistant, not enough iterations → nudgeType is undefined
    const messages: AgentMessage[] = [
      userMsg("user message", 1000),
      assistantMsg("assistant response", 2000),
    ];
    assignMessageRefs(state, messages);

    const result = injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    // Pre-existing anchor should still be applied even though no new nudge fires
    const text = (result[0] as unknown as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain("dcp-system-reminder");
  });

  it("anchor set in pass 1 injects at non-last position in pass 2", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 });

    // Pass 1: two-message array, last is user → turn nudge anchors at "user:2000:0"
    const msgA = userMsg("first user", 1000);
    const msgB = userMsg("second user", 2000);
    const passOneMessages = [msgA, msgB];
    assignMessageRefs(state, passOneMessages);
    injectCompressNudges(state, config, passOneMessages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });
    expect(state.nudges.turnAnchors.has("user:2000:0")).toBe(true);

    // Pass 2: extend array — msgB (index 1) is no longer the last message
    const msgC = assistantMsg("assistant response", 3000);
    const msgD = userMsg("third user", 4000);
    const passTwoMessages = [msgA, msgB, msgC, msgD];
    assignMessageRefs(state, passTwoMessages);
    const result = injectCompressNudges(state, config, passTwoMessages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    // msgB (index 1) should still have nudge text from the persisted anchor
    const textB = (result[1] as unknown as { content: Array<{ text: string }> }).content[0].text;
    expect(textB).toContain("dcp-system-reminder");
  });
});
