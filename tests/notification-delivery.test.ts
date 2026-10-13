import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";
import * as blocksModule from "../src/compress/blocks.ts";
import { createExtensionHarness } from "./extension-harness.ts";
import { makeUserMessage } from "./helpers.ts";

const agentDir = `${os.tmpdir()}/dcp-notification-delivery-${Date.now()}-${Math.random()}`;
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

const contextUsage = { tokens: 1000, contextWindow: 200_000, percent: 0.5 };

function compressionHistory(): AgentMessage[] {
  return [
    makeUserMessage("old user", 1),
    {
      ...assistantMetadata,
      role: "assistant",
      content: [{ type: "text", text: "old assistant" }],
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
}

function duplicateToolHistory(count: number, resultText = "x".repeat(400)): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push(makeUserMessage(`turn ${i}`, i * 10 + 1));
    messages.push({
      ...assistantMetadata,
      role: "assistant",
      content: [
        { type: "toolCall", id: `call-${i}`, name: "glob", arguments: { pattern: "**/*.ts" } },
      ],
      stopReason: "toolUse",
      timestamp: i * 10 + 2,
    } satisfies AgentMessage);
    messages.push({
      role: "toolResult",
      toolCallId: `call-${i}`,
      toolName: "glob",
      content: [{ type: "text", text: resultText }],
      isError: false,
      nestedCalls: { calls: [], complete: true },
      timestamp: i * 10 + 3,
    } satisfies AgentMessage);
  }
  return messages;
}

async function compressionHarness(config: unknown, hasUI = true) {
  writeConfig(config);
  const harness = createExtensionHarness({
    activeTools: ["read", "compress"],
    hasUI,
    contextUsage,
  });
  createExtension(harness.api);
  await harness.emit("session_start", { type: "session_start", reason: "new" });
  return harness;
}

