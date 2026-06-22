import { describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => "/tmp/test-pi-agent",
}));

type Handler = (...args: any[]) => unknown;

function createMockApi() {
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, unknown>();
  const commands = new Map<string, unknown>();

  const api = {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerTool(def: any) {
      tools.set(def.name, def);
    },
    registerCommand(name: string, def: unknown) {
      commands.set(name, def);
    },
  } as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI;

  return { api, handlers, tools, commands };
}

describe("integration", () => {
  it("runs full pipeline: load, session_start, context, prune duplicates", async () => {
    const { api, handlers, tools, commands } = createMockApi();
    createExtension(api);

    // Verify registration
    expect(handlers.has("session_start")).toBe(true);
    expect(handlers.has("context")).toBe(true);
    expect(handlers.has("session_shutdown")).toBe(true);
    expect(tools.has("compress")).toBe(true);
    expect(commands.has("dcp:help")).toBe(true);
    expect(commands.has("dcp:stats")).toBe(true);
    expect(commands.has("dcp:lifetime")).toBe(true);

    // Simulate session start
    const mockCtx = {
      sessionManager: { getSessionDir: () => "/tmp/test-integration-session" },
      getContextUsage: () => ({ tokens: 1000, contextWindow: 200000, percent: 0.5 }),
      hasUI: false,
      ui: { setStatus: () => {}, notify: () => {} },
    };

    const startHandlers = handlers.get("session_start")!;
    for (const h of startHandlers) {
      await h({ reason: "new" }, mockCtx);
    }

    // Simulate context event with duplicate tool calls
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "Find foo in the codebase" }],
        timestamp: Date.now(),
      },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "glob", arguments: { pattern: "**/*.ts" } }],
        api: "messages",
        provider: "test",
        model: "test-model",
        stopReason: "toolUse",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
        timestamp: Date.now(),
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "glob",
        content: [{ type: "text", text: "src/index.ts\nsrc/config.ts\nsrc/logger.ts" }],
        isError: false,
        timestamp: Date.now(),
      },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c2", name: "glob", arguments: { pattern: "**/*.ts" } }],
        api: "messages",
        provider: "test",
        model: "test-model",
        stopReason: "toolUse",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
        timestamp: Date.now(),
      },
      {
        role: "toolResult",
        toolCallId: "c2",
        toolName: "glob",
        content: [{ type: "text", text: "src/index.ts\nsrc/config.ts\nsrc/logger.ts (newer)" }],
        isError: false,
        timestamp: Date.now(),
      },
    ];

    const contextHandlers = handlers.get("context")!;
    let result: any;
    for (const h of contextHandlers) {
      result = await h({ messages: structuredClone(messages) }, mockCtx);
    }

    expect(result).toBeDefined();
    expect(result.messages).toBeDefined();

    // The older duplicate glob call (c1) should have its output pruned
    const toolResult1 = result.messages.find(
      (m: any) => m.role === "toolResult" && m.toolCallId === "c1",
    );
    if (toolResult1) {
      expect(toolResult1.content[0].text).toContain("[Output removed");
    }

    // The newer glob call (c2) should be untouched
    const toolResult2 = result.messages.find(
      (m: any) => m.role === "toolResult" && m.toolCallId === "c2",
    );
    expect(toolResult2).toBeDefined();
    expect(toolResult2.content[0].text).toContain("src/index.ts");

    // Messages should have dcp-message-id tags
    const userMsg = result.messages.find((m: any) => m.role === "user");
    expect(userMsg.content[0].text).toContain("<dcp-message-id>");
  });

  it("injects CONTEXT_LIMIT_NUDGE when tokens >= maxContextLimit (absolute)", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);

    const mockCtx = {
      sessionManager: { getSessionDir: () => "/tmp/test-integration-session" },
      // 200K tokens at only 20% of 1M window — proves absolute limit fires, not percentage
      getContextUsage: () => ({ tokens: 200000, contextWindow: 1000000, percent: 20 }),
      hasUI: false,
      ui: { setStatus: () => {}, notify: () => {} },
    };

    // Start session first
    const startHandlers = handlers.get("session_start")!;
    for (const h of startHandlers) {
      await h({ reason: "new" }, mockCtx);
    }

    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "Continue working" }],
        timestamp: Date.now(),
      },
    ];

    const contextHandlers = handlers.get("context")!;
    let result: any;
    for (const h of contextHandlers) {
      result = await h({ messages: structuredClone(messages) }, mockCtx);
    }

    // Should have injected a critical context warning nudge
    const lastMsg = result.messages[result.messages.length - 1];
    const text = lastMsg.content[0].text;
    expect(text).toContain("CRITICAL WARNING");
    expect(text).toContain("<dcp-system-reminder>");
  });
});
