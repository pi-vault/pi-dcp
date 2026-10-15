import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import createExtension from "../src/index.ts";
import type { DcpPanelComponent } from "../src/tui/panel.ts";
import * as sessionState from "../src/state/state.ts";

function fakeUiTheme(): Theme {
  const identity = (text: string) => text;
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: identity,
    italic: identity,
    underline: identity,
    inverse: identity,
    strikethrough: identity,
  } as unknown as Theme;
}

const FAKE_MODEL = {
  provider: "test",
  id: "test-model",
  name: "Test Model",
  api: "openai-completions",
  baseUrl: "https://example.invalid",
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
  reasoning: false,
} satisfies NonNullable<ExtensionContext["model"]>;

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const sessions: AgentSession[] = [];
const tempDirs: string[] = [];

async function createHostSession(
  options: Pick<
    NonNullable<Parameters<typeof createAgentSession>[0]>,
    "tools" | "excludeTools" | "noTools" | "sessionManager" | "sessionStartEvent"
  > & { setup?: (agentDir: string, settingsManager: SettingsManager) => void } = {},
): Promise<{ session: AgentSession; agentDir: string }> {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-sdk-contract-"));
  tempDirs.push(agentDir);
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const settingsManager = SettingsManager.inMemory();
  const { setup, ...hostOptions } = options;
  setup?.(agentDir, settingsManager);
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
    modelsStorePath: path.join(agentDir, "model-store.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: agentDir,
    agentDir,
    settingsManager,
    extensionFactories: [{ name: "dcp", factory: createExtension }],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: agentDir,
    agentDir,
    model: FAKE_MODEL,
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
    ...hostOptions,
  });
  sessions.push(session);
  // A real binding starts extensions and keeps reload's session_start enabled.
  await session.bindExtensions({
    onError: (error) => {
      throw new Error(error.error);
    },
  });
  return { session, agentDir };
}

/** Read DCP durable entries with a loose shape for assertions. */
function dcpSnapshotEntries(session: AgentSession): Array<{ data?: unknown }> {
  return session.sessionManager
    .getEntries()
    .filter((entry) => entry.type === "custom" && entry.customType === "pi-dcp-state")
    .map((entry) => entry as unknown as { data?: unknown });
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
});

