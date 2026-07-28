import { describe, expect, it } from "vitest";
import { sweepCommand } from "../src/commands/sweep.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";

describe("sweep command", () => {
  it("marks eligible completed tool outputs for pruning", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    // "custom-search" is not in BASE_PROTECTED_TOOLS
    state.toolParameters.set("call-1", {
      tool: "custom-search",
      parameters: {},
      status: "completed",
      error: undefined,
      userTurn: 1,
      tokenCount: 200,
      assistantIndex: undefined,
      resultIndex: undefined,
    });
    // "compress" is protected — should not be swept
    state.toolParameters.set("call-2", {
      tool: "compress",
      parameters: {},
      status: "completed",
      error: undefined,
      userTurn: 1,
      tokenCount: 100,
      assistantIndex: undefined,
      resultIndex: undefined,
    });

    const result = sweepCommand(state, config);
    expect(result).toContain("1"); // only call-1 swept (compress is protected)
    expect(state.prune.tools.has("call-1")).toBe(true);
    expect(state.prune.tools.has("call-2")).toBe(false);
  });

  it("respects config.compress.protectedTools", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ protectedTools: ["custom-search"] });

    state.toolParameters.set("call-1", {
      tool: "custom-search",
      parameters: {},
      status: "completed",
      error: undefined,
      userTurn: 1,
      tokenCount: 200,
      assistantIndex: undefined,
      resultIndex: undefined,
    });

    const result = sweepCommand(state, config);
    expect(result).toContain("0");
    expect(state.prune.tools.has("call-1")).toBe(false);
  });

  it("sweeps lookup and shell results but protects mutations", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.toolParameters.set("bash-1", {
      tool: "bash",
      parameters: { command: "same" },
      status: "completed",
      error: undefined,
      userTurn: 1,
      tokenCount: 20,
      assistantIndex: undefined,
      resultIndex: undefined,
    });
    state.toolParameters.set("write-1", {
      tool: "write",
      parameters: { path: "same" },
      status: "completed",
      error: undefined,
      userTurn: 1,
      tokenCount: 20,
      assistantIndex: undefined,
      resultIndex: undefined,
    });

    sweepCommand(state, config);

    expect(state.prune.tools.has("bash-1")).toBe(true);
    expect(state.prune.tools.has("write-1")).toBe(false);
  });

  it("skips already-pruned tool outputs", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    state.toolParameters.set("call-1", {
      tool: "custom-search",
      parameters: {},
      status: "completed",
      error: undefined,
      userTurn: 1,
      tokenCount: 200,
      assistantIndex: undefined,
      resultIndex: undefined,
    });
    state.prune.tools.set("call-1", 200);

    const result = sweepCommand(state, config);
    expect(result).toContain("0");
  });

  it("skips completed output within the global turn protection window", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.turnProtection = 3;
    state.currentUserTurn = 5;

    state.toolParameters.set("call-1", {
      tool: "custom-search",
      parameters: {},
      status: "completed",
      error: undefined,
      userTurn: 3,
      tokenCount: 200,
      assistantIndex: undefined,
      resultIndex: undefined,
    });

    const result = sweepCommand(state, config);

    expect(result).toContain("0");
    expect(state.prune.tools.has("call-1")).toBe(false);
  });
});
