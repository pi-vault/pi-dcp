import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import createExtension from "../src/index.ts";
import * as subagentResults from "../src/subagents/subagent-results.ts";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => "/tmp/test-pi-agent",
}));

type Handler = (...args: never[]) => unknown;

function createMockApi() {
  const handlers = new Map<string, Handler[]>();
  const api = {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerTool() {},
    registerCommand() {},
  } as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI;
  return { api, handlers };
}

describe("dcp extension", () => {
  it("exports a function", () => {
    expect(typeof createExtension).toBe("function");
  });

  it("accepts a mock ExtensionAPI without throwing", () => {
    const { api, handlers } = createMockApi();

    expect(() => createExtension(api)).not.toThrow();

    expect(handlers.has("session_start")).toBe(true);
    expect(handlers.has("session_compact")).toBe(true);
    expect(handlers.has("session_shutdown")).toBe(true);
    expect(handlers.has("context")).toBe(true);
  });

  it("registers before_agent_start handler", () => {
    const { api, handlers } = createMockApi();
    createExtension(api);
    expect(handlers.has("before_agent_start")).toBe(true);
  });

  it("before_agent_start appends DCP system prompt to existing system prompt", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);

    const handler = handlers.get("before_agent_start")?.[0];
    expect(handler).toBeDefined();

    const result = await (handler as (...args: unknown[]) => Promise<unknown>)(
      { systemPrompt: "Original prompt.", prompt: "user input" },
      {},
    );

    expect(result).toHaveProperty("systemPrompt");
    const sp = (result as { systemPrompt: string }).systemPrompt;
    expect(sp).toContain("Original prompt.");
    expect(sp).toContain("compress");
    expect(sp).toContain("dcp-message-id");
  });

  it("before_agent_start works when systemPrompt is undefined", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);

    const handler = handlers.get("before_agent_start")?.[0];
    const result = await (handler as (...args: unknown[]) => Promise<unknown>)(
      { systemPrompt: undefined, prompt: "user input" },
      {},
    );

    expect(result).toHaveProperty("systemPrompt");
    const sp = (result as { systemPrompt: string }).systemPrompt;
    expect(sp).toContain("compress");
  });

  it("context handler tags messages with dcp-message-id", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);

    const contextHandlers = handlers.get("context") ?? [];
    expect(contextHandlers).toHaveLength(1);

    const messages = [
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() },
      {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        api: "messages",
        provider: "test",
        model: "test-model",
        stopReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
        timestamp: Date.now(),
      },
    ];

    const mockCtx = {
      getContextUsage: () => ({
        tokens: 1000,
        contextWindow: 200000,
        percent: 5,
      }),
    };

    const result = await (contextHandlers[0] as (...args: unknown[]) => Promise<unknown>)(
      { messages },
      mockCtx,
    );

    const resultMessages = (result as { messages: unknown[] }).messages;
    const userText = (resultMessages[0] as any).content[0].text as string;
    const assistantText = (resultMessages[1] as any).content[0].text as string;

    expect(userText).toContain("<dcp-message-id>m0001</dcp-message-id>");
    expect(assistantText).toContain("<dcp-message-id>m0002</dcp-message-id>");
  });

  it("context handler injects CONTEXT_LIMIT_NUDGE when tokens >= maxContextLimit", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);

    const contextHandlers = handlers.get("context") ?? [];

    const messages = [
      { role: "user", content: [{ type: "text", text: "do the thing" }], timestamp: Date.now() },
    ];

    const mockCtx = {
      getContextUsage: () => ({
        tokens: 200000, // at maxContextLimit default (200K)
        contextWindow: 1000000,
        percent: 20, // only 20% of window — proves absolute limit, not percentage
      }),
    };

    const result = await (contextHandlers[0] as (...args: unknown[]) => Promise<unknown>)(
      { messages },
      mockCtx,
    );

    const resultMessages = (result as { messages: unknown[] }).messages;
    const text = (resultMessages[0] as any).content[0].text as string;
    expect(text).toContain("CRITICAL WARNING");
    expect(text).toContain("<dcp-system-reminder>");
  });

  it("context handler calls setStatus with new formatted message when tools are pruned", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);

    const contextHandlers = handlers.get("context") ?? [];
    const setStatus = vi.fn();
    const mockCtx = {
      hasUI: true,
      ui: { setStatus, notify: vi.fn() },
      getContextUsage: () => ({ tokens: 1000, contextWindow: 200000, percent: 5 }),
    };

    // Two identical tool calls — deduplication will prune the first one
    const messages = [
      { role: "user", content: [{ type: "text", text: "read the file" }], timestamp: 1001 },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call-1", name: "search_files", arguments: { query: "foo" } }],
        stopReason: "toolUse",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
        timestamp: 1002,
      },
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "search_files",
        content: [{ type: "text", text: "result one" }],
        isError: false,
        timestamp: 1003,
      },
      { role: "user", content: [{ type: "text", text: "read it again" }], timestamp: 1004 },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call-2", name: "search_files", arguments: { query: "foo" } }],
        stopReason: "toolUse",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
        timestamp: 1005,
      },
      {
        role: "toolResult",
        toolCallId: "call-2",
        toolName: "search_files",
        content: [{ type: "text", text: "result one" }],
        isError: false,
        timestamp: 1006,
      },
    ];

    await (contextHandlers[0] as (...args: unknown[]) => Promise<unknown>)(
      { messages },
      mockCtx,
    );

    // setStatus should have been called with the new formatted message
    expect(setStatus).toHaveBeenCalled();
    const calledWith = setStatus.mock.calls[0][1] as string;
    // New format: "DCP: ~N tokens saved (N items pruned)" — includes "items pruned"
    expect(calledWith).toContain("items pruned");
    // Old format was "DCP: N tokens saved" without "items pruned"
    expect(calledWith).toContain("tokens saved");
  });

  it("context handler does not call ui methods when hasUI is false", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);

    const contextHandlers = handlers.get("context") ?? [];
    const setStatus = vi.fn();
    const notify = vi.fn();
    const mockCtx = {
      hasUI: false,
      ui: { setStatus, notify },
      getContextUsage: () => ({ tokens: 1000, contextWindow: 200000, percent: 5 }),
    };

    const messages = [
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() },
    ];
    await (contextHandlers[0] as (...args: unknown[]) => Promise<unknown>)(
      { messages },
      mockCtx,
    );
    expect(setStatus).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("context handler does not call setStatus when nothing is pruned", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);

    const contextHandlers = handlers.get("context") ?? [];
    const setStatus = vi.fn();
    const mockCtx = {
      hasUI: true,
      ui: { setStatus, notify: vi.fn() },
      getContextUsage: () => ({ tokens: 1000, contextWindow: 200000, percent: 5 }),
    };

    // Single user message — nothing to prune
    const messages = [
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() },
    ];
    await (contextHandlers[0] as (...args: unknown[]) => Promise<unknown>)(
      { messages },
      mockCtx,
    );
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("session_start resolves logDir from sessionManager", async () => {
    const { api, handlers } = createMockApi();

    createExtension(api);

    const sessionStartHandlers = handlers.get("session_start") ?? [];
    expect(sessionStartHandlers).toHaveLength(1);

    const mockCtx = {
      sessionManager: {
        getSessionDir: () => "/tmp/test-session-dir",
      },
      getContextUsage: () => ({
        tokens: 100,
        contextWindow: 200000,
        percent: 0.05,
      }),
    };

    await expect(
      (sessionStartHandlers[0] as (...args: unknown[]) => Promise<void>)(
        { reason: "new" },
        mockCtx,
      ),
    ).resolves.not.toThrow();
  });
});

