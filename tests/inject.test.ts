import { describe, expect, it } from "vitest";
import {
  assignMessageRefs,
  injectMessageIds,
  injectCompressNudges,
  type ContextUsage,
} from "../src/messages/inject.ts";
import { createSessionState } from "../src/state/state.ts";
import type { DcpConfig } from "../src/config.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { CONTEXT_LIMIT_NUDGE, TURN_NUDGE, ITERATION_NUDGE } from "../src/prompts/nudges.ts";

function makeUserMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

/** E9: UserMessage.content can be a plain string */
function makeUserMessageString(text: string): AgentMessage {
  return {
    role: "user",
    content: text,
    timestamp: Date.now(),
  } as AgentMessage;
}

function makeAssistantMessage(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "messages",
    provider: "test",
    model: "test-model",
    stopReason: "stop",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      totalTokens: 0,
    },
    timestamp: Date.now(),
  } as unknown as AgentMessage;
}

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
      iterationNudgeThreshold: 3,
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
    const one = [makeUserMessage("a")];
    const two = [makeUserMessage("a"), makeAssistantMessage("b")];

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
});

// ---------------------------------------------------------------------------
// injectCompressNudges
// ---------------------------------------------------------------------------

describe("injectCompressNudges", () => {
  it("returns messages unchanged when contextUsage is undefined", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages = [makeUserMessage("hello")];

    const result = injectCompressNudges(state, config, messages, undefined);

    expect(result).toBe(messages);
  });

  it("returns messages unchanged when percent is null (E5)", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages = [makeUserMessage("hello")];
    const usage: ContextUsage = { tokens: null, contextWindow: 200000, percent: null };

    const result = injectCompressNudges(state, config, messages, usage);

    expect(result).toBe(messages);
  });

  it("returns messages unchanged when percent is below minContextPercent", () => {
    const state = createSessionState();
    const config = makeDefaultConfig(); // minContextPercent: 50
    const messages = [makeUserMessage("hello")];
    const usage: ContextUsage = { tokens: 1000, contextWindow: 200000, percent: 30 };

    const result = injectCompressNudges(state, config, messages, usage);

    expect(result).toBe(messages);
  });

  it("injects CONTEXT_LIMIT_NUDGE when percent >= maxContextPercent", () => {
    const state = createSessionState();
    const config = makeDefaultConfig(); // maxContextPercent: 80
    const messages = [makeAssistantMessage("done")];
    const usage: ContextUsage = { tokens: 160000, contextWindow: 200000, percent: 80 };

    const result = injectCompressNudges(state, config, messages, usage);

    const text = (result[result.length - 1] as any).content[0].text as string;
    expect(text).toContain("<dcp-system-reminder>");
    expect(text).toContain("CRITICAL WARNING");
  });

  it("injects TURN_NUDGE when last message is user and percent >= minContextPercent", () => {
    const state = createSessionState();
    const config = makeDefaultConfig(); // minContextPercent: 50, maxContextPercent: 80
    const messages = [makeAssistantMessage("previous"), makeUserMessage("new user msg")];
    const usage: ContextUsage = { tokens: 110000, contextWindow: 200000, percent: 55 };

    const result = injectCompressNudges(state, config, messages, usage);

    const text = (result[result.length - 1] as any).content[0].text as string;
    expect(text).toContain("Evaluate the conversation for compressible ranges");
  });

  it("injects ITERATION_NUDGE when many assistant iterations since last user message", () => {
    const state = createSessionState();
    const config = makeDefaultConfig(); // iterationNudgeThreshold: 3
    const messages = [
      makeUserMessage("go"),
      makeAssistantMessage("step 1"),
      makeAssistantMessage("step 2"),
      makeAssistantMessage("step 3"),
    ];
    const usage: ContextUsage = { tokens: 110000, contextWindow: 200000, percent: 55 };

    const result = injectCompressNudges(state, config, messages, usage);

    const text = (result[result.length - 1] as any).content[0].text as string;
    expect(text).toContain("iterating for a while");
  });

  it("is idempotent — does not double-inject nudge", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages = [makeUserMessage("hello")];
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
    const config = makeDefaultConfig();
    const messages = [makeUserMessage("hello")];
    const usage: ContextUsage = { tokens: 160000, contextWindow: 200000, percent: 80 };

    const result = injectCompressNudges(state, config, messages, usage);

    expect(result).toBe(messages);
  });

  it("skips nudge injection when compressPermission is deny", () => {
    const state = createSessionState();
    state.compressPermission = "deny";
    const config = makeDefaultConfig();
    const messages = [makeUserMessage("hello")];
    const usage: ContextUsage = { tokens: 160000, contextWindow: 200000, percent: 80 };

    const result = injectCompressNudges(state, config, messages, usage);

    expect(result).toBe(messages);
  });

  it("handles user messages with plain-string content for nudge injection (E9)", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages = [makeUserMessageString("plain user message")];
    const usage: ContextUsage = { tokens: 110000, contextWindow: 200000, percent: 55 };

    const result = injectCompressNudges(state, config, messages, usage);

    expect(Array.isArray((result[0] as any).content)).toBe(true);
    const text = (result[0] as any).content[0].text as string;
    expect(text).toContain("plain user message");
    expect(text).toContain("<dcp-system-reminder>");
  });
});
