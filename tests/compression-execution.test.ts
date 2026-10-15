import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  createCompressionExecution,
  type CompressionExecutionDependencies,
} from "../src/compress/execution.ts";
import { createCompressionBlockState } from "../src/compress/blocks.ts";
import { createSessionState } from "../src/state/state.ts";
import type { CompressionBlock, MessageIdState, SessionState } from "../src/state/types.ts";
import { createExtensionHarness, createHarnessModel } from "./extension-harness.ts";
import { makeAssistantMessage, makeDefaultConfig, makeUserMessage } from "./helpers.ts";

function assignRefs(state: SessionState, count: number): void {
  for (let index = 0; index < count; index++) {
    const ref = `m${String(index + 1).padStart(4, "0")}`;
    state.messageIds.byIndex.set(index, ref);
    state.messageIds.byRef.set(ref, `message:${index}`);
  }
}

function freshMessageIds(count: number): MessageIdState {
  const byRef = new Map<string, string>();
  const byIndex = new Map<number, string>();
  for (let index = 0; index < count; index++) {
    const ref = `m${String(index + 1).padStart(4, "0")}`;
    byIndex.set(index, ref);
    byRef.set(ref, `message:${index}`);
  }
  return { byRawId: new Map(), byRef, byIndex, nextRefIndex: count + 1 };
}

function buildMessages(): AgentMessage[] {
  return [
    makeUserMessage("hello", 1),
    makeAssistantMessage("hi", 2),
    makeUserMessage("do stuff", 3),
    makeAssistantMessage("done", 4),
  ];
}

function validRange(startId = "m0001", endId = "m0002") {
  return { topic: "topic", content: [{ startId, endId, summary: "summary" }] };
}

function installBlock(
  state: SessionState,
  blockId: number,
  compressToolCallId: string,
  durationMs: number,
  overrides: Partial<CompressionBlock> = {},
): CompressionBlock {
  const block: CompressionBlock = {
    blockId,
    runId: 1,
    active: true,
    deactivatedByUser: false,
    compressedTokens: 10,
    summaryTokens: 2,
    durationMs,
    mode: "range",
    topic: "topic",
    batchTopic: undefined,
    startIndex: 0,
    endIndex: 0,
    anchorIndex: 0,
    compressToolCallId,
    startKey: `start-${blockId}`,
    endKey: `end-${blockId}`,
    anchorKey: `anchor-${blockId}`,
    consumedBlockIds: [],
    parentBlockIds: [],
    directMessageIndices: [],
    directToolIds: [],
    effectiveMessageIndices: [],
    effectiveToolIds: [],
    createdAt: blockId,
    deactivatedAt: undefined,
    deactivatedByBlockId: undefined,
    summary: "summary",
    ...overrides,
  };
  state.prune.messages.blocksById.set(blockId, block);
  return block;
}

function executionFor(
  state: SessionState,
  overrides: Partial<CompressionExecutionDependencies> = {},
) {
  const persist = vi.fn();
  const onCompressed = vi.fn();
  const execution = createCompressionExecution({
    state,
    config: makeDefaultConfig(),
    getMessages: () => [],
    onCompressed,
    persist,
    now: () => 0,
    ...overrides,
  });
  return { execution, persist, onCompressed };
}

