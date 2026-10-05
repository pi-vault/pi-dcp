import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import createExtension from "../src/index.ts";
import { PromptStore } from "../src/prompts/store.ts";
import { createSessionState } from "../src/state/state.ts";
import { serializeDcpSnapshot } from "../src/state/persistence.ts";
import { createExtensionHarness, declaredLoadoutMessage } from "./extension-harness.ts";

const agentDir = `${os.tmpdir()}/dcp-pi-contract-${Date.now()}-${Math.random()}`;
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

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
    expect(harness.activeTools()).toEqual(["read"]);

    harness.setModel({ provider: "test", id: "test-model" });
    await harness.emit("model_select", {
      type: "model_select",
      model: { provider: "test", id: "test-model" } as never,
      previousModel: undefined,
      source: "set",
    });
    expect(harness.activeTools()).toEqual(["read"]);

    harness.setModel({ provider: "test", id: "allowed-model" });
    await harness.emit("model_select", {
      type: "model_select",
      model: { provider: "test", id: "allowed-model" } as never,
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
      model: { provider: "test", id: "test-model" } as never,
      previousModel: undefined,
      source: "set",
    });
    expect(harness.activeTools()).toEqual(["read"]);

    harness.setModel({ provider: "test", id: "allowed-model" });
    await harness.emit("model_select", {
      type: "model_select",
      model: { provider: "test", id: "allowed-model" } as never,
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

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "find" }], timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "glob", arguments: { pattern: "**/*.ts" } }],
        stopReason: "toolUse",
        timestamp: 2,
      } as unknown as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "glob",
        content: [{ type: "text", text: "same output" }],
        isError: false,
        timestamp: 3,
      } as unknown as AgentMessage,
      { role: "user", content: [{ type: "text", text: "again" }], timestamp: 4 },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c2", name: "glob", arguments: { pattern: "**/*.ts" } }],
        stopReason: "toolUse",
        timestamp: 5,
      } as unknown as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "c2",
        toolName: "glob",
        content: [{ type: "text", text: "same output" }],
        isError: false,
        timestamp: 6,
      } as unknown as AgentMessage,
    ];

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
          { role: "assistant", content: [{ type: "text", text: "two" }], timestamp: 2 },
        ] as AgentMessage[],
      });
      harness.entries.length = 0;

      vi.setSystemTime(1_000);
      await harness.emit("tool_execution_start", {
        type: "tool_execution_start",
        toolName: "compress",
        toolCallId: "harness-call",
        args: {},
      });
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

  it("captures custom prompt edits at the start of a run", async () => {
    writeConfig({ experimental: { customPrompts: true } });
    const overrideDir = path.join(agentDir, "extensions", "dcp-prompts", "overrides");
    fs.mkdirSync(overrideDir, { recursive: true });
    fs.writeFileSync(path.join(overrideDir, "system.md"), "First prompt");

    const harness = createExtensionHarness({ activeTools: ["read"] });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });

    const first = systemPromptEvent();
    await harness.emit("before_agent_start", { type: "before_agent_start", prompt: "a", ...first });
    expect(first.systemPromptOptions.sections.dcp).toBe("First prompt");

    fs.writeFileSync(path.join(overrideDir, "system.md"), "Second prompt");
    const second = systemPromptEvent();
    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "b",
      ...second,
    });
    expect(second.systemPromptOptions.sections.dcp).toBe("Second prompt");
  });
});
