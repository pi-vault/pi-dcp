import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import createExtension from "../src/index.ts";
import { DcpPanelComponent, openDcpPanel } from "../src/tui/panel.ts";
import * as panelRender from "../src/tui/panel-render.ts";
import * as sweepModule from "../src/commands/sweep.ts";
import {
  buildDcpPanelModel,
  createDcpPanelNavigation,
  type DcpPanelAction,
  type DcpPanelModel,
  type DcpPanelNavigation,
} from "../src/tui/panel-model.ts";
import { createSessionState } from "../src/state/state.ts";
import * as persistence from "../src/state/persistence.ts";
import type { CompressionBlock } from "../src/state/types.ts";
import { makeDefaultConfig } from "./helpers.ts";
import { createExtensionHarness, type ExtensionHarness } from "./extension-harness.ts";

const agentDir = `${os.tmpdir()}/dcp-panel-test-${Date.now()}-${Math.random()}`;
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

beforeEach(() => {
  process.env.PI_CODING_AGENT_DIR = agentDir;
  fs.mkdirSync(agentDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(agentDir, { recursive: true, force: true });
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
});

function writeDcpConfig(config: unknown): void {
  const configDir = path.join(agentDir, "extensions");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "dcp.json"), JSON.stringify(config));
}

function fakeTheme(): Theme {
  const identity = (text: string) => text;
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: identity,
    italic: identity,
    underline: identity,
    inverse: identity,
    strikethrough: identity,
  } as unknown as Theme;
}

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

function modelWithBlocks(count: number, topic = "topic"): DcpPanelModel {
  const state = createSessionState();
  for (let blockId = 1; blockId <= count; blockId++) {
    state.prune.messages.blocksById.set(blockId, makeBlock(blockId, `${topic} ${blockId}`));
  }
  return buildDcpPanelModel({
    state,
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
  });
}

interface CapturedAction {
  action: DcpPanelAction;
  navigation: DcpPanelNavigation;
}

function makeComponent(
  model: DcpPanelModel,
  overrides: Partial<{
    theme: Theme;
    getHeight: () => number;
    getWidth: () => number;
    initialNavigation: DcpPanelNavigation;
    lastActionMessage: string;
  }> = {},
) {
  const actions: CapturedAction[] = [];
  const requestRender = vi.fn();
  const component = new DcpPanelComponent(model, {
    theme: overrides.theme ?? fakeTheme(),
    getHeight: overrides.getHeight ?? (() => 24),
    getWidth: overrides.getWidth ?? (() => 80),
    requestRender,
    onAction: (action, navigation) => actions.push({ action, navigation }),
    initialNavigation: overrides.initialNavigation,
    lastActionMessage: overrides.lastActionMessage,
  });
  return { component, actions, requestRender };
}

function selectedLine(rendered: string[]): string | undefined {
  return rendered.find((line) => line.includes("▸"));
}