beforeEach(() => {
  process.env.PI_CODING_AGENT_DIR = agentDir;
  fs.mkdirSync(agentDir, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(agentDir, { recursive: true, force: true });
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
});

describe("compression notification delivery matrix", () => {
  const cases = [
    { mode: "range", verbosity: "minimal", type: "toast", showCompression: false },
    { mode: "range", verbosity: "minimal", type: "toast", showCompression: true },
    { mode: "range", verbosity: "detailed", type: "toast", showCompression: false },
    { mode: "range", verbosity: "detailed", type: "toast", showCompression: true },
    { mode: "range", verbosity: "minimal", type: "status", showCompression: false },
    { mode: "range", verbosity: "minimal", type: "status", showCompression: true },
    { mode: "range", verbosity: "detailed", type: "status", showCompression: false },
    { mode: "range", verbosity: "detailed", type: "status", showCompression: true },
    { mode: "message", verbosity: "minimal", type: "toast", showCompression: false },
    { mode: "message", verbosity: "minimal", type: "toast", showCompression: true },
    { mode: "message", verbosity: "detailed", type: "toast", showCompression: false },
    { mode: "message", verbosity: "detailed", type: "toast", showCompression: true },
    { mode: "message", verbosity: "minimal", type: "status", showCompression: false },
    { mode: "message", verbosity: "minimal", type: "status", showCompression: true },
    { mode: "message", verbosity: "detailed", type: "status", showCompression: false },
    { mode: "message", verbosity: "detailed", type: "status", showCompression: true },
  ] as const;

  it.each(cases)(
    "$type $verbosity $mode (showCompression=$showCompression) uses exactly one transport",
    async ({ mode, verbosity, type, showCompression }) => {
      const harness = await compressionHarness({
        nudgeNotification: verbosity,
        nudgeNotificationType: type,
        compress: { mode, showCompression },
      });

      await harness.emit("context", { type: "context", messages: compressionHistory() });
      harness.ui.notify.mockClear();
      harness.ui.setStatus.mockClear();

      const args =
        mode === "range"
          ? {
              topic: "  Auth\r\n system ",
              content: [{ startId: "m0001", endId: "m0001", summary: "s" }],
            }
          : { topic: "  Auth\r\n system ", targets: [{ messageId: "m0001", summary: "s" }] };
      await harness.executeTool("compress", args, { toolCallId: "compress-1" });

      const chosen = type === "toast" ? harness.ui.notify : harness.ui.setStatus;
      const other = type === "toast" ? harness.ui.setStatus : harness.ui.notify;
      expect(chosen).toHaveBeenCalledTimes(1);
      expect(other).not.toHaveBeenCalled();
      if (type === "toast") {
        expect(harness.ui.notify).toHaveBeenCalledWith(expect.any(String), "info");
      } else {
        expect(harness.ui.setStatus).toHaveBeenCalledWith("dcp", expect.any(String));
      }

      const message = type === "toast" ? chosen.mock.calls[0]?.[0] : chosen.mock.calls[0]?.[1];
      expect(typeof message).toBe("string");
      const text = message as string;

      if (verbosity === "detailed" && type === "toast") {
        expect(text).toContain("\nTopic: Auth system");
        if (showCompression) expect(text).toContain("\nSummary (");
        else expect(text).not.toContain("Summary (");
        return;
      }

      expect(text).toMatch(/^DCP · compressed ~[\d.]+k? tokens? · summary ~[\d.]+k? · 1 message$/);
      expect(text).not.toContain("\r");
      expect(text).not.toContain("\n");
      expect(text).not.toContain("Topic:");
      expect(text).not.toContain("Summary (");
      expect(text).not.toContain("Auth");
    },
  );

  it("detailed toast retains the combined multiline summary for multiple blocks", async () => {
    const harness = await compressionHarness({
      nudgeNotification: "detailed",
      nudgeNotificationType: "toast",
      compress: { mode: "range", showCompression: true },
    });

    await harness.emit("context", { type: "context", messages: compressionHistory() });
    harness.ui.notify.mockClear();

    await harness.executeTool(
      "compress",
      {
        topic: "Auth system",
        content: [
          { startId: "m0001", endId: "m0002", summary: "first summary" },
          { startId: "m0003", endId: "m0004", summary: "second summary" },
        ],
      },
      { toolCallId: "compress-1" },
    );

    expect(harness.ui.notify).toHaveBeenCalledTimes(1);
    const text = harness.ui.notify.mock.calls[0]?.[0] as string;
    expect(text).toContain("Summary (");
    expect(text).toContain("first summary\n\nsecond summary");
  });

  it("detailed toast omits summary text when showCompression is false", async () => {
    const harness = await compressionHarness({
      nudgeNotification: "detailed",
      nudgeNotificationType: "toast",
      compress: { mode: "range", showCompression: false },
    });

    await harness.emit("context", { type: "context", messages: compressionHistory() });
    harness.ui.notify.mockClear();

    await harness.executeTool(
      "compress",
      { topic: "Auth system", content: [{ startId: "m0001", endId: "m0001", summary: "s" }] },
      { toolCallId: "compress-1" },
    );

    const text = harness.ui.notify.mock.calls[0]?.[0] as string;
    expect(text).toContain("Topic: Auth system");
    expect(text).not.toContain("Summary (");
  });
});

describe("automatic delivery suppression", () => {
  it("does not deliver compression notifications without UI", async () => {
    writeConfig({
      nudgeNotification: "detailed",
      nudgeNotificationType: "toast",
      compress: { mode: "range" },
    });
    const harness = createExtensionHarness({
      activeTools: ["read", "compress"],
      hasUI: false,
      contextUsage,
    });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });

    await harness.emit("context", { type: "context", messages: compressionHistory() });
    await harness.executeTool(
      "compress",
      { topic: "Auth", content: [{ startId: "m0001", endId: "m0001", summary: "s" }] },
      { toolCallId: "compress-1" },
    );

    expect(harness.ui.notify).not.toHaveBeenCalled();
    expect(harness.ui.setStatus).not.toHaveBeenCalled();
  });

  it("does not deliver compression notifications when nudgeNotification is off", async () => {
    const harness = await compressionHarness({
      nudgeNotification: "off",
      nudgeNotificationType: "toast",
      compress: { mode: "range" },
    });

    await harness.emit("context", { type: "context", messages: compressionHistory() });
    harness.ui.notify.mockClear();
    harness.ui.setStatus.mockClear();

    await harness.executeTool(
      "compress",
      { topic: "Auth", content: [{ startId: "m0001", endId: "m0001", summary: "s" }] },
      { toolCallId: "compress-1" },
    );

    expect(harness.ui.notify).not.toHaveBeenCalled();
    expect(harness.ui.setStatus).not.toHaveBeenCalled();
  });

  it("produces no UI call for a zero-message compression result", async () => {
    const harness = await compressionHarness({
      nudgeNotification: "detailed",
      nudgeNotificationType: "toast",
      compress: { mode: "range" },
    });
    vi.spyOn(blocksModule, "handleCompress").mockReturnValue({
      text: "Compressed 0 messages.",
      messagesCompressed: 0,
      compressedTokens: 0,
      summaryTokens: 0,
      blockIds: [],
      topic: "Auth",
    });

    await harness.emit("context", { type: "context", messages: compressionHistory() });
    harness.ui.notify.mockClear();
    harness.ui.setStatus.mockClear();

    await harness.executeTool(
      "compress",
      { topic: "Auth", content: [{ startId: "m0001", endId: "m0001", summary: "s" }] },
      { toolCallId: "compress-1" },
    );

    expect(harness.ui.notify).not.toHaveBeenCalled();
    expect(harness.ui.setStatus).not.toHaveBeenCalled();
  });

  it("does not deliver notifications for a clean pruning pass", async () => {
    const harness = await compressionHarness({
      nudgeNotification: "detailed",
      nudgeNotificationType: "toast",
    });

    harness.ui.notify.mockClear();
    harness.ui.setStatus.mockClear();
    await harness.emit("context", {
      type: "context",
      messages: [makeUserMessage("hello", 1)],
    });

    expect(harness.ui.notify).not.toHaveBeenCalled();
    expect(harness.ui.setStatus).not.toHaveBeenCalled();
  });
});

