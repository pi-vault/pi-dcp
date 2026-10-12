import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import createExtension from "../src/index.ts";
import { PromptStore } from "../src/prompts/store.ts";
import { createSessionState } from "../src/state/state.ts";
import { serializeDcpSnapshot } from "../src/state/persistence.ts";
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
      expect(getMessageText(raw[0])).toContain("older user");

      const checkpoint = harness.entries
        .filter((entry) => entry.customType === "pi-dcp-state")
        .at(-1)?.data as
        | {
            version?: number;
            ownerSessionId?: string;
            nextBlockId?: number;
            nextRunId?: number;
            stats?: { messagesCompressed?: number };
          }
        | undefined;
      expect(checkpoint).toMatchObject({ version: 2, ownerSessionId: "harness-session" });
      const before = {
        nextBlockId: checkpoint?.nextBlockId,
        nextRunId: checkpoint?.nextRunId,
        messagesCompressed: checkpoint?.stats?.messagesCompressed,
      };

      await harness.runCommand("dcp:decompress", "1");
      const [restoredPass] = (await harness.emit("context", {
        type: "context",
        messages: [...raw],
      })) as [{ messages: AgentMessage[] }];
      expect(restoredPass.messages.map(getMessageText).join("\n")).toContain("older assistant");

      await harness.runCommand("dcp:recompress", "1");
      const [recompressedPass] = (await harness.emit("context", {
        type: "context",
        messages: [...raw],
      })) as [{ messages: AgentMessage[] }];
      expect(recompressedPass.messages.map(getMessageText).join("\n")).toContain("older summary");

      const afterCheckpoint = harness.entries
        .filter((entry) => entry.customType === "pi-dcp-state")
        .at(-1)?.data as
        | {
            nextBlockId?: number;
            nextRunId?: number;
            stats?: { messagesCompressed?: number };
          }
        | undefined;
      expect(afterCheckpoint?.nextBlockId).toBe(before.nextBlockId);
      expect(afterCheckpoint?.nextRunId).toBe(before.nextRunId);
      expect(afterCheckpoint?.stats?.messagesCompressed).toBe(before.messagesCompressed);
    },
  );
});
