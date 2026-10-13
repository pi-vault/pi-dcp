import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import createExtension from "../src/index.ts";
import { PromptStore } from "../src/prompts/store.ts";
import { createSessionState } from "../src/state/state.ts";
import { parseDcpSnapshot, serializeDcpSnapshot } from "../src/state/persistence.ts";
import {
  createExtensionHarness,
  createHarnessModel,
  declaredLoadoutMessage,
} from "./extension-harness.ts";
import {
  getMessageText,
  makeUserMessage,
  makeToolResultMessage,
  requireDefined,
} from "./helpers.ts";

const agentDir = `${os.tmpdir()}/dcp-pi-contract-${Date.now()}-${Math.random()}`;
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

const assistantMetadata = {
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
} satisfies Pick<
  Extract<AgentMessage, { role: "assistant" }>,
  "api" | "provider" | "model" | "usage"
>;

function writeConfig(config: unknown): void {
  const configDir = path.join(agentDir, "extensions");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "dcp.json"), JSON.stringify(config));
}

function systemPromptEvent(sections: Record<string, string> = {}) {
  return {
    systemPrompt: "base prompt",
    systemPromptOptions: {
      selectedTools: ["read"],
      hiddenTools: [],
      toolSnippets: {},
      toolGuidelines: {},
      promptGuidelines: [],
      appendSystemPrompt: "",
      sections,
      contextFiles: [],
      skills: [],
      cwd: process.cwd(),
    },
  };
}

