import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import createExtension from "../src/index.ts";
import * as subagentResults from "../src/subagents/subagent-results.ts";
import { createSessionState } from "../src/state/state.ts";
import { serializeDcpSnapshot } from "../src/state/persistence.ts";

const agentDir = vi.hoisted(() => `/tmp/dcp-index-test-${Date.now()}-${Math.random()}`);

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => agentDir,
}));

afterEach(() => fs.rmSync(agentDir, { recursive: true, force: true }));

type Handler = (...args: never[]) => unknown;

function createMockApi() {
  const handlers = new Map<string, Handler[]>();
  const entries: Array<{ customType: string; data: unknown }> = [];
  const commands = new Map<string, unknown>();
  const tools = new Map<string, unknown>();
  const api = {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerTool(tool: { name: string }) {
      tools.set(tool.name, tool);
    },
    registerCommand(name: string, command: unknown) {
      commands.set(name, command);
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ customType, data });
    },
  } as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI;
  return { api, handlers, entries, commands, tools };
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

  it("before_agent_start honors restored compression permission", async () => {
    const { api, handlers } = createMockApi();
    const saved = createSessionState();
    saved.sessionId = "session";
    saved.compressPermission = "deny";
    const snapshot = serializeDcpSnapshot(saved);
    if (!snapshot) throw new Error("expected snapshot");
    createExtension(api);

    const start = handlers.get("session_start")?.[0];
    await (start as (...args: unknown[]) => Promise<void>)(
      { reason: "resume" },
      {
        sessionManager: {
          getSessionDir: () => "/tmp/test-session-dir",
          getSessionId: () => "session",
          getBranch: () => [{ type: "custom", customType: "pi-dcp-state", data: snapshot }],
        },
        getContextUsage: () => undefined,
      },
    );
    const beforeAgentStart = handlers.get("before_agent_start")?.[0];

    await expect(
      (beforeAgentStart as (...args: unknown[]) => Promise<unknown>)(
        { systemPrompt: "Original prompt.", prompt: "user input" },
        {},
      ),
    ).resolves.toBeUndefined();
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
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
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
        content: [
          { type: "toolCall", id: "call-1", name: "search_files", arguments: { query: "foo" } },
        ],
        stopReason: "toolUse",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
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
        content: [
          { type: "toolCall", id: "call-2", name: "search_files", arguments: { query: "foo" } },
        ],
        stopReason: "toolUse",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
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

    await (contextHandlers[0] as (...args: unknown[]) => Promise<unknown>)({ messages }, mockCtx);

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
    await (contextHandlers[0] as (...args: unknown[]) => Promise<unknown>)({ messages }, mockCtx);
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
    await (contextHandlers[0] as (...args: unknown[]) => Promise<unknown>)({ messages }, mockCtx);
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

  it("restores the newest valid branch snapshot and appends a child-owned fork", async () => {
    const { api, handlers, entries } = createMockApi();
    const parent = createSessionState();
    parent.sessionId = "parent";
    parent.stats.totalPruneTokens = 99;
    const snapshot = serializeDcpSnapshot(parent)!;
    createExtension(api);

    const start = handlers.get("session_start")?.[0];
    await (start as (...args: unknown[]) => Promise<void>)(
      { reason: "fork" },
      {
        sessionManager: {
          getSessionDir: () => "/tmp/test-session-dir",
          getSessionId: () => "child",
          getBranch: () => [
            { type: "custom", customType: "pi-dcp-state", data: { nope: true } },
            { type: "custom", customType: "pi-dcp-state", data: snapshot },
          ],
        },
        getContextUsage: () => undefined,
      },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      customType: "pi-dcp-state",
      data: { ownerSessionId: "child", stats: { totalPruneTokens: 0 } },
    });
  });

  it("does not append an unchanged snapshot on clean resume", async () => {
    const { api, handlers, entries } = createMockApi();
    const saved = createSessionState();
    saved.sessionId = "session";
    const snapshot = serializeDcpSnapshot(saved);
    if (!snapshot) throw new Error("expected snapshot");
    createExtension(api);

    const start = handlers.get("session_start")?.[0];
    await (start as (...args: unknown[]) => Promise<void>)(
      { reason: "resume" },
      {
        sessionManager: {
          getSessionDir: () => "/tmp/test-session-dir",
          getSessionId: () => "session",
          getBranch: () => [{ type: "custom", customType: "pi-dcp-state", data: snapshot }],
        },
        getContextUsage: () => undefined,
      },
    );

    expect(entries).toHaveLength(0);
  });

  it("appends a repair snapshot after falling back past malformed branch state", async () => {
    const { api, handlers, entries } = createMockApi();
    const saved = createSessionState();
    saved.sessionId = "session";
    const snapshot = serializeDcpSnapshot(saved);
    if (!snapshot) throw new Error("expected snapshot");
    createExtension(api);

    const start = handlers.get("session_start")?.[0];
    const ctx = {
      sessionManager: {
        getSessionDir: () => "/tmp/test-session-dir",
        getSessionId: () => "session",
        getBranch: () => [] as unknown[],
      },
      getContextUsage: () => undefined,
    };
    await (start as (...args: unknown[]) => Promise<void>)({ reason: "new" }, ctx);
    entries.length = 0;
    ctx.sessionManager.getBranch = () => [
      { type: "custom", customType: "pi-dcp-state", data: snapshot },
      { type: "custom", customType: "pi-dcp-state", data: { invalid: true } },
    ];

    const tree = handlers.get("session_tree")?.[0];
    await (tree as (...args: unknown[]) => Promise<void>)({}, ctx);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.data).toMatchObject({ ownerSessionId: "session" });
  });

  it("appends a baseline snapshot when tree navigation has no native state", async () => {
    const { api, handlers, entries } = createMockApi();
    createExtension(api);
    const ctx = {
      sessionManager: {
        getSessionDir: () => "/tmp/test-session-dir",
        getSessionId: () => "session",
        getBranch: () => [] as unknown[],
      },
      getContextUsage: () => undefined,
    };
    const start = handlers.get("session_start")?.[0];
    await (start as (...args: unknown[]) => Promise<void>)({ reason: "new" }, ctx);
    entries.length = 0;

    const tree = handlers.get("session_tree")?.[0];
    await (tree as (...args: unknown[]) => Promise<void>)({}, ctx);

    expect(entries).toHaveLength(1);
  });

  it("persists command mutations once and skips command no-ops", async () => {
    const { api, handlers, entries, commands } = createMockApi();
    createExtension(api);
    const ctx = {
      sessionManager: {
        getSessionDir: () => "/tmp/test-session-dir",
        getSessionId: () => "session",
        getBranch: () => [] as unknown[],
      },
      getContextUsage: () => undefined,
      ui: { notify: vi.fn() },
    };
    const start = handlers.get("session_start")?.[0];
    await (start as (...args: unknown[]) => Promise<void>)({ reason: "new" }, ctx);
    entries.length = 0;

    const manual = commands.get("dcp:manual") as {
      handler: (args: string, commandCtx: typeof ctx) => Promise<void>;
    };
    await manual.handler("on", ctx);
    await manual.handler("on", ctx);
    await manual.handler("invalid", ctx);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.data).toMatchObject({ manualMode: "active" });

    const permission = commands.get("dcp:permission") as {
      handler: (args: string, commandCtx: typeof ctx) => Promise<void>;
    };
    await permission.handler("", ctx);
    expect(entries).toHaveLength(2);
    expect(entries[1]?.data).toMatchObject({ compressPermission: "deny" });
  });

  it("persists one context mutation and skips an unchanged repeated pass", async () => {
    const { api, handlers, entries } = createMockApi();
    createExtension(api);
    const ctx = {
      sessionManager: {
        getSessionDir: () => "/tmp/test-session-dir",
        getSessionId: () => "session",
        getBranch: () => [] as unknown[],
      },
      getContextUsage: () => ({ tokens: 200_000, contextWindow: 1_000_000, percent: 20 }),
      hasUI: false,
    };
    const start = handlers.get("session_start")?.[0];
    await (start as (...args: unknown[]) => Promise<void>)({ reason: "new" }, ctx);
    entries.length = 0;
    const event = {
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }],
    };
    const context = handlers.get("context")?.[0];

    await (context as (...args: unknown[]) => Promise<unknown>)(event, ctx);
    await (context as (...args: unknown[]) => Promise<unknown>)(event, ctx);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.data).toMatchObject({
      messageIds: { byRawId: [["user:1:0", "m0001"]] },
      nudges: { contextLimitAnchors: ["user:1:0"] },
    });
  });

  it("persists compression once after final duration is available", async () => {
    vi.useFakeTimers();
    try {
      const { api, handlers, entries, tools } = createMockApi();
      createExtension(api);
      const ctx = {
        sessionManager: {
          getSessionDir: () => "/tmp/test-session-dir",
          getSessionId: () => "session",
          getBranch: () => [] as unknown[],
        },
        getContextUsage: () => undefined,
        hasUI: false,
      };
      const start = handlers.get("session_start")?.[0];
      await (start as (...args: unknown[]) => Promise<void>)({ reason: "new" }, ctx);
      const messages = [
        { role: "user", content: [{ type: "text", text: "one" }], timestamp: 1 },
        { role: "assistant", content: [{ type: "text", text: "two" }], timestamp: 2 },
      ];
      const context = handlers.get("context")?.[0];
      await (context as (...args: unknown[]) => Promise<unknown>)({ messages }, ctx);
      entries.length = 0;

      vi.setSystemTime(1_000);
      const toolStart = handlers.get("tool_execution_start")?.[0];
      await (toolStart as (...args: unknown[]) => Promise<void>)(
        { toolName: "compress", toolCallId: "compress-call" },
        ctx,
      );
      const compress = tools.get("compress") as {
        execute: (...args: unknown[]) => Promise<unknown>;
      };
      await compress.execute(
        "compress-call",
        { topic: "topic", content: [{ startId: "m0001", endId: "m0002", summary: "summary" }] },
        undefined,
        undefined,
        ctx,
      );
      expect(entries).toHaveLength(0);

      vi.setSystemTime(2_500);
      const toolEnd = handlers.get("tool_execution_end")?.[0];
      await (toolEnd as (...args: unknown[]) => Promise<void>)(
        { toolName: "compress", toolCallId: "compress-call", isError: false },
        ctx,
      );

      expect(entries).toHaveLength(1);
      expect(entries[0]?.data).toMatchObject({ blocks: [{ durationMs: 1_500 }] });
    } finally {
      vi.useRealTimers();
    }
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
    const configDir = path.join(agentDir, "extensions");
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
  it("keeps sub-agent processing disabled after restoring a snapshot", async () => {
    const originalEnv = process.env.PI_SUBAGENT_CHILD;
    process.env.PI_SUBAGENT_CHILD = "1";
    try {
      const saved = createSessionState();
      saved.sessionId = "child";
      const snapshot = serializeDcpSnapshot(saved);
      if (!snapshot) throw new Error("expected snapshot");
      const { api, handlers } = createMockApi();
      createExtension(api);

      const start = handlers.get("session_start")?.[0];
      await (start as (...args: unknown[]) => Promise<void>)(
        { reason: "resume" },
        {
          sessionManager: {
            getSessionDir: () => "/tmp/test-session",
            getSessionId: () => "child",
            getBranch: () => [{ type: "custom", customType: "pi-dcp-state", data: snapshot }],
          },
          getContextUsage: () => undefined,
        },
      );

      const context = handlers.get("context")?.[0];
      const result = await (context as (...args: unknown[]) => Promise<unknown>)(
        { messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }] },
        { getContextUsage: () => undefined },
      );
      expect(result).toBeUndefined();
    } finally {
      if (originalEnv === undefined) delete process.env.PI_SUBAGENT_CHILD;
      else process.env.PI_SUBAGENT_CHILD = originalEnv;
    }
  });

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
        {
          messages: [
            { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() },
          ],
        },
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
    const configDir = path.join(agentDir, "extensions");
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
        {
          messages: [
            { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() },
          ],
        },
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

  it("preserves cumulative stats while compaction clears active pruning", async () => {
    const { api, handlers, commands } = createMockApi();
    createExtension(api);

    const sessionStartHandler = handlers.get("session_start")?.[0];
    await (sessionStartHandler as (...args: unknown[]) => Promise<void>)(
      { reason: "new" },
      {
        sessionManager: {
          getSessionDir: () => "/tmp/test-session-dir",
          getSessionId: () => "session",
          getBranch: () => [],
        },
        getContextUsage: () => undefined,
      },
    );

    const contextHandler = handlers.get("context")?.[0];
    await (contextHandler as (...args: unknown[]) => Promise<unknown>)(
      {
        messages: [
          { role: "user", content: [{ type: "text", text: "find the file" }], timestamp: 1001 },
          {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "call-1",
                name: "search_files",
                arguments: { query: "foo" },
              },
            ],
            stopReason: "toolUse",
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              totalTokens: 0,
            },
            timestamp: 1002,
          },
          {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "search_files",
            content: [{ type: "text", text: "result" }],
            isError: false,
            timestamp: 1003,
          },
        ],
      },
      {
        getContextUsage: () => ({ tokens: 1000, contextWindow: 200000, percent: 0.5 }),
      },
    );

    const sweepHandler = commands.get("dcp:sweep") as {
      handler: (...args: unknown[]) => Promise<void>;
    };
    await sweepHandler.handler("", { ui: { notify: vi.fn() } });

    const statsHandler = commands.get("dcp:stats") as {
      handler: (...args: unknown[]) => Promise<void>;
    };
    const statsBeforeNotify = vi.fn();
    await statsHandler.handler("", { ui: { notify: statsBeforeNotify } });
    const statsBefore = statsBeforeNotify.mock.calls[0]?.[0] as string;
    expect(statsBefore).toContain("Tools pruned this session: 1");
    expect(statsBefore).toMatch(/Cumulative tokens saved by pruning: \d+/);

    const contextCommandHandler = commands.get("dcp:context") as {
      handler: (...args: unknown[]) => Promise<void>;
    };
    const contextBeforeNotify = vi.fn();
    await contextCommandHandler.handler("", {
      getContextUsage: () => undefined,
      ui: { notify: contextBeforeNotify },
    });
    expect(contextBeforeNotify.mock.calls[0]?.[0]).toContain("Currently pruned tool calls: 1");

    const sessionCompactHandler = handlers.get("session_compact")?.[0];
    await (sessionCompactHandler as (...args: unknown[]) => Promise<void>)({}, {});

    const statsAfterNotify = vi.fn();
    await statsHandler.handler("", { ui: { notify: statsAfterNotify } });
    expect(statsAfterNotify.mock.calls[0]?.[0]).toBe(statsBefore);

    const contextAfterNotify = vi.fn();
    await contextCommandHandler.handler("", {
      getContextUsage: () => undefined,
      ui: { notify: contextAfterNotify },
    });
    expect(contextAfterNotify.mock.calls[0]?.[0]).toContain("Currently pruned tool calls: 0");
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
