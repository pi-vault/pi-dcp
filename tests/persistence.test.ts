import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadAllSessionStats } from "../src/state/persistence.ts";
import * as persistence from "../src/state/persistence.ts";
import { createSessionState } from "../src/state/state.ts";

function sessionHeader(id: string) {
  return {
    type: "session",
    version: 3,
    id,
    timestamp: "2026-07-29T00:00:00.000Z",
    cwd: "/tmp/project",
  };
}

describe("persistence", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-persist-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("loadAllSessionStats", () => {
    it("aggregates each owner's newest snapshot from nested Pi JSONL sessions", async () => {
      const dir1 = path.join(tempDir, "project-a", "session-1");
      const dir2 = path.join(tempDir, "project-b", "session-2");
      fs.mkdirSync(dir1, { recursive: true });
      fs.mkdirSync(dir2, { recursive: true });
      const snapshot = (owner: string, total: number, tools: number, messages: number) => ({
        version: 1,
        ownerSessionId: owner,
        manualMode: false,
        compressPermission: "allow",
        stats: {
          pruneTokenCounter: 0,
          totalPruneTokens: total,
          toolsPruned: tools,
          messagesCompressed: messages,
        },
        lastCompaction: 0,
        pruneTools: [],
        blocks: [],
        nextBlockId: 1,
        nextRunId: 1,
        messageIds: { byRawId: [], nextRefIndex: 1 },
        nudges: { contextLimitAnchors: [], turnAnchors: [], iterationAnchors: [] },
      });
      fs.writeFileSync(
        path.join(dir1, "session.jsonl"),
        [
          JSON.stringify(sessionHeader("session-1")),
          JSON.stringify({
            type: "custom",
            customType: "pi-dcp-state",
            timestamp: "2026-07-29T00:00:01.000Z",
            data: snapshot("one", 300, 2, 1),
          }),
          JSON.stringify({
            type: "custom",
            customType: "pi-dcp-state",
            timestamp: "2026-07-29T00:00:02.000Z",
            data: snapshot("one", 400, 3, 2),
          }),
        ].join("\n"),
      );
      fs.writeFileSync(
        path.join(dir2, "session.jsonl"),
        [
          JSON.stringify(sessionHeader("session-2")),
          "not json",
          JSON.stringify({
            type: "custom",
            customType: "pi-dcp-state",
            timestamp: "2026-07-29T00:00:01.000Z",
            data: snapshot("two", 700, 5, 3),
          }),
        ].join("\n"),
      );

      const result = await loadAllSessionStats(tempDir);
      expect(result.totalTokensSaved).toBe(1100);
      expect(result.totalToolsPruned).toBe(8);
      expect(result.totalMessagesCompressed).toBe(5);
      expect(result.sessionCount).toBe(2);
    });

    it("returns zeros when directory does not exist", async () => {
      const result = await loadAllSessionStats("/tmp/nonexistent-dcp-dir-xyz");
      expect(result.totalTokensSaved).toBe(0);
      expect(result.sessionCount).toBe(0);
    });

    it("ignores files without a Pi session header", async () => {
      const dir1 = path.join(tempDir, "good-session");
      const dir2 = path.join(tempDir, "bad-session");
      fs.mkdirSync(dir1, { recursive: true });
      fs.mkdirSync(dir2, { recursive: true });

      fs.writeFileSync(
        path.join(dir1, "session.jsonl"),
        JSON.stringify({ type: "custom", customType: "pi-dcp-state", data: {} }),
      );
      fs.writeFileSync(path.join(dir2, "session.jsonl"), "{{{invalid");

      const result = await loadAllSessionStats(tempDir);
      expect(result.totalTokensSaved).toBe(0);
      expect(result.sessionCount).toBe(0);
    });

    it("ignores JSONL files with an incomplete Pi session header", async () => {
      const state = createSessionState();
      state.sessionId = "owner";
      state.stats.totalPruneTokens = 100;
      const snapshot = persistence.serializeDcpSnapshot(state);
      if (!snapshot) throw new Error("expected snapshot");
      fs.writeFileSync(
        path.join(tempDir, "fake.jsonl"),
        [
          JSON.stringify({ type: "session" }),
          JSON.stringify({
            type: "custom",
            customType: "pi-dcp-state",
            timestamp: "2026-07-29T00:00:00.000Z",
            data: snapshot,
          }),
        ].join("\n"),
      );

      const result = await loadAllSessionStats(tempDir);

      expect(result.sessionCount).toBe(0);
      expect(result.totalTokensSaved).toBe(0);
    });

    it("ignores native snapshots without a valid custom-entry timestamp", async () => {
      const state = createSessionState();
      state.sessionId = "owner";
      state.stats.totalPruneTokens = 100;
      const snapshot = persistence.serializeDcpSnapshot(state);
      if (!snapshot) throw new Error("expected snapshot");
      fs.writeFileSync(
        path.join(tempDir, "invalid-timestamp.jsonl"),
        [
          JSON.stringify(sessionHeader("session")),
          JSON.stringify({
            type: "custom",
            customType: "pi-dcp-state",
            timestamp: "not-a-date",
            data: snapshot,
          }),
        ].join("\n"),
      );

      const result = await loadAllSessionStats(tempDir);

      expect(result.sessionCount).toBe(0);
    });
  });

  describe("native snapshots", () => {
    it("serializes only stable durable state in deterministic order", () => {
      const state = createSessionState();
      state.sessionId = "owner";
      state.manualMode = "active";
      state.compressPermission = "allow";
      state.stats.totalPruneTokens = 42;
      state.lastCompaction = 123;
      state.prune.tools.set("z-tool", 5);
      state.prune.tools.set("a-tool", 3);
      state.messageIds.byRawId.set("z-key", "m0002");
      state.messageIds.byRawId.set("a-key", "m0001");
      state.messageIds.nextRefIndex = 3;
      state.nudges.contextLimitAnchors.add("z-key");
      state.nudges.contextLimitAnchors.add("a-key");
      state.prune.messages.nextBlockId = 3;
      state.prune.messages.nextRunId = 2;
      state.prune.messages.blocksById.set(2, {
        blockId: 2,
        runId: 1,
        active: true,
        deactivatedByUser: false,
        compressedTokens: 10,
        summaryTokens: 2,
        durationMs: 30,
        mode: "range",
        topic: "topic",
        batchTopic: undefined,
        startIndex: 4,
        endIndex: 8,
        anchorIndex: 8,
        compressToolCallId: "call-2",
        startKey: "start",
        endKey: "end",
        anchorKey: "anchor",
        consumedBlockIds: [],
        parentBlockIds: [],
        directMessageIndices: [4, 5],
        directToolIds: ["tool"],
        effectiveMessageIndices: [4, 5],
        effectiveToolIds: ["tool"],
        createdAt: 1,
        deactivatedAt: undefined,
        deactivatedByBlockId: undefined,
        summary: "summary",
      });

      const snapshot = persistence.serializeDcpSnapshot(state);
      expect(snapshot).toMatchObject({
        version: 1,
        ownerSessionId: "owner",
        manualMode: "active",
        compressPermission: "allow",
        stats: { totalPruneTokens: 42 },
        pruneTools: [
          ["a-tool", 3],
          ["z-tool", 5],
        ],
        messageIds: {
          byRawId: [
            ["a-key", "m0001"],
            ["z-key", "m0002"],
          ],
        },
        nudges: { contextLimitAnchors: ["a-key", "z-key"] },
      });
      expect(snapshot?.blocks[0]).toEqual({
        blockId: 2,
        runId: 1,
        deactivatedByUser: false,
        compressedTokens: 10,
        summaryTokens: 2,
        durationMs: 30,
        mode: "range",
        topic: "topic",
        compressToolCallId: "call-2",
        startKey: "start",
        endKey: "end",
        anchorKey: "anchor",
        consumedBlockIds: [],
        createdAt: 1,
        summary: "summary",
      });
      expect(snapshot?.blocks[0]).not.toHaveProperty("startIndex");
      expect(snapshot?.blocks[0]).not.toHaveProperty("active");
    });

    it("excludes message-id bookkeeping from the durable fingerprint", () => {
      const state = createSessionState();
      state.sessionId = "owner";
      const before = persistence.durableStateFingerprint(state);

      state.messageIds.byRawId.set("user:1:0", "m0001");
      state.messageIds.byRef.set("m0001", "user:1:0");
      state.messageIds.nextRefIndex = 2;

      expect(persistence.durableStateFingerprint(state)).toBe(before);
      expect(persistence.serializeDcpSnapshot(state)?.messageIds).toEqual({
        byRawId: [["user:1:0", "m0001"]],
        nextRefIndex: 2,
      });
    });

    it("changes the durable fingerprint for semantic mutations", () => {
      const mutations: Array<(state: ReturnType<typeof createSessionState>) => void> = [
        (state) => {
          state.manualMode = "active";
        },
        (state) => {
          state.compressPermission = "deny";
        },
        (state) => {
          state.stats.totalPruneTokens = 1;
        },
        (state) => {
          state.lastCompaction = 1;
        },
        (state) => {
          state.prune.tools.set("call", 1);
        },
        (state) => {
          state.prune.messages.nextBlockId = 2;
        },
        (state) => {
          state.prune.messages.nextRunId = 2;
        },
        (state) => {
          state.nudges.turnAnchors.add("user:1:0");
        },
      ];

      for (const mutate of mutations) {
        const state = createSessionState();
        state.sessionId = "owner";
        const before = persistence.durableStateFingerprint(state);
        mutate(state);
        expect(persistence.durableStateFingerprint(state)).not.toBe(before);
      }
    });

    it("restores in place and resets statistics for a forked owner", () => {
      const saved = createSessionState();
      saved.sessionId = "parent";
      saved.manualMode = "active";
      saved.compressPermission = "deny";
      saved.stats.totalPruneTokens = 50;
      saved.prune.tools.set("call", 7);
      saved.messageIds.byRawId.set("key", "m0001");
      saved.messageIds.nextRefIndex = 2;
      saved.nudges.turnAnchors.add("key");
      const snapshot = persistence.serializeDcpSnapshot(saved);
      expect(snapshot).toBeDefined();
      if (!snapshot) throw new Error("expected snapshot");

      const restored = createSessionState();
      restored.toolParameters.set("stale", {} as never);
      restored.messageIds.byIndex.set(3, "stale");

      expect(persistence).toHaveProperty("restoreDcpSnapshot");
      expect(persistence.restoreDcpSnapshot(snapshot, restored, "child")).toBe(true);
      expect(restored.sessionId).toBe("child");
      expect(restored.manualMode).toBe("active");
      expect(restored.compressPermission).toBe("deny");
      expect(restored.stats).toEqual({
        pruneTokenCounter: 0,
        totalPruneTokens: 0,
        toolsPruned: 0,
        messagesCompressed: 0,
      });
      expect(restored.prune.tools).toEqual(new Map([["call", 7]]));
      expect(restored.messageIds.byRef).toEqual(new Map([["m0001", "key"]]));
      expect(restored.messageIds.byIndex.size).toBe(0);
      expect(restored.toolParameters.size).toBe(0);
    });

    it("rejects invalid roots and salvages valid snapshot entries", () => {
      expect(persistence.parseDcpSnapshot(null)).toBeUndefined();
      const state = createSessionState();
      state.sessionId = "owner";
      const snapshot = persistence.serializeDcpSnapshot(state)!;
      expect(persistence.parseDcpSnapshot({ ...snapshot, nextBlockId: 0 })).toBeUndefined();
      expect(
        persistence.parseDcpSnapshot({ ...snapshot, stats: { totalPruneTokens: 1 } }),
      ).toBeUndefined();

      snapshot.blocks = [
        {
          blockId: 1,
          runId: 1,
          deactivatedByUser: false,
          compressedTokens: 1,
          summaryTokens: 1,
          durationMs: 1,
          mode: "range",
          topic: "topic",
          compressToolCallId: "owner",
          startKey: "start",
          endKey: "end",
          anchorKey: "anchor",
          consumedBlockIds: [1, 2],
          createdAt: 1,
          summary: "summary",
        },
        { blockId: 1 } as never,
        { blockId: "bad" } as never,
      ];
      snapshot.messageIds.byRawId = [
        ["valid", "m0001"],
        ["valid", "m0002"],
        ["bad-ref", "not-a-message-ref"],
        ["broken"] as never,
      ];
      const warnings: string[] = [];
      const parsed = persistence.parseDcpSnapshot(snapshot, (message) => warnings.push(message));

      expect(parsed?.blocks).toHaveLength(1);
      expect(parsed?.blocks[0]?.consumedBlockIds).toEqual([]);
      expect(parsed?.messageIds.byRawId).toEqual([["valid", "m0002"]]);
      expect(warnings).toHaveLength(2);

      const restored = createSessionState();
      persistence.restoreDcpSnapshot({ ...snapshot, nextBlockId: 1 }, restored, "owner");
      expect(restored.prune.messages.nextBlockId).toBe(2);
    });

    it("repairs the message reference counter during restore", () => {
      const state = createSessionState();
      state.sessionId = "owner";
      const snapshot = persistence.serializeDcpSnapshot(state);
      if (!snapshot) throw new Error("expected snapshot");
      snapshot.messageIds = {
        byRawId: [["user:1:0", "m0007"]],
        nextRefIndex: 1,
      };

      const restored = createSessionState();
      persistence.restoreDcpSnapshot(snapshot, restored, "owner");

      expect(restored.messageIds.nextRefIndex).toBe(8);
    });

    it("normalizes duplicate pruning entries", () => {
      const state = createSessionState();
      state.sessionId = "owner";
      const snapshot = persistence.serializeDcpSnapshot(state);
      if (!snapshot) throw new Error("expected snapshot");
      snapshot.pruneTools = [
        ["call", 1],
        ["call", 2],
      ];

      const parsed = persistence.parseDcpSnapshot(snapshot);

      expect(parsed?.pruneTools).toEqual([["call", 2]]);
    });

    it("rejects negative and fractional persisted counters", () => {
      const state = createSessionState();
      state.sessionId = "owner";
      const snapshot = persistence.serializeDcpSnapshot(state);
      if (!snapshot) throw new Error("expected snapshot");

      expect(
        persistence.parseDcpSnapshot({
          ...snapshot,
          stats: { ...snapshot.stats, totalPruneTokens: -1 },
        }),
      ).toBeUndefined();
      expect(persistence.parseDcpSnapshot({ ...snapshot, nextRunId: 1.5 })).toBeUndefined();

      snapshot.pruneTools = [
        ["negative", -1],
        ["fractional", 1.5],
        ["valid", 0],
      ];
      snapshot.blocks = [
        {
          blockId: 1,
          runId: 1,
          deactivatedByUser: false,
          compressedTokens: -1,
          summaryTokens: 1,
          durationMs: 1,
          mode: "range",
          topic: "topic",
          compressToolCallId: "owner",
          startKey: "start",
          endKey: "end",
          anchorKey: "anchor",
          consumedBlockIds: [],
          createdAt: 1,
          summary: "summary",
        },
      ];

      const parsed = persistence.parseDcpSnapshot(snapshot);
      expect(parsed?.pruneTools).toEqual([["valid", 0]]);
      expect(parsed?.blocks).toEqual([]);
    });
  });
});