beforeEach(() => {
  process.env.PI_CODING_AGENT_DIR = agentDir;
  fs.mkdirSync(agentDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(agentDir, { recursive: true, force: true });
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
});

describe("DCP lifecycle reconciliation", () => {
  it("activates compress once for a fresh default session", async () => {
    const harness = createExtensionHarness({ activeTools: ["read"] });
    createExtension(harness.api);

    expect(harness.activeTools()).toEqual(["read"]);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    expect(harness.activeTools()).toEqual(["read", "compress"]);
  });

  it("does not implicitly activate on reload", async () => {
    const harness = createExtensionHarness({ activeTools: ["read"] });
    createExtension(harness.api);

    await harness.emit("session_start", { type: "session_start", reason: "reload" });
    expect(harness.activeTools()).toEqual(["read"]);
  });

  it("preserves an inactive compress across resume of a declared loadout", async () => {
    const harness = createExtensionHarness({
      activeTools: ["read"],
      branch: [{ type: "message", message: declaredLoadoutMessage(["read"]) }],
    });
    createExtension(harness.api);

    await harness.emit("session_start", { type: "session_start", reason: "resume" });
    expect(harness.activeTools()).toEqual(["read"]);
  });

  it("keeps compress inactive across a later reload", async () => {
    const harness = createExtensionHarness({
      activeTools: ["read"],
      branch: [{ type: "message", message: declaredLoadoutMessage(["read"]) }],
    });
    createExtension(harness.api);

    await harness.emit("session_start", { type: "session_start", reason: "resume" });
    harness.setBranch([{ type: "message", message: declaredLoadoutMessage(["read"]) }]);
    await harness.emit("session_start", { type: "session_start", reason: "reload" });
    expect(harness.activeTools()).toEqual(["read"]);
  });

  it.each([
    { name: "allowlist", allowedTools: ["read"] },
    { name: "denylist", excludedTools: ["compress"] },
    { name: "noTools all", noTools: "all" as const },
  ])("respects a host $name exclusion", async ({ name: _name, ...options }) => {
    const harness = createExtensionHarness({ activeTools: ["read"], ...options });
    createExtension(harness.api);

    await harness.emit("session_start", { type: "session_start", reason: "new" });
    expect(harness.activeTools()).not.toContain("compress");
    expect(harness.api.getAllTools().some((tool) => tool.name === "compress")).toBe(false);
  });

  it("preserves other active tools through suppression", async () => {
    writeConfig({ disabledModels: ["test/test-model"] });
    const harness = createExtensionHarness({ activeTools: ["read", "bash"] });
    createExtension(harness.api);

    await harness.emit("session_start", { type: "session_start", reason: "new" });
    expect(harness.activeTools()).toEqual(["read", "bash"]);
  });

  it("remembers an implicit selection through an initially denied fresh session", async () => {
    writeConfig({ compress: { permission: "deny" } });
    const harness = createExtensionHarness({ activeTools: ["read"] });
    createExtension(harness.api);

    await harness.emit("session_start", { type: "session_start", reason: "new" });
    expect(harness.activeTools()).toEqual(["read"]);

    await harness.runCommand("dcp:permission", "");
    expect(harness.activeTools()).toEqual(["read", "compress"]);
  });

  it("honors a restored deny permission and restores on allow", async () => {
    const saved = createSessionState();
    saved.sessionId = "harness-session";
    saved.compressPermission = "deny";
    const snapshot = serializeDcpSnapshot(saved);
    if (!snapshot) throw new Error("expected snapshot");
    const harness = createExtensionHarness({
      activeTools: ["read", "compress"],
      branch: [{ type: "custom", customType: "pi-dcp-state", data: snapshot }],
    });
    createExtension(harness.api);

    await harness.emit("session_start", { type: "session_start", reason: "resume" });
    expect(harness.activeTools()).toEqual(["read"]);

    await harness.runCommand("dcp:permission", "");
    expect(harness.activeTools()).toEqual(["read", "compress"]);
  });

  it("does not reactivate when model suppression clears while permission remains", async () => {
    writeConfig({ disabledModels: ["test/test-model"] });
    const harness = createExtensionHarness({
      activeTools: ["read"],
      model: { provider: "test", id: "allowed-model" },
    });
    createExtension(harness.api);

    await harness.emit("session_start", { type: "session_start", reason: "new" });
    expect(harness.activeTools()).toContain("compress");

    await harness.runCommand("dcp:permission", "");
    await harness.runCommand("dcp:permission", "");
    expect(harness.activeTools()).toEqual(["read"]);

    harness.setModel({ provider: "test", id: "test-model" });
    await harness.emit("model_select", {
      type: "model_select",
      model: createHarnessModel({ provider: "test", id: "test-model" }),
      previousModel: undefined,
      source: "set",
    });
    expect(harness.activeTools()).toEqual(["read"]);

    harness.setModel({ provider: "test", id: "allowed-model" });
    await harness.emit("model_select", {
      type: "model_select",
      model: createHarnessModel({ provider: "test", id: "allowed-model" }),
      previousModel: undefined,
      source: "set",
    });
    expect(harness.activeTools()).toEqual(["read"]);

    await harness.runCommand("dcp:permission", "");
    expect(harness.activeTools()).toEqual(["read", "compress"]);
  });

  it("does not reactivate when permission suppression clears while model remains", async () => {
    writeConfig({ disabledModels: ["test/test-model"], compress: { permission: "deny" } });
    const harness = createExtensionHarness({
      activeTools: ["read"],
      model: { provider: "test", id: "allowed-model" },
    });
    createExtension(harness.api);

    await harness.emit("session_start", { type: "session_start", reason: "new" });
    expect(harness.activeTools()).toEqual(["read"]);

    harness.setModel({ provider: "test", id: "test-model" });
    await harness.emit("model_select", {
      type: "model_select",
      model: createHarnessModel({ provider: "test", id: "test-model" }),
      previousModel: undefined,
      source: "set",
    });
    expect(harness.activeTools()).toEqual(["read"]);

    harness.setModel({ provider: "test", id: "allowed-model" });
    await harness.emit("model_select", {
      type: "model_select",
      model: createHarnessModel({ provider: "test", id: "allowed-model" }),
      previousModel: undefined,
      source: "set",
    });
    expect(harness.activeTools()).toEqual(["read"]);

    await harness.runCommand("dcp:permission", "");
    expect(harness.activeTools()).toEqual(["read", "compress"]);
  });

  it("suppresses compress for a disallowed child process", async () => {
    process.env.PI_SUBAGENT_CHILD = "1";
    try {
      const harness = createExtensionHarness({ activeTools: ["read", "compress"] });
      createExtension(harness.api);

      await harness.emit("session_start", { type: "session_start", reason: "new" });
      expect(harness.activeTools()).toEqual(["read"]);
    } finally {
      delete process.env.PI_SUBAGENT_CHILD;
    }
  });

  it("keeps compress available for an allowed child process", async () => {
    process.env.PI_SUBAGENT_CHILD = "1";
    writeConfig({ experimental: { allowSubAgents: true } });
    try {
      const harness = createExtensionHarness({ activeTools: ["read"] });
      createExtension(harness.api);

      await harness.emit("session_start", { type: "session_start", reason: "new" });
      expect(harness.activeTools()).toEqual(["read", "compress"]);
    } finally {
      delete process.env.PI_SUBAGENT_CHILD;
    }
  });

  it("removes compress after a globally enabled session becomes disabled", async () => {
    writeConfig({ enabled: true });
    const harness = createExtensionHarness({
      activeTools: ["read"],
    });
    createExtension(harness.api);

    await harness.emit("session_start", { type: "session_start", reason: "new" });
    expect(harness.activeTools()).toContain("compress");

    writeConfig({ enabled: false });
    await harness.emit("session_start", { type: "session_start", reason: "reload" });
    expect(harness.activeTools()).toEqual(["read"]);
  });
});

describe("DCP defensive authorization", () => {
  const validCompression = {
    topic: "test",
    content: [{ startId: "m0001", endId: "m0001", summary: "summary" }],
  };

  it.each([
    { name: "config", config: { enabled: false }, env: {} },
    {
      name: "model",
      config: { disabledModels: ["test/test-model"] },
      env: {},
    },
    { name: "subagent", config: {}, env: { PI_SUBAGENT_CHILD: "1" } },
    { name: "permission", config: { compress: { permission: "deny" } }, env: {} },
  ])("blocks tool_call and execute for $name suppression", async ({ config, env }) => {
    writeConfig(config);
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    try {
      const harness = createExtensionHarness({ activeTools: ["read", "compress"] });
      createExtension(harness.api);
      await harness.emit("session_start", { type: "session_start", reason: "new" });

      const [toolCall] = await harness.emit("tool_call", {
        type: "tool_call",
        toolName: "compress",
        toolCallId: "call-1",
        input: validCompression,
      });
      expect(toolCall).toMatchObject({ block: true });

      await expect(harness.executeTool("compress", validCompression)).resolves.toMatchObject({
        isError: true,
      });
    } finally {
      for (const key of Object.keys(env)) delete process.env[key];
    }
  });

  it("does not enqueue a follow-up for an inactive compress tool", async () => {
    writeConfig({});
    const harness = createExtensionHarness({
      activeTools: ["read"],
      branch: [{ type: "message", message: declaredLoadoutMessage(["read"]) }],
    });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "resume" });

    await harness.runCommand("dcp:compress", "focus");

    expect(harness.sentMessages).toHaveLength(0);
    expect(harness.activeTools()).not.toContain("compress");
  });

  it("still prunes duplicates under denied permission", async () => {
    writeConfig({ compress: { permission: "deny" } });
    const harness = createExtensionHarness({
      activeTools: ["read"],
      contextUsage: { tokens: 1000, contextWindow: 200_000, percent: 0.5 },
    });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });

    const messages = [
      { role: "user", content: [{ type: "text", text: "find" }], timestamp: 1 },
      {
        ...assistantMetadata,
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "glob", arguments: { pattern: "**/*.ts" } }],
        stopReason: "toolUse",
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "glob",
        content: [{ type: "text", text: "same output" }],
        isError: false,
        nestedCalls: { calls: [], complete: true },
        timestamp: 3,
      },
      { role: "user", content: [{ type: "text", text: "again" }], timestamp: 4 },
      {
        ...assistantMetadata,
        role: "assistant",
        content: [{ type: "toolCall", id: "c2", name: "glob", arguments: { pattern: "**/*.ts" } }],
        stopReason: "toolUse",
        timestamp: 5,
      },
      {
        role: "toolResult",
        toolCallId: "c2",
        toolName: "glob",
        content: [{ type: "text", text: "same output" }],
        isError: false,
        nestedCalls: { calls: [], complete: true },
        timestamp: 6,
      },
    ] satisfies AgentMessage[];

    const [result] = (await harness.emit("context", { type: "context", messages })) as [
      { messages: AgentMessage[] },
    ];
    const firstResult = result.messages.find(
      (message) => message.role === "toolResult" && message.toolCallId === "c1",
    );
    expect(firstResult).toBeDefined();
    expect((firstResult as { content: Array<{ text?: string }> }).content[0]?.text).toContain(
      "[Output removed",
    );
  });
  it("clears timing for a compression that started before permission changed", async () => {
    vi.useFakeTimers();
    try {
      const harness = createExtensionHarness({
        activeTools: ["read"],
        contextUsage: { tokens: 1000, contextWindow: 200_000, percent: 0.5 },
      });
      createExtension(harness.api);
      await harness.emit("session_start", { type: "session_start", reason: "new" });
      await harness.emit("context", {
        type: "context",
        messages: [
          { role: "user", content: [{ type: "text", text: "one" }], timestamp: 1 },
          {
            ...assistantMetadata,
            role: "assistant",
            content: [{ type: "text", text: "two" }],
            stopReason: "stop",
            timestamp: 2,
          },
        ] satisfies AgentMessage[],
      });
      harness.entries.length = 0;

      vi.setSystemTime(1_000);
      await harness.executeTool("compress", validCompression);

      // Permission changes after the call started.
      await harness.runCommand("dcp:permission", "");

      vi.setSystemTime(2_500);
      await harness.emit("tool_execution_end", {
        type: "tool_execution_end",
        toolName: "compress",
        toolCallId: "harness-call",
        result: {},
        isError: false,
      });

      const persisted = harness.entries
        .filter((entry) => entry.customType === "pi-dcp-state")
        .at(-1);
      expect(persisted?.data).toMatchObject({ blocks: [{ durationMs: 1_500 }] });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DCP structured prompts", () => {
  it("sets only the dcp section and leaves unrelated sections untouched", async () => {
    const harness = createExtensionHarness({ activeTools: ["read"] });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });

    const event = systemPromptEvent();
    event.systemPromptOptions.sections.guidelines = "keep me";
    const [result] = await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "hello",
      ...event,
    });

    expect(result).toBeUndefined();
    expect(event.systemPromptOptions.sections.guidelines).toBe("keep me");
    expect(event.systemPromptOptions.sections.dcp).toContain("compress");
  });

  it("replaces the dcp section idempotently", async () => {
    const harness = createExtensionHarness({ activeTools: ["read"] });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });

    const first = systemPromptEvent();
    await harness.emit("before_agent_start", { type: "before_agent_start", prompt: "a", ...first });
    const second = systemPromptEvent();
    second.systemPromptOptions.sections.dcp = "stale section";
    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "b",
      ...second,
    });

    expect(second.systemPromptOptions.sections.dcp).toBe(first.systemPromptOptions.sections.dcp);
  });

  it("removes the dcp section when the compress tool is inactive", async () => {
    const harness = createExtensionHarness({
      activeTools: ["read"],
      branch: [{ type: "message", message: declaredLoadoutMessage(["read"]) }],
    });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "resume" });

    const event = systemPromptEvent();
    event.systemPromptOptions.sections.dcp = "stale section";
    await harness.emit("before_agent_start", { type: "before_agent_start", prompt: "a", ...event });

    expect(event.systemPromptOptions.sections.dcp).toBeUndefined();
  });

  it("omits nudges for an inactive tool while still assigning references", async () => {
    const harness = createExtensionHarness({
      activeTools: ["read"],
      branch: [{ type: "message", message: declaredLoadoutMessage(["read"]) }],
      contextUsage: { tokens: 200_000, contextWindow: 1_000_000, percent: 20 },
    });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "resume" });

    const [result] = (await harness.emit("context", {
      type: "context",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }],
    })) as [{ messages: AgentMessage[] }];

    const text =
      (result.messages[0] as { content: Array<{ text?: string }> }).content[0]?.text ?? "";
    expect(text).toContain("@m1@");
    expect(text).not.toContain("CRITICAL WARNING");
  });

  it("reloads custom prompts once per run, not from context passes", async () => {
    writeConfig({ experimental: { customPrompts: true } });
    const harness = createExtensionHarness({
      activeTools: ["read"],
      contextUsage: { tokens: 1000, contextWindow: 200_000, percent: 0.5 },
    });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });

    const reload = vi.spyOn(PromptStore.prototype, "reload");
    try {
      await harness.emit("before_agent_start", {
        type: "before_agent_start",
        prompt: "a",
        ...systemPromptEvent(),
      });
      await harness.emit("context", {
        type: "context",
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }],
      });
      await harness.emit("context", {
        type: "context",
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }],
      });

      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      reload.mockRestore();
    }
  });

  it("holds custom system and turn-nudge edits until the next run", async () => {
    writeConfig({
      experimental: { customPrompts: true },
      compress: { nudgeForce: "strong", minContextPercent: 50, maxContextPercent: 80 },
    });
    const overrideDir = path.join(agentDir, "extensions", "dcp-prompts", "overrides");
    fs.mkdirSync(overrideDir, { recursive: true });
    fs.writeFileSync(path.join(overrideDir, "system.md"), "Startup prompt");
    fs.writeFileSync(path.join(overrideDir, "turn-nudge.md"), "Startup turn nudge");

    const harness = createExtensionHarness({
      activeTools: ["read"],
      contextUsage: { tokens: 120_000, contextWindow: 200_000, percent: 60 },
    });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });

    // Edits made before the first run must replace the startup snapshot.
    fs.writeFileSync(path.join(overrideDir, "system.md"), "First prompt");
    fs.writeFileSync(path.join(overrideDir, "turn-nudge.md"), "First turn nudge");
    const first = systemPromptEvent();
    await harness.emit("before_agent_start", { type: "before_agent_start", prompt: "a", ...first });
    expect(first.systemPromptOptions.sections.dcp).toBe("First prompt");

    const messages = [
      {
        ...assistantMetadata,
        role: "assistant",
        content: [{ type: "text", text: "Previous reply" }],
        stopReason: "stop",
        timestamp: 1,
      },
      { role: "user", content: [{ type: "text", text: "Continue" }], timestamp: 2 },
    ] satisfies AgentMessage[];

    // Mid-run edits must wait even when context is transformed repeatedly.
    fs.writeFileSync(path.join(overrideDir, "system.md"), "Second prompt");
    fs.writeFileSync(path.join(overrideDir, "turn-nudge.md"), "Second turn nudge");
    for (let pass = 0; pass < 2; pass++) {
      const [result] = await harness.emit("context", { type: "context", messages });
      expect(result).toMatchObject({
        messages: [
          {},
          { content: [{ type: "text", text: expect.stringContaining("First turn nudge") }] },
        ],
      });
      expect(result).not.toMatchObject({
        messages: [
          {},
          { content: [{ type: "text", text: expect.stringContaining("Second turn nudge") }] },
        ],
      });
      expect(first.systemPromptOptions.sections.dcp).toBe("First prompt");
    }

    const second = systemPromptEvent();
    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "b",
      ...second,
    });
    expect(second.systemPromptOptions.sections.dcp).toBe("Second prompt");
    const [result] = await harness.emit("context", { type: "context", messages });
    expect(result).toMatchObject({
      messages: [
        {},
        { content: [{ type: "text", text: expect.stringContaining("Second turn nudge") }] },
      ],
    });
    expect(result).not.toMatchObject({
      messages: [
        {},
        { content: [{ type: "text", text: expect.stringContaining("First turn nudge") }] },
      ],
    });
  });
});

