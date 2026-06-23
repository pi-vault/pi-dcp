import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { DcpConfig } from "../src/config.ts";

let nextTestTimestamp = 1000;

export function resetTestTimestamp(): void {
  nextTestTimestamp = 1000;
}

export function makeUserMessage(text: string, timestamp?: number): AgentMessage {
  const ts = timestamp ?? nextTestTimestamp++;
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: ts,
  } as AgentMessage;
}

/** E9: UserMessage.content can be a plain string */
export function makeUserMessageString(text: string, timestamp?: number): AgentMessage {
  const ts = timestamp ?? nextTestTimestamp++;
  return {
    role: "user",
    content: text,
    timestamp: ts,
  } as AgentMessage;
}

export function makeAssistantMessage(text: string, timestamp?: number): AgentMessage {
  const ts = timestamp ?? nextTestTimestamp++;
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
    timestamp: ts,
  } as unknown as AgentMessage;
}

export function makeToolResultMessage(
  toolCallId: string,
  toolName: string,
  text: string,
  isError = false,
  timestamp?: number,
): AgentMessage {
  const ts = timestamp ?? nextTestTimestamp++;
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError,
    timestamp: ts,
  } as AgentMessage;
}

export function makeDefaultConfig(overrides?: Partial<DcpConfig["compress"]>): DcpConfig {
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
      summaryBuffer: true,
      maxContextLimit: undefined,
      minContextLimit: undefined,
      modelMaxLimits: undefined,
      modelMinLimits: undefined,
      ...overrides,
    },
    manualMode: { default: false, automaticStrategies: true },
    strategies: {
      deduplication: { enabled: true, protectedTools: [] },
      purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
    },
    protectedFilePatterns: [],
    nudgeNotification: "minimal",
    nudgeNotificationType: "status",
    experimental: { allowSubAgents: false },
  };
}
