import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { executeDcpAction, type DcpAction } from "../src/commands/actions.ts";
import * as sweepModule from "../src/commands/sweep.ts";
import { buildDcpPanelModel } from "../src/tui/panel-model.ts";
import { createSessionState } from "../src/state/state.ts";
import type { CompressionBlock, SessionState } from "../src/state/types.ts";
import {
  makeDefaultConfig,
  makeAssistantMessage,
  makeToolResultMessage,
  makeUserMessage,
} from "./helpers.ts";
import { handleCompress } from "../src/compress/blocks.ts";
import { runPipeline } from "../src/pipeline.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createExtensionHarness } from "./extension-harness.ts";

function makeBlock(overrides: Partial<CompressionBlock> = {}): CompressionBlock {
  return {
    blockId: 1,
    runId: 1,
    active: true,
    deactivatedByUser: false,
    compressedTokens: 100,
    summaryTokens: 10,
    durationMs: 5,
    mode: "range",
    topic: "topic",
    batchTopic: undefined,
    startIndex: 0,
    endIndex: 1,
    anchorIndex: 0,
    compressToolCallId: "call",
    startKey: "k1",
    endKey: "k2",
    anchorKey: "k1",
    consumedBlockIds: [],
    parentBlockIds: [],
    directMessageIndices: [],
    directToolIds: [],
    effectiveMessageIndices: [],
    effectiveToolIds: [],
    createdAt: 1,
    deactivatedAt: undefined,
    deactivatedByBlockId: undefined,
    summary: "summary",
    ...overrides,
  };
}

function addBlock(
  state: SessionState,
  overrides: Partial<CompressionBlock> = {},
): CompressionBlock {
  const block = makeBlock(overrides);
  state.prune.messages.blocksById.set(block.blockId, block);
  return block;
}