describe("DCP ask authorization", () => {
  const validCompression = {
    topic: "ask topic",
    content: [{ startId: "m0001", endId: "m0001", summary: "summary" }],
  };

  async function askHarness(options: {
    mode?: "tui" | "rpc" | "json" | "print";
    hasUI?: boolean;
    config?: unknown;
    model?: { provider: string; id: string };
  }) {
    writeConfig(options.config ?? { compress: { permission: "ask" } });
    const harness = createExtensionHarness({
      activeTools: ["read", "compress"],
      mode: options.mode ?? "tui",
      hasUI: options.hasUI ?? true,
      model: options.model,
      contextUsage: { tokens: 1000, contextWindow: 200_000, percent: 0.5 },
    });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    await harness.emit("context", {
      type: "context",
      messages: [
        { role: "user", content: [{ type: "text", text: "one" }], timestamp: 1 },
        {
          ...assistantMetadata,
          role: "assistant",
          content: [{ type: "text", text: "two" }],
          stopReason: "stop",
          timestamp: 2,
        },
      ] satisfies AgentMessage[],
    });
    harness.entries.length = 0;
    return harness;
  }

  it.each(["tui", "rpc"] as const)(
    "confirms once in %s and starts timing only after approval",
    async (mode) => {
      vi.useFakeTimers();
      try {
        const harness = await askHarness({ mode });
        harness.ui.confirm.mockImplementation(async () => {
          vi.setSystemTime(1_500);
          return true;
        });

        vi.setSystemTime(1_000);
        await expect(harness.executeTool("compress", validCompression)).resolves.toMatchObject({
          content: [{ text: expect.stringContaining("Compressed") }],
        });
        expect(harness.ui.confirm).toHaveBeenCalledTimes(1);

        vi.setSystemTime(2_500);
        await harness.emit("tool_execution_end", {
          type: "tool_execution_end",
          toolName: "compress",
          toolCallId: "harness-call",
          result: {},
          isError: false,
        });

        const persisted = harness.entries
          .filter((entry) => entry.customType === "pi-dcp-state")
          .at(-1);
        expect(persisted?.data).toMatchObject({ blocks: [{ durationMs: 1_000 }] });
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(["print", "json"] as const)("fails closed without confirm in %s", async (mode) => {
    const harness = await askHarness({ mode, hasUI: false });

    await expect(harness.executeTool("compress", validCompression)).resolves.toMatchObject({
      isError: true,
      content: [{ text: "Compression requires interactive approval" }],
    });
    expect(harness.ui.confirm).not.toHaveBeenCalled();
    expect(harness.entries).toHaveLength(0);
  });

  it("fails closed in TUI when dialog UI is unavailable", async () => {
    const harness = await askHarness({ mode: "tui", hasUI: false });

    await expect(harness.executeTool("compress", validCompression)).resolves.toMatchObject({
      isError: true,
      content: [{ text: "Compression requires interactive approval" }],
    });
    expect(harness.ui.confirm).not.toHaveBeenCalled();
  });

  it("creates no block, statistics, or durable entry when rejected", async () => {
    const harness = await askHarness({});
    harness.ui.confirm.mockResolvedValue(false);

    await expect(harness.executeTool("compress", validCompression)).resolves.toMatchObject({
      isError: true,
      content: [{ text: "Compression was not approved" }],
    });
    await harness.emit("tool_execution_end", {
      type: "tool_execution_end",
      toolName: "compress",
      toolCallId: "harness-call",
      result: {},
      isError: true,
    });

    expect(harness.entries).toHaveLength(0);

    // A later allowed compression still starts from a clean state.
    harness.ui.confirm.mockResolvedValue(true);
    await expect(harness.executeTool("compress", validCompression)).resolves.toMatchObject({
      content: [{ text: expect.stringContaining("Compressed") }],
    });
  });

  it("does not reuse an approval between successive ask calls", async () => {
    const harness = await askHarness({});
    harness.ui.confirm.mockResolvedValue(true);

    await harness.executeTool("compress", validCompression);
    await harness.executeTool("compress", {
      topic: "second",
      content: [{ startId: "m0002", endId: "m0002", summary: "summary two" }],
    });

    expect(harness.ui.confirm).toHaveBeenCalledTimes(2);
  });

  it("prevents compression when the call aborts during confirmation", async () => {
    const harness = await askHarness({});
    const controller = new AbortController();
    harness.ui.confirm.mockImplementation(async () => {
      controller.abort();
      return true;
    });

    await expect(
      harness.executeTool("compress", validCompression, { signal: controller.signal }),
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: "Compression was not approved" }],
    });
    expect(harness.entries).toHaveLength(0);
  });

  it("prevents compression when policy suppression appears while confirmation is pending", async () => {
    const harness = await askHarness({
      config: { disabledModels: ["test/disabled-model"], compress: { permission: "ask" } },
    });
    harness.ui.confirm.mockImplementation(async () => {
      harness.setModel({ provider: "test", id: "disabled-model" });
      await harness.emit("model_select", {
        type: "model_select",
        model: createHarnessModel({ provider: "test", id: "disabled-model" }),
        previousModel: undefined,
        source: "set",
      });
      return true;
    });

    await expect(harness.executeTool("compress", validCompression)).resolves.toMatchObject({
      isError: true,
      content: [{ text: "Compression is disabled for the current model." }],
    });
  });

  it("rejects post-approval model suppression without changing tool selection", async () => {
    const harness = await askHarness({
      config: { disabledModels: ["test/disabled-model"], compress: { permission: "ask" } },
    });
    expect(harness.activeTools()).toEqual(["read", "compress"]);
    const setActiveTools = vi.spyOn(harness.api, "setActiveTools");
    harness.ui.confirm.mockImplementation(async () => {
      // No lifecycle event: the approval recheck must read policy without reconciling tools.
      harness.setModel({ provider: "test", id: "disabled-model" });
      return true;
    });

    await expect(harness.executeTool("compress", validCompression)).resolves.toMatchObject({
      isError: true,
      content: [{ text: "Compression is disabled for the current model." }],
    });
    expect(harness.ui.confirm).toHaveBeenCalledTimes(1);
    expect(harness.activeTools()).toEqual(["read", "compress"]);
    expect(setActiveTools).not.toHaveBeenCalled();
    expect(harness.entries).toHaveLength(0);
  });
});