describe("DcpPanelComponent rendering", () => {
  it.each([60, 80, 120])("bounds every rendered line to %i columns", (width) => {
    const { component } = makeComponent(
      modelWithBlocks(40, "日本語 very long topic with wide characters"),
      { getHeight: () => 40 },
    );

    const lines = component.render(width);

    expect(lines.length).toBeLessThanOrEqual(34);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  });

  it.each([60, 80, 120])("shows overview fields at %i columns", (width) => {
    const { component } = makeComponent(modelWithBlocks(1));

    const rendered = component.render(width).join("\n");

    expect(rendered).toContain("Pipeline");
    expect(rendered).toContain("enabled");
    expect(rendered).toContain("Compress tool");
    expect(rendered).toContain("active");
  });

  it("shows lifetime totals on the Statistics tab", () => {
    const navigation = createDcpPanelNavigation("statistics");
    const { component } = makeComponent(modelWithBlocks(1), {
      initialNavigation: navigation,
      getHeight: () => 40,
    });

    const rendered = component.render(120).join("\n");

    expect(rendered).toContain("Total tokens saved");
    expect(rendered).toContain("~1k");
    expect(rendered).toContain("Sessions tracked");
    expect(rendered).toContain("3");
  });

  it("can browse a long list of inactive blocks without activating them", () => {
    const model = modelWithBlocks(40);
    for (const row of model.tabs.blocks.rows) {
      row.action = undefined;
      row.block = row.block ? { ...row.block, toggleLabel: undefined } : undefined;
      row.unavailableReason = undefined;
    }
    const navigation = createDcpPanelNavigation("blocks");
    navigation.tabs.blocks = { selectedRowId: "block:1", offset: 0 };
    const { component, actions } = makeComponent(model, {
      initialNavigation: navigation,
      getHeight: () => 40,
    });

    for (let step = 0; step < 50; step++) component.handleInput("j");

    expect(component.render(80).join("\n")).toContain("Block b40:");
    component.handleInput("\r");
    expect(actions).toEqual([]);
    component.handleInput("q");
    expect(actions.map((entry) => entry.action)).toEqual([{ type: "close" }]);
  });

  it.each(["\n", "\r", "\r\n", "\t"])(
    "keeps block labels on one terminal line for %j",
    (separator) => {
      const navigation = createDcpPanelNavigation("blocks");
      const { component } = makeComponent(modelWithBlocks(1, `first${separator}second`), {
        initialNavigation: navigation,
        getHeight: () => 40,
      });

      const rendered = component.render(120);

      expect(rendered.join("\n")).toContain("first second");
      for (const line of rendered) expect(line).not.toMatch(/[\r\n\t]/);
    },
  );

  it.each([60, 80, 120])(
    "keeps long block topics from hiding identity or lifecycle at %i columns",
    (width) => {
      const state = createSessionState();
      for (let id = 1; id <= 3; id++) {
        const block = makeBlock(id, "very long topic ".repeat(30));
        block.active = id === 1;
        block.deactivatedByUser = id === 2;
        state.prune.messages.blocksById.set(id, block);
      }
      const model = buildDcpPanelModel({
        state,
        config: makeDefaultConfig(),
        model: undefined,
        contextUsage: undefined,
        lifetimeStats: undefined,
        compressToolActive: false,
      });
      const navigation = createDcpPanelNavigation("blocks");
      navigation.tabs.blocks = { selectedRowId: "block:1", offset: 0 };
      const { component } = makeComponent(model, {
        initialNavigation: navigation,
        getHeight: () => 40,
      });

      const rendered = component.render(width).join("\n");

      expect(rendered).toContain("Block b1:");
      expect(rendered).toContain("Active");
      expect(rendered).toContain("Deactivate");
      expect(rendered).toContain("User-deactivated");
      expect(rendered).toContain("Reactivate");
      expect(rendered).toContain("Inactive");
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    },
  );

  it("keeps policy-disabled block identifiers and lifecycle visible at 60 columns", () => {
    const state = createSessionState();
    state.prune.messages.blocksById.set(1, makeBlock(1, "long topic ".repeat(30)));
    state.prune.messages.blocksById.set(2, makeBlock(2, "another long topic ".repeat(30)));
    const config = makeDefaultConfig();
    config.enabled = false;
    const model = buildDcpPanelModel({
      state,
      config,
      model: undefined,
      contextUsage: undefined,
      lifetimeStats: undefined,
      compressToolActive: false,
    });
    const navigation = createDcpPanelNavigation("blocks");
    const { component } = makeComponent(model, {
      initialNavigation: navigation,
      getHeight: () => 40,
    });

    const lines = component.render(60);

    for (const id of [1, 2]) {
      const row = lines.find((line) => line.includes(`Block b${id}:`));
      expect(row).toContain("Active");
      expect(visibleWidth(row ?? "")).toBeLessThanOrEqual(60);
    }
  });

  it.each([1, 2, 3, 8, 10])("keeps a usable close hint within a %i-row terminal", (height) => {
    const { component } = makeComponent(modelWithBlocks(2), {
      getHeight: () => height,
      lastActionMessage: "Manual mode: on",
    });

    const lines = component.render(60);

    expect(lines.length).toBeLessThanOrEqual(Math.max(1, Math.floor(height * 0.85)));
    expect(lines.some((line) => line.includes("close") || line.trim() === "q")).toBe(true);
  });

  it("keeps the selection visible while scrolling and after resize", () => {
    let height = 40;
    const navigation = createDcpPanelNavigation("blocks");
    const { component } = makeComponent(modelWithBlocks(30), {
      initialNavigation: navigation,
      getHeight: () => height,
    });

    for (let step = 0; step < 25; step++) component.handleInput("j");
    expect(selectedLine(component.render(80))).toBeDefined();

    height = 12;
    const resized = component.render(80);
    expect(resized.length).toBeLessThanOrEqual(10);
    expect(selectedLine(resized)).toBeDefined();
  });

  it("selects the initial tab and row by stable identity", () => {
    const navigation = createDcpPanelNavigation("blocks");
    navigation.tabs.blocks = { selectedRowId: "block:2", offset: 0 };
    const { component } = makeComponent(modelWithBlocks(2), { initialNavigation: navigation });

    expect(selectedLine(component.render(80))).toContain("Block b2:");
  });

  it("falls back to the first row when the initial id is missing", () => {
    const navigation = createDcpPanelNavigation("controls");
    navigation.tabs.controls = { selectedRowId: "missing", offset: 0 };
    const { component } = makeComponent(modelWithBlocks(2), { initialNavigation: navigation });

    expect(selectedLine(component.render(80))).toContain("Manual mode");
  });

  it("defaults to Overview with the first row selected", () => {
    const { component } = makeComponent(modelWithBlocks(2));
    expect(selectedLine(component.render(80))).toContain("Model");
  });

  it("renders the last action message on a bounded feedback row", () => {
    const { component } = makeComponent(modelWithBlocks(1), {
      lastActionMessage: "Manual mode: on. Automatic compression is paused.",
    });

    const wide = component.render(160).join("\n");
    expect(wide).toContain("Last action: Manual mode: on");

    const narrow = component.render(26);
    for (const line of narrow) expect(visibleWidth(line)).toBeLessThanOrEqual(26);
  });

  it("does not mutate a supplied navigation snapshot", () => {
    const navigation = createDcpPanelNavigation("controls");
    navigation.tabs.controls = { selectedRowId: "sweep", offset: 2 };
    const snapshot = structuredClone(navigation);

    const { component } = makeComponent(modelWithBlocks(3), { initialNavigation: navigation });
    component.render(80);
    component.handleInput("k");
    component.render(80);
    component.handleInput("\t");
    component.render(80);

    expect(navigation).toEqual(snapshot);
  });
});

