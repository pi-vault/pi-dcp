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
import type { AgentSession, ExtensionContext } from "@earendil-works/pi-coding-agent";
import createExtension from "../src/index.ts";
import * as sessionState from "../src/state/state.ts";

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

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
});

describe("DCP public SDK contract", () => {
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
      session.agent.subscribe((event) => {
        if (event.type === "tool_execution_start") sequence.push(event.type);
        if (event.type === "tool_execution_end") {
          sequence.push(event.type);
          entriesAtEnd = dcpEntries().length;
          isErrorAtEnd = event.isError;
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
      expect(state.compressionTiming.startTimes.size).toBe(0);
      if (approved) {
        expect([...state.prune.messages.blocksById.values()]).toMatchObject([
          { compressToolCallId: "host-compress", durationMs: 7 },
        ]);
        expect(state.stats.messagesCompressed).toBe(1);
        expect(entriesAtEnd).toBeGreaterThan(entriesBefore);
      } else {
        expect(state.prune.messages.blocksById.size).toBe(0);
        expect(state.stats).toEqual(statsBefore);
        expect(entriesAtEnd).toBe(entriesBefore);
      }
    },
  );

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
});