describe("DCP guarded action callback reconciliation", () => {
  it.each([
    { name: "manual query", command: "dcp:manual", args: "" },
    { name: "invalid manual args", command: "dcp:manual", args: "invalid" },
    { name: "already-selected manual off", command: "dcp:manual", args: "off" },
    { name: "empty sweep", command: "dcp:sweep", args: "" },
  ])(
    "refreshes model identity and restores compress after a deduplicated $name",
    async ({ command, args }) => {
      writeConfig({ disabledModels: ["test/disabled"] });
      const harness = createExtensionHarness({
        activeTools: ["read", "compress"],
        model: { provider: "test", id: "disabled" },
      });
      createExtension(harness.api);
      await harness.emit("session_start", { type: "session_start", reason: "new" });
      expect(harness.activeTools()).toEqual(["read"]);
      harness.entries.length = 0;

      // The host model changed without a model_select event; the action callback
      // must still refresh identity and reconcile the restored selection.
      harness.setModel({ provider: "test", id: "enabled" });
      await harness.runCommand(command, args);

      expect(harness.activeTools()).toEqual(["read", "compress"]);
      expect(harness.entries).toHaveLength(0);
    },
  );
});

describe("DCP selection ownership characterization", () => {
  it("preserves an inactive restored loadout across tree navigation", async () => {
    writeConfig({ disabledModels: ["test/test-model"] });
    const harness = createExtensionHarness({ activeTools: ["read", "compress"] });
    createExtension(harness.api);

    await harness.emit("session_start", { type: "session_start", reason: "new" });
    expect(harness.activeTools()).toEqual(["read"]);

    harness.setBranch([{ type: "message", message: declaredLoadoutMessage(["read"]) }]);
    harness.setActiveTools(["read"]);
    const setActiveTools = vi.spyOn(harness.api, "setActiveTools");

    await harness.emitMessages("session_tree", { type: "session_tree" });
    expect(harness.activeTools()).toEqual(["read"]);
    expect(setActiveTools).toHaveBeenCalledTimes(0);

    harness.setModel({ provider: "test", id: "allowed-model" });
    await harness.emit("model_select", {
      type: "model_select",
      model: createHarnessModel({ provider: "test", id: "allowed-model" }),
      previousModel: undefined,
      source: "set",
    });

    expect(harness.activeTools()).toEqual(["read"]);
  });

  it("reloads the definition and policy without fresh activation", async () => {
    const harness = createExtensionHarness({ activeTools: ["read", "compress"] });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    expect(harness.activeTools()).toEqual(["read", "compress"]);

    writeConfig({ compress: { mode: "message", permission: "deny" } });
    await harness.emit("session_start", { type: "session_start", reason: "reload" });

    const parameters = harness.tools.get("compress")?.parameters as {
      properties?: Record<string, unknown>;
    };
    expect(Object.keys(parameters.properties ?? {})).toContain("targets");
    expect(harness.activeTools()).toEqual(["read"]);

    await harness.runCommand("dcp:permission", "");
    expect(harness.activeTools()).toEqual(["read", "compress"]);
  });

  it("does not activate compress on reload with a deselected branch", async () => {
    const harness = createExtensionHarness({
      activeTools: ["read"],
      branch: [{ type: "message", message: declaredLoadoutMessage(["read"]) }],
    });
    createExtension(harness.api);

    await harness.emit("session_start", { type: "session_start", reason: "reload" });
    expect(harness.activeTools()).toEqual(["read"]);
  });

  it("keeps a restored explicit permission over the config default", async () => {
    writeConfig({ compress: { permission: "deny" } });
    const saved = createSessionState();
    saved.sessionId = "harness-session";
    saved.compressPermission = "allow";
    const snapshot = serializeDcpSnapshot(saved);
    if (!snapshot) throw new Error("expected snapshot");
    const harness = createExtensionHarness({
      activeTools: ["read", "compress"],
      branch: [{ type: "custom", customType: "pi-dcp-state", data: snapshot }],
    });
    createExtension(harness.api);

    await harness.emit("session_start", { type: "session_start", reason: "resume" });
    expect(harness.activeTools()).toEqual(["read", "compress"]);
  });

  it("blocks a newly disallowed tool call without reconciling selection", async () => {
    writeConfig({ disabledModels: ["test/blocked"] });
    const harness = createExtensionHarness({ activeTools: ["read", "compress"] });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    expect(harness.activeTools()).toEqual(["read", "compress"]);

    const setActiveTools = vi.spyOn(harness.api, "setActiveTools");
    harness.setModel({ provider: "test", id: "blocked" });
    const [blocked] = await harness.emit("tool_call", {
      type: "tool_call",
      toolName: "compress",
      toolCallId: "call-1",
      input: { topic: "t", content: [{ startId: "m1", endId: "m1", summary: "s" }] },
    });
    expect(blocked).toMatchObject({
      block: true,
      reason: "Compression is disabled for the current model",
    });
    expect(harness.activeTools()).toEqual(["read", "compress"]);
    expect(setActiveTools).toHaveBeenCalledTimes(0);

    (harness.context as unknown as { model: unknown }).model = undefined;
    const [blockedAgain] = await harness.emit("tool_call", {
      type: "tool_call",
      toolName: "compress",
      toolCallId: "call-2",
      input: { topic: "t", content: [{ startId: "m1", endId: "m1", summary: "s" }] },
    });
    expect(blockedAgain).toMatchObject({
      block: true,
      reason: "Compression is disabled for the current model",
    });
    expect(setActiveTools).toHaveBeenCalledTimes(0);

    harness.setModel({ provider: "test", id: "allowed" });
    await harness.emit("context", { type: "context", messages: [] });
    expect(harness.activeTools()).toEqual(["read", "compress"]);
    expect(setActiveTools).toHaveBeenCalledTimes(0);
  });

  it("keeps defensive execution and approval queries free of selection writes", async () => {
    const validCompression = {
      topic: "t",
      content: [{ startId: "m1", endId: "m1", summary: "s" }],
    };

    writeConfig({ disabledModels: ["test/blocked"] });
    const direct = createExtensionHarness({ activeTools: ["read", "compress"] });
    createExtension(direct.api);
    await direct.emit("session_start", { type: "session_start", reason: "new" });
    const directWrites = vi.spyOn(direct.api, "setActiveTools");
    direct.setModel({ provider: "test", id: "blocked" });

    await expect(direct.executeTool("compress", validCompression)).resolves.toMatchObject({
      isError: true,
      content: [{ text: "Compression is disabled for the current model." }],
    });
    expect(directWrites).toHaveBeenCalledTimes(0);

    writeConfig({ compress: { permission: "ask" } });
    const ask = createExtensionHarness({
      activeTools: ["read", "compress"],
      mode: "tui",
      hasUI: true,
      contextUsage: { tokens: 1000, contextWindow: 200_000, percent: 0.5 },
    });
    createExtension(ask.api);
    await ask.emit("session_start", { type: "session_start", reason: "new" });
    await ask.emit("context", {
      type: "context",
      messages: [
        { role: "user", content: [{ type: "text", text: "one" }], timestamp: 1 },
        {
          ...assistantMetadata,
          role: "assistant",
          content: [{ type: "text", text: "two" }],
          stopReason: "stop",
          timestamp: 2,
        },
      ],
    });
    const askWrites = vi.spyOn(ask.api, "setActiveTools");

    ask.ui.confirm.mockResolvedValue(false);
    await expect(ask.executeTool("compress", validCompression)).resolves.toMatchObject({
      isError: true,
    });
    expect(askWrites).toHaveBeenCalledTimes(0);

    ask.ui.confirm.mockResolvedValue(true);
    await expect(ask.executeTool("compress", validCompression)).resolves.toMatchObject({
      content: [{ text: expect.stringContaining("Compressed") }],
    });
    expect(askWrites).toHaveBeenCalledTimes(0);
  });

  it("retains first-start handling and suppression memory through compaction", async () => {
    writeConfig({ disabledModels: ["test/blocked"] });
    const harness = createExtensionHarness({ activeTools: ["read", "compress"] });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    expect(harness.activeTools()).toEqual(["read", "compress"]);

    harness.setModel({ provider: "test", id: "blocked" });
    await harness.emit("model_select", {
      type: "model_select",
      model: createHarnessModel({ provider: "test", id: "blocked" }),
      previousModel: undefined,
      source: "set",
    });
    expect(harness.activeTools()).toEqual(["read"]);

    await harness.emitMessages("session_compact", { type: "session_compact" });

    harness.setModel({ provider: "test", id: "allowed" });
    await harness.emit("model_select", {
      type: "model_select",
      model: createHarnessModel({ provider: "test", id: "allowed" }),
      previousModel: undefined,
      source: "set",
    });
    expect(harness.activeTools()).toEqual(["read", "compress"]);

    harness.setActiveTools(["read"]);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    expect(harness.activeTools()).toEqual(["read"]);
  });
});

