import { describe, expect, it } from "vitest";
import { purgeErrors } from "../src/strategies/purge-errors.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";

describe("purge-errors", () => {
  it("marks old errored tool calls for pruning", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 10;

    state.toolParameters.set("err1", {
      tool: "glob",
      parameters: { pattern: "**/*.ts" },
      status: "error",
      error: "not found",
      turn: 3,
      tokenCount: 200,
    });
    state.toolIdList = ["err1"];

    const result = purgeErrors(state, config);
    expect(result.pruned).toBe(1);
    expect(state.prune.tools.has("err1")).toBe(true);
  });

  it("does not prune recent errors", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 5;

    state.toolParameters.set("err1", {
      tool: "glob",
      parameters: { pattern: "**/*.ts" },
      status: "error",
      error: "not found",
      turn: 3,
      tokenCount: 200,
    });
    state.toolIdList = ["err1"];

    const result = purgeErrors(state, config);
    expect(result.pruned).toBe(0);
  });

  it("does not prune non-error tools", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 10;

    state.toolParameters.set("ok1", {
      tool: "glob",
      parameters: { pattern: "**/*.ts" },
      status: "completed",
      error: undefined,
      turn: 1,
      tokenCount: 200,
    });
    state.toolIdList = ["ok1"];

    const result = purgeErrors(state, config);
    expect(result.pruned).toBe(0);
  });

  it("does nothing when disabled", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.purgeErrors.enabled = false;
    state.currentTurn = 10;

    state.toolParameters.set("err1", {
      tool: "glob",
      parameters: {},
      status: "error",
      error: "fail",
      turn: 1,
      tokenCount: 200,
    });
    state.toolIdList = ["err1"];

    const result = purgeErrors(state, config);
    expect(result.pruned).toBe(0);
  });

  it("skips protected tools", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 10;

    state.toolParameters.set("err1", {
      tool: "bash",
      parameters: { command: "fail" },
      status: "error",
      error: "exit 1",
      turn: 1,
      tokenCount: 200,
    });
    state.toolIdList = ["err1"];

    const result = purgeErrors(state, config);
    expect(result.pruned).toBe(0);
  });

  it("skips when manual mode active and automaticStrategies disabled", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 10;
    state.manualMode = "active";
    config.manualMode.automaticStrategies = false;

    state.toolParameters.set("err1", {
      tool: "glob",
      parameters: {},
      status: "error",
      error: "fail",
      turn: 1,
      tokenCount: 200,
    });
    state.toolIdList = ["err1"];

    const result = purgeErrors(state, config);
    expect(result.pruned).toBe(0);
  });

  it("skips tools operating on protected file paths", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 10;
    config.protectedFilePatterns = ["src/**/*.ts"];

    state.toolParameters.set("err1", {
      tool: "glob",
      parameters: { filePath: "src/index.ts" },
      status: "error",
      error: "fail",
      turn: 1,
      tokenCount: 200,
    });
    state.toolIdList = ["err1"];

    const result = purgeErrors(state, config);
    expect(result.pruned).toBe(0);
  });
});
