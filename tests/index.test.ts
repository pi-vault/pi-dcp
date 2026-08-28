import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import createExtension from "../src/index.ts";
import * as subagentResults from "../src/subagents/subagent-results.ts";
import { createSessionState } from "../src/state/state.ts";
import { restoreDcpSnapshot, serializeDcpSnapshot } from "../src/state/persistence.ts";
import { assignMessageRefs } from "../src/messages/inject.ts";
import { makeAssistantMessage } from "./helpers.ts";

const agentDir = vi.hoisted(() => `/tmp/dcp-index-test-${Date.now()}-${Math.random()}`);
const disabledModel = { provider: "openai-codex", id: "gpt-5.6-sol" };
const secondDisabledModel = { provider: "openai-codex", id: "gpt-5.6-luna" };
const enabledModel = { provider: "openai-codex", id: "gpt-5.6-terra" };

function writeDisabledModelConfig(...modelKeys: string[]): void {
  const configDir = path.join(agentDir, "extensions");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "dcp.json"), JSON.stringify({ disabledModels: modelKeys }));
}

function sessionContext(model = enabledModel, branch: unknown[] = []) {
  return {
    cwd: agentDir,
    model,
    isProjectTrusted: () => false,
    sessionManager: {
      getSessionDir: () => "/tmp/test-session-dir",
      getSessionId: () => "session",
      getBranch: () => branch,
    },
    getContextUsage: () => ({
      tokens: 1_000,
      contextWindow: 200_000,
      percent: 0.5,
    }),
    hasUI: false,
    ui: { notify: vi.fn(), setStatus: vi.fn() },
  };
}

const persistedCompressionSnapshot = {
  version: 1,
  ownerSessionId: "session",
  manualMode: false,
  compressPermission: "allow",
  stats: {
    pruneTokenCounter: 0,
    totalPruneTokens: 100,
    toolsPruned: 0,
    messagesCompressed: 2,
  },
  lastCompaction: 0,
  pruneTools: [],
  blocks: [
    {
      blockId: 1,
      runId: 1,
      deactivatedByUser: false,
      compressedTokens: 100,
      summaryTokens: 10,
      durationMs: 0,
      mode: "range",
      topic: "existing block",
      compressToolCallId: "compress-1",
      startKey: "user:1:0",
      endKey: "assistant:2:0",
      anchorKey: "user:1:0",
      consumedBlockIds: [],
      createdAt: 1,
      summary: "existing summary",
    },
  ],
  nextBlockId: 2,
  nextRunId: 2,
  messageIds: {
    byRawId: [
      ["user:1:0", "m0001"],
      ["assistant:2:0", "m0002"],
    ],
    nextRefIndex: 3,
  },
  nudges: {
    contextLimitAnchors: [],
    turnAnchors: [],
    iterationAnchors: [],
  },
};

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => agentDir,
}));

afterEach(() => fs.rmSync(agentDir, { recursive: true, force: true }));

type Handler = (...args: never[]) => unknown;

function createMockApi(options: { activeTools?: string[] } = {}) {
  const handlers = new Map<string, Handler[]>();
  const entries: Array<{ customType: string; data: unknown }> = [];
  const commands = new Map<string, unknown>();
  const tools = new Map<string, unknown>();
  let activeToolNames = [...(options.activeTools ?? ["read"])];
  const setActiveTools = vi.fn((names: string[]) => {
    activeToolNames = [...names];
  });
  const api = {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerTool(tool: { name: string }) {
      tools.set(tool.name, tool);
      if (!activeToolNames.includes(tool.name)) activeToolNames.push(tool.name);
    },
    getActiveTools() {
      return [...activeToolNames];
    },
    setActiveTools,
    registerCommand(name: string, command: unknown) {
      commands.set(name, command);
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ customType, data });
    },
  } as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI;
  return {
    api,
    handlers,
    entries,
    commands,
    tools,
    activeTools: () => [...activeToolNames],
    setActiveTools,
  };
}

function registeredHandler(
  handlers: Map<string, Handler[]>,
  event: string,
): (...args: unknown[]) => unknown {
  const handler = handlers.get(event)?.[0];
  if (!handler) throw new Error(`missing ${event} handler`);
  return handler as (...args: unknown[]) => unknown;
}

