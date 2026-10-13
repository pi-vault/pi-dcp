import { describe, it, expect } from "vitest";
import { buildMinimalMessage, buildDetailedMessage } from "../src/tui/notification.ts";

describe("buildMinimalMessage", () => {
  it.each([
    [12_400, 8, "DCP · saved ~12.4k tokens · pruned 8 outputs"],
    [1, 1, "DCP · saved ~1 token · pruned 1 output"],
    [0, 1, "DCP · saved ~0 tokens · pruned 1 output"],
    [100, 0, "DCP · saved ~100 tokens · pruned 0 outputs"],
  ])("formats saved %d and pruned %d", (tokensSaved, pruned, expected) => {
    expect(buildMinimalMessage({ tokensSaved, pruned })).toBe(expected);
  });

  it("returns undefined when nothing pruned", () => {
    expect(buildMinimalMessage({ tokensSaved: 0, pruned: 0 })).toBeUndefined();
  });
});

describe("buildDetailedMessage", () => {
  it("appends normalized, deduplicated tool names in first-occurrence order", () => {
    const result = buildDetailedMessage({ tokensSaved: 3000, pruned: 3 }, [
      "  grep ",
      "grep",
      "\n",
      "ls",
    ]);
    expect(result).toBe("DCP · saved ~3k tokens · pruned 3 outputs\nPruned: grep, ls");
  });

  it("falls back to minimal format when every label normalizes to empty", () => {
    const result = buildDetailedMessage({ tokensSaved: 5000, pruned: 2 }, [" ", "\t\n"]);
    expect(result).toBe("DCP · saved ~5k tokens · pruned 2 outputs");
  });

  it("returns undefined when nothing pruned", () => {
    expect(buildDetailedMessage({ tokensSaved: 0, pruned: 0 }, ["grep"])).toBeUndefined();
  });
});
