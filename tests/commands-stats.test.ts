import { describe, expect, it } from "vitest";
import { statsCommand } from "../src/commands/stats.ts";
import { createSessionState } from "../src/state/state.ts";

describe("stats command", () => {
  it("returns statistics", () => {
    const state = createSessionState();
    state.stats.toolsPruned = 5;
    state.stats.totalPruneTokens = 1234;
    state.stats.messagesCompressed = 3;

    const result = statsCommand(state);
    expect(result).toContain("5");
    expect(result).toContain("1234");
    expect(result).toContain("3");
  });
});
