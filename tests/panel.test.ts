import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import createExtension from "../src/index.ts";
import { DcpPanelComponent } from "../src/tui/panel.ts";
import {
  buildDcpPanelModel,
  type DcpPanelAction,
  type DcpPanelModel,
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

function makeComponent(
  model: DcpPanelModel,
  overrides: Partial<{
    theme: Theme;
    getHeight: () => number;
    initialRowId: string;
    lastActionMessage: string;
  }> = {},
) {
  const actions: DcpPanelAction[] = [];
  const requestRender = vi.fn();
  const component = new DcpPanelComponent(model, {
    theme: overrides.theme ?? fakeTheme(),
    getHeight: overrides.getHeight ?? (() => 24),
    requestRender,
    onAction: (action) => actions.push(action),
    initialRowId: overrides.initialRowId,
    lastActionMessage: overrides.lastActionMessage,
  });
  return { component, actions, requestRender };
}

describe("DcpPanelComponent", () => {
  it.each([60, 80, 120])("bounds every rendered line to %i columns", (width) => {
    const model = modelWithBlocks(40, "日本語 very long topic with wide characters");
    const { component } = makeComponent(model, { getHeight: () => 24 });

    const lines = component.render(width);

    expect(lines.length).toBeLessThanOrEqual(24);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  });

  it.each([60, 80, 120])(
    "shows policy, tool availability, and all lifetime totals at %i columns",
    (width) => {
      const model = modelWithBlocks(1);
      const { component } = makeComponent(model);

      const rendered = component.render(width).join("\n");

      expect(rendered).toContain("Pipeline enabled");
      expect(rendered).toContain("Tool active");
      expect(rendered).toContain("Lifetime saved 1000");
      expect(rendered).toContain("sessions 3");
      expect(rendered).toContain("Lifetime tools 4");
      expect(rendered).toContain("messages 2");
    },
  );

  it("can browse a long list of inactive blocks without activating them", () => {
    const model = modelWithBlocks(40);
    for (const row of model.blocks) {
      row.action = undefined;
      row.unavailableReason = "Inactive";
    }
    const { component, actions } = makeComponent(model);

    for (let step = 0; step < 50; step++) component.handleInput("j");

    expect(component.render(60).find((line) => line.startsWith("> "))).toContain("Block b40:");
    component.handleInput("\r");
    expect(actions).toEqual([]);
    component.handleInput("q");
    expect(actions).toEqual([{ type: "close" }]);
  });

  it.each(["\n", "\r", "\r\n", "\t"])(
    "keeps block labels on one terminal line for %j",
    (separator) => {
      const { component } = makeComponent(modelWithBlocks(1, `first${separator}second`));

      const row = component.render(120).find((line) => line.includes("Block b1:"));

      expect(row).toContain("first second");
      expect(row).not.toMatch(/[\r\n\t]/);
    },
  );

  it.each([60, 80, 120])(
    "keeps long block topics from hiding actions or state at %i columns",
    (width) => {
      const state = createSessionState();
      for (let id = 1; id <= 3; id++) {
        const block = makeBlock(id, "very long topic ".repeat(30));
        block.active = id === 1;
        block.deactivatedByUser = id === 2;
        state.prune.messages.blocksById.set(id, block);
      }
      const { component } = makeComponent(
        buildDcpPanelModel({
          state,
          config: makeDefaultConfig(),
          model: undefined,
          contextUsage: undefined,
          lifetimeStats: undefined,
          compressToolActive: false,
        }),
      );

      const rows = component.render(width).filter((line) => line.includes("Block b"));

      expect(rows).toHaveLength(3);
      expect(rows[0]).toContain("Deactivate");
      expect(rows[1]).toContain("Reactivate");
      expect(rows[2]).toContain("Inactive");
      for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
    },
  );

  it("keeps policy-disabled block identifiers and actions visible at 60 columns", () => {
    const state = createSessionState();
    state.prune.messages.blocksById.set(1, makeBlock(1, "long topic ".repeat(30)));
    state.prune.messages.blocksById.set(2, makeBlock(2, "another long topic ".repeat(30)));
    const config = makeDefaultConfig();
    config.enabled = false;
    const { component } = makeComponent(
      buildDcpPanelModel({
        state,
        config,
        model: undefined,
        contextUsage: undefined,
        lifetimeStats: undefined,
        compressToolActive: false,
      }),
    );

    const lines = component.render(60);

    for (const id of [1, 2]) {
      const row = lines.find((line) => line.includes(`Block b${id}:`));
      expect(row).toContain("Deactivate");
      expect(visibleWidth(row ?? "")).toBeLessThanOrEqual(60);
    }
  });

  it.each([1, 2, 3])("keeps close instructions visible within a %i-row terminal", (height) => {
    const { component } = makeComponent(modelWithBlocks(2), {
      getHeight: () => height,
      lastActionMessage: "Manual mode: on",
    });

    const lines = component.render(60);

    expect(lines.length).toBeLessThanOrEqual(height);
    expect(lines.join("\n")).toContain("Esc/q close");
  });

  it("keeps the selection visible while scrolling and after resize", () => {
    let height = 24;
    const { component } = makeComponent(modelWithBlocks(30), { getHeight: () => height });

    for (let step = 0; step < 25; step++) component.handleInput("j");
    expect(component.render(80).some((line) => line.startsWith("> "))).toBe(true);

    height = 8;
    const resized = component.render(80);
    expect(resized.length).toBeLessThanOrEqual(8);
    expect(resized.some((line) => line.startsWith("> "))).toBe(true);
  });

  it("navigates with j/k and arrow keys and completes the selected action", () => {
    const { component, actions } = makeComponent(modelWithBlocks(2));

    component.handleInput("j");
    component.handleInput("k");
    component.handleInput("k");
    component.handleInput("\r");

    expect(actions).toEqual([{ type: "toggle-manual" }]);
  });

  it("moves down with an arrow key", () => {
    const { component, actions } = makeComponent(modelWithBlocks(2));
    component.handleInput("\u001b[B");
    component.handleInput("\r");
    expect(actions).toEqual([{ type: "cycle-permission" }]);
  });

  it("requests a render when the selection changes", () => {
    const { component, requestRender } = makeComponent(modelWithBlocks(3));

    component.handleInput("j");

    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it("completes a close exactly once on Escape or q", () => {
    const { component, actions } = makeComponent(modelWithBlocks(1));

    component.handleInput("\u001b");
    component.handleInput("q");
    component.handleInput("\r");

    expect(actions).toEqual([{ type: "close" }]);
  });

  it("selects the initial row by stable identity", () => {
    const { component } = makeComponent(modelWithBlocks(2), { initialRowId: "sweep" });
    const selected = component.render(80).find((line) => line.startsWith("> "));
    expect(selected).toContain("Sweep");
  });

  it("renders the last action message", () => {
    const { component } = makeComponent(modelWithBlocks(1), {
      lastActionMessage: "Manual mode: on. Automatic compression is paused.",
    });
    expect(component.render(120).join("\n")).toContain("Manual mode: on");
  });

  it("falls back to a bounded unthemed view with working close keys on render failure", () => {
    const badTheme = {
      fg: () => {
        throw new Error("theme failure");
      },
    } as unknown as Theme;
    const { component, actions } = makeComponent(modelWithBlocks(3), { theme: badTheme });

    const lines = component.render(80);

    expect(lines.length).toBeLessThanOrEqual(24);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(80);
    expect(lines.join("\n")).toContain("close");

    component.handleInput("q");
    expect(actions).toEqual([{ type: "close" }]);
  });

  it("does not run unseen actions while rendering is unavailable", () => {
    const badTheme = {
      fg: () => {
        throw new Error("theme failure");
      },
    } as unknown as Theme;
    const { component, actions } = makeComponent(modelWithBlocks(3), { theme: badTheme });

    component.render(60);
    component.handleInput("j");
    component.handleInput("\r");

    expect(actions).toEqual([]);
    component.handleInput("q");
    expect(actions).toEqual([{ type: "close" }]);
  });
});

function createPanelHarness(options: Parameters<typeof createExtensionHarness>[0] = {}) {
  return createExtensionHarness({
    activeTools: ["read", "compress"],
    mode: "tui",
    hasUI: true,
    sessionDir: path.join(agentDir, "sessions", "session"),
    ...options,
  });
}

function drivePanel(
  harness: ExtensionHarness,
  queue: Array<DcpPanelAction | undefined>,
): DcpPanelComponent[] {
  const components: DcpPanelComponent[] = [];
  harness.ui.custom.mockImplementation(
    (factory: unknown) =>
      new Promise((resolve) => {
        const tui = { terminal: { rows: 24 }, requestRender: () => {} };
        const component = (
          factory as (
            tui: unknown,
            theme: Theme,
            keybindings: unknown,
            done: (action: DcpPanelAction | undefined) => void,
          ) => DcpPanelComponent
        )(tui, fakeTheme(), {}, resolve);
        components.push(component);
        resolve(queue.shift());
      }),
  );
  return components;
}

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

  it("applies a permitted action, persists once, and rebuilds with retained selection and message", async () => {
    writeDcpConfig({});
    const harness = createPanelHarness();
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    harness.entries.length = 0;

    const components = drivePanel(harness, [{ type: "toggle-manual" }, undefined]);
    await harness.runCommand("dcp", "");

    expect(harness.ui.custom).toHaveBeenCalledTimes(2);
    expect(components).toHaveLength(2);
    expect(components[1].render(120).join("\n")).toContain(
      "Manual mode: on. Automatic compression is paused.",
    );
    expect(
      harness.entries.some(
        (entry) => (entry.data as { manualMode?: unknown })?.manualMode === "active",
      ),
    ).toBe(true);
  });

  it("does not invoke the state callback on close", async () => {
    writeDcpConfig({});
    const harness = createPanelHarness();
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    harness.entries.length = 0;

    drivePanel(harness, [undefined]);
    await harness.runCommand("dcp", "");

    expect(harness.entries).toHaveLength(0);
  });

  it("rejects a policy-disabled action without invoking the state callback", async () => {
    writeDcpConfig({ enabled: false });
    const harness = createPanelHarness();
    createExtension(harness.api);
    await harness.emit("session_start", { type: "session_start", reason: "new" });
    harness.entries.length = 0;

    const components = drivePanel(harness, [{ type: "toggle-manual" }, undefined]);
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
    const queue: Array<DcpPanelAction | undefined> = [{ type: "toggle-manual" }, undefined];
    harness.ui.custom.mockImplementation(
      (factory: unknown) =>
        new Promise((resolve) => {
          const tui = { terminal: { rows: 24 }, requestRender: () => {} };
          const component = (
            factory as (
              tui: unknown,
              theme: Theme,
              keybindings: unknown,
              done: (action: DcpPanelAction | undefined) => void,
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
    const components = drivePanel(harness, [{ type: "toggle-manual" }, undefined]);
    await harness.runCommand("dcp", "");

    expect(harness.ui.notify).toHaveBeenCalledWith(
      "DCP is disabled for the current model.",
      "info",
    );
    expect(harness.entries).toHaveLength(0);
    expect(components[0].render(120).join("\n")).toContain(
      "Pipeline DCP is disabled for the current model.",
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
      await harness.runCommand("dcp", "");

      expect(loadSpy).toHaveBeenCalledTimes(1);
      expect(components[0].render(120).join("\n")).toContain("Lifetime saved Unavailable");
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
