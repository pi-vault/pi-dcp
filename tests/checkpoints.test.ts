import { describe, expect, it, vi } from "vitest";
import { assignMessageRefs } from "../src/messages/inject.ts";
import {
  createDcpCheckpoints,
  type DcpCheckpointHost,
  type DcpCheckpointWarning,
} from "../src/state/checkpoints.ts";
import { createSessionState } from "../src/state/state.ts";
import type { DcpConfig } from "../src/config.ts";
import type { DcpSnapshotBlockV1, DcpSnapshotV2, SessionState } from "../src/state/types.ts";
import { createExtensionHarness } from "./extension-harness.ts";
import { makeDefaultConfig, makeUserMessage } from "./helpers.ts";

const sampleBlock: DcpSnapshotBlockV1 = {
  blockId: 1,
  runId: 1,
  deactivatedByUser: false,
  compressedTokens: 100,
  summaryTokens: 10,
  durationMs: 0,
  mode: "range",
  topic: "existing block",
  compressToolCallId: "compress-1",
  startKey: "user:1:0",
  endKey: "assistant:2:0",
  anchorKey: "user:1:0",
  consumedBlockIds: [],
  createdAt: 1,
  summary: "existing summary",
};

function snapshotV2(overrides: Partial<DcpSnapshotV2> = {}): DcpSnapshotV2 {
  return {
    version: 2,
    ownerSessionId: "session",
    manualMode: false,
    compressPermission: "allow",
    stats: { pruneTokenCounter: 0, totalPruneTokens: 42, toolsPruned: 1, messagesCompressed: 2 },
    lastCompaction: 0,
    pruneTools: [],
    blocks: [],
    nextBlockId: 1,
    nextRunId: 1,
    messageIds: { byRawId: [], nextRefIndex: 1 },
    nudges: { contextLimitAnchors: [], turnAnchors: [], iterationAnchors: [] },
    ...overrides,
  };
}

function custom(data: unknown) {
  return { type: "custom", customType: "pi-dcp-state", data };
}

interface OwnerHarnessOptions {
  sessionId?: string;
  branch?: unknown[];
  state?: SessionState;
  config?: DcpConfig;
  warn?: DcpCheckpointWarning;
}

function ownerHarness(options: OwnerHarnessOptions = {}) {
  const harness = createExtensionHarness({
    sessionId: options.sessionId ?? "session",
    branch: options.branch ?? [],
  });
  const state = options.state ?? createSessionState();
  const config = options.config ?? makeDefaultConfig();
  const warn = vi.fn(options.warn);
  const appendSpy = vi.spyOn(harness.api, "appendEntry");
  const checkpoints = createDcpCheckpoints(harness.api, state, config, warn);
  return { harness, state, config, warn, appendSpy, checkpoints };
}