describe("DCP public SDK contract", () => {
  /** Fake provider stream that issues one compress tool call, then a text reply. */
  function fakeCompressStream(id: string, topic: string, now: () => number): StreamFn {
    let responses = 0;
    return () => {
      const firstResponse = responses++ === 0;
      const message = {
        role: "assistant",
        content: firstResponse
          ? [
              {
                type: "toolCall",
                id,
                name: "compress",
                arguments: {
                  topic,
                  content: [{ startId: "m1", endId: "m1", summary: "summary" }],
                },
              },
            ]
          : [{ type: "text", text: "Finished" }],
        api: "openai-completions",
        provider: "test",
        model: "test-model",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: firstResponse ? "toolUse" : "stop",
        timestamp: now(),
      } satisfies Extract<AgentMessage, { role: "assistant" }>;
      // Only the provider stream is substituted; Pi owns all tool lifecycle events.
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "done", reason: message.stopReason, message };
        },
        result: async () => message,
      } as unknown as Awaited<ReturnType<StreamFn>>;
    };
  }

  it.each([true, false])(
    "runs the complete host lifecycle with deferred approval %s",
    async (approved) => {
      const stateFactory = vi.spyOn(sessionState, "createSessionState");
      const { session } = await createHostSession({
        setup: (dir) => {
          fs.mkdirSync(path.join(dir, "extensions"), { recursive: true });
          fs.writeFileSync(
            path.join(dir, "extensions", "dcp.json"),
            '{"compress":{"permission":"ask"}}',
          );
        },
      });
      // Observe the real extension state without replacing its implementation.
      const state = stateFactory.mock.results[0]?.value;
      expect(state).toBeDefined();
      let resolveApproval!: (approved: boolean) => void;
      const approval = new Promise<boolean>((resolve) => {
        resolveApproval = resolve;
      });
      let resolveConfirmationEntered!: () => void;
      const confirmationEntered = new Promise<void>((resolve) => {
        resolveConfirmationEntered = resolve;
      });
      const sequence: string[] = [];
      let now = 1_000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
      let monotonic = 0;
      vi.spyOn(performance, "now").mockImplementation(() => monotonic);
      session.extensionRunner.setUIContext(
        {
          ...session.extensionRunner.getUIContext(),
          confirm: async () => {
            sequence.push("confirm");
            resolveConfirmationEntered();
            return approval;
          },
        },
        "rpc",
      );
      const beforeToolCall = session.agent.beforeToolCall;
      session.agent.beforeToolCall = async (context, signal) => {
        sequence.push("tool_call");
        return beforeToolCall?.(context, signal);
      };
      const afterToolCall = session.agent.afterToolCall;
      session.agent.afterToolCall = async (context, signal) => {
        const result = await afterToolCall?.(context, signal);
        now += 7;
        return result;
      };
      const dcpEntries = () =>
        session.sessionManager
          .getEntries()
          .filter((entry) => entry.type === "custom" && entry.customType === "pi-dcp-state");
      let entriesAtEnd = -1;
      let isErrorAtEnd: boolean | undefined;
      let detailsAtEnd: unknown;
      let durationMsAtEnd: number | undefined;
      session.agent.subscribe((event) => {
        if (event.type === "tool_execution_start") sequence.push(event.type);
        if (event.type === "tool_execution_end") {
          sequence.push(event.type);
          entriesAtEnd = dcpEntries().length;
          isErrorAtEnd = event.isError;
          detailsAtEnd = event.result?.details;
          durationMsAtEnd = event.durationMs;
        }
      });
      let responses = 0;
      session.agent.getApiKey = () => undefined;
      session.agent.streamFunction = () => {
        const firstResponse = responses++ === 0;
        const message = {
          role: "assistant",
          content: firstResponse
            ? [
                {
                  type: "toolCall",
                  id: "host-compress",
                  name: "compress",
                  arguments: {
                    topic: "Host lifecycle",
                    content: [{ startId: "m1", endId: "m1", summary: "summary" }],
                  },
                },
              ]
            : [{ type: "text", text: "Finished" }],
          api: "openai-completions",
          provider: "test",
          model: "test-model",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: firstResponse ? "toolUse" : "stop",
          timestamp: now,
        } satisfies Extract<AgentMessage, { role: "assistant" }>;
        // Only the provider stream is substituted; Pi owns all tool lifecycle events.
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "done", reason: message.stopReason, message };
          },
          result: async () => message,
        } as unknown as Awaited<ReturnType<StreamFn>>;
      };
      session.sessionManager.appendMessage({
        role: "user",
        content: "Older conversation to compress",
        timestamp: 1,
      });
      const running = session.agent.prompt("Please compress the older conversation");
      await Promise.race([
        confirmationEntered,
        running.then(() => {
          throw new Error("Agent finished before confirmation");
        }),
      ]);
      expect(sequence).toEqual(["tool_execution_start", "tool_call", "confirm"]);
      expect(state.compressionTiming.startTimes.size).toBe(0);
      expect(state.prune.messages.blocksById.size).toBe(0);
      const statsBefore = { ...state.stats };
      const entriesBefore = dcpEntries().length;
      now += 5_000;
      monotonic += 5_000;
      resolveApproval(approved);
      await running;

      expect(sequence).toEqual([
        "tool_execution_start",
        "tool_call",
        "confirm",
        "tool_execution_end",
      ]);
      expect(responses).toBe(2);
      expect(isErrorAtEnd).toBe(!approved);
      expect(durationMsAtEnd).toBe(5_000);
      expect(state.compressionTiming.startTimes.size).toBe(0);
      if (approved) {
        expect([...state.prune.messages.blocksById.values()]).toMatchObject([
          { compressToolCallId: "host-compress", durationMs: 7 },
        ]);
        expect(state.stats.messagesCompressed).toBe(1);
        expect(entriesAtEnd).toBeGreaterThan(entriesBefore);
        expect(detailsAtEnd).toEqual({
          dcpCompression: {
            mode: "range",
            topic: "Host lifecycle",
            messagesCompressed: 1,
            compressedTokens: expect.any(Number),
            summaryTokens: expect.any(Number),
            blockIds: [1],
          },
        });
      } else {
        expect(state.prune.messages.blocksById.size).toBe(0);
        expect(state.stats).toEqual(statsBefore);
        expect(entriesAtEnd).toBe(entriesBefore);
        expect(detailsAtEnd).toEqual({});
      }
    },
  );

  it("checkpoints a preflight-blocked compression without starting timing", async () => {
    const stateFactory = vi.spyOn(sessionState, "createSessionState");
    const { session } = await createHostSession();
    // Observe the real extension state without replacing its implementation.
    const state = stateFactory.mock.results[0]?.value;
    expect(state).toBeDefined();
    if (!state) throw new Error("expected extension state");

    const confirm = vi.fn();
    const notify = vi.fn();
    session.extensionRunner.setUIContext(
      { ...session.extensionRunner.getUIContext(), confirm, notify },
      "rpc",
    );
    const beforeToolCall = session.agent.beforeToolCall;
    const sequence: string[] = [];
    session.agent.beforeToolCall = async (context, signal) => {
      sequence.push("tool_call");
      // Make state dirty after the context checkpoint while keeping the call callable.
      state.compressPermission = "deny";
      return beforeToolCall?.(context, signal);
    };
    const afterToolCall = vi.fn();
    session.agent.afterToolCall = async () => {
      afterToolCall();
      return undefined;
    };

    const dcpEntries = () => dcpSnapshotEntries(session);
    let entriesAtEnd = -1;
    let isErrorAtEnd: boolean | undefined;
    let resultAtEnd: { content?: Array<{ text?: string }>; details?: unknown } | undefined;
    let durationMsAtEnd: number | undefined;
    session.agent.subscribe((event) => {
      if (event.type === "tool_execution_start") sequence.push(event.type);
      if (event.type === "tool_execution_end") {
        sequence.push(event.type);
        entriesAtEnd = dcpEntries().length;
        isErrorAtEnd = event.isError;
        resultAtEnd = event.result;
        durationMsAtEnd = event.durationMs;
      }
    });

    const entriesBefore = dcpEntries().length;
    const statsBefore = { ...state.stats };
    session.agent.getApiKey = () => undefined;
    session.agent.streamFunction = fakeCompressStream("host-compress", "Preflight", () => 1000);
    session.sessionManager.appendMessage({
      role: "user",
      content: "Older conversation to compress",
      timestamp: 1,
    });
    await session.agent.prompt("Please compress the older conversation");

    expect(sequence).toEqual(["tool_execution_start", "tool_call", "tool_execution_end"]);
    expect(isErrorAtEnd).toBe(true);
    expect(resultAtEnd?.content?.[0]?.text).toBe("Compression denied by configuration");
    expect(durationMsAtEnd).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(afterToolCall).not.toHaveBeenCalled();
    expect(state.compressionTiming.startTimes.size).toBe(0);
    expect(state.prune.messages.blocksById.size).toBe(0);
    expect(state.stats).toEqual(statsBefore);
    // The untimed completion still requests persistence after the policy change.
    expect(entriesAtEnd).toBeGreaterThan(entriesBefore);
    expect(dcpEntries().at(-1)?.data).toMatchObject({ compressPermission: "deny" });
  });

  it("checkpoints mutated blocks without duration after a notification error", async () => {
    const stateFactory = vi.spyOn(sessionState, "createSessionState");
    const { session } = await createHostSession({
      setup: (dir) => {
        fs.mkdirSync(path.join(dir, "extensions"), { recursive: true });
        fs.writeFileSync(
          path.join(dir, "extensions", "dcp.json"),
          '{"nudgeNotificationType":"toast"}',
        );
      },
    });
    const state = stateFactory.mock.results[0]?.value;
    expect(state).toBeDefined();
    if (!state) throw new Error("expected extension state");

    session.extensionRunner.setUIContext(
      {
        ...session.extensionRunner.getUIContext(),
        notify: () => {
          throw new Error("notification failed");
        },
      },
      "rpc",
    );

    const afterToolCall = session.agent.afterToolCall;
    let startPresentDuringHook = false;
    session.agent.afterToolCall = async (context, signal) => {
      startPresentDuringHook = state.compressionTiming.startTimes.has("host-compress");
      return afterToolCall?.(context, signal);
    };

    const dcpEntries = () => dcpSnapshotEntries(session);
    let entriesAtEnd = -1;
    let isErrorAtEnd: boolean | undefined;
    let resultAtEnd: { content?: Array<{ text?: string }>; details?: unknown } | undefined;
    session.agent.subscribe((event) => {
      if (event.type === "tool_execution_end") {
        entriesAtEnd = dcpEntries().length;
        isErrorAtEnd = event.isError;
        resultAtEnd = event.result;
      }
    });

    const entriesBefore = dcpEntries().length;
    session.agent.getApiKey = () => undefined;
    session.agent.streamFunction = fakeCompressStream("host-compress", "Notify", () => 1000);
    session.sessionManager.appendMessage({
      role: "user",
      content: "Older conversation to compress",
      timestamp: 1,
    });
    await session.agent.prompt("Please compress the older conversation");

    expect(isErrorAtEnd).toBe(true);
    expect(resultAtEnd?.content?.[0]?.text).toBe("notification failed");
    expect(resultAtEnd?.details).toEqual({});
    expect(startPresentDuringHook).toBe(true);
    expect(state.compressionTiming.startTimes.size).toBe(0);
    expect([...state.prune.messages.blocksById.values()]).toMatchObject([
      { compressToolCallId: "host-compress", durationMs: 0 },
    ]);
    expect(state.stats.messagesCompressed).toBe(1);
    expect(entriesAtEnd).toBeGreaterThan(entriesBefore);
    expect(dcpEntries().at(-1)?.data).toMatchObject({ blocks: [{ durationMs: 0 }] });
  });

  it("uses the final tool-result error status after successful compression", async () => {
    const stateFactory = vi.spyOn(sessionState, "createSessionState");
    const { session } = await createHostSession();
    const state = stateFactory.mock.results[0]?.value;
    expect(state).toBeDefined();
    if (!state) throw new Error("expected extension state");

    const afterToolCall = session.agent.afterToolCall;
    let startPresentDuringHook = false;
    session.agent.afterToolCall = async (context, signal) => {
      startPresentDuringHook = state.compressionTiming.startTimes.has("host-compress");
      const result = await afterToolCall?.(context, signal);
      return { ...(result ?? {}), isError: true };
    };

    const dcpEntries = () => dcpSnapshotEntries(session);
    let entriesAtEnd = -1;
    let isErrorAtEnd: boolean | undefined;
    let resultAtEnd: { content?: Array<{ text?: string }>; details?: unknown } | undefined;
    session.agent.subscribe((event) => {
      if (event.type === "tool_execution_end") {
        entriesAtEnd = dcpEntries().length;
        isErrorAtEnd = event.isError;
        resultAtEnd = event.result;
      }
    });

    const entriesBefore = dcpEntries().length;
    session.agent.getApiKey = () => undefined;
    session.agent.streamFunction = fakeCompressStream("host-compress", "FinalError", () => 1000);
    session.sessionManager.appendMessage({
      role: "user",
      content: "Older conversation to compress",
      timestamp: 1,
    });
    await session.agent.prompt("Please compress the older conversation");

    expect(resultAtEnd?.content?.[0]?.text).toContain("Compressed");
    expect(resultAtEnd?.details).toMatchObject({
      dcpCompression: { mode: "range", topic: "FinalError" },
    });
    expect(isErrorAtEnd).toBe(true);
    expect(startPresentDuringHook).toBe(true);
    expect(state.compressionTiming.startTimes.size).toBe(0);
    expect([...state.prune.messages.blocksById.values()]).toMatchObject([
      { compressToolCallId: "host-compress", durationMs: 0 },
    ]);
    expect(entriesAtEnd).toBeGreaterThan(entriesBefore);
    expect(dcpEntries().at(-1)?.data).toMatchObject({ blocks: [{ durationMs: 0 }] });
  });

  it("exposes compression renderers through the real SDK tool definition", async () => {
    const { session } = await createHostSession();
    const definition = session.getToolDefinition("compress");

    expect(definition?.renderCall).toBeTypeOf("function");
    expect(definition?.renderResult).toBeTypeOf("function");

    const theme = {
      fg: (_color: string, text: string) => text,
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      inverse: (text: string) => text,
    } as unknown as Theme;
    const component = definition?.renderCall?.(
      { topic: "Auth", content: [{ startId: "m1", endId: "m2", summary: "s" }] } as never,
      theme,
      {} as never,
    );
    expect(component).toBeDefined();
    const visible = component
      ?.render(200)
      .map((line) => stripTerminalSequences(line).replace(/\s+$/, ""))
      .join("\n");
    expect(visible).toBe("compress range · Auth · 1 range");
  });

  it("keeps the compress tool exposed and guided for ask permission", async () => {
    const { session, agentDir } = await createHostSession({
      setup: (dir) => {
        fs.mkdirSync(path.join(dir, "extensions"), { recursive: true });
        fs.writeFileSync(
          path.join(dir, "extensions", "dcp.json"),
          '{"compress":{"permission":"ask"}}',
        );
      },
    });

    expect(session.getActiveToolNames()).toContain("compress");
    const result = await session.extensionRunner.emitBeforeAgentStart("hello", undefined, {
      cwd: agentDir,
    });
    expect(result.systemPromptOptions.sections.dcp).toContain("compress");
  });

  it("activates the early-registered compress tool for a fresh default session", async () => {
    const { session } = await createHostSession();

    expect(session.getActiveToolNames()).toContain("compress");
  });

  it("keeps a host-selected inactive compress tool inactive across reload", async () => {
    const { session, agentDir } = await createHostSession();
    session.setActiveToolsByName(["read"]);

    expect(session.getActiveToolNames()).not.toContain("compress");
    expect(session.getAllTools().some((tool) => tool.name === "compress")).toBe(true);

    await session.reload();
    expect(session.getActiveToolNames()).not.toContain("compress");
    expect(session.getAllTools().some((tool) => tool.name === "compress")).toBe(true);
    const result = await session.extensionRunner.emitBeforeAgentStart("hello", undefined, {
      cwd: agentDir,
    });
    expect(result.systemPromptOptions.sections.dcp).toBeUndefined();
  });

  it("preserves an inactive compress tool when resuming a declared loadout", async () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendMessage({
      role: "system",
      content: "Existing session",
      sections: {},
      toolsAdded: [],
      timestamp: 1,
    });
    const { session } = await createHostSession({
      sessionManager,
      sessionStartEvent: { type: "session_start", reason: "resume" },
    });

    expect(session.getActiveToolNames()).not.toContain("compress");
    expect(session.getAllTools().some((tool) => tool.name === "compress")).toBe(true);
  });

  it("preserves a host-selected active compress tool on resume", async () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendMessage({
      role: "system",
      content: "Existing session",
      sections: {},
      toolsAdded: [],
      timestamp: 1,
    });
    const { session } = await createHostSession({
      tools: ["read", "compress"],
      sessionManager,
      sessionStartEvent: { type: "session_start", reason: "resume" },
    });

    expect(session.getActiveToolNames()).toEqual(["read", "compress"]);
  });

  it("refreshes trusted project mode on reload without activating compress", async () => {
    const { session, agentDir } = await createHostSession({
      setup: (dir, settings) => {
        settings.setProjectTrusted(true);
        fs.mkdirSync(path.join(dir, ".pi"));
        fs.writeFileSync(path.join(dir, ".pi", "dcp.json"), '{"compress":{"mode":"message"}}');
      },
    });
    const initial = session.getToolDefinition("compress");
    expect(initial?.parameters).toHaveProperty("properties.targets");
    expect(initial?.defaultActive).toBe(false);
    expect(initial?.executionMode).toBe("sequential");
    session.setActiveToolsByName(["read"]);

    fs.writeFileSync(path.join(agentDir, ".pi", "dcp.json"), '{"compress":{"mode":"range"}}');
    await session.reload();

    const refreshed = session.getToolDefinition("compress");
    expect(refreshed?.parameters).toHaveProperty("properties.content");
    expect(refreshed?.parameters).not.toHaveProperty("properties.targets");
    expect(refreshed?.defaultActive).toBe(false);
    expect(refreshed?.executionMode).toBe("sequential");
    expect(session.getActiveToolNames()).toEqual(["read"]);
  });

  it.each([
    { name: "allowlist", options: { tools: ["read"] } },
    { name: "denylist", options: { excludeTools: ["compress"] } },
    { name: "noTools all", options: { noTools: "all" as const } },
  ])("respects a host $name exclusion", async ({ name: _name, options }) => {
    const { session } = await createHostSession(options);

    expect(session.getActiveToolNames()).not.toContain("compress");
    expect(session.getAllTools().some((tool) => tool.name === "compress")).toBe(false);
  });

  it("sets the dcp system prompt section through the real extension runner", async () => {
    const { session, agentDir } = await createHostSession();
    const result = await session.extensionRunner.emitBeforeAgentStart("hello", undefined, {
      cwd: agentDir,
    });

    expect(result.systemPromptOptions.sections.dcp).toContain("compress");
  });

  it("omits the dcp section when the host excludes the tool", async () => {
    const { session, agentDir } = await createHostSession({ tools: ["read"] });
    const result = await session.extensionRunner.emitBeforeAgentStart("hello", undefined, {
      cwd: agentDir,
    });

    expect(result.systemPromptOptions.sections.dcp).toBeUndefined();
  });

  it("routes informational commands to matching tabs through the real extension runner", async () => {
    const { session } = await createHostSession();
    const runner = session.extensionRunner;
    const captured: Array<{ options: unknown; component: DcpPanelComponent }> = [];
    const notify = vi.fn();
    const stream = vi.fn<StreamFn>(() => {
      throw new Error("Informational commands must not start model streaming");
    });
    session.agent.streamFunction = stream;
    const custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: Theme,
          keybindings: unknown,
          done: (result: unknown) => void,
        ) => DcpPanelComponent | Promise<DcpPanelComponent>,
        options: unknown,
      ) =>
        new Promise((resolve, reject) => {
          const tui = { terminal: { rows: 40, columns: 120 }, requestRender: () => {} };
          Promise.resolve(factory(tui, fakeUiTheme(), {}, resolve))
            .then((component) => {
              captured.push({ options, component });
              component.render(110);
              component.handleInput("q");
            })
            .catch(reject);
        }),
    );
    runner.setUIContext({ ...runner.getUIContext(), notify, custom } as never, "tui");

    const expected = [
      ["dcp", "Model"],
      ["dcp:help", "Open the interactive DCP panel"],
      ["dcp:context", "Model"],
      ["dcp:stats", "Session"],
      ["dcp:lifetime", "Session"],
    ] as const;

    for (const [name, marker] of expected) {
      captured.length = 0;
      custom.mockClear();
      notify.mockClear();
      await session.prompt(`/${name}`);

      expect(custom).toHaveBeenCalledTimes(1);
      expect(captured[0]?.options).toMatchObject({
        overlay: true,
        overlayOptions: { anchor: "center", width: "92%", maxHeight: "85%" },
      });
      const selected = captured[0]?.component.render(120).find((line) => line.includes("▸"));
      expect(selected).toContain(marker);
      expect(notify).not.toHaveBeenCalled();
      expect(stream).not.toHaveBeenCalled();
    }

    runner.setUIContext({ ...runner.getUIContext(), notify, custom } as never, "rpc");
    custom.mockClear();
    notify.mockClear();
    await session.prompt("/dcp:help");
    expect(custom).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("DCP Commands:"), "info");
    expect(stream).not.toHaveBeenCalled();
  });

  it("repairs only the navigated branch through the real SDK", async () => {
    const sessionManager = SessionManager.inMemory();
    const owner = sessionManager.getSessionId();
    const snapshotA = {
      version: 2 as const,
      ownerSessionId: owner,
      manualMode: "active" as const,
      compressPermission: "allow" as const,
      stats: {
        pruneTokenCounter: 0,
        totalPruneTokens: 111,
        toolsPruned: 2,
        messagesCompressed: 3,
      },
      lastCompaction: 0,
      pruneTools: [],
      blocks: [],
      nextBlockId: 1,
      nextRunId: 1,
      messageIds: { byRawId: [], nextRefIndex: 1 },
      nudges: { contextLimitAnchors: [], turnAnchors: [], iterationAnchors: [] },
    };
    const snapshotB = {
      ...snapshotA,
      manualMode: false as const,
      stats: { ...snapshotA.stats, totalPruneTokens: 222, toolsPruned: 5, messagesCompressed: 4 },
    };

    // Same-owner A, a malformed child, then a sibling B that stays the active leaf.
    const aId = sessionManager.appendCustomEntry("pi-dcp-state", snapshotA);
    const malformedId = sessionManager.appendCustomEntry("pi-dcp-state", { invalid: true });
    sessionManager.branch(aId);
    const bId = sessionManager.appendCustomEntry("pi-dcp-state", snapshotB);

    const stateFactory = vi.spyOn(sessionState, "createSessionState");
    const { session } = await createHostSession({
      sessionManager,
      sessionStartEvent: { type: "session_start", reason: "resume" },
    });
    const state = stateFactory.mock.results[0]?.value;
    expect(state).toBeDefined();
    if (!state) throw new Error("expected extension state");

    type DcpEntry = { id: string; parentId: string | null; data?: unknown };
    const dcpEntries = (): DcpEntry[] =>
      session.sessionManager
        .getEntries()
        .filter((entry) => entry.type === "custom" && entry.customType === "pi-dcp-state")
        .map((entry) => entry as unknown as DcpEntry);

    const countAfterBinding = dcpEntries().length;
    expect(countAfterBinding).toBe(3);
    expect(state.manualMode).toBe(false);
    expect(state.stats.totalPruneTokens).toBe(222);

    // Navigate to the malformed child: A is restored and one repair is appended.
    await session.navigateTree(malformedId);
    const afterRepair = dcpEntries();
    expect(afterRepair).toHaveLength(countAfterBinding + 1);
    expect(state.manualMode).toBe("active");
    expect(state.stats.totalPruneTokens).toBe(111);
    const repair = afterRepair[afterRepair.length - 1];
    expect(repair?.parentId).toBe(malformedId);
    expect(repair?.data).toMatchObject({
      version: 2,
      ownerSessionId: owner,
      manualMode: "active",
    });
    const repairId = repair?.id;
    expect(repairId).toBeDefined();
    expect(session.sessionManager.getLeafId()).toBe(repairId);

    const branchIds = session.sessionManager.getBranch().map((entry) => entry.id);
    expect(branchIds).toContain(aId);
    expect(branchIds).toContain(malformedId);
    expect(branchIds).not.toContain(bId);

    // B survives in the session tree but is not on the navigated branch.
    expect(dcpEntries().some((entry) => entry.id === bId)).toBe(true);

    await session.navigateTree(bId);
    expect(state.manualMode).toBe(false);
    expect(state.stats.totalPruneTokens).toBe(222);
    expect(dcpEntries()).toHaveLength(countAfterBinding + 1);

    if (!repairId) throw new Error("expected repair entry id");
    await session.navigateTree(repairId);
    expect(state.manualMode).toBe("active");
    expect(state.stats.totalPruneTokens).toBe(111);
    expect(dcpEntries()).toHaveLength(countAfterBinding + 1);
  });
});
