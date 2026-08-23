import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { DcpConfig } from "../config.ts";
import { isToolNameProtected } from "../strategies/protected-patterns.ts";

const PROTECT_TAG_PATTERN = /<protect>([\s\S]*?)<\/protect>/gi;

/**
 * Extract text from a message's content (handles string and array forms).
 */
function getMessageText(msg: AgentMessage): string {
  if (!("content" in msg)) return "";
  if (typeof msg.content === "string") return msg.content;
  if (!Array.isArray(msg.content)) return "";
  return msg.content
    .filter(
      (p): p is { type: "text"; text: string } =>
        typeof p === "object" &&
        p !== null &&
        (p as unknown as Record<string, unknown>).type === "text",
    )
    .map((p) => (p as unknown as { text: string }).text)
    .join("\n");
}

/**
 * Append protected user messages verbatim to the summary.
 */
export function appendProtectedUserMessages(
  summary: string,
  messages: AgentMessage[],
  protectUserMessages: boolean,
): string {
  if (!protectUserMessages) return summary;

  const userTexts: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const text = getMessageText(msg);
    if (text.trim()) userTexts.push(text.replace(/<\/?protect>/gi, ""));
  }

  if (userTexts.length === 0) return summary;

  const section = userTexts.map((t) => `[Protected User Message]\n${t}`).join("\n\n");

  return `${summary}\n\n---\n${section}`;
}

/**
 * Extract content within <protect> tags from user messages and append to summary.
 */
export function appendProtectedPromptInfo(
  summary: string,
  messages: AgentMessage[],
  protectTags: boolean,
): string {
  if (!protectTags) return summary;

  const extracted: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const text = getMessageText(msg);
    for (const match of text.matchAll(PROTECT_TAG_PATTERN)) {
      const content = match[1].trim();
      if (content) extracted.push(content);
    }
  }

  if (extracted.length === 0) return summary;

  const section = extracted.map((t) => `[Protected Content]\n${t}`).join("\n\n");

  return `${summary}\n\n---\n${section}`;
}

/**
 * Append outputs of protected tools verbatim to the summary.
 */
export function appendProtectedToolOutputs(
  summary: string,
  messages: AgentMessage[],
  protectedTools: string[],
): string {
  if (protectedTools.length === 0) return summary;

  const outputs: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "toolResult") continue;
    if (msg.isError) continue;
    if (!isToolNameProtected(msg.toolName, protectedTools)) continue;

    const text = getMessageText(msg);
    if (text.trim()) {
      outputs.push(`[Protected Tool Output: ${msg.toolName}]\n${text}`);
    }
  }

  if (outputs.length === 0) return summary;

  return `${summary}\n\n---\n${outputs.join("\n\n")}`;
}

/**
 * Enrich a compression summary with all configured protected content.
 */
export function enrichSummaryWithProtectedContent(
  summary: string,
  messages: AgentMessage[],
  config: DcpConfig,
  subAgentResultCache?: Map<string, string>,
): string {
  let enriched = summary;
  enriched = appendProtectedUserMessages(enriched, messages, config.compress.protectUserMessages);
  enriched = appendProtectedPromptInfo(enriched, messages, config.compress.protectTags);
  enriched = appendProtectedToolOutputs(enriched, messages, config.compress.protectedTools);
  if (subAgentResultCache) {
    enriched = appendSubAgentResults(enriched, messages, subAgentResultCache);
  }
  return enriched;
}

/**
 * Append cached sub-agent child session results to the summary.
 * Looks up toolCallId for subagent tool results in the compressed range.
 */
export function appendSubAgentResults(
  summary: string,
  messages: AgentMessage[],
  cache: Map<string, string>,
): string {
  if (cache.size === 0) return summary;

  const outputs: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "toolResult") continue;
    if (msg.isError) continue;
    if (msg.toolName !== "subagent") continue;

    const cached = cache.get(msg.toolCallId);
    if (cached?.trim()) {
      outputs.push(`[Sub-Agent Results: ${msg.toolCallId}]\n${cached}`);
    }
  }

  if (outputs.length === 0) return summary;

  return `${summary}\n\n---\n${outputs.join("\n\n")}`;
}
