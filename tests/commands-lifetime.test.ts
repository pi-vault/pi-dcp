import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { lifetimeCommand } from "../src/commands/lifetime.ts";

function sessionHeader(id: string) {
  return {
    type: "session",
    version: 3,
    id,
    timestamp: "2026-07-29T00:00:00.000Z",
    cwd: "/tmp/project",
  };
}

function writeSession(
  dir: string,
  name: string,
  owner: string,
  stats: {
    totalPruneTokens: number;
    toolsPruned: number;
    messagesCompressed: number;
    pruneTokenCounter: number;
  },
): void {
  const sessionDir = path.join(dir, name);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionDir, "session.jsonl"),
    `${JSON.stringify(sessionHeader(name))}\n${JSON.stringify({
      type: "custom",
      customType: "pi-dcp-state",
      timestamp: "2026-07-29T00:00:01.000Z",
      data: {
        version: 1,
        ownerSessionId: owner,
        manualMode: false,
        compressPermission: "allow",
        stats,
        lastCompaction: 0,
        pruneTools: [],
        blocks: [],
        nextBlockId: 1,
        nextRunId: 1,
        messageIds: { byRawId: [], nextRefIndex: 1 },
        nudges: { contextLimitAnchors: [], turnAnchors: [], iterationAnchors: [] },
      },
    })}`,
  );
}

describe("lifetime command", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-lifetime-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("formats saved-session totals without changing aggregation", async () => {
    writeSession(tempDir, "session-1", "one", {
      totalPruneTokens: 500,
      toolsPruned: 3,
      messagesCompressed: 1,
      pruneTokenCounter: 0,
    });
    writeSession(tempDir, "session-2", "two", {
      totalPruneTokens: 1500,
      toolsPruned: 7,
      messagesCompressed: 4,
      pruneTokenCounter: 0,
    });

    expect(await lifetimeCommand(tempDir)).toBe(
      [
        "DCP Lifetime Statistics:",
        "  Sessions tracked:          2 sessions",
        "  Total tokens saved:        ~2k",
        "  Total tools pruned:        10",
        "  Total messages compressed: 5",
      ].join("\n"),
    );
  });

  it("uses singular session grammar", async () => {
    writeSession(tempDir, "session-1", "one", {
      totalPruneTokens: 500,
      toolsPruned: 3,
      messagesCompressed: 1,
      pruneTokenCounter: 0,
    });

    expect(await lifetimeCommand(tempDir)).toBe(
      [
        "DCP Lifetime Statistics:",
        "  Sessions tracked:          1 session",
        "  Total tokens saved:        ~500",
        "  Total tools pruned:        3",
        "  Total messages compressed: 1",
      ].join("\n"),
    );
  });

  it("pins zero totals for empty and missing directories", async () => {
    const expected = [
      "DCP Lifetime Statistics:",
      "  Sessions tracked:          0 sessions",
      "  Total tokens saved:        ~0",
      "  Total tools pruned:        0",
      "  Total messages compressed: 0",
    ].join("\n");

    expect(await lifetimeCommand(tempDir)).toBe(expected);
    expect(await lifetimeCommand("/tmp/nonexistent-dcp-dir-xyz")).toBe(expected);
  });
});
