import { describe, it, expect } from "vitest";
import { getMessageKey } from "../src/utils/message-ids.ts";
import { createSessionState } from "../src/state/state.ts";
import { assignMessageRefs } from "../src/messages/inject.ts";
import { restoreDcpSnapshot, serializeDcpSnapshot } from "../src/state/persistence.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("getMessageKey", () => {
  it("derives key for user message with counter", () => {
    const msg = {
      role: "user",
      content: [{ type: "text", text: "hi" }],
      timestamp: 1719100000000,
    } as AgentMessage;
    expect(getMessageKey(msg, 0)).toBe("user:1719100000000:0");
    expect(getMessageKey(msg, 1)).toBe("user:1719100000000:1");
  });

  it("derives key for assistant message with counter", () => {
    const msg = {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1719100001000,
      stopReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
    } as unknown as AgentMessage;
    expect(getMessageKey(msg, 0)).toBe("assistant:1719100001000:0");
  });

  it("derives key for toolResult message from toolCallId (ignores counter)", () => {
    const msg = {
      role: "toolResult",
      toolCallId: "call_abc123",
      content: [{ type: "text", text: "result" }],
      timestamp: 1719100002000,
    } as AgentMessage;
    expect(getMessageKey(msg, 0)).toBe("toolResult:call_abc123");
    expect(getMessageKey(msg, 5)).toBe("toolResult:call_abc123"); // counter ignored
  });

  it("falls back to role:timestamp:counter for unknown roles", () => {
    const msg = {
      role: "system",
      content: "sys",
      timestamp: 1719100003000,
    } as unknown as AgentMessage;
    expect(getMessageKey(msg, 0)).toBe("system:1719100003000:0");
  });
});

