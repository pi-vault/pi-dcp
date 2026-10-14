import { describe, expect, it } from "vitest";
import {
  buildDcpPanelModel,
  DCP_PANEL_TABS,
  type DcpPanelModel,
  type DcpPanelModelInput,
  type DcpPanelTab,
} from "../src/tui/panel-model.ts";
import { DCP_COMMAND_HELP } from "../src/commands/help.ts";
import { contextCommand } from "../src/commands/context.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";
import type { CompressionBlock, ContextUsage, SessionState } from "../src/state/types.ts";

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

function detail(model: DcpPanelModel, tab: DcpPanelTab, id: string): string | undefined {
  return model.tabs[tab].rows.find((row) => row.id === id)?.detail;
}

function label(model: DcpPanelModel, tab: DcpPanelTab, id: string): string | undefined {
  return model.tabs[tab].rows.find((row) => row.id === id)?.label;
}

function blockRow(model: DcpPanelModel, id: number) {
  return model.tabs.blocks.rows.find((row) => row.id === `block:${id}`);
}

describe("buildDcpPanelModel", () => {
  it("projects five tabs in approved order", () => {
    const model = buildDcpPanelModel(baseInput());

    expect(Object.keys(model.tabs)).toEqual([
      "overview",
      "controls",
      "blocks",
      "statistics",
      "help",
    ]);
    expect(DCP_PANEL_TABS).toEqual(["overview", "controls", "blocks", "statistics", "help"]);
    expect(model.tabs.overview.title).toBe("Overview");
    expect(model.tabs.controls.title).toBe("Controls");
    expect(model.tabs.blocks.title).toBe("Blocks");
    expect(model.tabs.statistics.title).toBe("Statistics");
    expect(model.tabs.help.title).toBe("Help");
    expect(model.tabs.controls.rows.map((row) => row.id)).toEqual([
      "toggle-manual",
      "cycle-permission",
      "sweep",
    ]);
    expect(model.tabs.overview.rows.every((row) => row.action === undefined)).toBe(true);
    expect(model.tabs.statistics.rows.every((row) => row.action === undefined)).toBe(true);
    expect(model.tabs.help.rows.every((row) => row.action === undefined)).toBe(true);
  });

  it("preserves all informational field sources", () => {
    const state = createSessionState();
    state.prune.tools.set("a", 10);
    state.prune.tools.set("b", 20);
    state.prune.messages.activeBlockIds.add(1);
    addBlock(state, { blockId: 1 });
    state.toolParameters.set("call", {
      tool: "read",
      parameters: {},
      filePaths: [],
      status: "completed",
      error: undefined,
      userTurn: 1,
      tokenCount: 1,
      assistantIndex: undefined,
      resultIndex: undefined,
    });
    state.currentUserTurn = 7;

    const model = buildDcpPanelModel(
      baseInput({
        state,
        config: makeDefaultConfig({ maxContextLimit: 100_000, minContextLimit: 50_000 }),
      }),
    );

    expect(detail(model, "overview", "overview:model")).toBe("test/test-model");
    expect(detail(model, "overview", "overview:context")).toBe("~20k / 200k (10%)");
    expect(detail(model, "overview", "overview:max-limit")).toBe("100k");
    expect(detail(model, "overview", "overview:min-limit")).toBe("50k");
    expect(detail(model, "overview", "overview:compression-mode")).toBe("range");
    expect(detail(model, "overview", "overview:manual-mode")).toBe("off");
    expect(detail(model, "overview", "overview:permission")).toBe("allow");
    expect(detail(model, "overview", "overview:pipeline")).toBe("enabled");
    expect(detail(model, "overview", "overview:compress-tool")).toBe("active");
    expect(detail(model, "overview", "overview:pruned-tools")).toBe("2");
    expect(detail(model, "overview", "overview:active-blocks")).toBe("1");
    expect(detail(model, "overview", "overview:total-blocks")).toBe("1");
    expect(detail(model, "overview", "overview:tool-cache")).toBe("1");
    expect(detail(model, "overview", "overview:user-turn")).toBe("7");

    expect(detail(model, "statistics", "statistics:session")).toBeUndefined();
    expect(detail(model, "statistics", "statistics:tools-pruned")).toBe("0");
    expect(detail(model, "statistics", "statistics:pruning-tokens-saved")).toBe("~0");
    expect(detail(model, "statistics", "statistics:messages-compressed")).toBe("0");
    expect(detail(model, "statistics", "statistics:prune-token-counter")).toBe("~0");
    expect(detail(model, "statistics", "statistics:lifetime")).toBeUndefined();
    expect(detail(model, "statistics", "statistics:lifetime-sessions")).toBe("3");
    expect(detail(model, "statistics", "statistics:lifetime-pruning-tokens-saved")).toBe("~1k");
    expect(detail(model, "statistics", "statistics:lifetime-tools-pruned")).toBe("4");
    expect(detail(model, "statistics", "statistics:lifetime-messages-compressed")).toBe("2");
  });

  it("keeps distinct counter values and exact integer counts", () => {
    const state = createSessionState();
    state.stats.totalPruneTokens = 1_000;
    state.stats.pruneTokenCounter = 2_500;
    state.stats.toolsPruned = 7_123;
    state.stats.messagesCompressed = 5_123;

    const model = buildDcpPanelModel(baseInput({ state }));

    expect(detail(model, "statistics", "statistics:tools-pruned")).toBe("7123");
    expect(detail(model, "statistics", "statistics:messages-compressed")).toBe("5123");
    expect(detail(model, "statistics", "statistics:pruning-tokens-saved")).toBe("~1k");
    expect(detail(model, "statistics", "statistics:prune-token-counter")).toBe("~2.5k");
  });

  it("distinguishes lifecycle from policy", () => {
    const state = createSessionState();
    addBlock(state, { blockId: 3, active: true, topic: "three" });
    addBlock(state, { blockId: 1, active: true, topic: "one" });
    addBlock(state, { blockId: 2, active: false, deactivatedByUser: true, topic: "two" });
    addBlock(state, {
      blockId: 5,
      active: false,
      deactivatedByUser: false,
      deactivatedByBlockId: 99,
      topic: "five",
    });

    const model = buildDcpPanelModel(baseInput({ state }));

    expect(model.tabs.blocks.rows.map((row) => row.id)).toEqual([
      "block:1",
      "block:2",
      "block:3",
      "block:5",
    ]);
    expect(blockRow(model, 1)?.block?.lifecycle).toBe("Active");
    expect(blockRow(model, 1)?.block?.toggleLabel).toBe("Deactivate");
    expect(blockRow(model, 1)?.action).toEqual({ type: "toggle-block", blockId: 1 });
    expect(blockRow(model, 2)?.block?.lifecycle).toBe("User-deactivated");
    expect(blockRow(model, 2)?.block?.toggleLabel).toBe("Reactivate");
    expect(blockRow(model, 2)?.action).toEqual({ type: "toggle-block", blockId: 2 });
    expect(blockRow(model, 3)?.block?.lifecycle).toBe("Active");
    expect(blockRow(model, 5)?.block?.lifecycle).toBe("Inactive");
    expect(blockRow(model, 5)?.action).toBeUndefined();
    expect(blockRow(model, 5)?.block?.toggleLabel).toBeUndefined();
  });

  it("labels a block Consumed only when its parent is present", () => {
    const state = createSessionState();
    addBlock(state, { blockId: 1, active: false, deactivatedByBlockId: 2 });
    addBlock(state, { blockId: 2, active: false, deactivatedByBlockId: 99 });

    const model = buildDcpPanelModel(baseInput({ state }));

    expect(blockRow(model, 1)?.block?.lifecycle).toBe("Consumed");
    expect(blockRow(model, 2)?.block?.lifecycle).toBe("Inactive");
  });

  it("does not infer Consumed from historical parent block ids alone", () => {
    const state = createSessionState();
    addBlock(state, { blockId: 1, active: false, parentBlockIds: [2] });

    const model = buildDcpPanelModel(baseInput({ state }));

    expect(blockRow(model, 1)?.block?.lifecycle).toBe("Inactive");
  });

  it("prefers user deactivation over active and consumed state", () => {
    const state = createSessionState();
    addBlock(state, {
      blockId: 1,
      active: true,
      deactivatedByUser: true,
      deactivatedByBlockId: 1,
    });

    const model = buildDcpPanelModel(baseInput({ state }));

    expect(blockRow(model, 1)?.block?.lifecycle).toBe("User-deactivated");
  });

  it("uses unknown mode and compressed-input token estimates", () => {
    const state = createSessionState();
    addBlock(state, { blockId: 1, mode: undefined, compressedTokens: 12_400, summaryTokens: 9 });

    const model = buildDcpPanelModel(baseInput({ state }));

    expect(blockRow(model, 1)?.detail).toBe("unknown · ~12.4k tokens");
  });

  it("matches command help descriptors on the Help tab", () => {
    const model = buildDcpPanelModel(baseInput());
    const commandRows = model.tabs.help.rows.filter((row) => row.id.startsWith("help:command:"));

    expect(
      commandRows.map((row) => ({
        id: row.id.slice("help:command:".length),
        syntax: row.label,
        description: row.detail,
      })),
    ).toEqual(DCP_COMMAND_HELP);
    expect(commandRows).toHaveLength(11);
  });

  it("adds read-only Help navigation rows", () => {
    const model = buildDcpPanelModel(baseInput());
    const ids = model.tabs.help.rows.map((row) => row.id);

    expect(ids).toContain("help:navigation:tabs");
    expect(ids).toContain("help:navigation:rows");
    expect(ids).toContain("help:navigation:activate");
    expect(ids).toContain("help:navigation:close");
  });

  it("omits actions and retains policy reasons when the pipeline is disabled", () => {
    const state = createSessionState();
    addBlock(state, { blockId: 1, active: true });

    const model = buildDcpPanelModel(
      baseInput({ state, config: { ...makeDefaultConfig(), enabled: false } }),
    );

    const manual = model.tabs.controls.rows.find((row) => row.id === "toggle-manual");
    expect(manual?.action).toBeUndefined();
    expect(manual?.unavailableReason).toBe("DCP is disabled by configuration.");
    expect(blockRow(model, 1)?.action).toBeUndefined();
    expect(blockRow(model, 1)?.block?.toggleLabel).toBeUndefined();
    expect(blockRow(model, 1)?.unavailableReason).toBe("DCP is disabled by configuration.");
  });

  it("leaves controls available when only permission is denied", () => {
    const state = createSessionState();
    state.compressPermission = "deny";
    const model = buildDcpPanelModel(baseInput({ state }));
    const manual = model.tabs.controls.rows.find((row) => row.id === "toggle-manual");
    expect(manual?.action).toEqual({ type: "toggle-manual" });
    expect(manual?.unavailableReason).toBeUndefined();
    expect(detail(model, "overview", "overview:permission")).toBe("deny");
  });

  it("reports sub-agent and model policy reasons without inventing actions", () => {
    const subAgentState = createSessionState();
    subAgentState.isSubAgent = true;
    const subAgentModel = buildDcpPanelModel(baseInput({ state: subAgentState }));
    expect(detail(subAgentModel, "overview", "overview:pipeline")).toBe(
      "DCP is disabled in sub-agent sessions.",
    );
    expect(subAgentModel.tabs.controls.rows.every((row) => row.action === undefined)).toBe(true);

    const modelState = createSessionState();
    const modelDisabled = buildDcpPanelModel(
      baseInput({
        state: modelState,
        model: { provider: "test", id: "disabled", contextWindow: 200_000 },
        config: { ...makeDefaultConfig(), disabledModels: ["test/disabled"] },
      }),
    );
    expect(detail(modelDisabled, "overview", "overview:pipeline")).toBe(
      "DCP is disabled for the current model.",
    );
  });

  it("retains a known context window when token usage is unavailable", () => {
    const model = buildDcpPanelModel(
      baseInput({ contextUsage: { tokens: null, contextWindow: 200_000, percent: null } }),
    );
    expect(detail(model, "overview", "overview:context")).toBe(
      "Unavailable (context window: 200k)",
    );
  });

  it("keeps unknown percentages and zero token values", () => {
    const unknown = buildDcpPanelModel(
      baseInput({ contextUsage: { tokens: 20_000, contextWindow: 200_000, percent: null } }),
    );
    expect(detail(unknown, "overview", "overview:context")).toBe("~20k / 200k (unknown)");

    const zero = buildDcpPanelModel(
      baseInput({ contextUsage: { tokens: 0, contextWindow: 200_000, percent: 0 } }),
    );
    expect(detail(zero, "overview", "overview:context")).toBe("~0 / 200k (0%)");
  });

  it("keeps adapter-specific context availability and precision", () => {
    const state = createSessionState();
    const cases: Array<{ usage: ContextUsage | undefined; text: string; dashboard: string }> = [
      {
        usage: { tokens: 12345, contextWindow: 200000, percent: 6.1725 },
        text: "~12.3k / 200k (6.2%)",
        dashboard: "~12.3k / 200k (6.1725%)",
      },
      {
        usage: { tokens: 12345, contextWindow: 200000, percent: null },
        text: "Unavailable (context window: 200k)",
        dashboard: "~12.3k / 200k (unknown)",
      },
      {
        usage: { tokens: null, contextWindow: 0, percent: null },
        text: "Unavailable (context window: 0)",
        dashboard: "Unavailable",
      },
      {
        usage: { tokens: 0, contextWindow: 200000, percent: 0 },
        text: "~0 / 200k (0.0%)",
        dashboard: "~0 / 200k (0%)",
      },
    ];

    for (const { usage, text, dashboard } of cases) {
      expect(contextCommand(state, usage)).toContain(text);
      const model = buildDcpPanelModel(baseInput({ state, contextUsage: usage }));
      expect(detail(model, "overview", "overview:context")).toBe(dashboard);
    }
  });

  it("keeps text manual-mode values distinct from dashboard labels", () => {
    const state = createSessionState();
    state.manualMode = "active";

    expect(contextCommand(state, undefined)).toContain("  Manual mode:                 active");
    const model = buildDcpPanelModel(baseInput({ state, contextUsage: undefined }));
    expect(detail(model, "overview", "overview:manual-mode")).toBe("on");
  });

  it("shows explicit unavailable values when data is missing", () => {
    const state = createSessionState();
    addBlock(state, { blockId: 1 });
    const model = buildDcpPanelModel(
      baseInput({
        state,
        model: undefined,
        contextUsage: undefined,
        lifetimeStats: undefined,
        compressToolActive: false,
      }),
    );

    expect(detail(model, "overview", "overview:model")).toBe("Unavailable");
    expect(detail(model, "overview", "overview:context")).toBe("Unavailable");
    expect(detail(model, "overview", "overview:max-limit")).toBe("Unavailable");
    expect(detail(model, "overview", "overview:min-limit")).toBe("Unavailable");
    expect(detail(model, "overview", "overview:compress-tool")).toBe("inactive");
    expect(detail(model, "statistics", "statistics:lifetime-sessions")).toBe("Unavailable");
    expect(detail(model, "statistics", "statistics:lifetime-pruning-tokens-saved")).toBe(
      "Unavailable",
    );
  });

  it("uses the current model view for thresholds without mutating cached state", () => {
    const state = createSessionState();
    state.modelProvider = "stale";
    state.modelId = "stale-model";
    state.modelContextWindow = 100;

    const model = buildDcpPanelModel(
      baseInput({
        state,
        model: { provider: "anthropic", id: "claude", contextWindow: 200_000 },
        config: makeDefaultConfig({ maxContextLimit: "50%" }),
        contextUsage: { tokens: 90_000, contextWindow: 200_000, percent: 45 },
      }),
    );

    expect(detail(model, "overview", "overview:model")).toBe("anthropic/claude");
    expect(detail(model, "overview", "overview:max-limit")).toBe("100k");
    expect(state.modelProvider).toBe("stale");
    expect(state.modelId).toBe("stale-model");
    expect(state.modelContextWindow).toBe(100);
  });

  it("prefers the session permission override over the configured default", () => {
    const state = createSessionState();
    state.compressPermission = "ask";
    const model = buildDcpPanelModel(
      baseInput({ state, config: makeDefaultConfig({ permission: "deny" }) }),
    );
    expect(detail(model, "overview", "overview:permission")).toBe("ask");
  });

  it("does not mutate projection inputs", () => {
    const state = createSessionState();
    state.prune.tools.set("a", 1);
    addBlock(state, { blockId: 2, active: true });
    addBlock(state, { blockId: 1, active: false, deactivatedByUser: true });
    const config = makeDefaultConfig();
    const stateSnapshot = structuredClone(state);
    const configSnapshot = structuredClone(config);

    const model = buildDcpPanelModel(baseInput({ state, config }));

    expect(state).toEqual(stateSnapshot);
    expect(config).toEqual(configSnapshot);
    expect(model.tabs.blocks.rows.map((row) => row.id)).toEqual(["block:1", "block:2"]);
  });

  it("labels numeric block ids in ascending order", () => {
    const state = createSessionState();
    addBlock(state, { blockId: 10 });
    addBlock(state, { blockId: 2 });

    const model = buildDcpPanelModel(baseInput({ state }));

    expect(model.tabs.blocks.rows.map((row) => row.id)).toEqual(["block:2", "block:10"]);
    expect(label(model, "blocks", "block:10")).toBe("topic");
  });
});
