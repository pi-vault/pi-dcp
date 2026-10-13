import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { createSessionState } from "../src/state/state.ts";
import type { CompressionBlock } from "../src/state/types.ts";
import {
  buildDcpPanelModel,
  createDcpPanelNavigation,
  DCP_PANEL_TABS,
  type DcpPanelModel,
  type DcpPanelModelInput,
  type DcpPanelNavigation,
  type DcpPanelTab,
} from "../src/tui/panel-model.ts";
import {
  renderDcpPanel,
  renderDcpPanelFallback,
  type DcpPanelView,
} from "../src/tui/panel-render.ts";
import type { DcpTheme } from "../src/tui/theme.ts";
import { makeDefaultConfig } from "./helpers.ts";

const identity: DcpTheme = {
  fg: (_color, text) => text,
  bg: (_color, text) => text,
  bold: (text) => text,
  inverse: (text) => text,
};

function makeBlock(blockId: number, topic: string): CompressionBlock {
  return {
    blockId,
    runId: 1,
    active: true,
    deactivatedByUser: false,
    compressedTokens: 100,
    summaryTokens: 10,
    durationMs: 5,
    mode: "range",
    topic,
    batchTopic: undefined,
    startIndex: 0,
    endIndex: 1,
    anchorIndex: 0,
    compressToolCallId: "call",
    startKey: `k${blockId}`,
    endKey: `e${blockId}`,
    anchorKey: `k${blockId}`,
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
  };
}