describe("DCP branch checkpoints", () => {
  it("restores a clean same-owner v2 snapshot and deduplicates until facts change", () => {
    const snapshot = snapshotV2({
      manualMode: "active",
      compressPermission: "ask",
      stats: { pruneTokenCounter: 3, totalPruneTokens: 42, toolsPruned: 1, messagesCompressed: 2 },
      messageIds: { byRawId: [["user:1:0", "m0001"]], nextRefIndex: 2 },
    });
    const { harness, state, appendSpy, checkpoints } = ownerHarness({
      branch: [custom(snapshot)],
    });
    const afterRestore = vi.fn(() => {
      expect(state.manualMode).toBe("active");
      expect(state.compressPermission).toBe("ask");
      expect(state.stats).toEqual({
        pruneTokenCounter: 3,
        totalPruneTokens: 42,
        toolsPruned: 1,
        messagesCompressed: 2,
      });
      expect(state.messageIds.byRawId.get("user:1:0")).toBe("m0001");
      expect(state.messageIds.byRef.get("m0001")).toBe("user:1:0");
      expect(state.messageIds.nextRefIndex).toBe(2);
      expect(appendSpy).not.toHaveBeenCalled();
    });

    checkpoints.restoreAndCheckpoint("session-start", harness.context, afterRestore);

    expect(afterRestore).toHaveBeenCalledTimes(1);
    expect(appendSpy).not.toHaveBeenCalled();

    state.stats.totalPruneTokens = 99;
    checkpoints.persist();
    expect(appendSpy).toHaveBeenCalledTimes(1);
    checkpoints.persist();
    expect(appendSpy).toHaveBeenCalledTimes(1);
  });

  it("restores a clean same-owner v1 snapshot without appending", () => {
    const snapshot = { ...snapshotV2({ compressPermission: "allow" }), version: 1 as const };
    const { harness, state, appendSpy, checkpoints } = ownerHarness({
      branch: [custom(snapshot)],
    });

    checkpoints.restoreAndCheckpoint("session-start", harness.context, () => {});

    expect(state.compressPermission).toBe("allow");
    expect(state.stats.totalPruneTokens).toBe(42);
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("selects the newest valid DCP entry and ignores other branch entries", () => {
    const newest = snapshotV2({ manualMode: "active", compressPermission: "ask" });
    const { harness, state, appendSpy, checkpoints } = ownerHarness({
      branch: [
        custom(snapshotV2({ stats: { ...newest.stats, totalPruneTokens: 7 } })),
        custom(newest),
        { type: "custom", customType: "another-extension", data: snapshotV2() },
        { type: "message", message: makeUserMessage("unrelated", 1) },
      ],
    });
    const afterRestore = vi.fn(() => {
      expect(state.stats.totalPruneTokens).toBe(42);
      expect(state.manualMode).toBe("active");
      expect(state.compressPermission).toBe("ask");
      expect(appendSpy).not.toHaveBeenCalled();
    });

    checkpoints.restoreAndCheckpoint("branch-navigation", harness.context, afterRestore);

    expect(afterRestore).toHaveBeenCalledTimes(1);
    expect(appendSpy).not.toHaveBeenCalled();
    checkpoints.persist();
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("zeroes inherited-session stats but retains blocks and refs, then forks a child checkpoint", () => {
    const snapshot = snapshotV2({
      ownerSessionId: "parent",
      manualMode: "active",
      stats: { pruneTokenCounter: 5, totalPruneTokens: 500, toolsPruned: 5, messagesCompressed: 5 },
      blocks: [sampleBlock],
      nextBlockId: 2,
      nextRunId: 2,
      messageIds: { byRawId: [["user:1:0", "m0001"]], nextRefIndex: 2 },
    });
    const { harness, state, appendSpy, checkpoints } = ownerHarness({
      sessionId: "child",
      branch: [custom(snapshot)],
    });
    const afterRestore = vi.fn(() => {
      expect(state.sessionId).toBe("child");
      expect(state.manualMode).toBe("active");
      expect(state.stats).toEqual({
        pruneTokenCounter: 0,
        totalPruneTokens: 0,
        toolsPruned: 0,
        messagesCompressed: 0,
      });
      expect(state.prune.messages.blocksById.get(1)?.summary).toBe("existing summary");
      expect(state.messageIds.byRawId.get("user:1:0")).toBe("m0001");
      expect(appendSpy).not.toHaveBeenCalled();
    });

    checkpoints.restoreAndCheckpoint("session-start", harness.context, afterRestore);

    expect(afterRestore).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(harness.entries[0]?.data).toMatchObject({
      version: 2,
      ownerSessionId: "child",
      stats: { totalPruneTokens: 0 },
      blocks: [{ blockId: 1, summary: "existing summary" }],
    });
  });

  it.each([
    { name: "malformed", newest: { invalid: true } },
    { name: "unsupported version 3", newest: { ...snapshotV2(), version: 3 } },
  ])(
    "restores the older valid snapshot and writes one repair for a $name newest entry",
    ({ newest }) => {
      const older = snapshotV2({
        stats: { pruneTokenCounter: 0, totalPruneTokens: 7, toolsPruned: 0, messagesCompressed: 0 },
        messageIds: { byRawId: [["user:1:0", "m0001"]], nextRefIndex: 2 },
      });
      const { harness, state, appendSpy, checkpoints } = ownerHarness({
        branch: [custom(older), custom(newest)],
      });
      const afterRestore = vi.fn(() => {
        expect(state.stats.totalPruneTokens).toBe(7);
        expect(appendSpy).not.toHaveBeenCalled();
      });

      checkpoints.restoreAndCheckpoint("branch-navigation", harness.context, afterRestore);

      expect(afterRestore).toHaveBeenCalledTimes(1);
      expect(appendSpy).toHaveBeenCalledTimes(1);
      expect(harness.entries[0]?.data).toMatchObject({
        version: 2,
        ownerSessionId: "session",
        stats: { totalPruneTokens: 7 },
      });
    },
  );

  it("writes a baseline with current defaults even when the fingerprint matches the previous branch", () => {
    const config = makeDefaultConfig();
    config.manualMode.default = "active";
    config.compress.permission = "deny";
    const { harness, state, appendSpy, checkpoints } = ownerHarness({ config });

    checkpoints.restoreAndCheckpoint("session-start", harness.context, () => {});
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(state.manualMode).toBe("active");
    expect(state.compressPermission).toBe("deny");
    const baseline = harness.entries[0]?.data;

    checkpoints.restoreAndCheckpoint("branch-navigation", harness.context, () => {});
    expect(appendSpy).toHaveBeenCalledTimes(2);
    expect(harness.entries[1]?.data).toEqual(baseline);
  });

  it("falls back to current defaults and repairs an all-invalid branch", () => {
    const { harness, state, config, appendSpy, checkpoints } = ownerHarness({
      branch: [custom(snapshotV2({ blocks: [sampleBlock], nextBlockId: 2, nextRunId: 2 }))],
    });
    checkpoints.restoreAndCheckpoint("session-start", harness.context, () => {});
    config.manualMode = { ...config.manualMode, default: "active" };
    config.compress = { ...config.compress, permission: "deny" };
    harness.setBranch([custom({ invalid: true }), custom({ ...snapshotV2(), version: 3 })]);
    const afterRestore = vi.fn(() => {
      expect(state.sessionId).toBe("session");
      expect(state.manualMode).toBe("active");
      expect(state.compressPermission).toBe("deny");
      expect(state.stats.totalPruneTokens).toBe(0);
      expect(state.prune.messages.blocksById.size).toBe(0);
      expect(appendSpy).not.toHaveBeenCalled();
    });

    checkpoints.restoreAndCheckpoint("branch-navigation", harness.context, afterRestore);

    expect(afterRestore).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(harness.entries[0]?.data).toMatchObject({
      version: 2,
      ownerSessionId: "session",
      manualMode: "active",
      compressPermission: "deny",
      stats: { totalPruneTokens: 0 },
      blocks: [],
      nextBlockId: 1,
      nextRunId: 1,
    });
    checkpoints.persist();
    expect(appendSpy).toHaveBeenCalledTimes(1);
  });

  it("warns, keeps the fingerprint unchanged, and retries changed state after an append failure", () => {
    const { harness, state, appendSpy, checkpoints, warn } = ownerHarness({
      branch: [custom(snapshotV2())],
    });
    checkpoints.restoreAndCheckpoint("session-start", harness.context, () => {});
    appendSpy.mockClear();

    state.stats.totalPruneTokens = 111;
    appendSpy.mockImplementationOnce(() => {
      throw new Error("append failed");
    });
    checkpoints.persist();

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("failed to persist native session state", {
      error: "Error: append failed",
    });

    checkpoints.persist();
    expect(appendSpy).toHaveBeenCalledTimes(2);
    expect(harness.entries).toHaveLength(1);
    expect(harness.entries[0]?.data).toMatchObject({ stats: { totalPruneTokens: 111 } });

    checkpoints.persist();
    expect(appendSpy).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a failed forced attempt once the fingerprint is already equal", () => {
    const { harness, appendSpy, checkpoints, warn } = ownerHarness({
      branch: [custom(snapshotV2())],
    });
    checkpoints.restoreAndCheckpoint("session-start", harness.context, () => {});
    appendSpy.mockClear();

    harness.setBranch([custom(snapshotV2()), custom({ invalid: true })]);
    appendSpy.mockImplementationOnce(() => {
      throw new Error("append failed");
    });
    checkpoints.restoreAndCheckpoint("branch-navigation", harness.context, () => {});

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);

    checkpoints.persist();
    expect(appendSpy).toHaveBeenCalledTimes(1);
  });

  it("propagates a host-work exception on an equal-fingerprint repair branch without appending", () => {
    const { harness, appendSpy, checkpoints } = ownerHarness({
      branch: [custom(snapshotV2())],
    });
    checkpoints.restoreAndCheckpoint("session-start", harness.context, () => {});
    appendSpy.mockClear();

    harness.setBranch([custom(snapshotV2()), custom({ invalid: true })]);
    const afterRestore = vi.fn(() => {
      throw new Error("host work failed");
    });
    expect(() =>
      checkpoints.restoreAndCheckpoint("branch-navigation", harness.context, afterRestore),
    ).toThrow("host work failed");

    expect(afterRestore).toHaveBeenCalledTimes(1);
    expect(appendSpy).not.toHaveBeenCalled();
    checkpoints.persist();
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("clears fingerprint memory on session start so a thrown checkpoint still retries", () => {
    const { harness, appendSpy, checkpoints } = ownerHarness({
      branch: [custom(snapshotV2())],
    });
    checkpoints.restoreAndCheckpoint("session-start", harness.context, () => {});
    appendSpy.mockClear();

    harness.setBranch([custom(snapshotV2()), custom({ invalid: true })]);
    expect(() =>
      checkpoints.restoreAndCheckpoint("session-start", harness.context, () => {
        throw new Error("host work failed");
      }),
    ).toThrow("host work failed");
    expect(appendSpy).not.toHaveBeenCalled();

    checkpoints.persist();
    expect(appendSpy).toHaveBeenCalledTimes(1);
    checkpoints.persist();
    expect(appendSpy).toHaveBeenCalledTimes(1);
  });

  it("does not append without a session identity", () => {
    const host = { appendEntry: vi.fn() } satisfies DcpCheckpointHost;
    const checkpoints = createDcpCheckpoints(
      host,
      createSessionState(),
      makeDefaultConfig(),
      vi.fn(),
    );

    checkpoints.persist();

    expect(host.appendEntry).not.toHaveBeenCalled();
  });

  it.each(["mutated", "replaced"])(
    "preserves root identity and reads %s config defaults",
    (kind) => {
      const state = createSessionState();
      const config = makeDefaultConfig();
      const { harness, appendSpy, checkpoints } = ownerHarness({ state, config });
      if (kind === "mutated") {
        config.manualMode.default = "active";
        config.compress.permission = "deny";
      } else {
        config.manualMode = { ...config.manualMode, default: "active" };
        config.compress = { ...config.compress, permission: "deny" };
      }
      let observed: SessionState | undefined;

      checkpoints.restoreAndCheckpoint("session-start", harness.context, () => {
        observed = state;
      });

      expect(observed).toBe(state);
      expect(state.manualMode).toBe("active");
      expect(state.compressPermission).toBe("deny");
      expect(appendSpy).toHaveBeenCalledTimes(1);
    },
  );

  it("waits for host work before writing a repair with the final facts", () => {
    const older = snapshotV2({
      stats: { pruneTokenCounter: 0, totalPruneTokens: 7, toolsPruned: 0, messagesCompressed: 0 },
    });
    const { harness, state, appendSpy, checkpoints } = ownerHarness({
      branch: [custom(older), custom({ invalid: true })],
    });
    const afterRestore = vi.fn(() => {
      expect(state.stats.totalPruneTokens).toBe(7);
      expect(appendSpy).not.toHaveBeenCalled();
      state.stats.totalPruneTokens = 700;
    });

    checkpoints.restoreAndCheckpoint("branch-navigation", harness.context, afterRestore);

    expect(afterRestore).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(harness.entries[0]?.data).toMatchObject({ stats: { totalPruneTokens: 700 } });
  });

  it("ignores reference-only and runtime-only changes when deciding to persist", () => {
    const { harness, state, appendSpy, checkpoints } = ownerHarness({
      branch: [custom(snapshotV2())],
    });
    checkpoints.restoreAndCheckpoint("session-start", harness.context, () => {});
    appendSpy.mockClear();

    assignMessageRefs(state, [makeUserMessage("hello", 1)]);
    state.modelId = "changed-model";
    state.modelProvider = "changed-provider";
    state.modelContextWindow = 42;
    state.currentUserTurn = 3;
    state.compressionTiming.startTimes.set("call", 1);
    checkpoints.persist();
    expect(appendSpy).not.toHaveBeenCalled();

    state.stats.totalPruneTokens = 5;
    checkpoints.persist();
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(harness.entries[0]?.data).toMatchObject({
      messageIds: { byRawId: [["user:1:0", "m0001"]], nextRefIndex: 2 },
      stats: { totalPruneTokens: 5 },
    });
  });

  it("reads current nested state at each persistence attempt", () => {
    const { harness, state, checkpoints } = ownerHarness({
      branch: [custom(snapshotV2())],
    });
    checkpoints.restoreAndCheckpoint("session-start", harness.context, () => {});

    state.stats = {
      pruneTokenCounter: 0,
      totalPruneTokens: 77,
      toolsPruned: 0,
      messagesCompressed: 0,
    };
    checkpoints.persist();
    expect(harness.entries[0]?.data).toMatchObject({ stats: { totalPruneTokens: 77 } });

    state.prune.tools = new Map([["tool-1", 5]]);
    checkpoints.persist();
    expect(harness.entries[1]?.data).toMatchObject({ pruneTools: [["tool-1", 5]] });
  });

  it("propagates a restoration warning before host work and checkpointing", () => {
    const snapshot = snapshotV2({
      blocks: [sampleBlock, { ...sampleBlock, blockId: 2, summary: 42 as unknown as string }],
      nextBlockId: 3,
    });
    const warn = vi.fn(() => {
      throw new Error("warn failed");
    });
    const harness = createExtensionHarness({ sessionId: "session", branch: [custom(snapshot)] });
    const appendSpy = vi.spyOn(harness.api, "appendEntry");
    const checkpoints = createDcpCheckpoints(
      harness.api,
      createSessionState(),
      makeDefaultConfig(),
      warn,
    );
    const afterRestore = vi.fn();

    expect(() =>
      checkpoints.restoreAndCheckpoint("session-start", harness.context, afterRestore),
    ).toThrow("warn failed");

    expect(warn).toHaveBeenCalledWith("Discarded invalid DCP snapshot block");
    expect(afterRestore).not.toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("keeps the codec warning and normalization for a same-owner snapshot with a discarded block", () => {
    const snapshot = snapshotV2({
      blocks: [sampleBlock, { ...sampleBlock, blockId: 2, summary: 42 as unknown as string }],
      nextBlockId: 3,
    });
    const { harness, state, appendSpy, checkpoints, warn } = ownerHarness({
      branch: [custom(snapshot)],
    });

    checkpoints.restoreAndCheckpoint("session-start", harness.context, () => {});

    expect(warn).toHaveBeenCalledWith("Discarded invalid DCP snapshot block");
    expect(state.prune.messages.blocksById.has(1)).toBe(true);
    expect(state.prune.messages.blocksById.has(2)).toBe(false);
    expect(state.prune.messages.nextBlockId).toBe(3);
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("propagates an append warning exception and retries changed facts later", () => {
    const { harness, state, appendSpy, checkpoints, warn } = ownerHarness({
      branch: [custom(snapshotV2())],
    });
    checkpoints.restoreAndCheckpoint("session-start", harness.context, () => {});
    appendSpy.mockClear();

    state.stats.totalPruneTokens = 123;
    appendSpy.mockImplementationOnce(() => {
      throw new Error("append failed");
    });
    warn.mockImplementationOnce(() => {
      throw new Error("warn failed");
    });

    expect(() => checkpoints.persist()).toThrow("warn failed");
    checkpoints.persist();
    expect(appendSpy).toHaveBeenCalledTimes(2);
    expect(harness.entries).toHaveLength(1);

    checkpoints.persist();
    expect(appendSpy).toHaveBeenCalledTimes(2);
  });
});
