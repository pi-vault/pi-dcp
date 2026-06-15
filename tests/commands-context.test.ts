import { describe, expect, it } from "vitest";
import { contextCommand } from "../src/commands/context.ts";
import { createSessionState } from "../src/state/state.ts";

describe("context command", () => {
  it("returns context summary with usage", () => {
    const state = createSessionState();
    state.prune.tools.set("c1", 100);
    state.prune.messages.activeBlockIds.add(1);

    const result = contextCommand(state, { tokens: 5000, contextWindow: 200000, percent: 2.5 });
    expect(result).toContain("5000");
    expect(result).toContain("200000");
    expect(result).toContain("2.5");
  });

  it("handles null token values in context usage (E5)", () => {
    const state = createSessionState();
    const result = contextCommand(state, { tokens: null, contextWindow: 200000, percent: null });
    expect(result).toContain("unavailable");
    expect(result).toContain("200000");
  });

  it("handles missing context usage entirely", () => {
    const state = createSessionState();
    const result = contextCommand(state, undefined);
    expect(result).toContain("unavailable");
  });
});