describe("permission gating (tool_call handler)", () => {
  it("registers tool_call handler", () => {
    const { api, handlers } = createMockApi();
    createExtension(api);
    expect(handlers.has("tool_call")).toBe(true);
  });

  it("tool_call handler allows compress when permission is allow", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);

    // Fire session_start to initialize state
    const sessionStartHandler = handlers.get("session_start")?.[0];
    await (sessionStartHandler as (...args: unknown[]) => Promise<void>)(
      { reason: "new" },
      {
        sessionManager: { getSessionDir: () => "/tmp/test-session" },
        getContextUsage: () => ({ tokens: 100, contextWindow: 200000, percent: 0.05 }),
      },
    );

    // Config defaults to "allow", which session_start sets on state.
    // Now the tool_call handler should allow:
    const toolCallHandler = handlers.get("tool_call")?.[0];
    const allowResult = await (toolCallHandler as (...args: unknown[]) => Promise<unknown>)(
      { toolName: "compress", toolCallId: "call-1", input: {} },
      {},
    );
    expect(allowResult).toBeUndefined();
  });

  it("tool_call handler blocks compress after permission toggled to deny", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);

    // Fire session_start to initialize state (defaults to "allow")
    const sessionStartHandler = handlers.get("session_start")?.[0];
    await (sessionStartHandler as (...args: unknown[]) => Promise<void>)(
      { reason: "new" },
      {
        sessionManager: { getSessionDir: () => "/tmp/test-session" },
        getContextUsage: () => ({ tokens: 100, contextWindow: 200000, percent: 0.05 }),
      },
    );

    // Simulate runtime toggle: fire dcp:permission command handler
    // (We can't easily fire the command, so instead we verify the tool_call
    // handler reads from the state that permissionCommand mutates.)
    // The tool_call handler reads state.compressPermission internally,
    // but we can't directly access state. Instead, we verify end-to-end
    // by calling session_start with a deny config.

    // Use a config file that sets permission to deny:
    const configDir = "/tmp/test-pi-agent/extensions";
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "dcp.json"),
      JSON.stringify({ compress: { permission: "deny" } }),
    );

    try {
      const { api: api2, handlers: handlers2 } = createMockApi();
      createExtension(api2);

      const sessionStart2 = handlers2.get("session_start")?.[0];
      await (sessionStart2 as (...args: unknown[]) => Promise<void>)(
        { reason: "new" },
        {
          sessionManager: { getSessionDir: () => "/tmp/test-session" },
          getContextUsage: () => ({ tokens: 100, contextWindow: 200000, percent: 0.05 }),
        },
      );

      const toolCallHandler2 = handlers2.get("tool_call")?.[0];
      const result = await (toolCallHandler2 as (...args: unknown[]) => Promise<unknown>)(
        { toolName: "compress", toolCallId: "call-1", input: {} },
        {},
      );
      expect(result).toEqual({ block: true, reason: "Compression denied by configuration" });
    } finally {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("tool_call handler ignores non-compress tools", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);

    const sessionStartHandler = handlers.get("session_start")?.[0];
    await (sessionStartHandler as (...args: unknown[]) => Promise<void>)(
      { reason: "new" },
      {
        sessionManager: { getSessionDir: () => "/tmp/test-session" },
        getContextUsage: () => ({ tokens: 100, contextWindow: 200000, percent: 0.05 }),
      },
    );

    const toolCallHandler = handlers.get("tool_call")?.[0];
    const result = await (toolCallHandler as (...args: unknown[]) => Promise<unknown>)(
      { toolName: "bash", toolCallId: "call-2", input: { command: "ls" } },
      {},
    );
    expect(result).toBeUndefined();
  });
});