describe("DCP compression block lifecycle integration", () => {
  function compressOwner(toolCallId: string, timestamp: number): AgentMessage {
    return {
      role: "assistant",
      content: [{ type: "toolCall", id: toolCallId, name: "compress", arguments: {} }],
      stopReason: "toolUse",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        totalTokens: 0,
      },
      timestamp,
    } as unknown as AgentMessage;
  }

  const cases = [
    {
      name: "range",
      config: { compress: { mode: "range" } },
      args: (view: string) => {
        const start = requireDefined(view.match(/@m1(?::\d+)?@/)?.[0], "start marker");
        const end = requireDefined(view.match(/@m2(?::\d+)?@/)?.[0], "end marker");
        return {
          topic: "older context",
          content: [{ startId: start, endId: end, summary: "older summary" }],
        };
      },
    },
    {
      name: "message",
      config: { compress: { mode: "message" } },
      args: (view: string) => {
        const target = requireDefined(view.match(/@m2(?::\d+)?@/)?.[0], "target marker");
        return {
          topic: "older context",
          targets: [{ messageId: target, summary: "older summary" }],
        };
      },
    },
  ];

  it.each(cases)(
    "creates and controls blocks across real extension context passes ($name)",
    async ({ config: configOverride, args }) => {
      writeConfig(configOverride);
      const harness = createExtensionHarness({ activeTools: ["read", "compress"] });
      createExtension(harness.api);
      await harness.emit("session_start", { type: "session_start", reason: "new" });

      const raw: AgentMessage[] = [
        makeUserMessage("older user", 1),
        {
          ...assistantMetadata,
          role: "assistant",
          content: [{ type: "text", text: "older assistant" }],
          stopReason: "stop",
          timestamp: 2,
        } satisfies AgentMessage,
        makeUserMessage("middle user", 3),
        {
          ...assistantMetadata,
          role: "assistant",
          content: [{ type: "text", text: "middle assistant" }],
          stopReason: "stop",
          timestamp: 4,
        } satisfies AgentMessage,
        makeUserMessage("tail user", 5),
      ];
      const originalMessages = structuredClone(raw);

      const [firstPass] = (await harness.emit("context", {
        type: "context",
        messages: [...raw],
      })) as [{ messages: AgentMessage[] }];
      const view = firstPass.messages.map(getMessageText).join("\n");

      // The host gains the owner call without another context pass, so DCP's
      // cached context still lacks the call that owns the new block.
      raw.push(compressOwner("compress-1", 6));
      const result = (await harness.executeTool("compress", args(view), {
        toolCallId: "compress-1",
      })) as { content: Array<{ text: string }>; isError?: boolean };
      expect(result.isError).not.toBe(true);
      expect(result.content[0]?.text).toContain("Compressed");

      await harness.emit("tool_execution_end", {
        type: "tool_execution_end",
        toolName: "compress",
        toolCallId: "compress-1",
        result,
        isError: false,
      });
      raw.push(
        makeToolResultMessage("compress-1", "compress", result.content[0]?.text ?? "", false, 7),
      );

      const [secondPass] = (await harness.emit("context", {
        type: "context",
        messages: [...raw],
      })) as [{ messages: AgentMessage[] }];
      const secondText = secondPass.messages.map(getMessageText).join("\n");
      expect(secondText).toContain("older summary");
      expect(secondText).not.toContain("older assistant");
      if (configOverride.compress.mode === "range") {
        expect(secondText).not.toContain("older user");
      }
      // The original raw history is never rewritten.
      expect(raw.slice(0, originalMessages.length)).toEqual(originalMessages);

      const checkpoint = requireDefined(
        parseDcpSnapshot(
          harness.entries.filter((entry) => entry.customType === "pi-dcp-state").at(-1)?.data,
        ),
        "compression checkpoint",
      );
      expect(checkpoint).toMatchObject({
        version: 2,
        ownerSessionId: "harness-session",
        nextBlockId: 2,
        nextRunId: 2,
        stats: { messagesCompressed: configOverride.compress.mode === "range" ? 2 : 1 },
        blocks: [
          {
            blockId: 1,
            runId: 1,
            compressToolCallId: "compress-1",
            summary: "[Compressed Block b1]\nolder summary\n[End Block b1]",
          },
        ],
      });
      const before = {
        nextBlockId: checkpoint.nextBlockId,
        nextRunId: checkpoint.nextRunId,
        stats: checkpoint.stats,
        blocks: checkpoint.blocks,
      };

      await harness.runCommand("dcp:decompress", "1");
      const [restoredPass] = (await harness.emit("context", {
        type: "context",
        messages: [...raw],
      })) as [{ messages: AgentMessage[] }];
      const restoredText = restoredPass.messages.map(getMessageText).join("\n");
      expect(restoredText).toContain("older assistant");
      expect(restoredText).not.toContain("older summary");

      await harness.runCommand("dcp:recompress", "1");
      const [recompressedPass] = (await harness.emit("context", {
        type: "context",
        messages: [...raw],
      })) as [{ messages: AgentMessage[] }];
      const recompressedText = recompressedPass.messages.map(getMessageText).join("\n");
      expect(recompressedText).toContain("older summary");
      expect(recompressedText).not.toContain("older assistant");
      expect(raw.slice(0, originalMessages.length)).toEqual(originalMessages);

      const afterCheckpoint = requireDefined(
        parseDcpSnapshot(
          harness.entries.filter((entry) => entry.customType === "pi-dcp-state").at(-1)?.data,
        ),
        "recompression checkpoint",
      );
      expect(afterCheckpoint).toMatchObject(before);
    },
  );
});

