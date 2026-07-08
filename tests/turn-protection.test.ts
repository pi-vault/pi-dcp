import { describe, it, expect } from "vitest";
import { runStrategies } from "../src/strategies/runner.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig, seedToolCache } from "./helpers.ts";

describe("turn protection for deduplication", () => {
  it("does not prune duplicates within the turn window", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.deduplication.turnProtection = 3;
    state.currentTurn = 5;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 3, // gap = 5 - 3 = 2, within window of 3
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 5,
        tokenCount: 100,
      },
    ]);

    const result = runStrategies(state, config);
    expect(state.prune.tools.has("a1")).toBe(false); // protected by turn window
    expect(state.prune.tools.has("a2")).toBe(false); // last in group, always kept
    expect(result.pruned).toBe(0);
  });

  it("prunes duplicates outside the turn window", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.deduplication.turnProtection = 3;
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2, // gap = 10 - 2 = 8, outside window of 3
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 9,
        tokenCount: 100,
      },
    ]);

    const result = runStrategies(state, config);
    expect(state.prune.tools.has("a1")).toBe(true); // old enough to prune
    expect(state.prune.tools.has("a2")).toBe(false); // last in group
    expect(result.pruned).toBe(1);
  });

  it("prunes all duplicates when turnProtection is 0 (disabled)", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.deduplication.turnProtection = 0;
    state.currentTurn = 5;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 4, // would be within window of 3, but protection is disabled
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 5,
        tokenCount: 100,
      },
    ]);

    const result = runStrategies(state, config);
    expect(state.prune.tools.has("a1")).toBe(true); // pruned — no protection
    expect(result.pruned).toBe(1);
  });

  it("does not affect purge-errors strategy", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.deduplication.turnProtection = 3;
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "err1",
        tool: "custom_tool",
        parameters: {},
        status: "error",
        turn: 1, // stale error
        tokenCount: 200,
      },
    ]);

    const result = runStrategies(state, config);
    // purge-errors has its own turn logic, unaffected by dedup turnProtection
    expect(state.prune.tools.has("err1")).toBe(true);
    expect(result.pruned).toBe(1);
  });

  it("protects recent entries even with multiple duplicates", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.deduplication.turnProtection = 3;
    state.currentTurn = 10;

    seedToolCache(state, [
      {
        id: "a1",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 2, // gap 8, outside window
        tokenCount: 100,
      },
      {
        id: "a2",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 8, // gap 2, inside window
        tokenCount: 100,
      },
      {
        id: "a3",
        tool: "custom_tool",
        parameters: { path: "/a.ts" },
        status: "completed",
        turn: 10, // last in group
        tokenCount: 100,
      },
    ]);

    const result = runStrategies(state, config);
    expect(state.prune.tools.has("a1")).toBe(true);  // old, pruned
    expect(state.prune.tools.has("a2")).toBe(false); // recent, protected
    expect(state.prune.tools.has("a3")).toBe(false); // last in group
    expect(result.pruned).toBe(1);
  });
});
