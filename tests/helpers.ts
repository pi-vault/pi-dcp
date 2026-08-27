import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { DcpConfig } from "../src/config.ts";
import type { SessionState } from "../src/state/types.ts";

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
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      totalTokens: 0,
    },
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

export function seedToolCache(
  state: SessionState,
  entries: Array<{
    id: string;
    tool: string;
    parameters: Record<string, unknown>;
    status: "completed" | "error";
    userTurn: number;
    tokenCount: number;
  }>,
): void {
  for (const e of entries) {
    state.toolParameters.set(e.id, {
      tool: e.tool,
      parameters: e.parameters,
      status: e.status,
      error: undefined,
      userTurn: e.userTurn,
      tokenCount: e.tokenCount,
      assistantIndex: undefined,
      resultIndex: undefined,
    });
    state.toolIdList.push(e.id);
  }
}

export function makeDefaultConfig(overrides?: Partial<DcpConfig["compress"]>): DcpConfig {
  return {
    enabled: true,
    disabledModels: [],
    debug: false,
    compress: {
      mode: "range",
      permission: "allow",
      maxContextPercent: 80,
      minContextPercent: 50,
      nudgeFrequency: 5,
      iterationNudgeThreshold: 15,
      nudgeForce: "soft",
      protectedTools: ["compress"],
      protectUserMessages: false,
      protectTags: false,
      showCompression: false,
      summaryBuffer: true,
      maxContextLimit: undefined,
      minContextLimit: undefined,
      modelMaxLimits: undefined,
      modelMinLimits: undefined,
      ...overrides,
    },
    manualMode: { default: false, automaticStrategies: true },
    strategies: {
      deduplication: { enabled: true, protectedTools: [], turnProtection: 0 },
      purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
    },
    protectedFilePatterns: [],
    turnProtection: 0,
    nudgeNotification: "minimal",
    nudgeNotificationType: "status",
    experimental: { allowSubAgents: false, customPrompts: false },
  };
}