function messageRefs(result: { messages: Array<{ content?: Array<{ text?: string }> }> }) {
  return result.messages.map((message) => message.content?.[0]?.text?.match(/m\d+/)?.[0]);
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
    expect(handlers.has("agent_settled")).toBe(false);
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

  it("message_end strips the observed transposed message-id suffix", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);

    const handler = handlers.get("message_end")?.[0];
    expect(handler).toBeDefined();

    const result = await (handler as (...args: unknown[]) => Promise<unknown>)(
      {
        type: "message_end",
        message: makeAssistantMessage("**Creating the GitHub PR**m0112</dpc-message-id>"),
      },
      {},
    );

    expect(result).toBeDefined();
    const message = (result as { message: { content: Array<{ type: string; text?: string }> } })
      .message;
    expect(message.content[0]?.text).toBe("**Creating the GitHub PR**");
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

  it("reconstructs refs through same-owner resume and fork lifecycle handlers", async () => {
    const prefix = {
      role: "user",
      content: [{ type: "text" as const, text: "prefix" }],
      timestamp: 1,
    } as AgentMessage;
    const continuation = {
      role: "assistant",
      content: [{ type: "text" as const, text: "continuation" }],
      timestamp: 2,
    } as AgentMessage;
    const messages = [prefix, continuation];
    const saved = createSessionState();
    saved.sessionId = "parent";
    saved.stats.totalPruneTokens = 99;
    assignMessageRefs(saved, [prefix]);
    const checkpoint = serializeDcpSnapshot(saved);
    if (!checkpoint) throw new Error("expected checkpoint");

    const runContext = async (
      sessionId: string,
      branch: unknown[],
      reason: "new" | "resume" | "fork",
    ) => {
      const mock = createMockApi();
      createExtension(mock.api);
      const ctx = {
        sessionManager: {
          getSessionDir: () => "/tmp/test-session-dir",
          getSessionId: () => sessionId,
          getBranch: () => branch,
        },
        getContextUsage: () => undefined,
        hasUI: false,
      };
      await (
        registeredHandler(mock.handlers, "session_start") as (...args: unknown[]) => Promise<void>
      )({ reason }, ctx);
      const result = (await (
        registeredHandler(mock.handlers, "context") as (...args: unknown[]) => Promise<unknown>
      )({ messages }, ctx)) as {
        messages: Array<{ content?: Array<{ text?: string }> }>;
      };
      return { mock, result };
    };

    const uninterrupted = await runContext("parent", [], "new");
    const resumed = await runContext(
      "parent",
      [{ type: "custom", customType: "pi-dcp-state", data: checkpoint }],
      "resume",
    );
    const forked = await runContext(
      "child",
      [{ type: "custom", customType: "pi-dcp-state", data: checkpoint }],
      "fork",
    );

    expect(messageRefs(resumed.result)).toEqual(messageRefs(uninterrupted.result));
    expect(messageRefs(forked.result)).toEqual(messageRefs(uninterrupted.result));
    expect(resumed.mock.entries).toHaveLength(0);
    expect(forked.mock.entries).toHaveLength(1);
    expect(forked.mock.entries[0]?.data).toMatchObject({
      ownerSessionId: "child",
      stats: { totalPruneTokens: 0 },
      messageIds: {
        byRawId: [["user:1:0", "m0001"]],
        nextRefIndex: 2,
      },
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

  it("reconstructs branch refs through session_tree without ID-only snapshots", async () => {
    const { api, handlers, entries } = createMockApi();
    const sharedState = createSessionState();
    sharedState.sessionId = "session";
    sharedState.lastCompaction = 1;
    const sharedCheckpoint = serializeDcpSnapshot(sharedState);
    if (!sharedCheckpoint) throw new Error("expected checkpoint");
    const branchAMessages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "prefix" }], timestamp: 1 } as AgentMessage,
      { role: "user", content: [{ type: "text", text: "A" }], timestamp: 2 } as AgentMessage,
    ];
    const branchBMessages: AgentMessage[] = [
      ...branchAMessages.slice(0, 1),
      {
        role: "assistant",
        content: [{ type: "text", text: "hidden" }],
        timestamp: 2,
      } as AgentMessage,
      { role: "user", content: [{ type: "text", text: "B" }], timestamp: 3 } as AgentMessage,
    ];
    let branch: unknown[] = [
      { type: "custom", customType: "pi-dcp-state", data: sharedCheckpoint },
      { type: "message", message: branchAMessages[1] },
    ];
    const ctx = {
      sessionManager: {
        getSessionDir: () => "/tmp/test-session-dir",
        getSessionId: () => "session",
        getBranch: () => branch,
      },
      getContextUsage: () => undefined,
      hasUI: false,
    };
    createExtension(api);
    await (registeredHandler(handlers, "session_start") as (...args: unknown[]) => Promise<void>)(
      { reason: "resume" },
      ctx,
    );
    entries.length = 0;
    const context = registeredHandler(handlers, "context") as (...args: unknown[]) => Promise<{
      messages: Array<{ content: Array<{ text?: string }> }>;
    }>;
    const tree = registeredHandler(handlers, "session_tree") as (
      ...args: unknown[]
    ) => Promise<void>;
    const expectedA = createSessionState();
    expect(restoreDcpSnapshot(sharedCheckpoint, expectedA, "session")).toBe(true);
    assignMessageRefs(expectedA, branchAMessages);
    const expectedB = createSessionState();
    expect(restoreDcpSnapshot(sharedCheckpoint, expectedB, "session")).toBe(true);
    assignMessageRefs(expectedB, branchBMessages);

    const firstA = await context({ messages: branchAMessages }, ctx);
    expect(messageRefs(firstA)).toEqual([...expectedA.messageIds.byIndex.values()]);
    branch = [
      { type: "custom", customType: "pi-dcp-state", data: sharedCheckpoint },
      { type: "message", message: branchBMessages[1] },
      { type: "message", message: branchBMessages[2] },
    ];
    await tree({}, ctx);
    const siblingB = await context({ messages: branchBMessages }, ctx);
    expect(messageRefs(siblingB)).toEqual([...expectedB.messageIds.byIndex.values()]);
    branch = [
      { type: "custom", customType: "pi-dcp-state", data: sharedCheckpoint },
      { type: "message", message: branchAMessages[1] },
    ];
    await tree({}, ctx);
    const returnedA = await context({ messages: branchAMessages }, ctx);

    expect(messageRefs(returnedA)).toEqual(messageRefs(firstA));
    expect(messageRefs(siblingB)[0]).toBe(messageRefs(firstA)[0]);
    expect(entries).toHaveLength(0);
  });

  it("reconstructs retained refs after compaction through registered lifecycle handlers", async () => {
    const { api, handlers, entries } = createMockApi();
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
    await (registeredHandler(handlers, "session_start") as (...args: unknown[]) => Promise<void>)(
      { reason: "new" },
      ctx,
    );
    entries.length = 0;
    const context = registeredHandler(handlers, "context") as (...args: unknown[]) => Promise<{
      messages: Array<{ content: Array<{ text?: string }> }>;
    }>;
    await context(
      {
        messages: [
          { role: "user", content: [{ type: "text", text: "old" }], timestamp: 1 },
          { role: "user", content: [{ type: "text", text: "retained" }], timestamp: 2 },
        ],
      },
      ctx,
    );
    entries.length = 0;
    await (registeredHandler(handlers, "session_compact") as (...args: unknown[]) => Promise<void>)(
      {},
      ctx,
    );
    const checkpoint = entries[0]?.data;
    expect(checkpoint).toMatchObject({
      messageIds: {
        byRawId: [
          ["user:1:0", "m0001"],
          ["user:2:0", "m0002"],
        ],
        nextRefIndex: 3,
      },
    });

    const postCompactionEvent = {
      messages: [
        { role: "compactionSummary", summary: "summary", tokensBefore: 100, timestamp: 3 },
        { role: "user", content: [{ type: "text", text: "retained" }], timestamp: 2 },
        { role: "user", content: [{ type: "text", text: "new" }], timestamp: 4 },
      ],
    };
    const liveResult = await context(postCompactionEvent, ctx);
    expect(entries).toHaveLength(1);

    const restarted = createMockApi();
    createExtension(restarted.api);
    const restartCtx = {
      ...ctx,
      sessionManager: {
        ...ctx.sessionManager,
        getBranch: () => [{ type: "custom", customType: "pi-dcp-state", data: checkpoint }],
      },
    };
    await (
      registeredHandler(restarted.handlers, "session_start") as (
        ...args: unknown[]
      ) => Promise<void>
    )({ reason: "resume" }, restartCtx);
    const result = await (
      registeredHandler(restarted.handlers, "context") as (...args: unknown[]) => Promise<{
        messages: Array<{ content: Array<{ text?: string }> }>;
      }>
    )(postCompactionEvent, restartCtx);

    expect(messageRefs(result)).toEqual(messageRefs(liveResult));
    expect(result.messages).toEqual(liveResult.messages);
    expect(result.messages[1]?.content[0]?.text).toContain("m0002");
    expect(result.messages[2]?.content[0]?.text).toContain("m0004");
  });

  it("skips state writes when growing context changes only message IDs", async () => {
    const { api, handlers, entries } = createMockApi();
    createExtension(api);
    const ctx = {
      sessionManager: {
        getSessionDir: () => "/tmp/test-session-dir",
        getSessionId: () => "session",
        getBranch: () => [] as unknown[],
      },
      getContextUsage: () => ({ tokens: 20_000, contextWindow: 1_000_000, percent: 2 }),
      hasUI: false,
    };
    await (registeredHandler(handlers, "session_start") as (...args: unknown[]) => Promise<void>)(
      { reason: "new" },
      ctx,
    );
    entries.length = 0;
    const context = registeredHandler(handlers, "context") as (
      ...args: unknown[]
    ) => Promise<unknown>;
    const first = [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }];
    const second = [
      ...first,
      { role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: 2 },
    ];

    await context({ messages: first }, ctx);
    await context({ messages: second }, ctx);

    expect(entries).toHaveLength(0);
  });

  it("persists one context snapshot when a nudge anchor changes", async () => {
    const { api, handlers, entries } = createMockApi();
    createExtension(api);
    const ctx = {
      sessionManager: {
        getSessionDir: () => "/tmp/test-session-dir",
        getSessionId: () => "session",
        getBranch: () => [] as unknown[],
      },
      getContextUsage: () => ({ tokens: 800_000, contextWindow: 1_000_000, percent: 80 }),
      hasUI: false,
    };
    await (registeredHandler(handlers, "session_start") as (...args: unknown[]) => Promise<void>)(
      { reason: "new" },
      ctx,
    );
    entries.length = 0;
    const event = {
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }],
    };
    const context = registeredHandler(handlers, "context") as (
      ...args: unknown[]
    ) => Promise<unknown>;

    await context(event, ctx);
    await context(event, ctx);

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

