import { describe, expect, it } from "vitest";
import {
  applyDcpPanelAction,
  buildDcpPanelModel,
  type DcpPanelModelInput,
} from "../src/ui/panel-model.ts";
import { getDcpCapabilities } from "../src/capabilities.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";
import type { CompressionBlock, SessionState } from "../src/state/types.ts";
import type { DcpConfig } from "../src/config.ts";

function addBlock(state: SessionState, overrides: Partial<CompressionBlock>): CompressionBlock {
  const block: CompressionBlock = {
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
  state.prune.messages.blocksById.set(block.blockId, block);
  return block;
}

function baseInput(overrides: Partial<DcpPanelModelInput> = {}): DcpPanelModelInput {
  return {
    state: createSessionState(),
    config: makeDefaultConfig(),
    model: { provider: "test", id: "test-model", contextWindow: 200_000 },
    contextUsage: { tokens: 20_000, contextWindow: 200_000, percent: 10 },
    lifetimeStats: {
      totalTokensSaved: 1_000,
      totalToolsPruned: 4,
      totalMessagesCompressed: 2,
      sessionCount: 3,
    },
    compressToolActive: true,
    ...overrides,
  };
}

function field(model: ReturnType<typeof buildDcpPanelModel>, label: string): string | undefined {
  return model.status.find((entry) => entry.label === label)?.value;
}

function statistic(
  model: ReturnType<typeof buildDcpPanelModel>,
  label: string,
): string | undefined {
  return model.statistics.find((entry) => entry.label === label)?.value;
}

describe("buildDcpPanelModel", () => {
  it("formats current model, context, limits, and statistics", () => {
    const input = baseInput({
      config: makeDefaultConfig({ maxContextLimit: 100_000, minContextLimit: 50_000 }),
    });

    const model = buildDcpPanelModel(input);

    expect(field(model, "Model")).toBe("test/test-model");
    expect(field(model, "Context")).toContain("20000");
    expect(field(model, "Context")).toContain("200000");
    expect(field(model, "Max limit")).toBe("100000");
    expect(field(model, "Min limit")).toBe("50000");
    expect(field(model, "Compression mode")).toBe("range");
    expect(field(model, "Permission")).toBe("allow");
    expect(field(model, "Manual mode")).toBe("off");
    expect(field(model, "Pipeline")).toBe("enabled");
    expect(field(model, "Compress tool")).toBe("active");
    expect(statistic(model, "Lifetime tokens saved")).toBe("1000");
    expect(statistic(model, "Lifetime sessions")).toBe("3");
  });

  it("uses the current model view for thresholds without mutating cached state", () => {
    const state = createSessionState();
    state.modelProvider = "stale";
    state.modelId = "stale-model";
    state.modelContextWindow = 100;

    const input = baseInput({
      state,
      model: { provider: "anthropic", id: "claude", contextWindow: 200_000 },
      config: makeDefaultConfig({ maxContextLimit: "50%" }),
      contextUsage: { tokens: 90_000, contextWindow: 200_000, percent: 45 },
    });

    const model = buildDcpPanelModel(input);

    expect(field(model, "Model")).toBe("anthropic/claude");
    expect(field(model, "Max limit")).toBe("100000");
    expect(state.modelProvider).toBe("stale");
    expect(state.modelId).toBe("stale-model");
    expect(state.modelContextWindow).toBe(100);
  });

  it("shows explicit unavailable values when data is missing", () => {
    const state = createSessionState();
    addBlock(state, { blockId: 1 });
    const input = baseInput({
      state,
      model: undefined,
      contextUsage: undefined,
      lifetimeStats: undefined,
      compressToolActive: false,
    });

    const model = buildDcpPanelModel(input);

    expect(field(model, "Model")).toBe("Unavailable");
    expect(field(model, "Context")).toBe("Unavailable");
    expect(field(model, "Max limit")).toBe("Unavailable");
    expect(field(model, "Min limit")).toBe("Unavailable");
    expect(field(model, "Compress tool")).toBe("inactive");
    expect(statistic(model, "Lifetime tokens saved")).toBe("Unavailable");
    expect(statistic(model, "Lifetime sessions")).toBe("Unavailable");
  });

  it("sorts block rows numerically and distinguishes block states", () => {
    const state = createSessionState();
    addBlock(state, { blockId: 3, active: true, topic: "three" });
    addBlock(state, { blockId: 1, active: true, topic: "one" });
    addBlock(state, {
      blockId: 2,
      active: false,
      deactivatedByUser: true,
      topic: "two",
    });
    addBlock(state, { blockId: 5, active: false, deactivatedByUser: false, topic: "five" });

    const model = buildDcpPanelModel(baseInput({ state }));

    expect(model.blocks.map((row) => row.id)).toEqual(["block:1", "block:2", "block:3", "block:5"]);

    const active = model.blocks.find((row) => row.id === "block:1");
    expect(active?.action).toEqual({ type: "toggle-block", blockId: 1 });
    expect(active?.unavailableReason).toBeUndefined();

    const deactivated = model.blocks.find((row) => row.id === "block:2");
    expect(deactivated?.action).toEqual({ type: "toggle-block", blockId: 2 });
    expect(deactivated?.detail).toContain("Reactivate");

    const inactive = model.blocks.find((row) => row.id === "block:5");
    expect(inactive?.action).toBeUndefined();
    expect(inactive?.unavailableReason).toBeDefined();
  });

  it("marks policy-disabled actions unavailable with the policy message", () => {
    const state = createSessionState();
    addBlock(state, { blockId: 1, active: true });

    const model = buildDcpPanelModel(
      baseInput({ state, config: { ...makeDefaultConfig(), enabled: false } }),
    );

    const manual = model.actions.find((row) => row.id === "toggle-manual");
    expect(manual?.action).toEqual({ type: "toggle-manual" });
    expect(manual?.unavailableReason).toBe("DCP is disabled by configuration.");
    const close = model.actions.find((row) => row.id === "close");
    expect(close?.unavailableReason).toBeUndefined();
    expect(model.blocks[0]?.unavailableReason).toBe("DCP is disabled by configuration.");
  });

  it("does not fabricate context values when usage tokens are null", () => {
    const model = buildDcpPanelModel(
      baseInput({ contextUsage: { tokens: null, contextWindow: 200_000, percent: null } }),
    );
    expect(field(model, "Context")).toBe("Unavailable");
  });

  it("prefers the session permission override over the configured default", () => {
    const state = createSessionState();
    state.compressPermission = "ask";
    const model = buildDcpPanelModel(
      baseInput({ state, config: makeDefaultConfig({ permission: "deny" }) }),
    );
    expect(field(model, "Permission")).toBe("ask");
  });
});

describe("applyDcpPanelAction", () => {
  function capabilities(config: DcpConfig, state: SessionState) {
    return getDcpCapabilities(config, state, "test", "test-model");
  }

  it("toggles manual mode from both states", () => {
    const config = makeDefaultConfig();
    const state = createSessionState();

    expect(
      applyDcpPanelAction({ type: "toggle-manual" }, state, config, capabilities(config, state)),
    ).toMatchObject({ permitted: true, message: expect.stringContaining("on") });
    expect(state.manualMode).toBe("active");

    expect(
      applyDcpPanelAction({ type: "toggle-manual" }, state, config, capabilities(config, state)),
    ).toMatchObject({ permitted: true, message: expect.stringContaining("off") });
    expect(state.manualMode).toBe(false);
  });

  it("cycles permission using the configured fallback", () => {
    const config = makeDefaultConfig({ permission: "deny" });
    const state = createSessionState();

    const result = applyDcpPanelAction(
      { type: "cycle-permission" },
      state,
      config,
      capabilities(config, state),
    );

    expect(result).toEqual({ permitted: true, message: "Compress permission: allow" });
    expect(state.compressPermission).toBe("allow");
  });

  it("sweeps eligible outputs", () => {
    const config = makeDefaultConfig();
    const state = createSessionState();
    const result = applyDcpPanelAction(
      { type: "sweep" },
      state,
      config,
      capabilities(config, state),
    );
    expect(result.permitted).toBe(true);
    expect(result.message).toContain("Sweep complete");
  });

  it("deactivates an active block and reactivates a user-deactivated block", () => {
    const config = makeDefaultConfig();
    const state = createSessionState();
    const block = addBlock(state, { blockId: 1, active: true });

    const deactivated = applyDcpPanelAction(
      { type: "toggle-block", blockId: 1 },
      state,
      config,
      capabilities(config, state),
    );
    expect(deactivated).toMatchObject({ permitted: true });
    expect(block.active).toBe(false);
    expect(block.deactivatedByUser).toBe(true);

    const reactivated = applyDcpPanelAction(
      { type: "toggle-block", blockId: 1 },
      state,
      config,
      capabilities(config, state),
    );
    expect(reactivated).toMatchObject({ permitted: true });
    expect(block.active).toBe(true);
    expect(block.deactivatedByUser).toBe(false);
  });

  it("returns the stale block message for a missing block", () => {
    const config = makeDefaultConfig();
    const state = createSessionState();
    const result = applyDcpPanelAction(
      { type: "toggle-block", blockId: 99 },
      state,
      config,
      capabilities(config, state),
    );
    expect(result).toEqual({ permitted: true, message: "Block 99 not found." });
  });

  it("rejects every mutation when the pipeline is disabled", () => {
    const config = { ...makeDefaultConfig(), enabled: false };
    const state = createSessionState();
    state.manualMode = false;
    const block = addBlock(state, { blockId: 1, active: true });
    const caps = capabilities(config, state);

    for (const action of [
      { type: "toggle-manual" } as const,
      { type: "cycle-permission" } as const,
      { type: "sweep" } as const,
      { type: "toggle-block", blockId: 1 } as const,
    ]) {
      expect(applyDcpPanelAction(action, state, config, caps)).toEqual({
        permitted: false,
        message: "DCP is disabled by configuration.",
      });
    }

    expect(state.manualMode).toBe(false);
    expect(state.compressPermission).toBeUndefined();
    expect(block.active).toBe(true);
  });

  it("allows mutations when only the permission is denied", () => {
    const config = makeDefaultConfig({ permission: "deny" });
    const state = createSessionState();
    const result = applyDcpPanelAction(
      { type: "toggle-manual" },
      state,
      config,
      capabilities(config, state),
    );
    expect(result.permitted).toBe(true);
    expect(state.manualMode).toBe("active");
  });

  it("closes without mutation", () => {
    const config = makeDefaultConfig();
    const state = createSessionState();
    const result = applyDcpPanelAction(
      { type: "close" },
      state,
      config,
      capabilities(config, state),
    );
    expect(result).toEqual({ permitted: false });
    expect(state.manualMode).toBe(false);
  });
});
