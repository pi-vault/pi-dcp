import { describe, it, expect } from "vitest";
import { runStrategies, sweepAll } from "../src/strategies/runner.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";

function seedToolCache(
  state: ReturnType<typeof createSessionState>,
  entries: Array<{
    id: string;
    tool: string;
    parameters: Record<string, unknown>;
    status: "completed" | "error";
    turn: number;
    tokenCount: number;
  }>,
): void {
  for (const e of entries) {
    state.toolParameters.set(e.id, {
      tool: e.tool,
      parameters: e.parameters,
      status: e.status,
      error: undefined,
      turn: e.turn,
      tokenCount: e.tokenCount,
      assistantIndex: undefined,
      resultIndex: undefined,
    });
    state.toolIdList.push(e.id);
  }
}

describe("runStrategies", () => {
  it("deduplicates and purges errors in one call", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 100,
      },
      {
        id: "b1",
        tool: "another_tool",
        parameters: { path: "/b.ts" },
        status: "error",
        turn: 1,
        tokenCount: 200,
      },
    ]);

    const result = runStrategies(state, config);

    // a1 is a duplicate of a2 (same signature), should be pruned
    expect(state.prune.tools.has("a1")).toBe(true);
    expect(state.prune.tools.has("a2")).toBe(false);
    // b1 is an old error (turn 1, current turn 10, threshold 4)
    expect(state.prune.tools.has("b1")).toBe(true);
    expect(result.pruned).toBe(2);
    expect(result.tokensSaved).toBe(300);
  });

  it("respects disabled deduplication", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.deduplication.enabled = false;
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 100,
      },
    ]);

    const result = runStrategies(state, config);
    expect(result.pruned).toBe(0);
  });

  it("respects disabled purgeErrors", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.purgeErrors.enabled = false;
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "err1",
        tool: "custom_tool",
        parameters: {},
        status: "error",
        turn: 1,
        tokenCount: 200,
      },
    ]);

    const result = runStrategies(state, config);
    expect(result.pruned).toBe(0);
  });

  it("skips when manual mode active and automaticStrategies disabled", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.manualMode.automaticStrategies = false;
    state.manualMode = "active";
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 100,
      },
    ]);

    const result = runStrategies(state, config);
    expect(result.pruned).toBe(0);
  });

  it("skips empty toolIdList", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const result = runStrategies(state, config);
    expect(result.pruned).toBe(0);
    expect(result.tokensSaved).toBe(0);
  });

  it("skips protected tools (BASE_PROTECTED_TOOLS)", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "bash",
        parameters: { command: "ls" },
        status: "completed",
        turn: 1,
        tokenCount: 50,
      },
      {
        id: "a2",
        tool: "bash",
        parameters: { command: "ls" },
        status: "completed",
        turn: 2,
        tokenCount: 50,
      },
    ]);

    const result = runStrategies(state, config);
    expect(result.pruned).toBe(0);
  });

  it("skips tools operating on protected file paths", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.protectedFilePatterns = ["src/**/*.ts"];
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { filePath: "src/index.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { filePath: "src/index.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 100,
      },
    ]);

    const result = runStrategies(state, config);
    expect(result.pruned).toBe(0);
  });

  it("does not prune recent errors", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 5;

    seedToolCache(state, [
      {
        id: "err1",
        tool: "custom_tool",
        parameters: {},
        status: "error",
        turn: 3,
        tokenCount: 200,
      },
    ]);

    const result = runStrategies(state, config);
    expect(result.pruned).toBe(0);
  });

  it("updates stats correctly", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 50,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 50,
      },
    ]);

    runStrategies(state, config);
    expect(state.stats.totalPruneTokens).toBe(50);
    expect(state.stats.toolsPruned).toBe(1);
  });

  it("respects per-strategy protectedTools lists", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.deduplication.protectedTools = ["custom_tool"];
    // purgeErrors does NOT protect custom_tool
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 100,
      },
      {
        id: "err1",
        tool: "custom_tool",
        parameters: { path: "/c.ts" },
        status: "error",
        turn: 1,
        tokenCount: 150,
      },
    ]);

    const result = runStrategies(state, config);
    // Dedup should NOT prune custom_tool (it's protected for dedup)
    expect(state.prune.tools.has("a1")).toBe(false);
    expect(state.prune.tools.has("a2")).toBe(false);
    // Purge SHOULD prune the error (custom_tool not protected for purge)
    expect(state.prune.tools.has("err1")).toBe(true);
    expect(result.pruned).toBe(1);
    expect(result.tokensSaved).toBe(150);
  });

  it("does not re-prune already-pruned tools", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 100,
      },
    ]);
    state.prune.tools.set("a1", 100); // already pruned

    const result = runStrategies(state, config);
    expect(result.pruned).toBe(0);
  });
});

describe("sweepAll", () => {
  it("prunes all non-protected completed tool outputs", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "another_tool",
        parameters: { path: "/b.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 200,
      },
      {
        id: "a3",
        tool: "list_dir",
        parameters: { path: "/" },
        status: "error",
        turn: 3,
        tokenCount: 50,
      },
    ]);

    const result = sweepAll(state, config);
    expect(result.pruned).toBe(2); // a1 and a2 (completed), not a3 (error)
    expect(result.tokensSaved).toBe(300);
    expect(state.prune.tools.has("a1")).toBe(true);
    expect(state.prune.tools.has("a2")).toBe(true);
    expect(state.prune.tools.has("a3")).toBe(false);
  });

  it("respects protected tools from config.compress.protectedTools", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ protectedTools: ["custom_tool"] });

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "another_tool",
        parameters: { path: "/b.ts" },
        status: "completed",
        turn: 2,
        tokenCount: 200,
      },
    ]);

    const result = sweepAll(state, config);
    expect(result.pruned).toBe(1); // only a2
    expect(state.prune.tools.has("a1")).toBe(false);
    expect(state.prune.tools.has("a2")).toBe(true);
  });

  it("skips already-pruned tools", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
    ]);
    state.prune.tools.set("a1", 100); // already pruned

    const result = sweepAll(state, config);
    expect(result.pruned).toBe(0);
  });

  it("updates pruneTokenCounter (unique to sweep)", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 1,
        tokenCount: 100,
      },
    ]);

    sweepAll(state, config);
    expect(state.stats.pruneTokenCounter).toBe(100);
    expect(state.stats.totalPruneTokens).toBe(100);
    expect(state.stats.toolsPruned).toBe(1);
  });
});