describe("assignMessageRefs (stable)", () => {
  it("assigns refs using content-derived keys", () => {
    const state = createSessionState();
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1000 } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
        timestamp: 2000,
        stopReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0 },
      } as unknown as AgentMessage,
    ];

    assignMessageRefs(state, messages);

    expect(state.messageIds.byRawId.get("user:1000:0")).toBe("m0001");
    expect(state.messageIds.byRawId.get("assistant:2000:0")).toBe("m0002");
    expect(state.messageIds.byIndex.get(0)).toBe("m0001");
    expect(state.messageIds.byIndex.get(1)).toBe("m0002");
  });

  it("preserves refs when messages reorder", () => {
    const state = createSessionState();
    const msg1 = {
      role: "user",
      content: [{ type: "text", text: "first" }],
      timestamp: 1000,
    } as AgentMessage;
    const msg2 = {
      role: "assistant",
      content: [{ type: "text", text: "second" }],
      timestamp: 2000,
      stopReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
    } as unknown as AgentMessage;

    // First pass: [msg1, msg2]
    assignMessageRefs(state, [msg1, msg2]);
    expect(state.messageIds.byIndex.get(0)).toBe("m0001");
    expect(state.messageIds.byIndex.get(1)).toBe("m0002");

    // Second pass: [msg2, msg1] (reordered)
    assignMessageRefs(state, [msg2, msg1]);
    expect(state.messageIds.byIndex.get(0)).toBe("m0002"); // msg2 keeps its ref
    expect(state.messageIds.byIndex.get(1)).toBe("m0001"); // msg1 keeps its ref
  });

  it("handles new messages added between existing ones", () => {
    const state = createSessionState();
    const msg1 = {
      role: "user",
      content: [{ type: "text", text: "A" }],
      timestamp: 1000,
    } as AgentMessage;
    const msg2 = {
      role: "user",
      content: [{ type: "text", text: "B" }],
      timestamp: 3000,
    } as AgentMessage;

    assignMessageRefs(state, [msg1, msg2]);
    expect(state.messageIds.nextRefIndex).toBe(3);

    const msgNew = {
      role: "assistant",
      content: [{ type: "text", text: "new" }],
      timestamp: 2000,
      stopReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
    } as unknown as AgentMessage;
    assignMessageRefs(state, [msg1, msgNew, msg2]);

    expect(state.messageIds.byIndex.get(0)).toBe("m0001");
    expect(state.messageIds.byIndex.get(1)).toBe("m0003"); // new message gets next ref
    expect(state.messageIds.byIndex.get(2)).toBe("m0002"); // msg2 keeps its ref
  });

  it("handles duplicate timestamps with counters", () => {
    const state = createSessionState();
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "A" }], timestamp: 1000 } as AgentMessage,
      { role: "user", content: [{ type: "text", text: "B" }], timestamp: 1000 } as AgentMessage,
    ];

    assignMessageRefs(state, messages);

    expect(state.messageIds.byRawId.get("user:1000:0")).toBe("m0001");
    expect(state.messageIds.byRawId.get("user:1000:1")).toBe("m0002");
    expect(state.messageIds.byIndex.get(0)).toBe("m0001");
    expect(state.messageIds.byIndex.get(1)).toBe("m0002");
  });

  it("toolResult uses toolCallId not timestamp counter", () => {
    const state = createSessionState();
    const messages: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "call_1",
        content: [{ type: "text", text: "r1" }],
        timestamp: 1000,
      } as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "call_2",
        content: [{ type: "text", text: "r2" }],
        timestamp: 1000,
      } as AgentMessage,
    ];

    assignMessageRefs(state, messages);

    expect(state.messageIds.byRawId.get("toolResult:call_1")).toBe("m0001");
    expect(state.messageIds.byRawId.get("toolResult:call_2")).toBe("m0002");
  });

  it("reconstructs the same refs after ID-only growth was not checkpointed", () => {
    const baseline = createSessionState();
    baseline.sessionId = "owner";
    const snapshot = serializeDcpSnapshot(baseline);
    if (!snapshot) throw new Error("expected snapshot");
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "one" }],
        timestamp: 1,
      } as AgentMessage,
      {
        role: "user",
        content: [{ type: "text", text: "two" }],
        timestamp: 2,
      } as AgentMessage,
    ];

    assignMessageRefs(baseline, messages);
    const original = [...baseline.messageIds.byIndex.values()];

    const resumed = createSessionState();
    expect(restoreDcpSnapshot(snapshot, resumed, "owner")).toBe(true);
    assignMessageRefs(resumed, messages);

    const forked = createSessionState();
    expect(restoreDcpSnapshot(snapshot, forked, "child")).toBe(true);
    assignMessageRefs(forked, messages);

    expect([...resumed.messageIds.byIndex.values()]).toEqual(original);
    expect([...forked.messageIds.byIndex.values()]).toEqual(original);
  });

  it("reconstructs stable refs independently on sibling branches", () => {
    const baseline = createSessionState();
    baseline.sessionId = "owner";
    const snapshot = serializeDcpSnapshot(baseline);
    if (!snapshot) throw new Error("expected snapshot");
    const prefix = {
      role: "user",
      content: [{ type: "text", text: "prefix" }],
      timestamp: 1,
    } as AgentMessage;
    const branchA = {
      ...prefix,
      content: [{ type: "text" as const, text: "A" }],
      timestamp: 2,
    } as AgentMessage;
    const branchB = {
      ...prefix,
      content: [{ type: "text" as const, text: "B" }],
      timestamp: 3,
    } as AgentMessage;

    const firstA = createSessionState();
    restoreDcpSnapshot(snapshot, firstA, "owner");
    assignMessageRefs(firstA, [prefix, branchA]);

    const siblingB = createSessionState();
    restoreDcpSnapshot(snapshot, siblingB, "owner");
    assignMessageRefs(siblingB, [prefix, branchB]);

    const returnedA = createSessionState();
    restoreDcpSnapshot(snapshot, returnedA, "owner");
    assignMessageRefs(returnedA, [prefix, branchA]);

    expect([...returnedA.messageIds.byIndex.values()]).toEqual([
      ...firstA.messageIds.byIndex.values(),
    ]);
    expect(siblingB.messageIds.byIndex.get(0)).toBe(firstA.messageIds.byIndex.get(0));
  });

  it("uses the semantic compaction checkpoint to preserve retained refs", () => {
    const state = createSessionState();
    state.sessionId = "owner";
    const old = {
      role: "user",
      content: [{ type: "text", text: "old" }],
      timestamp: 1,
    } as AgentMessage;
    const retained = {
      role: "user",
      content: [{ type: "text", text: "retained" }],
      timestamp: 2,
    } as AgentMessage;
    assignMessageRefs(state, [old, retained]);
    expect(state.messageIds.byIndex.get(1)).toBe("m0002");
    state.lastCompaction = 10;
    const checkpoint = serializeDcpSnapshot(state);
    if (!checkpoint) throw new Error("expected checkpoint");

    const restored = createSessionState();
    restoreDcpSnapshot(checkpoint, restored, "owner");
    const summary = {
      role: "compactionSummary",
      summary: "summary",
      tokensBefore: 100,
      timestamp: 3,
    } as unknown as AgentMessage;
    assignMessageRefs(restored, [summary, retained]);

    expect(restored.messageIds.byIndex.get(1)).toBe("m0002");
    expect(restored.messageIds.byIndex.get(0)).toBe("m0003");
  });

  it("rebuilds byIndex on every call (runtime cache)", () => {
    const state = createSessionState();
    const msg = {
      role: "user",
      content: [{ type: "text", text: "hi" }],
      timestamp: 1000,
    } as AgentMessage;

    assignMessageRefs(state, [msg]);
    expect(state.messageIds.byIndex.size).toBe(1);

    // Call again with empty — byIndex should be cleared
    assignMessageRefs(state, []);
    expect(state.messageIds.byIndex.size).toBe(0);
  });
});