describe("createCompressionExecution policy", () => {
  const reasons = [
    {
      reason: "config",
      tool: "Compression is disabled by configuration.",
      exec: "Compression is disabled by configuration.",
      configure: (config: ReturnType<typeof makeDefaultConfig>, _state: SessionState) => {
        config.enabled = false;
      },
    },
    {
      reason: "model",
      tool: "Compression is disabled for the current model",
      exec: "Compression is disabled for the current model.",
      configure: (config: ReturnType<typeof makeDefaultConfig>, _state: SessionState) => {
        config.disabledModels = ["test/test-model"];
      },
    },
    {
      reason: "subagent",
      tool: "Compression is disabled in sub-agent sessions.",
      exec: "Compression is disabled in sub-agent sessions.",
      configure: (_config: ReturnType<typeof makeDefaultConfig>, state: SessionState) => {
        state.isSubAgent = true;
      },
    },
    {
      reason: "permission",
      tool: "Compression denied by configuration",
      exec: "Compression is denied by configuration.",
      configure: (_config: ReturnType<typeof makeDefaultConfig>, state: SessionState) => {
        state.compressPermission = "deny";
      },
    },
  ] as const;

  it.each(reasons)(
    "rejects $reason with distinct tool-call and execution messages",
    async ({ reason, tool, exec, configure }) => {
      const state = createSessionState();
      const config = makeDefaultConfig();
      configure(config, state);
      const harness = createExtensionHarness({
        hasUI: true,
        model: { provider: "test", id: "test-model" },
      });
      const { execution, persist } = executionFor(state, { config });

      expect(execution.checkToolCall(harness.context)).toEqual({ block: true, reason: tool });
      await expect(
        execution.execute("range", "call", validRange(), harness.context),
      ).resolves.toEqual({ status: "rejected", message: exec });
      expect(state.compressionTiming.startTimes.size).toBe(0);
      expect(state.prune.messages.blocksById.size).toBe(0);
      expect(persist).not.toHaveBeenCalled();
      expect(reason).toBeDefined();
    },
  );

  it("orders rejection reasons config, model, subagent, permission", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.enabled = false;
    config.disabledModels = ["test/test-model"];
    state.isSubAgent = true;
    state.compressPermission = "deny";
    const harness = createExtensionHarness({
      hasUI: true,
      model: { provider: "test", id: "test-model" },
    });
    const { execution } = executionFor(state, { config });

    expect(execution.checkToolCall(harness.context)).toEqual({
      block: true,
      reason: "Compression is disabled by configuration.",
    });
  });

  it("falls back to stored model identity when the context has no model", () => {
    const state = createSessionState();
    state.modelProvider = "test";
    state.modelId = "test-model";
    const config = makeDefaultConfig();
    config.disabledModels = ["test/test-model"];
    const { execution } = executionFor(state, { config });

    expect(execution.checkToolCall({ model: undefined })).toEqual({
      block: true,
      reason: "Compression is disabled for the current model",
    });
  });

  it("does not treat manual mode or tool selection as policy suppression", () => {
    const state = createSessionState();
    state.manualMode = "active";
    const harness = createExtensionHarness({ hasUI: true });
    const setActiveTools = vi.spyOn(harness.api, "setActiveTools");
    const { execution } = executionFor(state);

    expect(execution.checkToolCall(harness.context)).toBeUndefined();
    expect(setActiveTools).not.toHaveBeenCalled();
  });
});