describe("static model disablement", () => {
  it("passes messages through and omits the prompt for a disabled model", async () => {
    writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
    const { api, handlers } = createMockApi();
    createExtension(api);
    const ctx = sessionContext(disabledModel);
    await registeredHandler(handlers, "session_start")({ reason: "new" }, ctx);

    const before = await registeredHandler(handlers, "before_agent_start")(
      { systemPrompt: "base", prompt: "hello" },
      ctx,
    );
    const messages = [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }];
    const context = await registeredHandler(handlers, "context")({ messages }, ctx);

    expect(before).toBeUndefined();
    expect(context).toBeUndefined();
    expect(messages[0].content[0].text).toBe("hello");
  });

  it("does not sanitize assistant text for a disabled model", async () => {
    writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
    const { api, handlers } = createMockApi();
    createExtension(api);
    const message = makeAssistantMessage("**Creating the GitHub PR**m0112</dpc-message-id>");

    const result = await registeredHandler(handlers, "message_end")(
      { type: "message_end", message },
      sessionContext(disabledModel),
    );

    expect(result).toBeUndefined();
    expect((message as { content: Array<{ text?: string }> }).content[0]?.text).toBe(
      "**Creating the GitHub PR**m0112</dpc-message-id>",
    );
  });

  it("does not record compression timing for a disabled model", async () => {
    vi.useFakeTimers();
    try {
      writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
      const { api, handlers, entries } = createMockApi();
      createExtension(api);
      const ctx = sessionContext(disabledModel, [
        { type: "custom", customType: "pi-dcp-state", data: persistedCompressionSnapshot },
      ]);
      await registeredHandler(handlers, "session_start")({ reason: "resume" }, ctx);
      entries.length = 0;

      vi.setSystemTime(1_000);
      await registeredHandler(handlers, "tool_execution_start")(
        { toolName: "compress", toolCallId: "compress-1" },
        ctx,
      );
      vi.setSystemTime(2_500);
      await registeredHandler(handlers, "tool_execution_end")(
        { toolName: "compress", toolCallId: "compress-1", isError: false },
        ctx,
      );

      expect(entries).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not carry disabled compression timing into an enabled model", async () => {
    vi.useFakeTimers();
    try {
      writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
      const { api, handlers, entries } = createMockApi();
      createExtension(api);
      const disabledCtx = sessionContext(disabledModel, [
        {
          type: "custom",
          customType: "pi-dcp-state",
          data: persistedCompressionSnapshot,
        },
      ]);
      await registeredHandler(handlers, "session_start")({ reason: "resume" }, disabledCtx);
      entries.length = 0;

      vi.setSystemTime(1_000);
      await registeredHandler(handlers, "tool_execution_start")(
        { toolName: "compress", toolCallId: "compress-1" },
        disabledCtx,
      );
      await registeredHandler(handlers, "model_select")(
        {
          type: "model_select",
          model: enabledModel,
          previousModel: disabledModel,
          source: "set",
        },
        sessionContext(enabledModel),
      );
      vi.setSystemTime(2_500);
      await registeredHandler(handlers, "tool_execution_end")(
        { toolName: "compress", toolCallId: "compress-1", isError: false },
        sessionContext(enabledModel),
      );

      expect(entries).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not cache subagent results for a disabled model", async () => {
    writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
    const parser = vi
      .spyOn(subagentResults, "parseChildSessionResults")
      .mockResolvedValue("child result");
    try {
      const { api, handlers } = createMockApi();
      createExtension(api);

      await registeredHandler(handlers, "tool_execution_end")(
        {
          toolName: "subagent",
          toolCallId: "subagent-1",
          isError: false,
          result: { details: { childSessionPath: "/tmp/child.jsonl" } },
        },
        sessionContext(disabledModel),
      );

      expect(parser).not.toHaveBeenCalled();
    } finally {
      parser.mockRestore();
    }
  });

  it("removes compress for an initially disabled model", async () => {
    writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
    const { api, handlers, activeTools } = createMockApi({
      activeTools: ["read"],
    });
    createExtension(api);

    await registeredHandler(handlers, "session_start")(
      { reason: "new" },
      sessionContext(disabledModel),
    );

    expect(activeTools()).toEqual(["read"]);
  });

  it("keeps compress active for an unlisted initial model", async () => {
    writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
    const { api, handlers, activeTools } = createMockApi({
      activeTools: ["read"],
    });
    createExtension(api);

    await registeredHandler(handlers, "session_start")(
      { reason: "new" },
      sessionContext(enabledModel),
    );

    expect(activeTools()).toEqual(["read", "compress"]);
  });

  it("removes and restores compress across model_select", async () => {
    writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
    const { api, handlers, activeTools } = createMockApi({
      activeTools: ["read", "bash"],
    });
    createExtension(api);
    await registeredHandler(handlers, "session_start")(
      { reason: "new" },
      sessionContext(enabledModel),
    );
    expect(activeTools()).toEqual(["read", "bash", "compress"]);

    await registeredHandler(handlers, "model_select")(
      {
        type: "model_select",
        model: disabledModel,
        previousModel: enabledModel,
        source: "set",
      },
      sessionContext(disabledModel),
    );
    expect(activeTools()).toEqual(["read", "bash"]);

    await registeredHandler(handlers, "model_select")(
      {
        type: "model_select",
        model: enabledModel,
        previousModel: disabledModel,
        source: "set",
      },
      sessionContext(enabledModel),
    );
    expect(activeTools()).toEqual(["read", "bash", "compress"]);
  });

  it("does not restore compress when it was inactive before disablement", async () => {
    writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
    const { api, handlers, activeTools } = createMockApi({
      activeTools: ["read", "bash"],
    });
    createExtension(api);
    await registeredHandler(handlers, "session_start")(
      { reason: "new" },
      sessionContext(enabledModel),
    );
    api.setActiveTools(["read", "bash"]);

    await registeredHandler(handlers, "model_select")(
      {
        type: "model_select",
        model: disabledModel,
        previousModel: enabledModel,
        source: "set",
      },
      sessionContext(disabledModel),
    );
    await registeredHandler(handlers, "model_select")(
      {
        type: "model_select",
        model: enabledModel,
        previousModel: disabledModel,
        source: "set",
      },
      sessionContext(enabledModel),
    );

    expect(activeTools()).toEqual(["read", "bash"]);
  });

  it("preserves compress activation across repeated disabled reconciliation", async () => {
    writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
    const { api, handlers, activeTools, setActiveTools } = createMockApi({
      activeTools: ["read"],
    });
    createExtension(api);
    await registeredHandler(handlers, "session_start")(
      { reason: "new" },
      sessionContext(enabledModel),
    );
    setActiveTools.mockClear();

    await registeredHandler(handlers, "model_select")(
      {
        type: "model_select",
        model: disabledModel,
        previousModel: enabledModel,
        source: "set",
      },
      sessionContext(disabledModel),
    );
    expect(activeTools()).toEqual(["read"]);

    for (let index = 0; index < 2; index++) {
      await registeredHandler(handlers, "context")({ messages: [] }, sessionContext(disabledModel));
      expect(activeTools()).toEqual(["read"]);
    }

    await registeredHandler(handlers, "model_select")(
      {
        type: "model_select",
        model: enabledModel,
        previousModel: disabledModel,
        source: "set",
      },
      sessionContext(enabledModel),
    );

    expect(activeTools()).toEqual(["read", "compress"]);
    expect(setActiveTools.mock.calls).toEqual([[["read"]], [["read", "compress"]]]);
  });

  it.each([
    {
      name: "restores an initially active compress tool",
      activeBeforeDisable: ["read", "compress"],
      expectedActiveTools: ["read", "compress"],
      expectedCalls: [[["read"]], [["read", "compress"]]],
    },
    {
      name: "keeps an initially inactive compress tool inactive",
      activeBeforeDisable: ["read"],
      expectedActiveTools: ["read"],
      expectedCalls: [],
    },
  ])(
    "$name across consecutive disabled models",
    async ({ activeBeforeDisable, expectedActiveTools, expectedCalls }) => {
      writeDisabledModelConfig("openai-codex/gpt-5.6-sol", "openai-codex/gpt-5.6-luna");
      const { api, handlers, activeTools, setActiveTools } = createMockApi({
        activeTools: ["read"],
      });
      createExtension(api);
      await registeredHandler(handlers, "session_start")(
        { reason: "new" },
        sessionContext(enabledModel),
      );
      api.setActiveTools(activeBeforeDisable);
      setActiveTools.mockClear();

      await registeredHandler(handlers, "model_select")(
        {
          type: "model_select",
          model: disabledModel,
          previousModel: enabledModel,
          source: "set",
        },
        sessionContext(disabledModel),
      );
      await registeredHandler(handlers, "model_select")(
        {
          type: "model_select",
          model: secondDisabledModel,
          previousModel: disabledModel,
          source: "set",
        },
        sessionContext(secondDisabledModel),
      );
      await registeredHandler(handlers, "model_select")(
        {
          type: "model_select",
          model: enabledModel,
          previousModel: secondDisabledModel,
          source: "set",
        },
        sessionContext(enabledModel),
      );

      expect(activeTools()).toEqual(expectedActiveTools);
      expect(setActiveTools.mock.calls).toEqual(expectedCalls);
    },
  );

  it("blocks a stale compress call for a disabled model", async () => {
    writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
    const { api, handlers } = createMockApi();
    createExtension(api);

    const result = await registeredHandler(handlers, "tool_call")(
      { toolName: "compress", toolCallId: "compress-1", input: {} },
      sessionContext(disabledModel),
    );

    expect(result).toMatchObject({
      block: true,
      reason: "Compression is disabled for the current model",
    });
  });

  it("rejects direct compress execution for a disabled model", async () => {
    writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
    const { api, handlers, tools } = createMockApi();
    createExtension(api);
    const ctx = sessionContext(disabledModel);
    await registeredHandler(handlers, "session_start")({ reason: "new" }, ctx);
    const compress = tools.get("compress") as {
      execute: (...args: unknown[]) => Promise<unknown>;
    };

    const result = await compress.execute(
      "compress-1",
      { topic: "stale call", content: [] },
      undefined,
      undefined,
      ctx,
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: "Compression is disabled for the current model." }],
    });
  });

  it("retains state and reports status across disabled model switches", async () => {
    writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
    const { api, handlers, entries, commands } = createMockApi({
      activeTools: ["read"],
    });
    createExtension(api);
    const enabledCtx = sessionContext(enabledModel);
    await registeredHandler(handlers, "session_start")({ reason: "new" }, enabledCtx);

    const manual = commands.get("dcp:manual") as {
      handler: (args: string, ctx: ReturnType<typeof sessionContext>) => Promise<void>;
    };
    const context = commands.get("dcp:context") as {
      handler: (args: string, ctx: ReturnType<typeof sessionContext>) => Promise<void>;
    };
    await manual.handler("on", enabledCtx);
    expect(enabledCtx.ui.notify).toHaveBeenLastCalledWith(
      "Manual mode: on. Automatic compression is paused.",
      "info",
    );
    entries.length = 0;

    const disabledCtx = sessionContext(disabledModel);
    await registeredHandler(handlers, "model_select")(
      {
        type: "model_select",
        model: disabledModel,
        previousModel: enabledModel,
        source: "set",
      },
      disabledCtx,
    );
    expect(entries).toHaveLength(0);
    await context.handler("", disabledCtx);
    const disabledStatus = disabledCtx.ui.notify.mock.calls[0]?.[0] as string;
    expect(disabledStatus).toContain("Manual mode: active");
    expect(disabledStatus).toContain("DCP status: disabled for the current model");

    const reenabledCtx = sessionContext(enabledModel);
    await registeredHandler(handlers, "model_select")(
      {
        type: "model_select",
        model: enabledModel,
        previousModel: disabledModel,
        source: "set",
      },
      reenabledCtx,
    );
    expect(entries).toHaveLength(0);
    await context.handler("", reenabledCtx);
    const enabledStatus = reenabledCtx.ui.notify.mock.calls[0]?.[0] as string;
    expect(enabledStatus).toContain("Manual mode: active");
    expect(enabledStatus).not.toContain("disabled for the current model");
  });

  it("restores branch state through session_tree while the model is disabled", async () => {
    writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
    const saved = createSessionState();
    saved.sessionId = "session";
    saved.manualMode = "active";
    const snapshot = serializeDcpSnapshot(saved);
    if (!snapshot) throw new Error("expected checkpoint");

    let branch: unknown[] = [];
    const baseCtx = sessionContext(disabledModel);
    const ctx = {
      ...baseCtx,
      sessionManager: {
        ...baseCtx.sessionManager,
        getBranch: () => branch,
      },
    };
    const { api, handlers, entries, commands } = createMockApi();
    createExtension(api);
    await registeredHandler(handlers, "session_start")({ reason: "new" }, ctx);
    entries.length = 0;

    branch = [{ type: "custom", customType: "pi-dcp-state", data: snapshot }];
    await registeredHandler(handlers, "session_tree")({}, ctx);

    const context = commands.get("dcp:context") as {
      handler: (args: string, commandCtx: typeof ctx) => Promise<void>;
    };
    await context.handler("", ctx);
    const status = ctx.ui.notify.mock.calls[0]?.[0] as string;
    expect(status).toContain("Manual mode: active");
    expect(status).toContain("DCP status: disabled for the current model");
    expect(entries).toHaveLength(0);
  });

  it("clears active pruning through session_compact while the model is disabled", async () => {
    writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
    const { api, handlers, entries } = createMockApi();
    createExtension(api);
    const ctx = sessionContext(disabledModel, [
      {
        type: "custom",
        customType: "pi-dcp-state",
        data: persistedCompressionSnapshot,
      },
    ]);
    await registeredHandler(handlers, "session_start")({ reason: "resume" }, ctx);
    entries.length = 0;

    await registeredHandler(handlers, "session_compact")({}, ctx);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.data).toMatchObject({
      stats: {
        totalPruneTokens: 100,
        messagesCompressed: 2,
      },
      pruneTools: [],
      blocks: [],
    });
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
