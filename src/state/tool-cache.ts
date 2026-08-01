import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState, ToolParameterEntry } from "./types.ts";
import { countMessageTokens } from "../utils/tokens.ts";

/**
 * Scan messages and populate state.toolParameters with metadata for each tool call.
 * Called on every context event to keep the cache current.
 *
 * Pi message model:
 * - Tool calls are in `assistant` messages: content[].type === "toolCall"
 * - Tool results are separate `toolResult` messages with toolCallId, isError
 */
export function syncToolCache(state: SessionState, messages: AgentMessage[]): void {
  state.toolParameters.clear();
  state.currentUserTurn = 0;

  // First pass: collect tool results with token counts and indices
  const resultsByCallId = new Map<
    string,
    { isError: boolean; errorText?: string; tokenCount: number; index: number }
  >();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "toolResult") continue;
    resultsByCallId.set(msg.toolCallId, {
      isError: msg.isError,
      errorText: msg.isError ? extractToolResultText(msg) : undefined,
      tokenCount: countMessageTokens(msg),
      index: i,
    });
  }

  // Second pass: collect tool calls from assistant messages by user turn.
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "user") {
      state.currentUserTurn++;
      continue;
    }
    if (msg.role !== "assistant") continue;
    if (!Array.isArray(msg.content)) continue;

    for (const part of msg.content) {
      if (typeof part !== "object" || part === null) continue;
      const p = part as unknown as Record<string, unknown>;
      if (p.type !== "toolCall" || typeof p.id !== "string") continue;

      const callId = p.id as string;
      const result = resultsByCallId.get(callId);
      const entry: ToolParameterEntry = {
        tool: (p.name as string) ?? "unknown",
        parameters: p.arguments ?? {},
        status: result ? (result.isError ? "error" : "completed") : "pending",
        error: result?.errorText,
        userTurn: state.currentUserTurn,
        tokenCount: result?.tokenCount,
        assistantIndex: i,
        resultIndex: result?.index,
      };

      state.toolParameters.set(callId, entry);
    }
  }
}

/**
 * Build ordered list of tool call IDs from messages.
 */
export function buildToolIdList(state: SessionState, messages: AgentMessage[]): void {
  const ids: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    if (!Array.isArray(msg.content)) continue;

    for (const part of msg.content) {
      if (typeof part !== "object" || part === null) continue;
      const p = part as unknown as Record<string, unknown>;
      if (p.type === "toolCall" && typeof p.id === "string") {
        ids.push(p.id as string);
      }
    }
  }
  state.toolIdList = ids;
}

function extractToolResultText(msg: AgentMessage): string | undefined {
  if (msg.role !== "toolResult") return undefined;
  if (!Array.isArray(msg.content)) return undefined;
  const texts: string[] = [];
  for (const part of msg.content) {
    if (
      typeof part === "object" &&
      part !== null &&
      (part as unknown as Record<string, unknown>).type === "text"
    ) {
      texts.push((part as unknown as Record<string, unknown>).text as string);
    }
  }
  return texts.join("\n") || undefined;
}
