import { describe, it, expect, beforeEach } from "vitest";
import { createSessionState } from "../src/state/state.ts";
import { assignMessageRefs, injectCompressNudges } from "../src/messages/inject.ts";
import { makeDefaultConfig, resetTestTimestamp } from "./helpers.ts";
import { restoreDcpSnapshot, serializeDcpSnapshot } from "../src/state/persistence.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { DcpSnapshotV1 } from "../src/state/types.ts";

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

    // Both halves of the eligible pair are stored.
    expect(state.nudges.turnAnchors.size).toBe(2);
    expect(state.nudges.turnAnchors.has("user:3000:0")).toBe(true);
    expect(state.nudges.turnAnchors.has("assistant:2000:0")).toBe(true);
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

    expect(state.nudges.turnAnchors.has("user:5000:0")).toBe(false);
    expect(state.nudges.turnAnchors.has("assistant:2000:0")).toBe(true);
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

    expect(state.nudges.turnAnchors.size).toBe(3);
    expect(state.nudges.turnAnchors.has("user:4000:0")).toBe(true);
    expect(state.nudges.turnAnchors.has("assistant:3000:0")).toBe(true);
  });

  it("injects nudge text at all anchored positions", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      nudgeFrequency: 1,
      nudgeForce: "strong",
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
    const config = makeDefaultConfig({ nudgeFrequency: 1, nudgeForce: "strong" });

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

    const messages: AgentMessage[] = [assistantMsg("prior", 500), userMsg("msg1", 1000)];
    assignMessageRefs(state, messages);

    const result = injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    // Stale anchor should not crash anything; new pair should be added
    expect(state.nudges.turnAnchors.has("user:1000:0")).toBe(true);
    expect(state.nudges.turnAnchors.has("assistant:500:0")).toBe(true);
    // Soft mode injects into the assistant half of the pair
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

    // Pre-populate a soft (assistant) turn anchor from a previous pass
    state.nudges.turnAnchors.add("assistant:2000:0");

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
    const text = (result[1] as unknown as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain("dcp-system-reminder");
  });

  it("anchor set in pass 1 injects at non-last position in pass 2", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1, nudgeForce: "strong" });

    // Pass 1: user → assistant → user, last is user → pair anchored at assistant:1000 and user:2000
    const msgA = userMsg("first user", 500);
    const msgB = assistantMsg("first assistant", 1000);
    const msgC = userMsg("second user", 2000);
    const passOneMessages = [msgA, msgB, msgC];
    assignMessageRefs(state, passOneMessages);
    injectCompressNudges(state, config, passOneMessages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });
    expect(state.nudges.turnAnchors.has("user:2000:0")).toBe(true);

    // Pass 2: extend array — msgC (index 2) is no longer the last message
    const msgD = assistantMsg("later assistant", 3000);
    const msgE = userMsg("third user", 4000);
    const passTwoMessages = [msgA, msgB, msgC, msgD, msgE];
    assignMessageRefs(state, passTwoMessages);
    const result = injectCompressNudges(state, config, passTwoMessages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    // msgC (index 2) should still have nudge text from the persisted anchor
    const textC = (result[2] as unknown as { content: Array<{ text: string }> }).content[0].text;
    expect(textC).toContain("dcp-system-reminder");
  });

  it.each(["strong", "soft"] as const)(
    "stores both pair keys and injects into the %s role only",
    (nudgeForce) => {
      const state = createSessionState();
      const config = makeDefaultConfig({ nudgeFrequency: 1, nudgeForce });
      const messages: AgentMessage[] = [assistantMsg("prior", 1000), userMsg("latest", 2000)];
      assignMessageRefs(state, messages);

      const result = injectCompressNudges(state, config, messages, {
        tokens: 60000,
        contextWindow: 100000,
        percent: 60,
      });

      expect(state.nudges.turnAnchors.has("assistant:1000:0")).toBe(true);
      expect(state.nudges.turnAnchors.has("user:2000:0")).toBe(true);

      const assistantText = (result[0] as unknown as { content: Array<{ text: string }> })
        .content[0].text;
      const userText = (result[1] as unknown as { content: Array<{ text: string }> }).content[0]
        .text;
      if (nudgeForce === "strong") {
        expect(userText).toContain("Evaluate the conversation");
        expect(assistantText).not.toContain("dcp-system-reminder");
      } else {
        expect(assistantText).toContain("Evaluate the conversation");
        expect(userText).not.toContain("dcp-system-reminder");
      }
    },
  );

  it("creates no turn anchor and injects nothing for a user-only conversation", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1, nudgeForce: "soft" });
    const messages: AgentMessage[] = [userMsg("only user", 1000)];
    assignMessageRefs(state, messages);

    const result = injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    expect(state.nudges.turnAnchors.size).toBe(0);
    const text = (result[0] as unknown as { content: Array<{ text: string }> }).content[0].text;
    expect(text).not.toContain("dcp-system-reminder");
  });

  it("prepends a synthetic text part before a tool-only assistant call", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1, nudgeForce: "soft" });
    const toolCall = {
      type: "toolCall" as const,
      id: "call-1",
      name: "read",
      arguments: { path: "a" },
    };
    const toolOnlyAssistant = {
      role: "assistant",
      content: [toolCall],
      api: "test",
      provider: "test",
      model: "test",
      stopReason: "toolUse",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: 1000,
    } satisfies AgentMessage;
    const messages: AgentMessage[] = [toolOnlyAssistant, userMsg("latest", 2000)];
    assignMessageRefs(state, messages);

    const result = injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    const content = (result[0] as unknown as { content: Array<Record<string, unknown>> }).content;
    expect(content[0]).toMatchObject({ type: "text" });
    expect(String(content[0].text)).toContain("Evaluate the conversation");
    expect(content[1]).toBe(toolCall);
  });

  it("measures frequency against user-role turn anchors only", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 3 });
    const messages: AgentMessage[] = [
      userMsg("u1", 1000),
      assistantMsg("a1", 2000),
      userMsg("u2", 3000),
      assistantMsg("a2", 4000),
      userMsg("u3", 5000),
    ];
    assignMessageRefs(state, messages);
    state.nudges.turnAnchors.add("user:1000:0");
    state.nudges.turnAnchors.add("assistant:4000:0");

    injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    // The assistant half at index 3 must not suppress the new pair; the user
    // anchor at index 0 is 4 messages away (>= 3).
    expect(state.nudges.turnAnchors.has("user:5000:0")).toBe(true);
  });

  it("keeps soft role filtering stable across a version-1 snapshot restore", () => {
    const config = makeDefaultConfig({ nudgeFrequency: 1, nudgeForce: "soft" });
    const first = createSessionState();
    first.sessionId = "session";
    const initial = [assistantMsg("prior", 1000), userMsg("latest", 2000)];
    assignMessageRefs(first, initial);
    injectCompressNudges(first, config, initial, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });
    const snapshot = serializeDcpSnapshot(first);
    if (!snapshot) throw new Error("expected snapshot");

    const restored = createSessionState();
    expect(restoreDcpSnapshot(snapshot, restored, "session")).toBe(true);
    expect(restored.nudges.turnAnchors.has("assistant:1000:0")).toBe(true);
    expect(restored.nudges.turnAnchors.has("user:2000:0")).toBe(true);

    const fresh = [assistantMsg("prior", 1000), userMsg("latest", 2000)];
    assignMessageRefs(restored, fresh);
    const result = injectCompressNudges(restored, config, fresh, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    const assistantText = (result[0] as unknown as { content: Array<{ text: string }> }).content[0]
      .text;
    const userText = (result[1] as unknown as { content: Array<{ text: string }> }).content[0].text;
    expect(assistantText).toContain("Evaluate the conversation");
    expect(userText).not.toContain("dcp-system-reminder");
  });

  it("upgrades a legacy version-1 user-only turn anchor after restore", () => {
    const snapshot = {
      version: 1,
      ownerSessionId: "session",
      manualMode: false,
      compressPermission: "allow",
      stats: {
        pruneTokenCounter: 0,
        totalPruneTokens: 0,
        toolsPruned: 0,
        messagesCompressed: 0,
      },
      lastCompaction: 0,
      pruneTools: [],
      blocks: [],
      nextBlockId: 1,
      nextRunId: 1,
      messageIds: {
        byRawId: [
          ["assistant:1000:0", "m0001"],
          ["user:2000:0", "m0002"],
        ],
        nextRefIndex: 3,
      },
      nudges: {
        contextLimitAnchors: [],
        turnAnchors: ["user:2000:0"],
        iterationAnchors: [],
      },
    } satisfies DcpSnapshotV1;
    const state = createSessionState();
    expect(restoreDcpSnapshot(snapshot, state, "session")).toBe(true);

    const messages = [assistantMsg("prior", 1000), userMsg("latest", 2000)];
    assignMessageRefs(state, messages);
    const result = injectCompressNudges(
      state,
      makeDefaultConfig({ nudgeFrequency: 1, nudgeForce: "soft" }),
      messages,
      { tokens: 60000, contextWindow: 100000, percent: 60 },
    );

    expect(state.nudges.turnAnchors.has("assistant:1000:0")).toBe(true);
    const assistantText = (result[0] as unknown as { content: Array<{ text: string }> }).content[0]
      .text;
    const userText = (result[1] as unknown as { content: Array<{ text: string }> }).content[0].text;
    expect(assistantText).toContain("Evaluate the conversation");
    expect(userText).not.toContain("dcp-system-reminder");
  });

  it("moves injection to the user without adding keys when force switches to strong", () => {
    const state = createSessionState();
    const softConfig = makeDefaultConfig({ nudgeFrequency: 1, nudgeForce: "soft" });
    const softMessages = [assistantMsg("prior", 1000), userMsg("latest", 2000)];
    assignMessageRefs(state, softMessages);
    injectCompressNudges(state, softConfig, softMessages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });
    const keys = [...state.nudges.turnAnchors].sort();

    const strongConfig = makeDefaultConfig({ nudgeFrequency: 1, nudgeForce: "strong" });
    const strongMessages = [assistantMsg("prior", 1000), userMsg("latest", 2000)];
    assignMessageRefs(state, strongMessages);
    const result = injectCompressNudges(state, strongConfig, strongMessages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    expect([...state.nudges.turnAnchors].sort()).toEqual(keys);
    const assistantText = (result[0] as unknown as { content: Array<{ text: string }> }).content[0]
      .text;
    const userText = (result[1] as unknown as { content: Array<{ text: string }> }).content[0].text;
    expect(userText).toContain("Evaluate the conversation");
    expect(assistantText).not.toContain("dcp-system-reminder");
  });
});