describe("createCompressionExecution execution", () => {
  it("compresses a range against live messages", async () => {
    const state = createSessionState();
    assignRefs(state, 4);
    const messages = buildMessages();
    const harness = createExtensionHarness({ hasUI: true });
    const { execution, persist, onCompressed } = executionFor(state, {
      getMessages: () => messages,
      now: () => 1_000,
    });

    const outcome = await execution.execute("range", "call", validRange(), harness.context);

    expect(outcome.status).toBe("compressed");
    if (outcome.status !== "compressed") throw new Error("expected compression");
    expect(outcome.result.messagesCompressed).toBe(2);
    expect(onCompressed).toHaveBeenCalledTimes(1);
    expect(onCompressed).toHaveBeenCalledWith(outcome.result, harness.context);
    expect(state.compressionTiming.startTimes.get("call")).toBe(1_000);
    expect(persist).not.toHaveBeenCalled();
  });

  it("compresses message targets against live messages", async () => {
    const state = createSessionState();
    assignRefs(state, 4);
    const messages = buildMessages();
    const harness = createExtensionHarness({ hasUI: true });
    const { execution } = executionFor(state, { getMessages: () => messages });

    const outcome = await execution.execute(
      "message",
      "call",
      { topic: "topic", targets: [{ messageId: "m0001", summary: "summary" }] },
      harness.context,
    );

    expect(outcome.status).toBe("compressed");
    if (outcome.status !== "compressed") throw new Error("expected compression");
    expect(outcome.result.messagesCompressed).toBe(1);
  });

  it("requests native approval for every ask call", async () => {
    const state = createSessionState();
    assignRefs(state, 4);
    const messages = buildMessages();
    const harness = createExtensionHarness({ hasUI: true });
    harness.ui.confirm.mockResolvedValue(true);
    const config = makeDefaultConfig({ permission: "ask" });
    const { execution } = executionFor(state, { config, getMessages: () => messages });

    await execution.execute(
      "range",
      "c1",
      { topic: "topic", content: [{ startId: "m0001", endId: "m0001", summary: "s" }] },
      harness.context,
    );
    await execution.execute(
      "range",
      "c2",
      { topic: "topic", content: [{ startId: "m0002", endId: "m0002", summary: "s" }] },
      harness.context,
    );

    expect(harness.ui.confirm).toHaveBeenCalledTimes(2);
  });

  it("returns the approval adapter denial text unchanged", async () => {
    const state = createSessionState();
    assignRefs(state, 4);
    const harness = createExtensionHarness({ hasUI: true });
    harness.ui.confirm.mockResolvedValue(false);
    const config = makeDefaultConfig({ permission: "ask" });
    const { execution, persist, onCompressed } = executionFor(state, {
      config,
      getMessages: () => buildMessages(),
    });

    await expect(
      execution.execute("range", "call", validRange("m0001", "m0001"), harness.context),
    ).resolves.toEqual({ status: "rejected", message: "Compression was not approved" });
    expect(state.compressionTiming.startTimes.size).toBe(0);
    expect(state.prune.messages.blocksById.size).toBe(0);
    expect(onCompressed).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("fails closed when the mode cannot render dialogs", async () => {
    const state = createSessionState();
    assignRefs(state, 4);
    const harness = createExtensionHarness({ hasUI: false, mode: "json" });
    const config = makeDefaultConfig({ permission: "ask" });
    const { execution } = executionFor(state, {
      config,
      getMessages: () => buildMessages(),
    });

    await expect(
      execution.execute("range", "call", validRange("m0001", "m0001"), harness.context),
    ).resolves.toEqual({
      status: "rejected",
      message: "Compression requires interactive approval",
    });
    expect(harness.ui.confirm).not.toHaveBeenCalled();
  });

  it("rejects when the effective signal aborts during confirmation", async () => {
    const state = createSessionState();
    assignRefs(state, 4);
    const harness = createExtensionHarness({ hasUI: true });
    const controller = new AbortController();
    harness.ui.confirm.mockImplementation(async () => {
      controller.abort();
      return true;
    });
    const config = makeDefaultConfig({ permission: "ask" });
    const { execution, persist } = executionFor(state, {
      config,
      getMessages: () => buildMessages(),
    });

    await expect(
      execution.execute(
        "range",
        "call",
        validRange("m0001", "m0001"),
        harness.context,
        controller.signal,
      ),
    ).resolves.toEqual({ status: "rejected", message: "Compression was not approved" });
    expect(state.compressionTiming.startTimes.size).toBe(0);
    expect(state.prune.messages.blocksById.size).toBe(0);
    expect(persist).not.toHaveBeenCalled();
  });

  it("rechecks fresh policy after approval", async () => {
    const state = createSessionState();
    assignRefs(state, 4);
    const harness = createExtensionHarness({
      hasUI: true,
      model: { provider: "test", id: "test-model" },
    });
    harness.ui.confirm.mockImplementation(async () => {
      harness.setModel({ provider: "test", id: "disabled-model" });
      return true;
    });
    const config = makeDefaultConfig({ permission: "ask" });
    config.disabledModels = ["test/disabled-model"];
    const { execution, persist } = executionFor(state, {
      config,
      getMessages: () => buildMessages(),
    });

    await expect(
      execution.execute("range", "call", validRange("m0001", "m0001"), harness.context),
    ).resolves.toEqual({
      status: "rejected",
      message: "Compression is disabled for the current model.",
    });
    expect(state.compressionTiming.startTimes.size).toBe(0);
    expect(persist).not.toHaveBeenCalled();
  });

  it("preserves live context model getters across approval", async () => {
    const state = createSessionState();
    assignRefs(state, 4);
    const harness = createExtensionHarness({ hasUI: true });
    const base = harness.context;
    let liveModel = createHarnessModel({ provider: "test", id: "test-model" });
    const ctx = Object.create(base, {
      model: { get: () => liveModel, configurable: true, enumerable: true },
    }) as ExtensionContext;
    harness.ui.confirm.mockImplementation(async () => {
      liveModel = createHarnessModel({ provider: "test", id: "disabled-model" });
      return true;
    });
    const config = makeDefaultConfig({ permission: "ask" });
    config.disabledModels = ["test/disabled-model"];
    const { execution, persist, onCompressed } = executionFor(state, {
      config,
      getMessages: () => buildMessages(),
    });

    await expect(
      execution.execute("range", "call", validRange("m0001", "m0001"), ctx),
    ).resolves.toEqual({
      status: "rejected",
      message: "Compression is disabled for the current model.",
    });
    expect(state.compressionTiming.startTimes.size).toBe(0);
    expect(state.prune.messages.blocksById.size).toBe(0);
    expect(onCompressed).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("reads live config, nested state, and messages after approval waits", async () => {
    const state = createSessionState();
    assignRefs(state, 4);
    let currentMessages = buildMessages();
    const oldBlocks = state.prune.messages;
    const harness = createExtensionHarness({ hasUI: true });
    const config = makeDefaultConfig({ permission: "ask" });
    const { execution } = executionFor(state, {
      config,
      getMessages: () => currentMessages,
    });

    const replacementMessages = [
      makeUserMessage("fresh message text", 1),
      makeAssistantMessage("fresh reply", 2),
      makeUserMessage("front", 3),
      makeAssistantMessage("back", 4),
    ];
    harness.ui.confirm.mockImplementation(async () => {
      state.prune.messages = createCompressionBlockState();
      state.messageIds = freshMessageIds(4);
      currentMessages = replacementMessages;
      config.compress.protectUserMessages = true;
      return true;
    });

    const outcome = await execution.execute(
      "range",
      "call",
      validRange("m0001", "m0002"),
      harness.context,
    );

    expect(outcome.status).toBe("compressed");
    expect(state.prune.messages.blocksById.size).toBe(1);
    expect(oldBlocks.blocksById.size).toBe(0);
    const block = [...state.prune.messages.blocksById.values()][0];
    expect(block?.summary).toContain("fresh message text");
    expect(block?.summary).toContain("[Protected User Message]");
  });

  it("uses the explicit signal before the context signal", async () => {
    const state = createSessionState();
    assignRefs(state, 4);
    const harness = createExtensionHarness({ hasUI: true });
    const contextController = new AbortController();
    const callController = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    harness.ui.confirm.mockImplementation(async (_title, _message, options) => {
      receivedSignal = options?.signal;
      contextController.abort();
      return true;
    });
    const config = makeDefaultConfig({ permission: "ask" });
    const { execution } = executionFor(state, {
      config,
      getMessages: () => buildMessages(),
    });
    const ctx = { ...harness.context, signal: contextController.signal };

    const outcome = await execution.execute(
      "range",
      "call",
      validRange("m0001", "m0001"),
      ctx,
      callController.signal,
    );

    expect(receivedSignal).toBe(callController.signal);
    expect(outcome.status).toBe("compressed");
  });

  it("falls back to the context signal when no call signal is supplied", async () => {
    const state = createSessionState();
    assignRefs(state, 4);
    const harness = createExtensionHarness({ hasUI: true });
    const contextController = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    harness.ui.confirm.mockImplementation(async (_title, _message, options) => {
      receivedSignal = options?.signal;
      contextController.abort();
      return true;
    });
    const config = makeDefaultConfig({ permission: "ask" });
    const { execution } = executionFor(state, {
      config,
      getMessages: () => buildMessages(),
    });
    const ctx = { ...harness.context, signal: contextController.signal };

    await expect(
      execution.execute("range", "call", validRange("m0001", "m0001"), ctx),
    ).resolves.toEqual({ status: "rejected", message: "Compression was not approved" });
    expect(receivedSignal).toBe(contextController.signal);
  });

  it("resolves the default clock at operation time", async () => {
    const state = createSessionState();
    assignRefs(state, 4);
    const harness = createExtensionHarness({ hasUI: true });
    const { execution } = executionFor(state, {
      getMessages: () => buildMessages(),
      now: undefined,
    });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_234);
    try {
      await execution.execute("range", "call", validRange("m0001", "m0001"), harness.context);
      expect(state.compressionTiming.startTimes.get("call")).toBe(1_234);
    } finally {
      now.mockRestore();
    }
  });

  it("propagates compression errors without timing cleanup or a checkpoint", async () => {
    const state = createSessionState();
    assignRefs(state, 4);
    const messages = buildMessages();
    const harness = createExtensionHarness({ hasUI: true });
    const { execution, persist, onCompressed } = executionFor(state, {
      getMessages: () => messages,
    });

    await expect(
      execution.execute("range", "call", validRange("invalid", "m0001"), harness.context),
    ).rejects.toThrow();
    expect(state.compressionTiming.startTimes.has("call")).toBe(true);
    expect(persist).not.toHaveBeenCalled();
    expect(onCompressed).not.toHaveBeenCalled();

    // The later error end still clears timing and requests one checkpoint.
    execution.complete({ toolCallId: "call", toolName: "compress", isError: true });
    expect(state.compressionTiming.startTimes.has("call")).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("preserves block writes and propagates a notification error", async () => {
    const state = createSessionState();
    assignRefs(state, 4);
    const messages = buildMessages();
    const harness = createExtensionHarness({ hasUI: true });
    const failure = new Error("notification failed");
    const { execution, persist } = executionFor(state, {
      getMessages: () => messages,
      onCompressed: () => {
        throw failure;
      },
    });

    await expect(execution.execute("range", "call", validRange(), harness.context)).rejects.toThrow(
      failure,
    );
    expect(state.prune.messages.blocksById.size).toBe(1);
    expect(state.stats.messagesCompressed).toBe(2);
    expect(persist).not.toHaveBeenCalled();
  });
});

describe("createCompressionExecution completion", () => {
  it("clears error timing and still requests a checkpoint", () => {
    const state = createSessionState();
    state.compressionTiming.startTimes.set("call", 0);
    const persist = vi.fn();
    const execution = createCompressionExecution({
      state,
      config: makeDefaultConfig(),
      getMessages: () => [],
      onCompressed: vi.fn(),
      persist,
      now: () => 100,
    });
    execution.complete({
      toolCallId: "call",
      toolName: "compress",
      isError: true,
    });
    expect(state.compressionTiming.startTimes.has("call")).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("requests a checkpoint even when no start time exists", () => {
    const state = createSessionState();
    const persist = vi.fn();
    const { execution } = executionFor(state, { persist });

    execution.complete({ toolCallId: "call", toolName: "compress", isError: false });

    expect(persist).toHaveBeenCalledTimes(1);
    expect(state.compressionTiming.startTimes.size).toBe(0);
  });

  it("treats a start time of zero as valid", () => {
    const state = createSessionState();
    const block = installBlock(state, 1, "call", 0);
    state.compressionTiming.startTimes.set("call", 0);
    const { execution } = executionFor(state, { now: () => 100 });

    execution.complete({ toolCallId: "call", toolName: "compress", isError: false });

    expect(block.durationMs).toBe(100);
    expect(state.compressionTiming.startTimes.has("call")).toBe(false);
  });

  it("treats an omitted isError as a successful completion", () => {
    const state = createSessionState();
    const block = installBlock(state, 1, "call", 75);
    state.compressionTiming.startTimes.set("call", 0);
    const { execution, persist } = executionFor(state, { now: () => 100 });

    execution.complete({ toolCallId: "call", toolName: "compress" });

    expect(block.durationMs).toBe(100);
    expect(state.compressionTiming.startTimes.has("call")).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("writes the elapsed duration to every matching block including inactive ones", () => {
    const state = createSessionState();
    const active = installBlock(state, 1, "call-a", 75);
    const inactive = installBlock(state, 2, "call-a", 75, {
      active: false,
      deactivatedByUser: true,
      deactivatedAt: 5,
      deactivatedByBlockId: 9,
    });
    const control = installBlock(state, 3, "call-b", 75);
    state.compressionTiming.startTimes.set("call-a", 0);
    const { execution } = executionFor(state, { now: () => 100 });

    execution.complete({ toolCallId: "call-a", toolName: "compress", isError: false });

    expect(active.durationMs).toBe(100);
    expect(inactive.durationMs).toBe(100);
    expect(control.durationMs).toBe(75);
    expect(state.compressionTiming.startTimes.has("call-a")).toBe(false);
  });

  it("clears the matching start without writing duration on error", () => {
    const state = createSessionState();
    const block = installBlock(state, 1, "call-a", 75);
    state.compressionTiming.startTimes.set("call-a", 0);
    state.compressionTiming.startTimes.set("unrelated", 5);
    const { execution, persist } = executionFor(state, { now: () => 100 });

    execution.complete({ toolCallId: "call-a", toolName: "compress", isError: true });

    expect(block.durationMs).toBe(75);
    expect(state.compressionTiming.startTimes.has("call-a")).toBe(false);
    expect(state.compressionTiming.startTimes.get("unrelated")).toBe(5);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("ignores a non-compression event", () => {
    const state = createSessionState();
    state.compressionTiming.startTimes.set("call-a", 0);
    const block = installBlock(state, 1, "call-a", 75);
    const { execution, persist } = executionFor(state, { now: () => 100 });

    execution.complete({ toolCallId: "call-a", toolName: "read", isError: false });

    expect(block.durationMs).toBe(75);
    expect(state.compressionTiming.startTimes.get("call-a")).toBe(0);
    expect(persist).not.toHaveBeenCalled();
  });

  it("does not rewrite duration on a repeated end but requests a checkpoint each time", () => {
    const state = createSessionState();
    const block = installBlock(state, 1, "call-a", 0);
    state.compressionTiming.startTimes.set("call-a", 0);
    const { execution, persist } = executionFor(state, { now: () => 100 });

    execution.complete({ toolCallId: "call-a", toolName: "compress", isError: false });
    expect(block.durationMs).toBe(100);
    block.durationMs = 999;

    execution.complete({ toolCallId: "call-a", toolName: "compress", isError: false });

    expect(block.durationMs).toBe(999);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("does not gate completion on changed policy", () => {
    const state = createSessionState();
    const block = installBlock(state, 1, "call-a", 0);
    state.compressionTiming.startTimes.set("call-a", 0);
    state.compressPermission = "deny";
    const { execution } = executionFor(state, { now: () => 100 });

    execution.complete({ toolCallId: "call-a", toolName: "compress", isError: false });

    expect(block.durationMs).toBe(100);
    expect(state.compressionTiming.startTimes.has("call-a")).toBe(false);
  });

  it("observes cleared timing and recorded duration inside persist", () => {
    const state = createSessionState();
    const block = installBlock(state, 1, "call-a", 0);
    state.compressionTiming.startTimes.set("call-a", 0);
    const persist = vi.fn(() => {
      expect(state.compressionTiming.startTimes.has("call-a")).toBe(false);
      expect(block.durationMs).toBe(100);
    });
    const { execution } = executionFor(state, { persist, now: () => 100 });

    execution.complete({ toolCallId: "call-a", toolName: "compress", isError: false });

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("propagates a throwing persist after timing and duration updates", () => {
    const state = createSessionState();
    const block = installBlock(state, 1, "call-a", 0);
    state.compressionTiming.startTimes.set("call-a", 0);
    const failure = new Error("persist failed");
    const persist = vi.fn(() => {
      throw failure;
    });
    const { execution } = executionFor(state, { persist, now: () => 100 });

    expect(() =>
      execution.complete({ toolCallId: "call-a", toolName: "compress", isError: false }),
    ).toThrow(failure);
    expect(block.durationMs).toBe(100);
    expect(state.compressionTiming.startTimes.has("call-a")).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