function baseInput(overrides: Partial<DcpPanelModelInput> = {}): DcpPanelModelInput {
  return {
    state: createSessionState(),
    config: makeDefaultConfig({ maxContextLimit: 100_000, minContextLimit: 50_000 }),
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

function modelWithBlocks(count: number, topic = "topic"): DcpPanelModel {
  const state = createSessionState();
  for (let blockId = 1; blockId <= count; blockId++) {
    state.prune.messages.blocksById.set(blockId, makeBlock(blockId, `${topic} ${blockId}`));
  }
  return buildDcpPanelModel(baseInput({ state }));
}

function view(
  activeTab: DcpPanelTab = "overview",
  active: { selectedRowId?: string; offset?: number } = {},
  lastActionMessage?: string,
): DcpPanelView {
  const navigation: DcpPanelNavigation = createDcpPanelNavigation(activeTab);
  navigation.tabs[activeTab] = {
    ...(active.selectedRowId === undefined ? {} : { selectedRowId: active.selectedRowId }),
    offset: active.offset ?? 0,
  };
  return { navigation, ...(lastActionMessage === undefined ? {} : { lastActionMessage }) };
}

function text(result: { lines: string[] }): string {
  return result.lines.join("\n");
}

describe("renderDcpPanel", () => {
  it("frames a bounded view with heavy corners and two-column padding", () => {
    const result = renderDcpPanel(modelWithBlocks(1), view(), identity, 60, 40);

    expect(result.lines).toHaveLength(24);
    expect(result.actionsVisible).toBe(true);
    for (const line of result.lines) expect(visibleWidth(line)).toBe(60);
    expect(result.lines[0]).toBe(`┏${"━".repeat(58)}┓`);
    expect(result.lines[1]).toBe(`┃${" ".repeat(58)}┃`);
    expect(result.lines[2]?.startsWith("┃  DCP Panel")).toBe(true);
    expect(result.lines.at(-2)).toBe(`┃${" ".repeat(58)}┃`);
    expect(result.lines.at(-1)).toBe(`┗${"━".repeat(58)}┛`);
  });

  it("caps height at 85% with one body row per chrome budget", () => {
    const tall = renderDcpPanel(modelWithBlocks(40), view("blocks"), identity, 60, 40);
    const short = renderDcpPanel(modelWithBlocks(40), view("blocks"), identity, 60, 24);

    expect(tall.lines).toHaveLength(34);
    expect(short.lines).toHaveLength(20);
    for (const line of short.lines) expect(visibleWidth(line)).toBe(60);
  });

  it("renders one body row at terminal height twelve and falls back at eleven", () => {
    const normal = renderDcpPanel(modelWithBlocks(40), view(), identity, 60, 12);
    expect(normal.actionsVisible).toBe(true);
    expect(normal.lines).toHaveLength(10);

    const fallback = renderDcpPanel(modelWithBlocks(40), view(), identity, 60, 11);
    expect(fallback.actionsVisible).toBe(false);
  });

  it("renders a normal view at the 26-column and 12-row boundary", () => {
    const result = renderDcpPanel(modelWithBlocks(1), view(), identity, 26, 24);
    expect(result.actionsVisible).toBe(true);
    expect(result.lines.length).toBeGreaterThan(0);
  });

  it("renders only the active tab body", () => {
    const model = modelWithBlocks(2);
    const overview = text(renderDcpPanel(model, view("overview"), identity, 100, 40));
    const stats = text(renderDcpPanel(model, view("statistics"), identity, 100, 40));

    expect(overview).toContain("Model test/test-model");
    expect(overview).not.toContain("Cumulative pruning tokens saved");
    expect(stats).toContain("Cumulative pruning tokens saved");
    expect(stats).not.toContain("Model test/test-model");
  });

  it("shows the full tab bar and inverts only the active tab label", () => {
    const inverses: string[] = [];
    const theme: DcpTheme = {
      ...identity,
      inverse: (value) => {
        inverses.push(value);
        return value;
      },
    };

    const rendered = text(renderDcpPanel(modelWithBlocks(1), view("blocks"), theme, 100, 40));

    for (const title of ["Overview", "Controls", "Blocks", "Statistics", "Help"]) {
      expect(rendered).toContain(title);
    }
    expect(inverses).toEqual([" Blocks "]);
  });

  it("windows neighboring tab labels with indicators at narrow widths", () => {
    const rendered = text(renderDcpPanel(modelWithBlocks(1), view("overview"), identity, 30, 40));

    expect(rendered).toContain("Overview");
    expect(rendered).toContain("›");
    expect(rendered).not.toContain("Help");
  });

  it("says No compression blocks on an empty Blocks tab with controls available", () => {
    const result = renderDcpPanel(modelWithBlocks(0), view("blocks"), identity, 60, 40);

    expect(result.actionsVisible).toBe(true);
    expect(text(result)).toContain("No compression blocks.");
  });

  it("keeps read-only tabs scrollable by reporting a normal viewport", () => {
    const result = renderDcpPanel(modelWithBlocks(1), view("statistics"), identity, 60, 40);
    expect(result.actionsVisible).toBe(true);
  });

  it("keeps dynamic values and feedback on one terminal line", () => {
    const model = modelWithBlocks(1);
    const row = model.tabs.overview.rows[0];
    if (row) row.detail = `${row.detail ?? ""}\r\n extra\tvalue`;

    const result = renderDcpPanel(
      model,
      view("overview", {}, "line1\nline2\ttab"),
      identity,
      160,
      40,
    );

    for (const line of result.lines) {
      expect(line).not.toMatch(/[\r\n\t]/);
      expect(visibleWidth(line)).toBe(160);
    }
    expect(text(result)).toContain("extra value");
    expect(text(result)).toContain("Last action: line1 line2 tab");
  });

  it("flattens control characters and bounds wide glyphs", () => {
    const state = createSessionState();
    state.prune.messages.blocksById.set(
      1,
      makeBlock(1, "日本語🎉 very long topic\nwith\ttabs\r\nand more ".repeat(10)),
    );
    const model = buildDcpPanelModel(baseInput({ state }));

    const result = renderDcpPanel(
      model,
      view("blocks", { selectedRowId: "block:1" }),
      identity,
      60,
      40,
    );

    for (const line of result.lines) {
      expect(line).not.toMatch(/[\r\n\t]/);
      expect(visibleWidth(line)).toBe(60);
    }
  });

  it("reserves block identity and lifecycle before topic text", () => {
    const state = createSessionState();
    for (const id of [1, 2, 3]) {
      const block = makeBlock(id, "very long topic ".repeat(30));
      block.active = id === 1;
      block.deactivatedByUser = id === 2;
      state.prune.messages.blocksById.set(id, block);
    }
    const model = buildDcpPanelModel(
      baseInput({
        state,
        model: undefined,
        contextUsage: undefined,
        lifetimeStats: undefined,
        compressToolActive: false,
      }),
    );

    const rendered = text(
      renderDcpPanel(model, view("blocks", { selectedRowId: "block:1" }), identity, 80, 40),
    );

    expect(rendered).toContain("Block b1:");
    expect(rendered).toContain("Active");
    expect(rendered).toContain("Deactivate");
    expect(rendered).toContain("User-deactivated");
    expect(rendered).toContain("Reactivate");
    expect(rendered).toContain("Inactive");
  });

  it("keeps the mode and token detail when a block topic is long", () => {
    const state = createSessionState();
    state.prune.messages.blocksById.set(1, makeBlock(1, "very long topic ".repeat(30)));
    const model = buildDcpPanelModel(baseInput({ state }));

    const rendered = text(
      renderDcpPanel(model, view("blocks", { selectedRowId: "block:1" }), identity, 60, 40),
    );

    expect(rendered).toContain("range · ~100 tokens");
  });

  it("falls back when a visible block identity and lifecycle cannot fit", () => {
    const state = createSessionState();
    const id = Number.MAX_SAFE_INTEGER;
    state.prune.messages.blocksById.set(id, makeBlock(id, "topic"));
    const model = buildDcpPanelModel(baseInput({ state }));

    const result = renderDcpPanel(
      model,
      view("blocks", { selectedRowId: `block:${id}` }),
      identity,
      26,
      24,
    );

    expect(result.actionsVisible).toBe(false);
    expect(text(result)).toContain("Esc/q close");
  });

  it("shows a complete block policy reason or omits it without truncation", () => {
    const state = createSessionState();
    state.prune.messages.blocksById.set(1, makeBlock(1, "long topic ".repeat(20)));
    const model = buildDcpPanelModel(
      baseInput({ state, config: { ...makeDefaultConfig(), enabled: false } }),
    );

    const wide = text(
      renderDcpPanel(model, view("blocks", { selectedRowId: "block:1" }), identity, 140, 40),
    );
    expect(wide).toContain("[DCP is disabled by configuration.]");

    const narrow = text(
      renderDcpPanel(model, view("blocks", { selectedRowId: "block:1" }), identity, 60, 40),
    );
    expect(narrow).not.toContain("DCP is disabled by configuration.");
  });

  it("restores the active tab offset and clamps without mutating inputs", () => {
    const model = modelWithBlocks(40);
    const navigation = createDcpPanelNavigation("blocks");
    navigation.tabs.blocks = { selectedRowId: "block:40", offset: 0 };
    const frozen = Object.freeze({ navigation: Object.freeze({ ...navigation }) });

    const result = renderDcpPanel(model, frozen as unknown as DcpPanelView, identity, 60, 24);

    expect(result.offset).toBe(29);
    expect(text(result)).toContain("Block b40:");
    expect(navigation.tabs.blocks.offset).toBe(0);

    const clamped = renderDcpPanel(
      model,
      view("blocks", { selectedRowId: "block:1", offset: -5 }),
      identity,
      60,
      24,
    );
    expect(clamped.offset).toBe(0);

    const stale = renderDcpPanel(
      model,
      view("blocks", { selectedRowId: "missing" }),
      identity,
      60,
      24,
    );
    expect(text(stale)).toContain("Block b1:");
  });

  it("reserves a separate feedback row and picks the longest fitting hint", () => {
    const model = modelWithBlocks(1);
    const withFeedback = renderDcpPanel(
      model,
      view("overview", {}, "Manual mode: on. Automatic compression is paused."),
      identity,
      80,
      40,
    );
    expect(text(withFeedback)).toContain("Last action: Manual mode: on");

    const without = renderDcpPanel(model, view("overview"), identity, 80, 40);
    expect(without.lines).toHaveLength(withFeedback.lines.length);

    expect(text(without)).toContain("Tab/Shift-Tab tabs");
    expect(text(renderDcpPanel(model, view("overview"), identity, 30, 40))).toContain(
      "Esc/q close",
    );
    expect(text(renderDcpPanel(model, view("overview"), identity, 26, 40))).toContain("q");
  });

  it("disables actions for an empty list render", () => {
    const empty: DcpPanelModel = {
      tabs: {
        overview: { title: "Overview", rows: [] },
        controls: { title: "Controls", rows: [] },
        blocks: { title: "Blocks", rows: [] },
        statistics: { title: "Statistics", rows: [] },
        help: { title: "Help", rows: [] },
      },
    };
    const result = renderDcpPanel(empty, view("blocks"), identity, 60, 40);
    expect(result.actionsVisible).toBe(true);
    expect(result.offset).toBe(0);
    expect(text(result)).toContain("No compression blocks.");
  });

  it.each(["overview", "controls", "blocks", "statistics", "help"] as const)(
    "renders the %s tab at every supported size",
    (tab) => {
      const model = modelWithBlocks(6);
      for (const width of [0, 1, 25, 26, 32, 60, 80, 120]) {
        for (const height of [1, 10, 11, 12, 24, 40]) {
          const result = renderDcpPanel(model, view(tab), identity, width, height);
          for (const line of result.lines) {
            expect(visibleWidth(line)).toBeLessThanOrEqual(Math.max(0, width));
          }
          expect(result.lines.length).toBeLessThanOrEqual(Math.max(1, Math.floor(height * 0.85)));
        }
      }
    },
  );

  it("does not mutate frozen model and view inputs", () => {
    const model = Object.freeze(modelWithBlocks(3));
    const viewInput = Object.freeze(view("blocks", { selectedRowId: "block:2", offset: 1 }));

    expect(() => renderDcpPanel(model, viewInput, Object.freeze(identity), 80, 24)).not.toThrow();
    expect(DCP_PANEL_TABS).toHaveLength(5);
  });
});

describe("renderDcpPanelFallback", () => {
  it("returns bounded plain close instructions", () => {
    const result = renderDcpPanelFallback(80, 24);
    expect(result.actionsVisible).toBe(false);
    expect(result.offset).toBe(0);
    expect(text(result)).toContain("close");
    for (const line of result.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(80);
  });

  it("keeps an intact short close key below eleven columns", () => {
    expect(renderDcpPanelFallback(10, 24).lines).toEqual(["q"]);
  });

  it("normalizes zero width to one empty line", () => {
    const result = renderDcpPanelFallback(0, 24);
    expect(result.lines).toEqual([""]);
    expect(result.actionsVisible).toBe(false);
  });
});