describe("pruning notification delivery", () => {
  it.each([
    {
      verbosity: "minimal",
      type: "status",
      expected: "DCP · saved ~100 tokens · pruned 1 output",
    },
    {
      verbosity: "detailed",
      type: "toast",
      expected: "DCP · saved ~100 tokens · pruned 1 output\nPruned: glob",
    },
  ] as const)("delivers $verbosity pruning via $type", async ({ verbosity, type, expected }) => {
    const harness = await compressionHarness({
      nudgeNotification: verbosity,
      nudgeNotificationType: type,
    });
    harness.ui.notify.mockClear();
    harness.ui.setStatus.mockClear();

    await harness.emit("context", { type: "context", messages: duplicateToolHistory(2) });

    if (type === "toast") {
      expect(harness.ui.notify).toHaveBeenCalledExactlyOnceWith(expected, "info");
      expect(harness.ui.setStatus).not.toHaveBeenCalled();
    } else {
      expect(harness.ui.setStatus).toHaveBeenCalledExactlyOnceWith("dcp", expected);
      expect(harness.ui.notify).not.toHaveBeenCalled();
    }
  });

  it.each([
    { verbosity: "off", hasUI: true, type: "toast" },
    { verbosity: "off", hasUI: true, type: "status" },
    { verbosity: "detailed", hasUI: false, type: "toast" },
    { verbosity: "detailed", hasUI: false, type: "status" },
  ] as const)(
    "prunes without $type feedback when verbosity=$verbosity and hasUI=$hasUI",
    async ({ verbosity, hasUI, type }) => {
      const harness = await compressionHarness(
        { nudgeNotification: verbosity, nudgeNotificationType: type },
        hasUI,
      );
      harness.ui.notify.mockClear();
      harness.ui.setStatus.mockClear();

      await harness.emit("context", { type: "context", messages: duplicateToolHistory(2) });

      expect(harness.entries.at(-1)?.data).toMatchObject({
        stats: { totalPruneTokens: 100, toolsPruned: 1 },
      });
      expect(harness.ui.notify).not.toHaveBeenCalled();
      expect(harness.ui.setStatus).not.toHaveBeenCalled();
    },
  );
});

describe("pruning notification provenance", () => {
  it("toast stays per-pass while status stays cumulative", async () => {
    const toast = await compressionHarness({
      nudgeNotification: "minimal",
      nudgeNotificationType: "toast",
    });

    await toast.emit("context", { type: "context", messages: duplicateToolHistory(2) });
    expect(toast.ui.notify).toHaveBeenLastCalledWith(
      "DCP · saved ~100 tokens · pruned 1 output",
      "info",
    );
    expect(toast.ui.setStatus).not.toHaveBeenCalled();

    toast.ui.notify.mockClear();
    await toast.emit("context", { type: "context", messages: duplicateToolHistory(3) });
    expect(toast.ui.notify).toHaveBeenLastCalledWith(
      "DCP · saved ~100 tokens · pruned 1 output",
      "info",
    );
    // Repeating the unchanged second context emits no toast.
    toast.ui.notify.mockClear();
    await toast.emit("context", { type: "context", messages: duplicateToolHistory(3) });
    expect(toast.ui.notify).not.toHaveBeenCalled();
  });

  it("status refreshes cumulatively including a repeated context", async () => {
    const status = await compressionHarness({
      nudgeNotification: "detailed",
      nudgeNotificationType: "status",
    });

    await status.emit("context", { type: "context", messages: duplicateToolHistory(2) });
    expect(status.ui.setStatus).toHaveBeenLastCalledWith(
      "dcp",
      "DCP · saved ~100 tokens · pruned 1 output",
    );

    status.ui.setStatus.mockClear();
    await status.emit("context", { type: "context", messages: duplicateToolHistory(3) });
    expect(status.ui.setStatus).toHaveBeenLastCalledWith(
      "dcp",
      "DCP · saved ~200 tokens · pruned 2 outputs",
    );

    status.ui.setStatus.mockClear();
    await status.emit("context", { type: "context", messages: duplicateToolHistory(3) });
    expect(status.ui.setStatus).toHaveBeenLastCalledWith(
      "dcp",
      "DCP · saved ~200 tokens · pruned 2 outputs",
    );
    expect(status.ui.notify).not.toHaveBeenCalled();
  });

  it("reports a pruned empty output as zero savings without a zero-savings status", async () => {
    const toast = await compressionHarness({
      nudgeNotification: "minimal",
      nudgeNotificationType: "toast",
    });
    await toast.emit("context", { type: "context", messages: duplicateToolHistory(2, "") });
    expect(toast.ui.notify).toHaveBeenLastCalledWith(
      "DCP · saved ~0 tokens · pruned 1 output",
      "info",
    );

    const status = await compressionHarness({
      nudgeNotification: "minimal",
      nudgeNotificationType: "status",
    });
    await status.emit("context", { type: "context", messages: duplicateToolHistory(2, "") });
    expect(status.ui.setStatus).not.toHaveBeenCalled();
  });
});