function run(
  action: DcpAction,
  ctx: ExtensionCommandContext,
  dependencies: {
    state: SessionState;
    config: ReturnType<typeof makeDefaultConfig>;
    onStateChange: (seen: ExtensionCommandContext) => void;
  },
) {
  return executeDcpAction(action, ctx, dependencies);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("executeDcpAction", () => {
  it("calls back once with the original context after a permitted manual action", () => {
    const ctx = createExtensionHarness().commandContext;
    const state = createSessionState();
    const config = makeDefaultConfig();
    const onStateChange = vi.fn((seen: ExtensionCommandContext) => {
      expect(seen).toBe(ctx);
      expect(state.manualMode).toBe("active");
    });
    const result = executeDcpAction({ type: "manual", args: "on" }, ctx, {
      state,
      config,
      onStateChange,
    });
    expect(result).toEqual({
      permitted: true,
      message: "Manual mode: on. Automatic compression is paused.",
    });
    expect(onStateChange).toHaveBeenCalledTimes(1);
  });

  const everyAction: DcpAction[] = [
    { type: "manual", args: "on" },
    { type: "toggle-manual" },
    { type: "cycle-permission" },
    { type: "sweep" },
    { type: "decompress", args: "1" },
    { type: "recompress", args: "1" },
    { type: "toggle-block", blockId: 1 },
  ];

  it.each(everyAction)("rejects current pipeline policy before executing $type", (action) => {
    const ctx = createExtensionHarness().commandContext;
    const state = createSessionState();
    const config = { ...makeDefaultConfig(), enabled: false };
    addBlock(state);
    const onStateChange = vi.fn();
    const block = state.prune.messages.blocksById.get(1);

    const result = run(action, ctx, { state, config, onStateChange });

    expect(state.manualMode).toBe(false);
    expect(state.compressPermission).toBeUndefined();
    expect(state.prune.tools.size).toBe(0);
    expect(block?.active).toBe(true);
    expect(block?.deactivatedByUser).toBe(false);
    expect(result).toEqual({ permitted: false, message: "DCP is disabled by configuration." });
    expect(onStateChange).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "configuration",
      enabled: false,
      isSubAgent: true,
      message: "DCP is disabled by configuration.",
    },
    {
      name: "sub-agent",
      enabled: true,
      isSubAgent: true,
      message: "DCP is disabled in sub-agent sessions.",
    },
    {
      name: "model",
      enabled: true,
      isSubAgent: false,
      message: "DCP is disabled for the current model.",
    },
  ])(
    "preserves $name policy message precedence without a callback",
    ({ enabled, isSubAgent, message }) => {
      const ctx = createExtensionHarness().commandContext;
      const state = createSessionState();
      state.isSubAgent = isSubAgent;
      state.compressPermission = "deny";
      const config = {
        ...makeDefaultConfig(),
        enabled,
        disabledModels: ["test/test-model"],
      };
      const onStateChange = vi.fn();

      const result = run({ type: "toggle-manual" }, ctx, { state, config, onStateChange });

      expect(result).toEqual({ permitted: false, message });
      expect(state.manualMode).toBe(false);
      expect(onStateChange).not.toHaveBeenCalled();
    },
  );

  it.each([
    { name: "sweep", action: { type: "sweep" } as DcpAction, message: "Sweep complete" },
    {
      name: "manual",
      action: { type: "manual", args: "on" } as DcpAction,
      message: "Manual mode: on",
    },
    {
      name: "permission",
      action: { type: "cycle-permission" } as DcpAction,
      message: "Compress permission: allow",
    },
    {
      name: "block",
      action: { type: "toggle-block", blockId: 1 } as DcpAction,
      message: "Block 1 deactivated",
    },
  ])("allows operator $name controls under permission denial", ({ action, message }) => {
    const ctx = createExtensionHarness().commandContext;
    const state = createSessionState();
    state.compressPermission = "deny";
    const config = makeDefaultConfig();
    addBlock(state);
    const onStateChange = vi.fn();

    const result = run(action, ctx, { state, config, onStateChange });

    expect(result.permitted).toBe(true);
    expect(result.message).toContain(message);
    expect(onStateChange).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "manual query", action: { type: "manual", args: "" } as DcpAction },
    { name: "invalid manual input", action: { type: "manual", args: "invalid" } as DcpAction },
    { name: "empty sweep", action: { type: "sweep" } as DcpAction },
    {
      name: "already-selected manual mode",
      action: { type: "manual", args: "off" } as DcpAction,
    },
  ])("preserves callbacks for allowed $name", ({ action }) => {
    const ctx = createExtensionHarness().commandContext;
    const state = createSessionState();
    state.manualMode = false;
    const config = makeDefaultConfig();
    const onStateChange = vi.fn();

    const result = run(action, ctx, { state, config, onStateChange });

    expect(result.permitted).toBe(true);
    expect(onStateChange).toHaveBeenCalledTimes(1);
  });

  it("rechecks a stale block action", () => {
    const ctx = createExtensionHarness().commandContext;
    const state = createSessionState();
    const config = makeDefaultConfig();
    const onStateChange = vi.fn();

    const result = run({ type: "toggle-block", blockId: 99 }, ctx, {
      state,
      config,
      onStateChange,
    });

    expect(result).toEqual({ permitted: true, message: "Block 99 not found." });
    expect(onStateChange).toHaveBeenCalledTimes(1);
  });

  it("reads current policy after a panel projection", () => {
    const ctx = createExtensionHarness().commandContext;
    const state = createSessionState();
    const config = makeDefaultConfig();
    const projected = buildDcpPanelModel({
      state,
      config,
      model: { provider: "test", id: "test-model", contextWindow: 200_000 },
      contextUsage: undefined,
      lifetimeStats: undefined,
      compressToolActive: true,
    }).actions.find((row) => row.id === "toggle-manual")?.action;
    if (!projected || projected.type === "close")
      throw new Error("expected projected toggle-manual action");
    const onStateChange = vi.fn();
    config.enabled = false;

    const result = run(projected, ctx, { state, config, onStateChange });

    expect(state.manualMode).toBe(false);
    expect(result).toEqual({ permitted: false, message: "DCP is disabled by configuration." });
    expect(onStateChange).not.toHaveBeenCalled();
  });

  it("uses live model identity with cached fallback", () => {
    const config = { ...makeDefaultConfig(), disabledModels: ["test/disabled"] };
    const harness = createExtensionHarness({ model: { provider: "test", id: "enabled" } });

    const enabledState = createSessionState();
    enabledState.modelProvider = "test";
    enabledState.modelId = "disabled";
    const enabledCallback = vi.fn();
    const enabledResult = run({ type: "manual", args: "on" }, harness.commandContext, {
      state: enabledState,
      config,
      onStateChange: enabledCallback,
    });
    expect(enabledResult.permitted).toBe(true);
    expect(enabledState.manualMode).toBe("active");
    expect(enabledCallback).toHaveBeenCalledTimes(1);

    harness.setModel({ provider: "test", id: "disabled" });
    const disabledState = createSessionState();
    disabledState.modelProvider = "test";
    disabledState.modelId = "enabled";
    const disabledCallback = vi.fn();
    const disabledResult = run({ type: "manual", args: "on" }, harness.commandContext, {
      state: disabledState,
      config,
      onStateChange: disabledCallback,
    });
    expect(disabledResult).toEqual({
      permitted: false,
      message: "DCP is disabled for the current model.",
    });
    expect(disabledState.manualMode).toBe(false);
    expect(disabledCallback).not.toHaveBeenCalled();

    harness.context.model = undefined;
    const cachedState = createSessionState();
    cachedState.modelProvider = "test";
    cachedState.modelId = "disabled";
    const cachedCallback = vi.fn();
    const cachedResult = run({ type: "manual", args: "on" }, harness.commandContext, {
      state: cachedState,
      config,
      onStateChange: cachedCallback,
    });
    expect(cachedResult).toEqual({
      permitted: false,
      message: "DCP is disabled for the current model.",
    });
    expect(cachedCallback).not.toHaveBeenCalled();
  });

  it("reads replaced nested config and block state", () => {
    const ctx = createExtensionHarness().commandContext;
    const state = createSessionState();
    const config = makeDefaultConfig();
    const onStateChange = vi.fn();
    config.compress = { ...config.compress, permission: "deny" };

    const cycled = run({ type: "cycle-permission" }, ctx, { state, config, onStateChange });
    expect(cycled.message).toBe("Compress permission: allow");
    expect(state.compressPermission).toBe("allow");

    state.compressPermission = "ask";
    const overridden = run({ type: "cycle-permission" }, ctx, { state, config, onStateChange });
    expect(overridden.message).toBe("Compress permission: deny");

    const originalBlock = addBlock(state);
    const projected = buildDcpPanelModel({
      state,
      config,
      model: { provider: "test", id: "test-model", contextWindow: 200_000 },
      contextUsage: undefined,
      lifetimeStats: undefined,
      compressToolActive: true,
    }).blocks.find((row) => row.id === "block:1")?.action;
    if (!projected || projected.type === "close")
      throw new Error("expected projected toggle-block action");

    const replacement = new Map<number, CompressionBlock>();
    replacement.set(1, makeBlock({ active: false, deactivatedByUser: true }));
    state.prune.messages.blocksById = replacement;
    onStateChange.mockClear();
    const toggled = run(projected, ctx, { state, config, onStateChange });
    expect(toggled).toEqual({
      permitted: true,
      message: "Block 1 reactivated. Compression will apply on next context pass.",
    });
    expect(replacement.get(1)?.active).toBe(true);
    expect(replacement.get(1)?.deactivatedByUser).toBe(false);
    expect(originalBlock.active).toBe(true);
    expect(originalBlock.deactivatedByUser).toBe(false);
    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenCalledWith(ctx);
  });

  it("resolves toggle direction from current state", () => {
    const ctx = createExtensionHarness().commandContext;
    const config = makeDefaultConfig();

    const manualState = createSessionState();
    const projectedManual = buildDcpPanelModel({
      state: manualState,
      config,
      model: { provider: "test", id: "test-model", contextWindow: 200_000 },
      contextUsage: undefined,
      lifetimeStats: undefined,
      compressToolActive: true,
    }).actions.find((row) => row.id === "toggle-manual")?.action;
    if (!projectedManual || projectedManual.type === "close")
      throw new Error("expected projected toggle-manual action");
    manualState.manualMode = "active";
    const manualCallback = vi.fn();
    const manualResult = run(projectedManual, ctx, {
      state: manualState,
      config,
      onStateChange: manualCallback,
    });
    expect(manualResult).toEqual({
      permitted: true,
      message: "Manual mode: off. Automatic compression resumed.",
    });
    expect(manualState.manualMode).toBe(false);
    expect(manualCallback).toHaveBeenCalledTimes(1);

    const blockState = createSessionState();
    addBlock(blockState);
    const projectedBlock = buildDcpPanelModel({
      state: blockState,
      config,
      model: { provider: "test", id: "test-model", contextWindow: 200_000 },
      contextUsage: undefined,
      lifetimeStats: undefined,
      compressToolActive: true,
    }).blocks.find((row) => row.id === "block:1")?.action;
    if (!projectedBlock || projectedBlock.type === "close")
      throw new Error("expected projected toggle-block action");
    const block = blockState.prune.messages.blocksById.get(1);
    if (!block) throw new Error("expected block");
    block.active = false;
    block.deactivatedByUser = true;
    const reactivateCallback = vi.fn();
    const reactivated = run(projectedBlock, ctx, {
      state: blockState,
      config,
      onStateChange: reactivateCallback,
    });
    expect(reactivated).toEqual({
      permitted: true,
      message: "Block 1 reactivated. Compression will apply on next context pass.",
    });
    expect(reactivateCallback).toHaveBeenCalledTimes(1);

    const inactiveState = createSessionState();
    addBlock(inactiveState, { active: false, deactivatedByUser: false });
    const inactiveCallback = vi.fn();
    const inactiveResult = run({ type: "toggle-block", blockId: 1 }, ctx, {
      state: inactiveState,
      config,
      onStateChange: inactiveCallback,
    });
    expect(inactiveResult).toEqual({
      permitted: true,
      message: "Block 1 was not deactivated by user. Cannot reactivate.",
    });
    expect(inactiveCallback).toHaveBeenCalledTimes(1);
  });

  it("toggles real nested blocks from current state", () => {
    const ctx = createExtensionHarness().commandContext;
    const state = createSessionState();
    state.sessionId = "dcp-actions-nested";
    const config = makeDefaultConfig();
    config.strategies = {
      deduplication: { enabled: false, protectedTools: [], turnProtection: 0 },
      purgeErrors: { enabled: false, turns: 4, protectedTools: [] },
    };
    const owner = (id: string, timestamp: number): AgentMessage =>
      ({
        role: "assistant",
        content: [{ type: "toolCall", id, name: "compress", arguments: {} }],
        stopReason: "toolUse",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
        timestamp,
      }) as unknown as AgentMessage;

    let raw: AgentMessage[] = [
      makeUserMessage("child user", 1),
      makeAssistantMessage("child reply", 2),
      makeUserMessage("tail user", 3),
    ];
    runPipeline(state, config, raw, undefined);
    handleCompress(state, config, raw, "child-call", {
      topic: "child",
      mode: "range",
      content: [{ startId: "m1", endId: "m2", summary: "child summary" }],
    });
    raw = [
      ...raw,
      owner("child-call", 4),
      makeToolResultMessage("child-call", "compress", "ok", false, 5),
    ];
    runPipeline(state, config, raw, undefined);
    handleCompress(state, config, raw, "parent-call", {
      topic: "parent",
      mode: "range",
      content: [{ startId: "b1", endId: "b1", summary: "parent summary" }],
    });
    raw = [
      ...raw,
      owner("parent-call", 6),
      makeToolResultMessage("parent-call", "compress", "ok", false, 7),
    ];
    runPipeline(state, config, raw, undefined);

    const onStateChange = vi.fn();
    const child = run({ type: "toggle-block", blockId: 1 }, ctx, {
      state,
      config,
      onStateChange,
    });
    expect(child).toEqual({
      permitted: true,
      message: "Block 1 was not deactivated by user. Cannot reactivate.",
    });
    expect(onStateChange).toHaveBeenCalledTimes(1);

    const parent = run({ type: "toggle-block", blockId: 2 }, ctx, {
      state,
      config,
      onStateChange,
    });
    expect(parent.message).toContain("Block 2 deactivated");
    expect(state.prune.messages.blocksById.get(1)?.active).toBe(true);
    expect(onStateChange).toHaveBeenCalledTimes(2);
  });

  it("preserves raw command argument behavior", () => {
    const ctx = createExtensionHarness().commandContext;
    const config = makeDefaultConfig();

    const manualState = createSessionState();
    const manualCallback = vi.fn();
    const manualResult = run({ type: "manual", args: " ON " }, ctx, {
      state: manualState,
      config,
      onStateChange: manualCallback,
    });
    expect(manualResult.message).toBe("Manual mode: on. Automatic compression is paused.");
    expect(manualCallback).toHaveBeenCalledTimes(1);

    const decompressState = createSessionState();
    addBlock(decompressState);
    const decompressCallback = vi.fn();
    const decompressed = run({ type: "decompress", args: "1suffix" }, ctx, {
      state: decompressState,
      config,
      onStateChange: decompressCallback,
    });
    expect(decompressed.message).toBe(
      "Block 1 deactivated. Original messages will be restored on next context pass.",
    );
    expect(decompressCallback).toHaveBeenCalledTimes(1);

    const recompressState = createSessionState();
    addBlock(recompressState, { active: false, deactivatedByUser: true });
    const recompressCallback = vi.fn();
    const recompressed = run({ type: "recompress", args: "1suffix" }, ctx, {
      state: recompressState,
      config,
      onStateChange: recompressCallback,
    });
    expect(recompressed.message).toBe(
      "Block 1 reactivated. Compression will apply on next context pass.",
    );
    expect(recompressCallback).toHaveBeenCalledTimes(1);

    const emptyState = createSessionState();
    const emptyCallback = vi.fn();
    expect(
      run({ type: "decompress", args: "" }, ctx, {
        state: emptyState,
        config,
        onStateChange: emptyCallback,
      }).message,
    ).toBe("Usage: dcp:decompress <blockId>");
    expect(
      run({ type: "recompress", args: "" }, ctx, {
        state: emptyState,
        config,
        onStateChange: emptyCallback,
      }).message,
    ).toBe("Usage: dcp:recompress <blockId>");
    expect(
      run({ type: "decompress", args: "invalid" }, ctx, {
        state: emptyState,
        config,
        onStateChange: emptyCallback,
      }).message,
    ).toBe("Invalid block ID: invalid");
    expect(emptyCallback).toHaveBeenCalledTimes(3);
  });

  it("propagates command errors before callback", () => {
    const ctx = createExtensionHarness().commandContext;
    const state = createSessionState();
    const config = makeDefaultConfig();
    const onStateChange = vi.fn();
    const sentinel = new Error("sweep implementation failed");
    vi.spyOn(sweepModule, "sweepCommand").mockImplementation(() => {
      throw sentinel;
    });

    let caught: unknown;
    try {
      run({ type: "sweep" }, ctx, { state, config, onStateChange });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(sentinel);
    expect(onStateChange).not.toHaveBeenCalled();
  });

  it("propagates a callback error once", () => {
    const ctx = createExtensionHarness().commandContext;
    const state = createSessionState();
    const config = makeDefaultConfig();
    const sentinel = new Error("callback failed");
    const onStateChange = vi.fn(() => {
      throw sentinel;
    });

    let caught: unknown;
    try {
      run({ type: "manual", args: "on" }, ctx, { state, config, onStateChange });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(sentinel);
    expect(onStateChange).toHaveBeenCalledTimes(1);
  });
});
