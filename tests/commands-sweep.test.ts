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
      turn: 1,
      tokenCount: 200,
    });
    // "compress" is protected — should not be swept
    state.toolParameters.set("call-2", {
      tool: "compress",
      parameters: {},
      status: "completed",
      error: undefined,
      turn: 1,
      tokenCount: 100,
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
      turn: 1,
      tokenCount: 200,
    });

    const result = sweepCommand(state, config);
    expect(result).toContain("0");
    expect(state.prune.tools.has("call-1")).toBe(false);
  });

  it("skips already-pruned tool outputs", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    state.toolParameters.set("call-1", {
      tool: "custom-search",
      parameters: {},
      status: "completed",
      error: undefined,
      turn: 1,
      tokenCount: 200,
    });
    state.prune.tools.set("call-1", 200);

    const result = sweepCommand(state, config);
    expect(result).toContain("0");
  });
});
