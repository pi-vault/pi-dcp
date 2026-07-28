import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  saveSessionState,
  loadSessionState,
  loadAllSessionStats,
} from "../src/state/persistence.ts";
import { createSessionState } from "../src/state/state.ts";

describe("persistence", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-persist-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("saves and loads session state", () => {
    const state = createSessionState();
    state.sessionId = "test-session";
    state.currentUserTurn = 5;
    state.stats.toolsPruned = 3;
    state.stats.totalPruneTokens = 500;
    state.stats.messagesCompressed = 2;
    state.prune.tools.set("c1", 100);

    const stateDir = path.join(tempDir, "test-session-dir");
    fs.mkdirSync(stateDir, { recursive: true });
    saveSessionState(state, stateDir);

    const loaded = loadSessionState(stateDir);
    expect(loaded).toBeDefined();
    expect(loaded).not.toHaveProperty("currentUserTurn");
    const saved = JSON.parse(
      fs.readFileSync(path.join(stateDir, "dcp", "state.json"), "utf-8"),
    );
    expect(saved).not.toHaveProperty("currentTurn");
    expect(loaded!.stats.toolsPruned).toBe(3);
    expect(loaded!.stats.totalPruneTokens).toBe(500);
    expect(loaded!.stats.messagesCompressed).toBe(2);
    expect(loaded!.lastCompaction).toBe(0);
  });

  it("returns undefined when no state file exists", () => {
    const loaded = loadSessionState(tempDir);
    expect(loaded).toBeUndefined();
  });

  it("handles corrupt JSON gracefully", () => {
    const dcpDir = path.join(tempDir, "dcp");
    fs.mkdirSync(dcpDir, { recursive: true });
    fs.writeFileSync(path.join(dcpDir, "state.json"), "not json");

    const loaded = loadSessionState(tempDir);
    expect(loaded).toBeUndefined();
  });

  it("does not write when sessionId is null", () => {
    const state = createSessionState();
    state.sessionId = null;

    saveSessionState(state, tempDir);

    const dcpDir = path.join(tempDir, "dcp");
    expect(fs.existsSync(path.join(dcpDir, "state.json"))).toBe(false);
  });

  it("saves and loads messageIds state", () => {
    const state = createSessionState();
    state.sessionId = "test-session";
    state.messageIds.byRawId.set("user:1000:0", "m0001");
    state.messageIds.byRawId.set("assistant:2000:0", "m0002");
    state.messageIds.byRef.set("m0001", "user:1000:0");
    state.messageIds.byRef.set("m0002", "assistant:2000:0");
    state.messageIds.nextRefIndex = 3;

    const stateDir = path.join(tempDir, "ids-test");
    fs.mkdirSync(stateDir, { recursive: true });
    saveSessionState(state, stateDir);

    const loaded = loadSessionState(stateDir);
    expect(loaded).toBeDefined();
    expect(loaded!.messageIds).toBeDefined();
    expect(loaded!.messageIds!.byRawId.get("user:1000:0")).toBe("m0001");
    expect(loaded!.messageIds!.byRef.get("m0001")).toBe("user:1000:0");
    expect(loaded!.messageIds!.nextRefIndex).toBe(3);
    // byIndex is not persisted — runtime-only
    expect(loaded!.messageIds!.byIndex.size).toBe(0);
  });

  it("saves and loads nudge anchor sets", () => {
    const state = createSessionState();
    state.sessionId = "test-session";
    state.nudges.contextLimitAnchors.add("user:1000:0");
    state.nudges.contextLimitAnchors.add("user:2000:0");
    state.nudges.turnAnchors.add("assistant:3000:0");
    state.nudges.iterationAnchors.add("user:4000:0");
    state.nudges.iterationAnchors.add("assistant:5000:0");

    const stateDir = path.join(tempDir, "nudges-test");
    fs.mkdirSync(stateDir, { recursive: true });
    saveSessionState(state, stateDir);

    const loaded = loadSessionState(stateDir);
    expect(loaded).toBeDefined();
    expect(loaded!.nudges).toBeDefined();
    expect(loaded!.nudges!.contextLimitAnchors).toEqual(
      new Set(["user:1000:0", "user:2000:0"]),
    );
    expect(loaded!.nudges!.turnAnchors).toEqual(new Set(["assistant:3000:0"]));
    expect(loaded!.nudges!.iterationAnchors).toEqual(
      new Set(["user:4000:0", "assistant:5000:0"]),
    );
  });

  it("handles legacy state files without nudges", () => {
    const dcpDir = path.join(tempDir, "dcp");
    fs.mkdirSync(dcpDir, { recursive: true });
    fs.writeFileSync(
      path.join(dcpDir, "state.json"),
      JSON.stringify({
        currentTurn: 7,
        stats: { pruneTokenCounter: 0, totalPruneTokens: 0, toolsPruned: 0, messagesCompressed: 0 },
        lastCompaction: 0,
      }),
    );

    const loaded = loadSessionState(tempDir);
    expect(loaded).toBeDefined();
    expect(loaded!.nudges).toBeUndefined();
  });

  it("handles legacy state files without messageIds", () => {
    const dcpDir = path.join(tempDir, "dcp");
    fs.mkdirSync(dcpDir, { recursive: true });
    fs.writeFileSync(
      path.join(dcpDir, "state.json"),
      JSON.stringify({
        currentTurn: 3,
        stats: { pruneTokenCounter: 0, totalPruneTokens: 100, toolsPruned: 1, messagesCompressed: 0 },
        lastCompaction: 0,
      }),
    );

    const loaded = loadSessionState(tempDir);
    expect(loaded).toBeDefined();
    expect(loaded!.messageIds).toBeUndefined(); // gracefully absent
  });

  describe("loadAllSessionStats", () => {
    it("aggregates stats from multiple session dirs", () => {
      // Create two session dirs with state files
      const dir1 = path.join(tempDir, "session-1", "dcp");
      const dir2 = path.join(tempDir, "session-2", "dcp");
      fs.mkdirSync(dir1, { recursive: true });
      fs.mkdirSync(dir2, { recursive: true });

      fs.writeFileSync(
        path.join(dir1, "state.json"),
        JSON.stringify({
          stats: { totalPruneTokens: 300, toolsPruned: 2, messagesCompressed: 1, pruneTokenCounter: 0 },
        }),
      );
      fs.writeFileSync(
        path.join(dir2, "state.json"),
        JSON.stringify({
          stats: { totalPruneTokens: 700, toolsPruned: 5, messagesCompressed: 3, pruneTokenCounter: 0 },
        }),
      );

      const result = loadAllSessionStats(tempDir);
      expect(result.totalTokensSaved).toBe(1000);
      expect(result.totalToolsPruned).toBe(7);
      expect(result.totalMessagesCompressed).toBe(4);
      expect(result.sessionCount).toBe(2);
    });

    it("returns zeros when directory does not exist", () => {
      const result = loadAllSessionStats("/tmp/nonexistent-dcp-dir-xyz");
      expect(result.totalTokensSaved).toBe(0);
      expect(result.sessionCount).toBe(0);
    });

    it("skips corrupt state files", () => {
      const dir1 = path.join(tempDir, "good-session", "dcp");
      const dir2 = path.join(tempDir, "bad-session", "dcp");
      fs.mkdirSync(dir1, { recursive: true });
      fs.mkdirSync(dir2, { recursive: true });

      fs.writeFileSync(
        path.join(dir1, "state.json"),
        JSON.stringify({
          stats: { totalPruneTokens: 100, toolsPruned: 1, messagesCompressed: 0, pruneTokenCounter: 0 },
        }),
      );
      fs.writeFileSync(path.join(dir2, "state.json"), "{{{invalid");

      const result = loadAllSessionStats(tempDir);
      expect(result.totalTokensSaved).toBe(100);
      expect(result.sessionCount).toBe(1);
    });
  });
});