describe("DCP compaction durability", () => {
  function compressOwner(toolCallId: string, timestamp: number): AgentMessage {
    return {
      role: "assistant",
      content: [{ type: "toolCall", id: toolCallId, name: "compress", arguments: {} }],
      stopReason: "toolUse",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        totalTokens: 0,
      },
      timestamp,
    } as unknown as AgentMessage;
  }

  const compactionEntry = {
    type: "compaction" as const,
    id: "compaction-1",
    parentId: null,
    timestamp: "2026-07-29T00:00:00.000Z",
    summary: "compacted summary",
    firstKeptEntryId: "retained-1",
    tokensBefore: 500,
  };

  function snapshotFrom(harness: ReturnType<typeof createExtensionHarness>, label: string) {
    return requireDefined(
      parseDcpSnapshot(
        harness.entries.filter((entry) => entry.customType === "pi-dcp-state").at(-1)?.data,
      ),
      label,
    );
  }

  it("continues block run and message references after compaction and resume", async () => {
    vi.useFakeTimers();
    try {
      writeConfig({});
      const sessionId = "compact-session";
      const baseOptions = {
        activeTools: ["read", "compress"],
        sessionId,
        contextUsage: { tokens: 1000, contextWindow: 200_000, percent: 0.5 },
      };
      const live = createExtensionHarness(baseOptions);
      createExtension(live.api);
      await live.emit("session_start", { type: "session_start", reason: "new" });

      const preCompactionRaw: AgentMessage[] = [
        makeUserMessage("older user", 1),
        {
          ...assistantMetadata,
          role: "assistant",
          content: [{ type: "text", text: "older assistant" }],
          stopReason: "stop",
          timestamp: 2,
        } satisfies AgentMessage,
      ];
      await live.emit("context", { type: "context", messages: structuredClone(preCompactionRaw) });
      live.entries.length = 0;

      vi.setSystemTime(1_000);
      preCompactionRaw.push(compressOwner("compress-1", 3));
      const first = (await live.executeTool(
        "compress",
        {
          topic: "older context",
          content: [{ startId: "m0001", endId: "m0002", summary: "older summary" }],
        },
        { toolCallId: "compress-1" },
      )) as { content: Array<{ text: string }> };
      vi.setSystemTime(2_000);
      await live.emit("tool_execution_end", {
        type: "tool_execution_end",
        toolName: "compress",
        toolCallId: "compress-1",
        result: first,
        isError: false,
      });
      const pre = snapshotFrom(live, "pre-compaction checkpoint");
      expect(pre).toMatchObject({
        version: 2,
        ownerSessionId: sessionId,
        nextBlockId: 2,
        nextRunId: 2,
        stats: { messagesCompressed: 2 },
        blocks: [{ blockId: 1, runId: 1 }],
      });
      expect(pre.messageIds.nextRefIndex).toBe(3);

      live.entries.length = 0;
      vi.setSystemTime(3_000);
      live.setBranch([{ ...compactionEntry }]);
      await live.emit("session_compact", {
        type: "session_compact",
        compactionEntry: { ...compactionEntry },
        fromExtension: false,
        reason: "manual",
        willRetry: false,
      });

      expect(live.entries).toHaveLength(1);
      const post = snapshotFrom(live, "post-compaction checkpoint");
      expect(post).toMatchObject({
        version: 2,
        ownerSessionId: sessionId,
        manualMode: false,
        compressPermission: "allow",
        lastCompaction: 3_000,
        stats: { messagesCompressed: 2 },
        blocks: [],
        nextBlockId: 2,
        nextRunId: 2,
      });
      expect(post.messageIds.nextRefIndex).toBe(3);
      expect(post.messageIds.byRawId).toEqual(pre.messageIds.byRawId);
      expect(post.stats).toEqual(pre.stats);

      const postRaw: AgentMessage[] = [
        {
          role: "compactionSummary",
          summary: "compacted summary",
          tokensBefore: 500,
          timestamp: 10,
        } as AgentMessage,
        preCompactionRaw[1] as AgentMessage,
        makeUserMessage("new user", 11),
      ];

      const [liveViewResult] = (await live.emit("context", {
        type: "context",
        messages: structuredClone(postRaw),
      })) as [{ messages: AgentMessage[] }];
      const liveRetained = requireDefined(
        liveViewResult.messages.find((message) =>
          getMessageText(message).includes("older assistant"),
        ),
        "live retained message",
      );
      expect(getMessageText(liveRetained)).toContain("@m2@");
      const liveNew = requireDefined(
        liveViewResult.messages.find((message) => getMessageText(message).includes("new user")),
        "live new message",
      );
      const liveNewMarker = requireDefined(
        getMessageText(liveNew).match(/@m\d+(?::\d+)?@/)?.[0],
        "live new marker",
      );
      expect(liveNewMarker).toBe("@m4@");

      const resumed = createExtensionHarness({
        ...baseOptions,
        branch: [{ type: "custom", customType: "pi-dcp-state", data: post }],
      });
      createExtension(resumed.api);
      await resumed.emit("session_start", { type: "session_start", reason: "resume" });
      const [resumedViewResult] = (await resumed.emit("context", {
        type: "context",
        messages: structuredClone(postRaw),
      })) as [{ messages: AgentMessage[] }];
      expect(resumedViewResult.messages).toEqual(liveViewResult.messages);
      const resumedRetained = requireDefined(
        resumedViewResult.messages.find((message) =>
          getMessageText(message).includes("older assistant"),
        ),
        "resumed retained message",
      );
      expect(getMessageText(resumedRetained)).toContain("@m2@");
      const resumedNew = requireDefined(
        resumedViewResult.messages.find((message) => getMessageText(message).includes("new user")),
        "resumed new message",
      );
      const resumedNewMarker = requireDefined(
        getMessageText(resumedNew).match(/@m\d+(?::\d+)?@/)?.[0],
        "resumed new marker",
      );
      expect(resumedNewMarker).toBe(liveNewMarker);

      vi.setSystemTime(4_000);
      const liveSecond = (await live.executeTool(
        "compress",
        {
          topic: "new context",
          content: [{ startId: liveNewMarker, endId: liveNewMarker, summary: "new summary" }],
        },
        { toolCallId: "compress-2" },
      )) as { content: Array<{ text: string }> };
      const resumedSecond = (await resumed.executeTool(
        "compress",
        {
          topic: "new context",
          content: [{ startId: resumedNewMarker, endId: resumedNewMarker, summary: "new summary" }],
        },
        { toolCallId: "compress-2" },
      )) as { content: Array<{ text: string }> };

      await live.emit("tool_execution_end", {
        type: "tool_execution_end",
        toolName: "compress",
        toolCallId: "compress-2",
        result: liveSecond,
        isError: false,
      });
      const liveRaw2 = [
        ...postRaw,
        compressOwner("compress-2", 12),
        makeToolResultMessage(
          "compress-2",
          "compress",
          liveSecond.content[0]?.text ?? "",
          false,
          13,
        ),
      ];
      const [liveCompressed] = (await live.emit("context", {
        type: "context",
        messages: structuredClone(liveRaw2),
      })) as [{ messages: AgentMessage[] }];

      await resumed.emit("tool_execution_end", {
        type: "tool_execution_end",
        toolName: "compress",
        toolCallId: "compress-2",
        result: resumedSecond,
        isError: false,
      });
      const resumedRaw2 = [
        ...postRaw,
        compressOwner("compress-2", 12),
        makeToolResultMessage(
          "compress-2",
          "compress",
          resumedSecond.content[0]?.text ?? "",
          false,
          13,
        ),
      ];
      const [resumedCompressed] = (await resumed.emit("context", {
        type: "context",
        messages: structuredClone(resumedRaw2),
      })) as [{ messages: AgentMessage[] }];
      expect(resumedCompressed.messages).toEqual(liveCompressed.messages);
      const compressedText = liveCompressed.messages.map(getMessageText).join("\n");
      expect(compressedText).toContain("[Compressed Block b2]");
      expect(compressedText).toContain("new summary");
      expect(compressedText).toContain("older assistant");
      expect(compressedText).not.toContain("new user");

      const liveFinal = snapshotFrom(live, "live final checkpoint");
      const resumedFinal = snapshotFrom(resumed, "resumed final checkpoint");
      expect(liveFinal).toMatchObject({
        nextBlockId: 3,
        nextRunId: 3,
        blocks: [{ blockId: 2, runId: 2 }],
      });
      expect(resumedFinal).toMatchObject({
        nextBlockId: 3,
        nextRunId: 3,
        blocks: [{ blockId: 2, runId: 2 }],
      });
      expect(resumedFinal.blocks).toEqual(liveFinal.blocks);
      expect(resumedFinal.stats).toEqual(liveFinal.stats);
    } finally {
      vi.useRealTimers();
    }
  });
});
