import { describe, expect, it } from "vitest";
import { helpCommand } from "../src/commands/help.ts";

describe("help command", () => {
  it("returns help text listing all commands", () => {
    const result = helpCommand();
    expect(result).toContain("dcp:context");
    expect(result).toContain("dcp:stats");
    expect(result).toContain("dcp:sweep");
    expect(result).toContain("dcp:manual");
    expect(result).toContain("dcp:decompress");
    expect(result).toContain("dcp:recompress");
  });
});