describe("sub-agent support", () => {
  it("context handler returns early when PI_SUBAGENT_CHILD=1", async () => {
    const originalEnv = process.env.PI_SUBAGENT_CHILD;
    process.env.PI_SUBAGENT_CHILD = "1";

    try {
      const { api, handlers } = createMockApi();
      createExtension(api);

      // Fire session_start to set isSubAgent
      const sessionStartHandler = handlers.get("session_start")?.[0];
      await (sessionStartHandler as (...args: unknown[]) => Promise<void>)(
        { reason: "new" },
        {
          sessionManager: { getSessionDir: () => "/tmp/test-session" },
          getContextUsage: () => ({ tokens: 100, contextWindow: 200000, percent: 0.05 }),
        },
      );

      // Fire context — should return early (undefined), not { messages: [...] }
      const contextHandler = handlers.get("context")?.[0];
      const result = await (contextHandler as (...args: unknown[]) => Promise<unknown>)(
        { messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() }] },
        { getContextUsage: () => ({ tokens: 100, contextWindow: 200000, percent: 0.05 }) },
      );

      expect(result).toBeUndefined();
    } finally {
      if (originalEnv === undefined) delete process.env.PI_SUBAGENT_CHILD;
      else process.env.PI_SUBAGENT_CHILD = originalEnv;
    }
  });

  it("context handler proceeds when allowSubAgents is true even with PI_SUBAGENT_CHILD=1", async () => {
    const originalEnv = process.env.PI_SUBAGENT_CHILD;
    process.env.PI_SUBAGENT_CHILD = "1";

    // Write a config file to the mocked agent dir enabling allowSubAgents
    const configDir = "/tmp/test-pi-agent/extensions";
    const configFile = path.join(configDir, "dcp.json");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ experimental: { allowSubAgents: true } }));

    try {
      const { api, handlers } = createMockApi();
      createExtension(api);

      // Fire session_start to set isSubAgent = true
      const sessionStartHandler = handlers.get("session_start")?.[0];
      await (sessionStartHandler as (...args: unknown[]) => Promise<void>)(
        { reason: "new" },
        {
          sessionManager: { getSessionDir: () => "/tmp/test-session" },
          getContextUsage: () => ({ tokens: 100, contextWindow: 200000, percent: 0.05 }),
        },
      );

      // Fire context — should NOT return early because allowSubAgents overrides the skip
      const contextHandler = handlers.get("context")?.[0];
      const result = await (contextHandler as (...args: unknown[]) => Promise<unknown>)(
        { messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() }] },
        { getContextUsage: () => ({ tokens: 100, contextWindow: 200000, percent: 0.05 }) },
      );

      // Should have returned { messages: [...] }, not undefined
      expect(result).not.toBeUndefined();
    } finally {
      if (originalEnv === undefined) delete process.env.PI_SUBAGENT_CHILD;
      else process.env.PI_SUBAGENT_CHILD = originalEnv;
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("tool_execution_end calls parseChildSessionResults for subagent events", async () => {
    const sessionFile = path.join(os.tmpdir(), `dcp-test-${Date.now()}.jsonl`);
    fs.writeFileSync(
      sessionFile,
      JSON.stringify({
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "Task done" }] },
      }),
    );

    const spy = vi.spyOn(subagentResults, "parseChildSessionResults");

    try {
      const { api, handlers } = createMockApi();
      createExtension(api);

      // Fire session_start
      const sessionStartHandler = handlers.get("session_start")?.[0];
      await (sessionStartHandler as (...args: unknown[]) => Promise<void>)(
        { reason: "new" },
        {
          sessionManager: { getSessionDir: () => "/tmp/test-session" },
          getContextUsage: () => ({ tokens: 100, contextWindow: 200000, percent: 0.05 }),
        },
      );

      // Fire tool_execution_end with a subagent tool result
      const toolEndHandler = handlers.get("tool_execution_end")?.[0];
      await (toolEndHandler as (...args: unknown[]) => Promise<void>)(
        {
          toolCallId: "call-subagent-1",
          toolName: "subagent",
          result: { details: { childSessionPath: sessionFile } },
          isError: false,
        },
        {},
      );

      expect(spy).toHaveBeenCalledWith(sessionFile);
      expect(await spy.mock.results[0]?.value).toBe("Task done");
    } finally {
      spy.mockRestore();
      fs.rmSync(sessionFile, { force: true });
    }
  });

  it("session_compact handler clears subagent cache without error", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);

    const sessionCompactHandler = handlers.get("session_compact")?.[0];
    await expect(
      (sessionCompactHandler as (...args: unknown[]) => Promise<void>)(
        {},
        {},
      ),
    ).resolves.not.toThrow();
  });

  it("before_agent_start returns early when PI_SUBAGENT_CHILD=1", async () => {
    const originalEnv = process.env.PI_SUBAGENT_CHILD;
    process.env.PI_SUBAGENT_CHILD = "1";

    try {
      const { api, handlers } = createMockApi();
      createExtension(api);

      // Fire session_start
      const sessionStartHandler = handlers.get("session_start")?.[0];
      await (sessionStartHandler as (...args: unknown[]) => Promise<void>)(
        { reason: "new" },
        {
          sessionManager: { getSessionDir: () => "/tmp/test-session" },
          getContextUsage: () => ({ tokens: 100, contextWindow: 200000, percent: 0.05 }),
        },
      );

      // Fire before_agent_start — should return early (undefined)
      const handler = handlers.get("before_agent_start")?.[0];
      const result = await (handler as (...args: unknown[]) => Promise<unknown>)(
        { systemPrompt: "Original", prompt: "input" },
        {},
      );

      expect(result).toBeUndefined();
    } finally {
      if (originalEnv === undefined) delete process.env.PI_SUBAGENT_CHILD;
      else process.env.PI_SUBAGENT_CHILD = originalEnv;
    }
  });
});