describe("DcpPanelComponent input and activation", () => {
  it("navigates with j/k and completes the selected action after rendering", () => {
    const navigation = createDcpPanelNavigation("controls");
    const { component, actions } = makeComponent(modelWithBlocks(2), {
      initialNavigation: navigation,
    });

    component.render(60);
    component.handleInput("j");
    component.render(60);
    component.handleInput("k");
    component.render(60);
    component.handleInput("\r");

    expect(actions.map((entry) => entry.action)).toEqual([{ type: "toggle-manual" }]);
  });

  it("moves down with an arrow key", () => {
    const navigation = createDcpPanelNavigation("controls");
    const { component, actions } = makeComponent(modelWithBlocks(2), {
      initialNavigation: navigation,
    });
    component.render(60);
    component.handleInput("\u001b[B");
    component.render(60);
    component.handleInput("\r");
    expect(actions.map((entry) => entry.action)).toEqual([{ type: "cycle-permission" }]);
  });

  it("activates the selected row with Space", () => {
    const navigation = createDcpPanelNavigation("controls");
    const { component, actions } = makeComponent(modelWithBlocks(1), {
      initialNavigation: navigation,
    });
    component.render(60);
    component.handleInput(" ");
    expect(actions.map((entry) => entry.action)).toEqual([{ type: "toggle-manual" }]);
  });

  it("requests a render when the selection changes", () => {
    const navigation = createDcpPanelNavigation("controls");
    const { component, requestRender } = makeComponent(modelWithBlocks(3), {
      initialNavigation: navigation,
    });

    component.handleInput("j");

    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it("completes a close exactly once on Escape or q", () => {
    const { component, actions } = makeComponent(modelWithBlocks(1));

    component.handleInput("\u001b");
    component.handleInput("q");
    component.handleInput("\r");

    expect(actions.map((entry) => entry.action)).toEqual([{ type: "close" }]);
  });

  it("does not activate before the first successful render", () => {
    const navigation = createDcpPanelNavigation("controls");
    const { component, actions } = makeComponent(modelWithBlocks(1), {
      initialNavigation: navigation,
    });

    component.handleInput("\r");
    expect(actions).toEqual([]);

    component.handleInput("q");
    expect(actions.map((entry) => entry.action)).toEqual([{ type: "close" }]);
  });

  it("activates once after rendering the selected row", () => {
    const navigation = createDcpPanelNavigation("controls");
    const { component, actions } = makeComponent(modelWithBlocks(1), {
      initialNavigation: navigation,
    });

    component.render(80);
    component.handleInput("\r");
    component.handleInput("\r");

    expect(actions.map((entry) => entry.action)).toEqual([{ type: "toggle-manual" }]);
  });

  it("does not activate a moved selection until it is rendered", () => {
    const navigation = createDcpPanelNavigation("controls");
    const { component, actions } = makeComponent(modelWithBlocks(1), {
      initialNavigation: navigation,
    });

    component.render(80);
    component.handleInput("j");
    component.handleInput("\r");
    expect(actions).toEqual([]);

    component.render(80);
    component.handleInput("\r");
    expect(actions.map((entry) => entry.action)).toEqual([{ type: "cycle-permission" }]);
  });

  it("keeps the latest selection across repeated moves before rendering", () => {
    const navigation = createDcpPanelNavigation("controls");
    const { component } = makeComponent(modelWithBlocks(3), { initialNavigation: navigation });

    component.handleInput("j");
    component.handleInput("j");

    expect(selectedLine(component.render(80))).toContain("Sweep");
  });

  it("requires a render after invalidation", () => {
    const navigation = createDcpPanelNavigation("controls");
    const { component, actions } = makeComponent(modelWithBlocks(1), {
      initialNavigation: navigation,
    });

    component.render(80);
    component.invalidate();
    component.handleInput("\r");
    expect(actions).toEqual([]);

    component.render(80);
    component.handleInput("\r");
    expect(actions.map((entry) => entry.action)).toEqual([{ type: "toggle-manual" }]);
  });

  it("requires matching terminal dimensions", () => {
    let width = 80;
    const navigation = createDcpPanelNavigation("controls");
    const { component, actions } = makeComponent(modelWithBlocks(1), {
      initialNavigation: navigation,
      getWidth: () => width,
    });

    component.render(80);
    width = 100;
    component.handleInput("\r");
    expect(actions).toEqual([]);

    component.render(80);
    component.handleInput("\r");
    expect(actions.map((entry) => entry.action)).toEqual([{ type: "toggle-manual" }]);
  });

  it("disables navigation and activation after a tiny render until it recovers", () => {
    let height = 8;
    const navigation = createDcpPanelNavigation("controls");
    const { component, actions } = makeComponent(modelWithBlocks(3), {
      initialNavigation: navigation,
      getHeight: () => height,
    });

    component.render(60);
    component.handleInput("j");
    component.handleInput("\r");
    expect(actions).toEqual([]);

    height = 24;
    component.render(60);
    component.handleInput("j");
    component.render(60);
    component.handleInput("\r");
    expect(actions.map((entry) => entry.action)).toEqual([{ type: "cycle-permission" }]);
  });

  it("keeps plain controls usable when a theme method throws", () => {
    const badTheme = {
      fg: () => {
        throw new Error("theme failure");
      },
      bg: () => {
        throw new Error("theme failure");
      },
      bold: () => {
        throw new Error("theme failure");
      },
      inverse: () => {
        throw new Error("theme failure");
      },
    } as unknown as Theme;
    const navigation = createDcpPanelNavigation("controls");
    const { component, actions } = makeComponent(modelWithBlocks(1), {
      initialNavigation: navigation,
      theme: badTheme,
    });

    const rendered = component.render(80).join("\n");
    expect(rendered).toContain("DCP Panel");
    expect(rendered).toContain("Manual mode: off");

    component.handleInput("\r");
    expect(actions.map((entry) => entry.action)).toEqual([{ type: "toggle-manual" }]);
  });

  it("tolerates a non-string theme return without disabling controls", () => {
    const weirdTheme = {
      fg: () => 42,
      bg: () => 42,
      bold: () => 42,
      inverse: () => 42,
    } as unknown as Theme;
    const navigation = createDcpPanelNavigation("controls");
    const { component, actions } = makeComponent(modelWithBlocks(1), {
      initialNavigation: navigation,
      theme: weirdTheme,
    });

    expect(component.render(80).join("\n")).toContain("DCP Panel");
    component.handleInput("\r");
    expect(actions.map((entry) => entry.action)).toEqual([{ type: "toggle-manual" }]);
  });

  it("honors NO_COLOR while keeping controls usable", () => {
    const previous = process.env.NO_COLOR;
    process.env.NO_COLOR = "";
    try {
      const { component, actions } = makeComponent(modelWithBlocks(1));
      expect(component.render(80).join("\n")).toContain("DCP Panel");
      component.handleInput("q");
      expect(actions.map((entry) => entry.action)).toEqual([{ type: "close" }]);
    } finally {
      if (previous === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previous;
    }
  });

  it("falls back to a bounded plain view when the renderer throws", () => {
    const spy = vi.spyOn(panelRender, "renderDcpPanel").mockImplementation(() => {
      throw new Error("render failed");
    });
    try {
      const { component, actions } = makeComponent(modelWithBlocks(3));

      const lines = component.render(80);
      expect(lines.length).toBeLessThanOrEqual(34);
      for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(80);
      expect(lines.join("\n")).toContain("close");

      component.handleInput("j");
      component.handleInput("\r");
      expect(actions).toEqual([]);

      component.handleInput("q");
      expect(actions.map((entry) => entry.action)).toEqual([{ type: "close" }]);
    } finally {
      spy.mockRestore();
    }
  });

  it("recovers controls on a later component after a renderer failure", () => {
    const spy = vi.spyOn(panelRender, "renderDcpPanel").mockImplementationOnce(() => {
      throw new Error("render failed");
    });
    try {
      const navigation = createDcpPanelNavigation("controls");
      const failing = makeComponent(modelWithBlocks(1), { initialNavigation: navigation });
      failing.component.render(80);
      failing.component.handleInput("\r");
      expect(failing.actions).toEqual([]);

      const recovered = makeComponent(modelWithBlocks(1), { initialNavigation: navigation });
      recovered.component.render(80);
      recovered.component.handleInput("\r");
      expect(recovered.actions.map((entry) => entry.action)).toEqual([{ type: "toggle-manual" }]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("DcpPanelComponent tab navigation", () => {
  it("wraps tabs in both directions and requests a render", () => {
    const { component, requestRender } = makeComponent(modelWithBlocks(1));

    component.render(80);
    component.handleInput("\t");
    component.render(80);
    expect(selectedLine(component.render(80))).toContain("Manual mode");

    component.handleInput("\u001b[Z");
    component.render(80);
    expect(selectedLine(component.render(80))).toContain("Model");

    component.handleInput("\u001b[Z");
    component.render(80);
    expect(component.render(80).join("\n")).toContain("Help");

    expect(requestRender).toHaveBeenCalled();
  });

  it("restores independent tab viewports", () => {
    const navigation = createDcpPanelNavigation("blocks");
    navigation.tabs.blocks = { selectedRowId: "block:10", offset: 5 };
    navigation.tabs.controls = { selectedRowId: "sweep", offset: 0 };
    const { component } = makeComponent(modelWithBlocks(30), {
      initialNavigation: navigation,
      getHeight: () => 40,
    });

    component.render(80);
    component.handleInput("\u001b[Z");
    expect(selectedLine(component.render(80))).toContain("Sweep");

    component.handleInput("\t");
    const restored = component.render(80);
    expect(selectedLine(restored)).toContain("Block b10:");
    expect(restored.join("\n")).not.toContain("Block b1:");
  });

  it("scrolls read-only rows without completing", () => {
    const { component, actions } = makeComponent(modelWithBlocks(1));

    component.render(80);
    component.handleInput("j");
    component.handleInput("j");
    component.render(80);
    component.handleInput("\r");

    expect(actions).toEqual([]);
  });

  it("invalidates activation when changing tabs", () => {
    const navigation = createDcpPanelNavigation("controls");
    const { component, actions } = makeComponent(modelWithBlocks(2), {
      initialNavigation: navigation,
    });

    component.render(80);
    component.handleInput("\t");
    component.handleInput("\r");
    expect(actions).toEqual([]);

    component.render(80);
    component.handleInput("\r");
    expect(actions.map((entry) => entry.action)).toEqual([{ type: "toggle-block", blockId: 1 }]);
  });

  it("passes a copied complete navigation snapshot with every action", () => {
    const navigation = createDcpPanelNavigation("controls");
    navigation.tabs.overview = { selectedRowId: "overview:user-turn", offset: 4 };
    const { component, actions } = makeComponent(modelWithBlocks(2), {
      initialNavigation: navigation,
    });

    component.render(80);
    component.handleInput("\r");

    const snapshot = actions[0]?.navigation;
    if (snapshot === undefined) throw new Error("expected a navigation snapshot");
    expect(snapshot.activeTab).toBe("controls");
    expect(snapshot.tabs.controls.selectedRowId).toBe("toggle-manual");
    expect(snapshot.tabs.overview).toEqual({ selectedRowId: "overview:user-turn", offset: 4 });
    snapshot.tabs.controls.selectedRowId = "sweep";
    expect(navigation.tabs.controls.selectedRowId).toBeUndefined();
  });
});

type Completion = { action: DcpPanelAction; navigation: DcpPanelNavigation };

function completion(action: DcpPanelAction, navigation?: DcpPanelNavigation): Completion {
  return { action, navigation: navigation ?? createDcpPanelNavigation() };
}

function createPanelHarness(options: Parameters<typeof createExtensionHarness>[0] = {}) {
  return createExtensionHarness({
    activeTools: ["read", "compress"],
    mode: "tui",
    hasUI: true,
    sessionDir: path.join(agentDir, "sessions", "session"),
    ...options,
  });
}

interface TerminalSize {
  rows: number;
  columns: number;
}

function drivePanel(
  harness: ExtensionHarness,
  queue: Array<Completion | undefined>,
  terminal: TerminalSize = { rows: 24, columns: 80 },
): DcpPanelComponent[] {
  const components: DcpPanelComponent[] = [];
  harness.ui.custom.mockImplementation(
    (factory: unknown) =>
      new Promise((resolve) => {
        const tui = { terminal: { ...terminal }, requestRender: () => {} };
        const component = (
          factory as (
            tui: unknown,
            theme: Theme,
            keybindings: unknown,
            done: (result: Completion | undefined) => void,
          ) => DcpPanelComponent
        )(tui, fakeTheme(), {}, resolve);
        components.push(component);
        resolve(queue.shift());
      }),
  );
  return components;
}

const OVERLAY_OPTIONS = {
  overlay: true,
  overlayOptions: { anchor: "center", width: "92%", maxHeight: "85%" },
};

describe("dcp panel controller", () => {
  it.each([
    { name: "RPC", mode: "rpc" as const, hasUI: true },
    { name: "print", mode: "print" as const, hasUI: false },
    { name: "JSON", mode: "json" as const, hasUI: false },
    { name: "TUI without dialog UI", mode: "tui" as const, hasUI: false },
  ])("notifies once and skips lifetime/custom in $name mode", async ({ mode, hasUI }) => {
    const harness = createPanelHarness({ mode, hasUI });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    const loadSpy = vi.spyOn(persistence, "loadAllSessionStats");
    try {
      await harness.runCommand("dcp", "");

      expect(harness.ui.notify).toHaveBeenCalledTimes(1);
      expect(harness.ui.notify).toHaveBeenCalledWith(
        "DCP panel requires interactive TUI mode. Use dcp:help for available commands.",
        "error",
      );
      expect(harness.ui.custom).not.toHaveBeenCalled();
      expect(loadSpy).not.toHaveBeenCalled();
    } finally {
      loadSpy.mockRestore();
    }
  });

  it("opens each iteration with centered 92%/85% overlay options", async () => {
    writeDcpConfig({});
    const harness = createPanelHarness();
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });

    const components = drivePanel(harness, [
      completion({ type: "toggle-manual" }, createDcpPanelNavigation("controls")),
      undefined,
    ]);
    await harness.runCommand("dcp", "");

    expect(harness.ui.custom).toHaveBeenCalledTimes(2);
    for (const call of harness.ui.custom.mock.calls) expect(call[1]).toEqual(OVERLAY_OPTIONS);
    expect(components[0].render(60).at(-1)).toBe(`┗${"━".repeat(58)}┛`);
  });

  it("applies a permitted action, persists once, and rebuilds with retained navigation and message", async () => {
    writeDcpConfig({});
    const harness = createPanelHarness();
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    harness.entries.length = 0;

    const navigation = createDcpPanelNavigation("controls");
    navigation.tabs.controls = { selectedRowId: "toggle-manual", offset: 0 };
    const components = drivePanel(harness, [
      completion({ type: "toggle-manual" }, navigation),
      undefined,
    ]);
    await harness.runCommand("dcp", "");

    expect(harness.ui.custom).toHaveBeenCalledTimes(2);
    expect(components).toHaveLength(2);
    const rebuilt = components[1].render(160).join("\n");
    expect(rebuilt).toContain("Manual mode: on. Automatic compression is paused.");
    expect(selectedLine(components[1].render(160))).toContain("Manual mode");
    expect(
      harness.entries.some(
        (entry) => (entry.data as { manualMode?: unknown })?.manualMode === "active",
      ),
    ).toBe(true);
    for (const line of components[1].render(60)) expect(visibleWidth(line)).toBeLessThanOrEqual(60);
  });

  it("retains every tab viewport across an action rebuild", async () => {
    writeDcpConfig({});
    const harness = createPanelHarness();
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });

    const navigation = createDcpPanelNavigation("controls");
    navigation.tabs.overview = { selectedRowId: "overview:user-turn", offset: 0 };
    navigation.tabs.controls = { selectedRowId: "cycle-permission", offset: 1 };
    navigation.tabs.blocks = { selectedRowId: "block:2", offset: 0 };
    const components = drivePanel(harness, [
      completion({ type: "toggle-manual" }, navigation),
      undefined,
    ]);
    await harness.runCommand("dcp", "");

    expect(components).toHaveLength(2);
    expect(selectedLine(components[1].render(80))).toContain("Compress permission");
  });

  it("does not invoke the state callback on close", async () => {
    writeDcpConfig({});
    const harness = createPanelHarness();
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    harness.entries.length = 0;

    drivePanel(harness, [completion({ type: "close" }, createDcpPanelNavigation("help"))]);
    await harness.runCommand("dcp", "");

    expect(harness.entries).toHaveLength(0);
  });

  it("rejects a policy-disabled action without invoking the state callback", async () => {
    writeDcpConfig({ enabled: false });
    const harness = createPanelHarness();
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    harness.entries.length = 0;

    const components = drivePanel(harness, [
      completion({ type: "toggle-manual" }, createDcpPanelNavigation("controls")),
      undefined,
    ]);
    await harness.runCommand("dcp", "");

    expect(components[1].render(120).join("\n")).toContain("DCP is disabled by configuration.");
    expect(harness.entries).toHaveLength(0);
  });

  it("rechecks policy against the current context before acting", async () => {
    writeDcpConfig({ disabledModels: ["test/disabled"] });
    const harness = createPanelHarness({ model: { provider: "test", id: "enabled" } });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    harness.entries.length = 0;

    const components: DcpPanelComponent[] = [];
    const queue: Array<Completion | undefined> = [
      completion({ type: "toggle-manual" }, createDcpPanelNavigation("controls")),
      undefined,
    ];
    harness.ui.custom.mockImplementation(
      (factory: unknown) =>
        new Promise((resolve) => {
          const tui = { terminal: { rows: 24, columns: 80 }, requestRender: () => {} };
          const component = (
            factory as (
              tui: unknown,
              theme: Theme,
              keybindings: unknown,
              done: (result: Completion | undefined) => void,
            ) => DcpPanelComponent
          )(tui, fakeTheme(), {}, resolve);
          components.push(component);
          if (components.length === 1) harness.setModel({ provider: "test", id: "disabled" });
          resolve(queue.shift());
        }),
    );

    await harness.runCommand("dcp", "");

    expect(components[1].render(120).join("\n")).toContain(
      "DCP is disabled for the current model.",
    );
    expect(harness.entries).toHaveLength(0);
  });

  it("preserves command policy when the current model is unavailable", async () => {
    writeDcpConfig({ disabledModels: ["test/disabled"] });
    const harness = createPanelHarness({ model: { provider: "test", id: "disabled" } });
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    harness.context.model = undefined;
    harness.entries.length = 0;

    await harness.runCommand("dcp:manual", "on");
    const components = drivePanel(harness, [
      completion({ type: "toggle-manual" }, createDcpPanelNavigation("controls")),
      undefined,
    ]);
    await harness.runCommand("dcp", "");

    expect(harness.ui.notify).toHaveBeenCalledWith(
      "DCP is disabled for the current model.",
      "info",
    );
    expect(harness.entries).toHaveLength(0);
    expect(components[0].render(120).join("\n")).toContain(
      "DCP is disabled for the current model.",
    );
    expect(components[1].render(120).join("\n")).toContain(
      "DCP is disabled for the current model.",
    );
  });

  it("loads lifetime once and opens with unavailable totals when loading fails", async () => {
    writeDcpConfig({});
    const harness = createPanelHarness();
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    const loadSpy = vi
      .spyOn(persistence, "loadAllSessionStats")
      .mockRejectedValue(new Error("no sessions"));
    try {
      const components = drivePanel(harness, [undefined]);
      await harness.runCommand("dcp:stats", "");

      expect(loadSpy).toHaveBeenCalledTimes(1);
      expect(components[0].render(120).join("\n")).toContain("Total tokens saved");
      expect(components[0].render(120).join("\n")).toContain("Unavailable");
    } finally {
      loadSpy.mockRestore();
    }
  });

  it("loads lifetime statistics once across action rebuilds", async () => {
    writeDcpConfig({});
    const harness = createPanelHarness();
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    const loadSpy = vi.spyOn(persistence, "loadAllSessionStats");
    try {
      drivePanel(harness, [
        completion({ type: "toggle-manual" }, createDcpPanelNavigation("controls")),
        completion({ type: "sweep" }, createDcpPanelNavigation("controls")),
        undefined,
      ]);
      await harness.runCommand("dcp", "");

      expect(loadSpy).toHaveBeenCalledTimes(1);
    } finally {
      loadSpy.mockRestore();
    }
  });

  it("closes without looping when the custom component returns undefined", async () => {
    writeDcpConfig({});
    const harness = createPanelHarness();
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });

    drivePanel(harness, [undefined]);
    await harness.runCommand("dcp", "");

    expect(harness.ui.custom).toHaveBeenCalledTimes(1);
  });

  it("notifies once and keeps commands accessible when the custom UI rejects", async () => {
    writeDcpConfig({});
    const harness = createPanelHarness();
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });

    harness.ui.custom.mockRejectedValue(new Error("ui failed"));
    await harness.runCommand("dcp", "");

    expect(harness.ui.notify).toHaveBeenCalledTimes(1);
    expect(harness.ui.notify).toHaveBeenCalledWith(
      "DCP panel closed: interactive UI failed.",
      "error",
    );
    expect(harness.commands.has("dcp:help")).toBe(true);
  });
});

describe("openDcpPanel guarded action characterization", () => {
  function driveDirect(
    harness: ExtensionHarness,
    queue: Array<Completion | undefined>,
  ): DcpPanelComponent[] {
    const components: DcpPanelComponent[] = [];
    harness.ui.custom.mockImplementation(
      (factory: unknown) =>
        new Promise((resolve) => {
          const tui = { terminal: { rows: 24, columns: 80 }, requestRender: () => {} };
          const component = (
            factory as (
              tui: unknown,
              theme: Theme,
              keybindings: unknown,
              done: (result: Completion | undefined) => void,
            ) => DcpPanelComponent
          )(tui, fakeTheme(), {}, resolve);
          components.push(component);
          resolve(queue.shift());
        }),
    );
    return components;
  }

  it.each([
    {
      name: "toggle-manual",
      action: { type: "toggle-manual" } as DcpPanelAction,
      tab: "controls" as const,
      message: "Manual mode: on. Automatic compression is paused.",
    },
    {
      name: "cycle-permission",
      action: { type: "cycle-permission" } as DcpPanelAction,
      tab: "controls" as const,
      message: "Compress permission: ask",
    },
    {
      name: "sweep",
      action: { type: "sweep" } as DcpPanelAction,
      tab: "controls" as const,
      message: "Sweep complete: 0 tool outputs pruned, ~0 tokens saved.",
    },
    {
      name: "toggle-block",
      action: { type: "toggle-block", blockId: 1 } as DcpPanelAction,
      tab: "blocks" as const,
      message: "Block 1 deactivated. Original messages will be restored on next context pass.",
    },
  ])(
    "calls back once with the original context after a permitted $name action",
    async ({ action, tab, message }) => {
      const harness = createPanelHarness();
      const state = createSessionState();
      state.prune.messages.blocksById.set(1, makeBlock(1, "topic"));
      const config = makeDefaultConfig();
      const onStateChange = vi.fn((ctx: ExtensionCommandContext) => {
        expect(ctx).toBe(harness.commandContext);
        expect(harness.ui.custom).toHaveBeenCalledTimes(1);
      });

      const components = driveDirect(harness, [
        completion(action, createDcpPanelNavigation(tab)),
        undefined,
      ]);
      await openDcpPanel(state, config, harness.commandContext, onStateChange, () =>
        harness.activeTools(),
      );

      expect(onStateChange).toHaveBeenCalledTimes(1);
      expect(onStateChange.mock.invocationCallOrder[0]).toBeGreaterThan(
        harness.ui.custom.mock.invocationCallOrder[0],
      );
      expect(onStateChange.mock.invocationCallOrder[0]).toBeLessThan(
        harness.ui.custom.mock.invocationCallOrder[1],
      );
      expect(components).toHaveLength(2);
      expect(components[1].render(160).join("\n")).toContain(message);
    },
  );

  it.each([
    {
      name: "a policy rejection",
      config: { enabled: false },
      queue: [
        completion({ type: "toggle-manual" }, createDcpPanelNavigation("controls")),
        undefined,
      ],
    },
    {
      name: "an explicit close",
      config: {},
      queue: [completion({ type: "close" }, createDcpPanelNavigation("controls"))],
    },
    { name: "an undefined completion", config: {}, queue: [undefined] },
  ])("calls back zero times for $name", async ({ config: overrides, queue }) => {
    const harness = createPanelHarness();
    const state = createSessionState();
    const config = { ...makeDefaultConfig(), ...overrides };
    const onStateChange = vi.fn();

    driveDirect(harness, queue);
    await openDcpPanel(state, config, harness.commandContext, onStateChange, () =>
      harness.activeTools(),
    );

    expect(onStateChange).not.toHaveBeenCalled();
  });

  it("calls back once for a permitted stale missing-block result", async () => {
    const harness = createPanelHarness();
    const state = createSessionState();
    const config = makeDefaultConfig();
    const onStateChange = vi.fn((ctx: ExtensionCommandContext) => {
      expect(ctx).toBe(harness.commandContext);
    });

    const components = driveDirect(harness, [
      completion({ type: "toggle-block", blockId: 99 }, createDcpPanelNavigation("blocks")),
      undefined,
    ]);
    await openDcpPanel(state, config, harness.commandContext, onStateChange, () =>
      harness.activeTools(),
    );

    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(components[1].render(120).join("\n")).toContain("Block 99 not found.");
  });

  it("propagates a sweep implementation error without a callback or next component", async () => {
    const harness = createPanelHarness();
    const state = createSessionState();
    const config = makeDefaultConfig();
    const onStateChange = vi.fn();
    const sentinel = new Error("sweep implementation failed");
    vi.spyOn(sweepModule, "sweepCommand").mockImplementation(() => {
      throw sentinel;
    });
    const components = driveDirect(harness, [
      completion({ type: "sweep" }, createDcpPanelNavigation("controls")),
      undefined,
    ]);

    let caught: unknown;
    try {
      await openDcpPanel(state, config, harness.commandContext, onStateChange, () =>
        harness.activeTools(),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(sentinel);
    expect(onStateChange).not.toHaveBeenCalled();
    expect(components).toHaveLength(1);
    expect(harness.ui.notify).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("propagates a callback error once without a next component", async () => {
    const harness = createPanelHarness();
    const state = createSessionState();
    const config = makeDefaultConfig();
    const sentinel = new Error("callback failed");
    const onStateChange = vi.fn(() => {
      throw sentinel;
    });
    const components = driveDirect(harness, [
      completion({ type: "toggle-manual" }, createDcpPanelNavigation("controls")),
      undefined,
    ]);

    let caught: unknown;
    try {
      await openDcpPanel(state, config, harness.commandContext, onStateChange, () =>
        harness.activeTools(),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(sentinel);
    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(components).toHaveLength(1);
    expect(harness.ui.notify).not.toHaveBeenCalled();
  });
});
