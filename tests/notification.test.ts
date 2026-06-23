import { describe, it, expect } from "vitest";
import {
  buildMinimalMessage,
  buildDetailedMessage,
} from "../src/ui/notification.ts";

describe("buildMinimalMessage", () => {
  it("formats token count and prune count", () => {
    const result = buildMinimalMessage({ tokensSaved: 12400, pruned: 3 });
    expect(result).toBe("DCP: ~12.4K tokens saved (3 items pruned)");
  });

  it("formats large token counts with K suffix", () => {
    const result = buildMinimalMessage({ tokensSaved: 156000, pruned: 10 });
    expect(result).toBe("DCP: ~156.0K tokens saved (10 items pruned)");
  });

  it("formats small token counts without K suffix", () => {
    const result = buildMinimalMessage({ tokensSaved: 500, pruned: 1 });
    expect(result).toBe("DCP: ~500 tokens saved (1 items pruned)");
  });

  it("returns undefined when nothing pruned", () => {
    const result = buildMinimalMessage({ tokensSaved: 0, pruned: 0 });
    expect(result).toBeUndefined();
  });
});

describe("buildDetailedMessage", () => {
  it("includes pruned tool list", () => {
    const result = buildDetailedMessage({ tokensSaved: 5000, pruned: 2 }, [
      "grep",
      "ls",
    ]);
    expect(result).toContain("~5.0K tokens saved");
    expect(result).toContain("grep");
    expect(result).toContain("ls");
  });

  it("falls back to minimal format when tool list is empty", () => {
    const result = buildDetailedMessage({ tokensSaved: 5000, pruned: 2 }, []);
    expect(result).toContain("~5.0K tokens saved");
    expect(result).not.toContain("Pruned:");
  });

  it("deduplicates tool names", () => {
    const result = buildDetailedMessage({ tokensSaved: 3000, pruned: 3 }, [
      "grep",
      "grep",
      "ls",
    ]);
    expect(result).toContain("Pruned: grep, ls");
  });

  it("returns undefined when nothing pruned", () => {
    const result = buildDetailedMessage({ tokensSaved: 0, pruned: 0 }, ["grep"]);
    expect(result).toBeUndefined();
  });
});
