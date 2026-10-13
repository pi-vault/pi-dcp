import { describe, expect, it } from "vitest";
import { statsCommand } from "../src/commands/stats.ts";
import { createSessionState } from "../src/state/state.ts";

describe("stats command", () => {
  it("retains all four session counters with estimate provenance", () => {
    const state = createSessionState();
    state.stats.toolsPruned = 5;
    state.stats.totalPruneTokens = 1234;
    state.stats.messagesCompressed = 3;
    state.stats.pruneTokenCounter = 500;

    expect(statsCommand(state)).toBe(
      [
        "DCP Session Statistics:",
        "  Tools pruned this session:          5",
        "  Cumulative tokens saved by pruning: ~1.2k",
        "  Messages compressed this session:   3",
        "  Prune token counter:                ~500",
      ].join("\n"),
    );
  });

  it("keeps integer counts unformatted when zero", () => {
    const result = statsCommand(createSessionState());
    expect(result).toBe(
      [
        "DCP Session Statistics:",
        "  Tools pruned this session:          0",
        "  Cumulative tokens saved by pruning: ~0",
        "  Messages compressed this session:   0",
        "  Prune token counter:                ~0",
      ].join("\n"),
    );
    expect(result).not.toContain("\u001b[");
  });
});
