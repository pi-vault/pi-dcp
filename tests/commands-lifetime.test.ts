import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { lifetimeCommand } from "../src/commands/lifetime.ts";

describe("lifetime command", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-lifetime-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("shows aggregate stats from multiple sessions", () => {
    const dir1 = path.join(tempDir, "session-1", "dcp");
    const dir2 = path.join(tempDir, "session-2", "dcp");
    fs.mkdirSync(dir1, { recursive: true });
    fs.mkdirSync(dir2, { recursive: true });

    fs.writeFileSync(
      path.join(dir1, "state.json"),
      JSON.stringify({
        stats: { totalPruneTokens: 500, toolsPruned: 3, messagesCompressed: 1, pruneTokenCounter: 0 },
      }),
    );
    fs.writeFileSync(
      path.join(dir2, "state.json"),
      JSON.stringify({
        stats: { totalPruneTokens: 1500, toolsPruned: 7, messagesCompressed: 4, pruneTokenCounter: 0 },
      }),
    );

    const result = lifetimeCommand(tempDir);
    expect(result).toContain("2000");
    expect(result).toContain("10");
    expect(result).toContain("5");
    expect(result).toContain("2 sessions");
  });

  it("handles empty directory gracefully", () => {
    const result = lifetimeCommand(tempDir);
    expect(result).toContain("0 sessions");
  });

  it("handles non-existent directory", () => {
    const result = lifetimeCommand("/tmp/nonexistent-dcp-dir-xyz");
    expect(result).toContain("0 sessions");
  });
});
