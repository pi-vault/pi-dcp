import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { createSessionState } from "../src/state/state.ts";
import type { CompressionBlock } from "../src/state/types.ts";
import {
  buildDcpPanelModel,
  type DcpPanelModel,
  type DcpPanelModelInput,
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

function blocksModel(count: number, topic = "topic"): DcpPanelModel {
  return modelWithBlocks(count, topic);
}

function emptyModel(): DcpPanelModel {
  return { status: [], statistics: [], actions: [], blocks: [] };
}

function text(result: { lines: string[] }): string {
  return result.lines.join("\n");
}

describe("renderDcpPanel", () => {
  it("frames a bounded view with heavy corners and two-column padding", () => {
    const result = renderDcpPanel(modelWithBlocks(1), { offset: 0 }, identity, 60, 40);

    expect(result.lines).toHaveLength(22);
    expect(result.actionsVisible).toBe(true);
    for (const line of result.lines) expect(visibleWidth(line)).toBe(60);
    expect(result.lines[0]).toBe(`┏${"━".repeat(58)}┓`);
    expect(result.lines[1]).toBe(`┃${" ".repeat(58)}┃`);
    expect(result.lines[2]?.startsWith("┃  DCP Panel")).toBe(true);
    expect(result.lines.at(-2)).toBe(`┃${" ".repeat(58)}┃`);
    expect(result.lines.at(-1)).toBe(`┗${"━".repeat(58)}┛`);
  });

  it("caps height at 85% and shows three interactive rows at 60x24", () => {
    const result = renderDcpPanel(modelWithBlocks(40), { offset: 0 }, identity, 60, 24);

    expect(result.lines).toHaveLength(20);
    for (const line of result.lines) expect(visibleWidth(line)).toBe(60);
    const rendered = text(result);
    expect(rendered).toContain("Manual mode: off");
    expect(rendered).toContain("Compress permission: allow");
    expect(rendered).toContain("Sweep eligible outputs");
    expect(rendered).not.toContain("Close panel");
  });

  it("pins a single list row at 60x11", () => {
    const result = renderDcpPanel(modelWithBlocks(40), { offset: 0 }, identity, 60, 11);

    expect(result.lines).toHaveLength(9);
    const rendered = text(result);
    expect(rendered).toContain("Manual mode: off");
    expect(rendered).not.toContain("Compress permission");
    expect(rendered).not.toContain("Context ");
  });

  it("fits all nine information lines on a tall terminal", () => {
    const rendered = text(renderDcpPanel(modelWithBlocks(1), { offset: 0 }, identity, 80, 40));

    expect(rendered).toContain("Model test/test-model");
    expect(rendered).toContain("Context ~20k / 200k (10%)");
    expect(rendered).toContain("Limits max 100k / min 50k · Mode range");
    expect(rendered).toContain("Permission allow · Manual off");
    expect(rendered).toContain("Pipeline enabled");
    expect(rendered).toContain("Tool active");
    expect(rendered).toContain("Session saved ~0 · pruned 0 · compressed 0");
    expect(rendered).toContain("Lifetime saved ~1k · sessions 3");
    expect(rendered).toContain("Lifetime tools 4 · messages 2");
  });

  it("uses semantic theme roles with an accent marker and no row inversion", () => {
    const calls: Array<{ role: string; text: string }> = [];
    const theme: DcpTheme = {
      fg: (role, value) => {
        calls.push({ role, text: value });
        return value;
      },
      bg: (_role, value) => value,
      bold: (value) => value,
      inverse: () => {
        throw new Error("inverse must not be used");
      },
    };

    const result = renderDcpPanel(
      modelWithBlocks(1),
      { selectedRowId: "block:1", offset: 0, lastActionMessage: "Manual mode: on" },
      theme,
      80,
      40,
    );

    expect(calls.some(({ role, text: value }) => role === "accent" && value.includes("▸"))).toBe(
      true,
    );
    expect(calls.some(({ role }) => role === "borderAccent")).toBe(true);
    expect(calls.some(({ role }) => role === "dim")).toBe(true);
    expect(text(result)).toContain("▸");
  });

  it("reveals the selected block and clamps offsets without mutating inputs", () => {
    const model = modelWithBlocks(40);
    const view: DcpPanelView = { selectedRowId: "block:40", offset: 0 };

    const result = renderDcpPanel(model, view, identity, 60, 24);

    expect(result.offset).toBe(41);
    expect(text(result)).toContain("Block b40:");
    expect(view.offset).toBe(0);

    const clampedLow = renderDcpPanel(
      model,
      { selectedRowId: "toggle-manual", offset: -5 },
      identity,
      60,
      24,
    );
    expect(clampedLow.offset).toBe(0);

    const stale = renderDcpPanel(model, { selectedRowId: "missing", offset: 0 }, identity, 60, 24);
    expect(text(stale)).toContain("▸ Manual mode: off");
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
      {
        selectedRowId: "block:1",
        offset: 0,
        lastActionMessage: "line1\nline2\ttab",
      },
      identity,
      60,
      40,
    );

    for (const line of result.lines) {
      expect(line).not.toMatch(/[\r\n\t]/);
      expect(visibleWidth(line)).toBe(60);
    }
  });

  it.each([60, 80, 120])("keeps block identity and lifecycle suffixes at %i columns", (width) => {
    const state = createSessionState();
    for (let id = 1; id <= 3; id++) {
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

    const rendered = text(renderDcpPanel(model, { offset: 0 }, identity, width, 40));

    expect(rendered).toContain("Block b1:");
    expect(rendered).toContain("Deactivate");
    expect(rendered).toContain("Reactivate");
    expect(rendered).toContain("Inactive");
  });

  it.each([1, 6, 7, 8, 25])("returns a bounded close-only fallback at width %i", (width) => {
    const result = renderDcpPanel(modelWithBlocks(2), { offset: 0 }, identity, width, 24);
    expect(result.actionsVisible).toBe(false);
    expect(result.offset).toBe(0);
    for (const line of result.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  });

  it.each([1, 10])("returns a close-only fallback at terminal height %i", (height) => {
    const result = renderDcpPanel(modelWithBlocks(2), { offset: 0 }, identity, 60, height);
    expect(result.actionsVisible).toBe(false);
    expect(result.lines.length).toBeLessThanOrEqual(Math.max(1, Math.floor(height * 0.85)));
  });

  it("renders a normal view at the 26-column and 9-row boundary", () => {
    const result = renderDcpPanel(modelWithBlocks(2), { offset: 0 }, identity, 26, 11);
    expect(result.actionsVisible).toBe(true);
    expect(result.lines).toHaveLength(9);
  });

  it("reserves a separate feedback row and picks the longest fitting hint", () => {
    const model = modelWithBlocks(1);
    const withFeedback = renderDcpPanel(
      model,
      { offset: 0, lastActionMessage: "Manual mode: on. Automatic compression is paused." },
      identity,
      60,
      40,
    );
    expect(text(withFeedback)).toContain("Last action: Manual mode: on");

    const without = renderDcpPanel(model, { offset: 0 }, identity, 60, 40);
    expect(without.lines).toHaveLength(withFeedback.lines.length);
  });

  it("falls back to shorter key hints as space shrinks", () => {
    const model = modelWithBlocks(1);
    expect(text(renderDcpPanel(model, { offset: 0 }, identity, 60, 40))).toContain(
      "↑/↓ j/k navigate · Enter run · Esc/q close",
    );
    expect(text(renderDcpPanel(model, { offset: 0 }, identity, 30, 40))).toContain(
      "Enter run · Esc/q close",
    );
    expect(text(renderDcpPanel(model, { offset: 0 }, identity, 26, 40))).toContain("Esc/q close");
  });

  it("disables actions for an empty list", () => {
    const result = renderDcpPanel(emptyModel(), { offset: 0 }, identity, 60, 40);
    expect(result.actionsVisible).toBe(false);
    expect(result.offset).toBe(0);
    expect(text(result)).not.toContain("▸");
  });

  it("does not mutate frozen inputs", () => {
    const model = Object.freeze(blocksModel(3));
    const view = Object.freeze({ offset: 2, selectedRowId: "block:2" });

    expect(() => renderDcpPanel(model, view, Object.freeze(identity), 80, 24)).not.toThrow();
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
