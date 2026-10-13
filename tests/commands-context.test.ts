import { describe, expect, it } from "vitest";
import { contextCommand } from "../src/commands/context.ts";
import { createSessionState } from "../src/state/state.ts";

describe("context command", () => {
  it("retains every context field with compact estimated usage", () => {
    const state = createSessionState();
    state.prune.tools.set("c1", 100);
    state.prune.messages.activeBlockIds.add(1);
    state.prune.messages.blocksById.set(1, {} as never);
    state.prune.messages.blocksById.set(2, {} as never);
    state.toolParameters.set("t1", {} as never);
    state.toolParameters.set("t2", {} as never);
    state.toolParameters.set("t3", {} as never);
    state.currentUserTurn = 4;
    state.manualMode = "active";

    const result = contextCommand(
      state,
      { tokens: 5000, contextWindow: 200000, percent: 2.5 },
      true,
    );

    expect(result).toBe(
      [
        "DCP Context Usage:",
        "  Tokens:                      ~5k / 200k (2.5%)",
        "  Currently pruned tool calls: 1",
        "  Active compression blocks:   1",
        "  Total blocks:                2",
        "  Tool cache entries:          3",
        "  Current user turn:           4",
        "  Manual mode:                 active",
        "  DCP status:                  disabled for the current model",
      ].join("\n"),
    );
    expect(result).not.toContain("\u001b[");
  });

  it("keeps missing usage unavailable and zero usage available", () => {
    const empty = createSessionState();

    expect(contextCommand(empty, undefined)).toBe(
      [
        "DCP Context Usage:",
        "  Tokens:                      Unavailable",
        "  Currently pruned tool calls: 0",
        "  Active compression blocks:   0",
        "  Total blocks:                0",
        "  Tool cache entries:          0",
        "  Current user turn:           0",
        "  Manual mode:                 off",
      ].join("\n"),
    );

    expect(contextCommand(empty, { tokens: null, contextWindow: 200000, percent: null })).toBe(
      [
        "DCP Context Usage:",
        "  Tokens:                      Unavailable (context window: 200k)",
        "  Currently pruned tool calls: 0",
        "  Active compression blocks:   0",
        "  Total blocks:                0",
        "  Tool cache entries:          0",
        "  Current user turn:           0",
        "  Manual mode:                 off",
      ].join("\n"),
    );

    expect(contextCommand(empty, { tokens: 0, contextWindow: 200000, percent: 0 })).toBe(
      [
        "DCP Context Usage:",
        "  Tokens:                      ~0 / 200k (0.0%)",
        "  Currently pruned tool calls: 0",
        "  Active compression blocks:   0",
        "  Total blocks:                0",
        "  Tool cache entries:          0",
        "  Current user turn:           0",
        "  Manual mode:                 off",
      ].join("\n"),
    );
  });

  it("reports model-level disablement as a final row", () => {
    const result = contextCommand(createSessionState(), undefined, true);
    expect(result).toBe(
      [
        "DCP Context Usage:",
        "  Tokens:                      Unavailable",
        "  Currently pruned tool calls: 0",
        "  Active compression blocks:   0",
        "  Total blocks:                0",
        "  Tool cache entries:          0",
        "  Current user turn:           0",
        "  Manual mode:                 off",
        "  DCP status:                  disabled for the current model",
      ].join("\n"),
    );
  });
});
