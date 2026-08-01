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

describe("lifetime command", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-lifetime-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("shows aggregate stats from multiple sessions", async () => {
    const dir1 = path.join(tempDir, "session-1");
    const dir2 = path.join(tempDir, "session-2");
    fs.mkdirSync(dir1, { recursive: true });
    fs.mkdirSync(dir2, { recursive: true });

    fs.writeFileSync(
      path.join(dir1, "session.jsonl"),
      `${JSON.stringify(sessionHeader("session-1"))}\n${JSON.stringify({
        type: "custom",
        customType: "pi-dcp-state",
        timestamp: "2026-07-29T00:00:01.000Z",
        data: {
          version: 1,
          ownerSessionId: "one",
          manualMode: false,
          compressPermission: "allow",
          stats: {
            totalPruneTokens: 500,
            toolsPruned: 3,
            messagesCompressed: 1,
            pruneTokenCounter: 0,
          },
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
    fs.writeFileSync(
      path.join(dir2, "session.jsonl"),
      `${JSON.stringify(sessionHeader("session-2"))}\n${JSON.stringify({
        type: "custom",
        customType: "pi-dcp-state",
        timestamp: "2026-07-29T00:00:01.000Z",
        data: {
          version: 1,
          ownerSessionId: "two",
          manualMode: false,
          compressPermission: "allow",
          stats: {
            totalPruneTokens: 1500,
            toolsPruned: 7,
            messagesCompressed: 4,
            pruneTokenCounter: 0,
          },
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

    const result = await lifetimeCommand(tempDir);
    expect(result).toContain("2000");
    expect(result).toContain("10");
    expect(result).toContain("5");
    expect(result).toContain("2 sessions");
  });

  it("handles empty directory gracefully", async () => {
    const result = await lifetimeCommand(tempDir);
    expect(result).toContain("0 sessions");
  });

  it("handles non-existent directory", async () => {
    const result = await lifetimeCommand("/tmp/nonexistent-dcp-dir-xyz");
    expect(result).toContain("0 sessions");
  });
});
