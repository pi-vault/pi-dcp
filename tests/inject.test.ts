import { beforeEach, describe, expect, it } from "vitest";
import {
  assignMessageRefs,
  injectMessageIds,
  injectCompressNudges,
} from "../src/messages/inject.ts";
import type { ContextUsage } from "../src/state/types.ts";
import { createSessionState } from "../src/state/state.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { CONTEXT_LIMIT_NUDGE, TURN_NUDGE, ITERATION_NUDGE } from "../src/prompts/nudges.ts";
import { makeUserMessage, makeUserMessageString, makeAssistantMessage, makeDefaultConfig, resetTestTimestamp } from "./helpers.ts";
import { buildPriorityMap } from "../src/messages/priority.ts";

// ---------------------------------------------------------------------------
// assignMessageRefs
// ---------------------------------------------------------------------------

describe("assignMessageRefs", () => {
  it("assigns sequential refs starting at m0001", () => {
    const state = createSessionState();
    const messages = [makeUserMessage("hello"), makeAssistantMessage("hi")];

    assignMessageRefs(state, messages);

    expect(state.messageIds.byIndex.get(0)).toBe("m0001");
    expect(state.messageIds.byIndex.get(1)).toBe("m0002");
    expect(state.messageIds.nextRefIndex).toBe(3);
  });

  it("reuses existing refs for already-assigned indices", () => {
    const state = createSessionState();
    const messages = [makeUserMessage("hello")];

    assignMessageRefs(state, messages);
    const ref1 = state.messageIds.byIndex.get(0);

    assignMessageRefs(state, messages);
    const ref2 = state.messageIds.byIndex.get(0);

    expect(ref1).toBe(ref2);
    expect(state.messageIds.nextRefIndex).toBe(2); // not incremented again
  });

  it("extends refs when messages grow", () => {
    const state = createSessionState();
    const msg = makeUserMessage("a");
    const one = [msg];
    const two = [msg, makeAssistantMessage("b")];

    assignMessageRefs(state, one);
    expect(state.messageIds.nextRefIndex).toBe(2);

    assignMessageRefs(state, two);
    expect(state.messageIds.byIndex.get(1)).toBe("m0002");
    expect(state.messageIds.nextRefIndex).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// injectMessageIds
// ---------------------------------------------------------------------------

describe("injectMessageIds", () => {
  it("appends dcp-message-id tags to text content", () => {
    const state = createSessionState();
    const messages = [makeUserMessage("hello"), makeAssistantMessage("hi")];
    assignMessageRefs(state, messages);

    const result = injectMessageIds(state, messages);

    const userText = (result[0] as any).content[0].text as string;
    expect(userText).toContain("<dcp-message-id>m0001</dcp-message-id>");

    const assistantText = (result[1] as any).content[0].text as string;
    expect(assistantText).toContain("<dcp-message-id>m0002</dcp-message-id>");
  });

  it("is idempotent — does not double-inject", () => {
    const state = createSessionState();
    const messages = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);

    const first = injectMessageIds(state, messages);
    const second = injectMessageIds(state, first);

    const text = (second[0] as any).content[0].text as string;
    const matches = text.match(/<dcp-message-id>/g);
    expect(matches).toHaveLength(1);
  });

  it("handles user messages with plain-string content (E9)", () => {
    const state = createSessionState();
    const messages = [makeUserMessageString("plain text content")];
    assignMessageRefs(state, messages);

    const result = injectMessageIds(state, messages);

    // Content should be converted to array form
    expect(Array.isArray((result[0] as any).content)).toBe(true);
    const text = (result[0] as any).content[0].text as string;
    expect(text).toContain("plain text content");
    expect(text).toContain("<dcp-message-id>m0001</dcp-message-id>");
  });

  it("is idempotent for plain-string content messages (E9)", () => {
    const state = createSessionState();
    const messages = [makeUserMessageString("plain text content")];
    assignMessageRefs(state, messages);

    const first = injectMessageIds(state, messages);
    const second = injectMessageIds(state, first);

    const text = (second[0] as any).content[0].text as string;
    const matches = text.match(/<dcp-message-id>/g);
    expect(matches).toHaveLength(1);
  });

  it("skips messages with no text parts", () => {
    const state = createSessionState();
    const msg: AgentMessage = {
      role: "user",
      content: [{ type: "image", source: { type: "base64", mediaType: "image/png", data: "" } }],
      timestamp: Date.now(),
    } as unknown as AgentMessage;
    assignMessageRefs(state, [msg]);

    const result = injectMessageIds(state, [msg]);

    expect(result[0]).toBe(msg); // unchanged reference
  });

  it("strips existing DCP tags before injecting fresh ones", () => {
    const state = createSessionState();
    const messages: AgentMessage[] = [
      makeUserMessage("Hello <dcp-message-id>m0099</dcp-message-id>"),
      makeAssistantMessage("Response <dcp-message-id>m0100</dcp-message-id>"),
    ];

    assignMessageRefs(state, messages);
    const result = injectMessageIds(state, messages);

    // Should have fresh m0001/m0002 tags, not the stale m0099/m0100
    const userText = (result[0] as any).content[0].text as string;
    const assistantText = (result[1] as any).content[0].text as string;

    expect(userText).toContain("<dcp-message-id>m0001</dcp-message-id>");
    expect(userText).not.toContain("m0099");
    expect(assistantText).toContain("<dcp-message-id>m0002</dcp-message-id>");
    expect(assistantText).not.toContain("m0100");
  });

  it("strips truncated DCP tags before injecting", () => {
    const state = createSessionState();
    const messages: AgentMessage[] = [
      makeAssistantMessage("Response <dcp-message-id>m0050</dcp"),
    ];

    assignMessageRefs(state, messages);
    const result = injectMessageIds(state, messages);

    const text = (result[0] as any).content[0].text as string;
    expect(text).toContain("<dcp-message-id>m0001</dcp-message-id>");
    expect(text).not.toContain("m0050");
  });
});

// ---------------------------------------------------------------------------
// injectMessageIds — priority map support
// ---------------------------------------------------------------------------

describe("injectMessageIds with priorityMap", () => {
  it("injects priority attribute when priorityMap is provided", () => {
    const state = createSessionState();
    const messages = [
      makeUserMessage("a".repeat(400)),
      makeAssistantMessage("b".repeat(100)),
    ];
    assignMessageRefs(state, messages);

    const priorityMap = buildPriorityMap(state, messages);
    const result = injectMessageIds(state, messages, priorityMap);

    const userText = (result[0] as any).content[0].text as string;
    expect(userText).toMatch(
      /<dcp-message-id priority="\d">m0001<\/dcp-message-id>/,
    );

    const assistantText = (result[1] as any).content[0].text as string;
    expect(assistantText).toMatch(
      /<dcp-message-id priority="\d">m0002<\/dcp-message-id>/,
    );
  });

  it("omits priority attribute when priorityMap is undefined", () => {
    const state = createSessionState();
    const messages = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);

    const result = injectMessageIds(state, messages);

    const text = (result[0] as any).content[0].text as string;
    expect(text).toContain("<dcp-message-id>m0001</dcp-message-id>");
    expect(text).not.toContain("priority=");
  });

  it("is idempotent with priority attributes", () => {
    const state = createSessionState();
    const messages = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);

    const priorityMap = buildPriorityMap(state, messages);
    const first = injectMessageIds(state, messages, priorityMap);
    const second = injectMessageIds(state, first, priorityMap);

    const text = (second[0] as any).content[0].text as string;
    const matches = text.match(/<dcp-message-id/g);
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// injectCompressNudges
// ---------------------------------------------------------------------------

describe("injectCompressNudges", () => {
  beforeEach(() => resetTestTimestamp());

  it("returns messages unchanged when contextUsage is undefined", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 });
    const messages = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);

    const result = injectCompressNudges(state, config, messages, undefined);

    expect(result).toBe(messages);
  });

  it("returns messages unchanged when percent is null (E5)", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 });
    const messages = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);
    const usage: ContextUsage = { tokens: null, contextWindow: 200000, percent: null };

    const result = injectCompressNudges(state, config, messages, usage);

    expect(result).toBe(messages);
  });

  it("returns messages unchanged when percent is below minContextPercent", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 }); // minContextPercent: 50
    const messages = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);
    const usage: ContextUsage = { tokens: 1000, contextWindow: 200000, percent: 30 };

    const result = injectCompressNudges(state, config, messages, usage);

    expect(result).toBe(messages);
  });

  it("injects CONTEXT_LIMIT_NUDGE when percent >= maxContextPercent", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 }); // maxContextPercent: 80
    const messages = [makeAssistantMessage("done")];
    assignMessageRefs(state, messages);
    const usage: ContextUsage = { tokens: 160000, contextWindow: 200000, percent: 80 };

    const result = injectCompressNudges(state, config, messages, usage);

    const text = (result[result.length - 1] as any).content[0].text as string;
    expect(text).toContain("<dcp-system-reminder>");
    expect(text).toContain("CRITICAL WARNING");
  });

  it("injects TURN_NUDGE when last message is user and percent >= minContextPercent", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 }); // minContextPercent: 50, maxContextPercent: 80
    const messages = [makeAssistantMessage("previous"), makeUserMessage("new user msg")];
    assignMessageRefs(state, messages);
    const usage: ContextUsage = { tokens: 110000, contextWindow: 200000, percent: 55 };

    const result = injectCompressNudges(state, config, messages, usage);

    const text = (result[result.length - 1] as any).content[0].text as string;
    expect(text).toContain("Evaluate the conversation for compressible ranges");
  });

  it("injects ITERATION_NUDGE when many assistant iterations since last user message", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ iterationNudgeThreshold: 3, nudgeFrequency: 1 });
    const messages = [
      makeUserMessage("go"),
      makeAssistantMessage("step 1"),
      makeAssistantMessage("step 2"),
      makeAssistantMessage("step 3"),
    ];
    assignMessageRefs(state, messages);
    const usage: ContextUsage = { tokens: 110000, contextWindow: 200000, percent: 55 };

    const result = injectCompressNudges(state, config, messages, usage);

    const text = (result[result.length - 1] as any).content[0].text as string;
    expect(text).toContain("iterating for a while");
  });

  it("is idempotent — does not double-inject nudge", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 });
    const messages = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);
    const usage: ContextUsage = { tokens: 110000, contextWindow: 200000, percent: 55 };

    const first = injectCompressNudges(state, config, messages, usage);
    const second = injectCompressNudges(state, config, first, usage);

    const text = (second[second.length - 1] as any).content[0].text as string;
    const matches = text.match(/<dcp-system-reminder>/g);
    expect(matches).toHaveLength(1);
  });

  it("skips nudge injection when manualMode is active", () => {
    const state = createSessionState();
    state.manualMode = "active";
    const config = makeDefaultConfig({ nudgeFrequency: 1 });
    const messages = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);
    const usage: ContextUsage = { tokens: 160000, contextWindow: 200000, percent: 80 };

    const result = injectCompressNudges(state, config, messages, usage);

    expect(result).toBe(messages);
  });

  it("skips nudge injection when compressPermission is deny", () => {
    const state = createSessionState();
    state.compressPermission = "deny";
    const config = makeDefaultConfig({ nudgeFrequency: 1 });
    const messages = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);
    const usage: ContextUsage = { tokens: 160000, contextWindow: 200000, percent: 80 };

    const result = injectCompressNudges(state, config, messages, usage);

    expect(result).toBe(messages);
  });

  it("counts only assistant messages for iteration nudge, not toolResult/custom", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ iterationNudgeThreshold: 3, nudgeFrequency: 1 });
    const messages = [
      makeUserMessage("go"),
      makeAssistantMessage("step 1"),
      { role: "toolResult", content: [{ type: "text", text: "result" }], toolCallId: "t1" } as unknown as AgentMessage,
      { role: "toolResult", content: [{ type: "text", text: "result" }], toolCallId: "t2" } as unknown as AgentMessage,
      makeAssistantMessage("step 2"),
    ];
    assignMessageRefs(state, messages);
    const usage: ContextUsage = { tokens: 110000, contextWindow: 200000, percent: 55 };

    const result = injectCompressNudges(state, config, messages, usage);

    // Only 2 assistant messages since user — should NOT trigger at threshold 3
    const text = (result[result.length - 1] as any).content[0].text as string;
    expect(text).not.toContain("iterating for a while");
  });

  it("handles user messages with plain-string content for nudge injection (E9)", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 });
    const messages = [makeUserMessageString("plain user message")];
    assignMessageRefs(state, messages);
    const usage: ContextUsage = { tokens: 110000, contextWindow: 200000, percent: 55 };

    const result = injectCompressNudges(state, config, messages, usage);

    expect(Array.isArray((result[0] as any).content)).toBe(true);
    const text = (result[0] as any).content[0].text as string;
    expect(text).toContain("plain user message");
    expect(text).toContain("<dcp-system-reminder>");
  });

  it("uses custom context-limit nudge text from runtimePrompts", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 }); // maxContextPercent: 80
    const messages = [makeAssistantMessage("done")];
    assignMessageRefs(state, messages);
    const usage: ContextUsage = { tokens: 160000, contextWindow: 200000, percent: 80 };

    const customPrompts = {
      system: "custom system",
      contextLimitNudge: "CUSTOM CONTEXT LIMIT NUDGE",
      turnNudge: "CUSTOM TURN NUDGE",
      iterationNudge: "CUSTOM ITERATION NUDGE",
    };

    const result = injectCompressNudges(state, config, messages, usage, customPrompts);

    const text = (result[result.length - 1] as any).content[0].text as string;
    expect(text).toContain("CUSTOM CONTEXT LIMIT NUDGE");
    expect(text).not.toContain("CRITICAL WARNING");
  });

  it("uses custom turn nudge text from runtimePrompts", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 }); // minContextPercent: 50, maxContextPercent: 80
    const messages = [makeAssistantMessage("previous"), makeUserMessage("new user msg")];
    assignMessageRefs(state, messages);
    const usage: ContextUsage = { tokens: 110000, contextWindow: 200000, percent: 55 };

    const customPrompts = {
      system: "custom system",
      contextLimitNudge: "CUSTOM CONTEXT LIMIT NUDGE",
      turnNudge: "CUSTOM TURN NUDGE",
      iterationNudge: "CUSTOM ITERATION NUDGE",
    };

    const result = injectCompressNudges(state, config, messages, usage, customPrompts);

    const text = (result[result.length - 1] as any).content[0].text as string;
    expect(text).toContain("CUSTOM TURN NUDGE");
    expect(text).not.toContain("Evaluate the conversation");
  });

  it("falls back to bundled nudge text when runtimePrompts is undefined", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ nudgeFrequency: 1 }); // maxContextPercent: 80
    const messages = [makeAssistantMessage("done")];
    assignMessageRefs(state, messages);
    const usage: ContextUsage = { tokens: 160000, contextWindow: 200000, percent: 80 };

    const result = injectCompressNudges(state, config, messages, usage, undefined);

    const text = (result[result.length - 1] as any).content[0].text as string;
    expect(text).toContain("CRITICAL WARNING");
  });
});
