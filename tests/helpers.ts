import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { DcpConfig } from "../src/config.ts";
import type { SessionState } from "../src/state/types.ts";
import { getFilePathsFromParameters } from "../src/strategies/protected-patterns.ts";

/**
 * Assert a required value is present. Replaces non-null assertions in tests with
 * a readable failure that names the missing fixture value.
 */
export function requireDefined<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}

/**
 * Read the text of a user, assistant, or tool-result message. Content is either a
 * plain string or a multipart array; only `text` parts are joined, so thinking,
 * image, and tool-call parts contribute nothing.
 */
export function getMessageText(message: AgentMessage): string {
  switch (message.role) {
    case "system":
    case "user":
    case "custom":
    case "assistant":
    case "toolResult":
      return joinTextContent(message.content);
    default:
      return "";
  }
}

/**
 * Narrow an unknown value to an AgentMessage by checking for a `role` field.
 * Lets tests read messages held in loosely typed containers without a blind cast.
 */
export function isAgentMessage(value: unknown): value is AgentMessage {
  return typeof value === "object" && value !== null && "role" in value;
}

/**
 * Require a loosely typed value to be an AgentMessage, with a readable failure.
 */
export function requireMessage(value: unknown, label: string): AgentMessage {
  if (!isAgentMessage(value)) {
    throw new Error(`Expected ${label} to be an AgentMessage, got ${typeof value}`);
  }
  return value;
}

type TextBearingContent = string | Array<{ type: string; text?: string }>;

function joinTextContent(content: TextBearingContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

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
    filePaths?: string[];
  }>,
): void {
  for (const e of entries) {
    state.toolParameters.set(e.id, {
      tool: e.tool,
      parameters: e.parameters,
      filePaths: e.filePaths ?? getFilePathsFromParameters(e.tool, e.parameters),
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
