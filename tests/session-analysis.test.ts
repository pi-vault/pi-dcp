import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeSessionFiles } from "../scripts/analyze-sessions.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function state(messageIds: string[][], totalPruneTokens = 0) {
  return {
    version: 1,
    ownerSessionId: "session-1",
    manualMode: false,
    compressPermission: "allow",
    stats: {
      pruneTokenCounter: 0,
      totalPruneTokens,
      toolsPruned: 0,
      messagesCompressed: 0,
    },
    lastCompaction: 0,
    pruneTools: [],
    blocks: [],
    nextBlockId: 1,
    nextRunId: 1,
    messageIds: { byRawId: messageIds, nextRefIndex: messageIds.length + 1 },
    nudges: { contextLimitAnchors: [], turnAnchors: [], iterationAnchors: [] },
  };
}

describe("session analysis", () => {
  it("reports safe transition, tool, error, and duplicate evidence", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-analysis-"));
    tempDirs.push(dir);
    const file = path.join(dir, "session.jsonl");
    const first = state([]);
    const idsOnly = state([["user:1:0", "m0001"]]);
    const semantic = state([["user:1:0", "m0001"]], 5);
    const lines = [
      {
        type: "session",
        version: 3,
        id: "session-1",
        timestamp: "2026-08-22T00:00:00.000Z",
        cwd: "/tmp",
      },
      {
        type: "message",
        id: "a1",
        parentId: null,
        timestamp: "2026-08-22T00:00:00.100Z",
        message: {
          role: "assistant",
          stopReason: "toolUse",
          content: [
            {
              type: "toolCall",
              id: "sk-live-tool-call-secret-1",
              name: "read",
              arguments: {},
            },
            {
              type: "toolCall",
              id: "sk-live-tool-call-secret-open",
              name: "read",
              arguments: {},
            },
          ],
        },
      },
      {
        type: "message",
        id: "r1",
        parentId: "a1",
        timestamp: "2026-08-22T00:00:00.200Z",
        message: {
          role: "toolResult",
          toolCallId: "sk-live-tool-call-secret-1",
          toolName: "read",
          content: [],
          isError: false,
        },
      },
      {
        type: "message",
        id: "r2",
        parentId: "r1",
        timestamp: "2026-08-22T00:00:00.300Z",
        message: {
          role: "toolResult",
          toolCallId: "missing",
          toolName: "read",
          content: [],
          isError: true,
        },
      },
      {
        type: "custom",
        id: "s1",
        parentId: "r2",
        timestamp: "2026-08-22T00:00:01.000Z",
        customType: "pi-dcp-state",
        data: first,
      },
      {
        type: "custom",
        id: "s2",
        parentId: "s1",
        timestamp: "2026-08-22T00:00:02.000Z",
        customType: "pi-dcp-state",
        data: idsOnly,
      },
      {
        type: "custom",
        id: "s3",
        parentId: "s2",
        timestamp: "2026-08-22T00:00:02.003Z",
        customType: "pi-dcp-state",
        data: idsOnly,
      },
      {
        type: "custom",
        id: "s4",
        parentId: "s3",
        timestamp: "2026-08-22T00:00:03.000Z",
        customType: "pi-dcp-state",
        data: semantic,
      },
      {
        type: "message",
        id: "a2",
        parentId: "s4",
        timestamp: "2026-08-22T00:00:04.000Z",
        message: {
          role: "assistant",
          stopReason: "error",
          errorMessage: "redacted by analyzer",
          content: [],
        },
      },
      {
        type: "compaction",
        id: "c1",
        parentId: "a2",
        timestamp: "2026-08-22T00:00:05.000Z",
      },
    ];
    fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\nnot-json\n`);

    const report = await analyzeSessionFiles([file]);

    expect(report.totals).toMatchObject({
      files: 1,
      dcpStates: 4,
      exactDuplicateTransitions: 1,
      messageIdOnlyTransitions: 1,
      semanticCheckpoints: 2,
      compactions: 1,
      malformedLines: 1,
      unmatchedToolCalls: 1,
      unmatchedToolResults: 1,
      assistantErrors: 1,
      stopReasons: { toolUse: 1, error: 1 },
    });
    expect(report.files[0]?.exactDuplicateEvidence).toEqual({
      firstStateOrdinal: 2,
      adjacentTransitions: 1,
      parentLinkedTransitions: 1,
      minDeltaMs: 3,
      maxDeltaMs: 3,
    });
    expect(report.files[0]?.dcpBytes).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain("sk-live-tool-call-secret");
  });

  it("accepts the package script's argument separator", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-analysis-"));
    tempDirs.push(dir);
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      file,
      `${JSON.stringify({
        type: "custom",
        id: "s1",
        timestamp: "2026-08-22T00:00:01.000Z",
        customType: "pi-dcp-state",
        data: state([]),
      })}\n`,
    );

    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/analyze-sessions.ts", "--", file],
      {
        encoding: "utf8",
      },
    );

    expect(output).toContain('"files": 1');
  });

  it("uses non-reversible transition metadata without exposing state content", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-analysis-"));
    tempDirs.push(dir);
    const file = path.join(dir, "session.jsonl");
    const sensitiveState = {
      ...state([]),
      summary: "private summary must not be retained",
      token: "private-token-must-not-be-retained",
    };
    fs.writeFileSync(
      file,
      `${[
        {
          type: "custom",
          id: "s1",
          timestamp: "2026-08-22T00:00:01.000Z",
          customType: "pi-dcp-state",
          data: sensitiveState,
        },
        {
          type: "custom",
          id: "s2",
          parentId: "s1",
          timestamp: "2026-08-22T00:00:01.001Z",
          customType: "pi-dcp-state",
          data: sensitiveState,
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n")}\n`,
    );

    const report = await analyzeSessionFiles([file]);

    expect(report.totals.exactDuplicateTransitions).toBe(1);
    expect(JSON.stringify(report)).not.toContain("private-token-must-not-be-retained");
  });

  it("counts non-entry JSONL values as malformed while continuing to stream", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-analysis-"));
    tempDirs.push(dir);
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      file,
      `${[null, [], 42, "scalar", {}, { type: "message" }]
        .map((line) => JSON.stringify(line))
        .concat(
          JSON.stringify({
            type: "compaction",
            id: "c1",
            timestamp: "2026-08-22T00:00:01.000Z",
          }),
        )
        .join("\n")}\n`,
    );

    const report = await analyzeSessionFiles([file]);

    expect(report.totals).toMatchObject({ malformedLines: 6, compactions: 1 });
  });

  it("skips deeply nested DCP data while continuing to stream", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-analysis-"));
    tempDirs.push(dir);
    const file = path.join(dir, "session.jsonl");
    const deepData = `${'{"nested":'.repeat(10_000)}null${"}".repeat(10_000)}`;
    const validEntry = {
      type: "custom",
      id: "s2",
      timestamp: "2026-08-22T00:00:02.000Z",
      customType: "pi-dcp-state",
      data: state([]),
    };
    const deepLine = `{"type":"custom","id":"s1","timestamp":"2026-08-22T00:00:01.000Z","customType":"pi-dcp-state","data":${deepData}}`;
    const validLine = JSON.stringify(validEntry);
    fs.writeFileSync(file, `${deepLine}\n${validLine}\n`);

    const report = await analyzeSessionFiles([file]);

    expect(report.totals).toMatchObject({ malformedLines: 1, dcpStates: 1 });
    expect(report.totals.dcpBytes).toBe(
      Buffer.byteLength(deepLine) + 1 + Buffer.byteLength(validLine) + 1,
    );
  });

  it("counts non-object DCP data as malformed", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-analysis-"));
    tempDirs.push(dir);
    const file = path.join(dir, "session.jsonl");
    const entries = [null, [], "private-state", 42].map((data, index) => ({
      type: "custom",
      id: `s${index}`,
      timestamp: `2026-08-22T00:00:0${index}.000Z`,
      customType: "pi-dcp-state",
      data,
    }));
    fs.writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);

    const report = await analyzeSessionFiles([file]);

    expect(report.totals).toMatchObject({ malformedLines: 4, dcpStates: 0 });
    expect(report.totals.dcpBytes).toBe(fs.statSync(file).size);
  });

  it("normalizes unknown assistant stop reasons without exposing them", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-analysis-"));
    tempDirs.push(dir);
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      file,
      `${["toolUse", "stop", "aborted", "error", "length", "private-stop-reason"]
        .map((stopReason, index) =>
          JSON.stringify({
            type: "message",
            id: `a${index}`,
            timestamp: "2026-08-22T00:00:01.000Z",
            message: { role: "assistant", stopReason, content: [] },
          }),
        )
        .join("\n")}\n`,
    );

    const report = await analyzeSessionFiles([file]);

    expect(report.totals.stopReasons).toEqual({
      toolUse: 1,
      stop: 1,
      aborted: 1,
      error: 1,
      length: 1,
      other: 1,
    });
    expect(JSON.stringify(report)).not.toContain("private-stop-reason");
  });
});

// ---------------------------------------------------------------------------
// Cache and latency evidence
// ---------------------------------------------------------------------------

/** Build a Pi `Usage` object; `"__INF__"` expands to a literal 1e400 (JSON-infinite). */
function usageJson(fields: Record<string, unknown>): string {
  return JSON.stringify({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...fields,
  }).replaceAll('"__INF__"', "1e400");
}

function usage(fields: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(usageJson(fields)) as Record<string, unknown>;
}

function entry(fields: Record<string, unknown>): string {
  return JSON.stringify({
    type: "message",
    id: "e",
    parentId: null,
    timestamp: "2026-08-22T00:00:00.000Z",
    ...fields,
  });
}

const zeroUsage = usage({});

describe("session usage and latency evidence", () => {
  it("aggregates every Pi usage carrier and reports one-based file ordinals", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-usage-"));
    tempDirs.push(dir);

    const firstFile = path.join(dir, "session.jsonl");
    const firstLines = [
      entry({ type: "session", id: "session-1", cwd: "/tmp" }),
      entry({
        id: "u1",
        message: { role: "user", content: "go" },
        timestamp: "2026-08-22T00:00:00.000Z",
      }),
      // assistant after a user message -> latency candidate (1200ms)
      entry({
        id: "a1",
        timestamp: "2026-08-22T00:00:01.200Z",
        message: {
          role: "assistant",
          stopReason: "toolUse",
          content: [],
          usage: usage({
            input: 1000,
            output: 200,
            cacheRead: 300,
            cacheWrite: 400,
            totalTokens: 1500,
            cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
          }),
        },
      }),
      // tool result with no usage -> optional absence, ignored
      entry({
        id: "r1",
        timestamp: "2026-08-22T00:00:01.300Z",
        message: { role: "toolResult", toolCallId: "c1", content: [], isError: false },
      }),
      // assistant after a tool result -> latency candidate (1600ms)
      entry({
        id: "a2",
        timestamp: "2026-08-22T00:00:02.900Z",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [],
          usage: usage({
            input: 10,
            output: 20,
            cacheRead: 30,
            cacheWrite: 40,
            cacheWrite1h: 5,
            totalTokens: 60,
            cost: { input: 11, output: 12, cacheRead: 13, cacheWrite: 14, total: 15 },
          }),
        },
      }),
      // tool result carrying usage
      entry({
        id: "r2",
        timestamp: "2026-08-22T00:00:03.000Z",
        message: {
          role: "toolResult",
          toolCallId: "c2",
          content: [],
          isError: false,
          usage: usage({
            input: 1,
            output: 2,
            cacheRead: 3,
            cacheWrite: 4,
            totalTokens: 5,
            cost: { input: 21, output: 22, cacheRead: 23, cacheWrite: 24, total: 25 },
          }),
        },
      }),
      // standalone usage entry carrying usage
      entry({
        type: "usage",
        id: "s1",
        timestamp: "2026-08-22T00:00:03.100Z",
        kind: "cache_warm",
        usage: usage({
          input: 7,
          output: 8,
          cacheRead: 9,
          cacheWrite: 10,
          reasoning: 6,
          totalTokens: 11,
          cost: { input: 31, output: 32, cacheRead: 33, cacheWrite: 34, total: 35 },
        }),
      }),
      // compaction with no usage -> optional absence, ignored
      entry({ type: "compaction", id: "c1", timestamp: "2026-08-22T00:00:03.200Z" }),
      // branch summary carrying an all-zero usage object
      entry({
        type: "branch_summary",
        id: "b1",
        timestamp: "2026-08-22T00:00:03.300Z",
        usage: zeroUsage,
      }),
      // branch summary with no usage -> optional absence, ignored
      entry({ type: "branch_summary", id: "b2", timestamp: "2026-08-22T00:00:03.400Z" }),
    ];
    fs.writeFileSync(firstFile, `${firstLines.join("\n")}\n`);

    const secondFile = path.join(dir, "other.jsonl");
    const secondLines = [
      entry({ type: "session", id: "session-2", cwd: "/tmp" }),
      // a session header is not a latency candidate
      entry({
        id: "a1",
        timestamp: "2026-08-22T00:00:00.500Z",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [],
          usage: usage({
            input: 2,
            output: 3,
            cacheRead: 4,
            cacheWrite: 5,
            totalTokens: 6,
            cost: { input: 6, output: 7, cacheRead: 8, cacheWrite: 9, total: 10 },
          }),
        },
      }),
    ];
    fs.writeFileSync(secondFile, `${secondLines.join("\n")}\n`);

    const report = await analyzeSessionFiles([firstFile, secondFile]);

    expect(report.files.map((f) => f.fileIndex)).toEqual([1, 2]);
    for (const file of report.files) {
      expect(file).not.toHaveProperty("file");
      expect(Object.keys(file)).not.toContain("file");
    }

    expect(report.files[0]?.usage).toEqual({
      input: 1018,
      output: 230,
      cacheRead: 342,
      cacheWrite: 454,
      cacheWrite1h: 5,
      reasoning: 6,
      totalTokens: 1576,
      cost: { input: 64, output: 68, cacheRead: 72, cacheWrite: 76, total: 85 },
    });
    expect(report.files[0]?.responseLatency).toEqual({
      count: 2,
      totalMs: 2800,
      minMs: 1200,
      maxMs: 1600,
    });
    expect(report.files[0]?.malformedUsage).toBe(0);
    expect(report.files[0]?.malformedLatency).toBe(0);

    // File 2 reports no cacheWrite1h/reasoning because no valid call reported them.
    expect(report.files[1]?.usage).toEqual({
      input: 2,
      output: 3,
      cacheRead: 4,
      cacheWrite: 5,
      totalTokens: 6,
      cost: { input: 6, output: 7, cacheRead: 8, cacheWrite: 9, total: 10 },
    });
    expect(report.files[1]?.usage).not.toHaveProperty("cacheWrite1h");
    expect(report.files[1]?.usage).not.toHaveProperty("reasoning");
    expect(report.files[1]?.responseLatency).toEqual({
      count: 0,
      totalMs: 0,
      minMs: null,
      maxMs: null,
    });

    expect(report.totals.usage).toEqual({
      input: 1020,
      output: 233,
      cacheRead: 346,
      cacheWrite: 459,
      cacheWrite1h: 5,
      reasoning: 6,
      totalTokens: 1582,
      cost: { input: 70, output: 75, cacheRead: 80, cacheWrite: 85, total: 95 },
    });
    expect(report.totals.responseLatency).toEqual({
      count: 2,
      totalMs: 2800,
      minMs: 1200,
      maxMs: 1600,
    });
    expect(report.totals.malformedUsage).toBe(0);
    expect(report.totals.malformedLatency).toBe(0);
  });

  it("counts required usage once per invalid object without corrupting later totals", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-malformed-usage-"));
    tempDirs.push(dir);
    const file = path.join(dir, "session.jsonl");

    const invalid = [
      // assistant with no usage at all
      entry({
        id: "a1",
        timestamp: "2026-08-22T00:00:00.100Z",
        message: { role: "assistant", stopReason: "stop", content: [] },
      }),
      // standalone usage entry with a negative required value
      entry({
        type: "usage",
        id: "s1",
        timestamp: "2026-08-22T00:00:00.200Z",
        kind: "cache_warm",
        usage: usage({ input: -5 }),
      }),
      // assistant with a nonnumeric required value
      entry({
        id: "a2",
        timestamp: "2026-08-22T00:00:00.300Z",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [],
          usage: usage({ input: "many" }),
        },
      }),
      // assistant with an infinite required value
      entry({
        id: "a3",
        timestamp: "2026-08-22T00:00:00.400Z",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [],
          usage: usage({ output: "__INF__" }),
        },
      }),
      // assistant missing a required cost component
      entry({
        id: "a4",
        timestamp: "2026-08-22T00:00:00.500Z",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [],
          usage: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, totalTokens: 4, cost: {} },
        },
      }),
      // a later valid entry still aggregates
      entry({
        id: "a5",
        timestamp: "2026-08-22T00:00:00.600Z",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [],
          usage: usage({
            input: 9,
            output: 8,
            cacheRead: 7,
            cacheWrite: 6,
            totalTokens: 30,
            cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, total: 4 },
          }),
        },
      }),
    ];
    fs.writeFileSync(file, `${invalid.join("\n")}\n`);

    const report = await analyzeSessionFiles([file]);

    expect(report.totals.malformedUsage).toBe(5);
    // No partial values from invalid usage entered the totals.
    expect(report.totals.usage).toEqual({
      input: 9,
      output: 8,
      cacheRead: 7,
      cacheWrite: 6,
      totalTokens: 30,
      cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, total: 4 },
    });
  });

  it("keeps absent optional totals absent and creates them on a reported zero", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-optional-usage-"));
    tempDirs.push(dir);

    const absentFile = path.join(dir, "absent.jsonl");
    fs.writeFileSync(
      absentFile,
      `${entry({
        id: "a1",
        message: { role: "assistant", stopReason: "stop", content: [], usage: zeroUsage },
      })}\n`,
    );
    const absentReport = await analyzeSessionFiles([absentFile]);
    expect(absentReport.totals.usage).not.toHaveProperty("cacheWrite1h");
    expect(absentReport.totals.usage).not.toHaveProperty("reasoning");

    const zeroFile = path.join(dir, "zero.jsonl");
    fs.writeFileSync(
      zeroFile,
      `${entry({
        id: "a1",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [],
          usage: usage({ cacheWrite1h: 0, reasoning: 0 }),
        },
      })}\n`,
    );
    const zeroReport = await analyzeSessionFiles([zeroFile]);
    expect(zeroReport.totals.usage).toHaveProperty("cacheWrite1h", 0);
    expect(zeroReport.totals.usage).toHaveProperty("reasoning", 0);
  });

  it("aggregates latency only for user/tool-result to assistant pairs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-latency-"));
    tempDirs.push(dir);
    const file = path.join(dir, "session.jsonl");
    const assistant = (id: string, at: string) =>
      entry({
        id,
        timestamp: at,
        message: { role: "assistant", stopReason: "stop", content: [], usage: zeroUsage },
      });

    fs.writeFileSync(
      file,
      `${[
        entry({
          id: "u1",
          timestamp: "2026-08-22T00:00:01.000Z",
          message: { role: "user", content: "go" },
        }),
        assistant("a1", "2026-08-22T00:00:03.000Z"), // candidate: 2000ms
        // assistant after an assistant -> not a candidate
        assistant("a2", "2026-08-22T00:00:09.000Z"),
        entry({
          id: "r1",
          timestamp: "2026-08-22T00:00:10.000Z",
          message: { role: "toolResult", toolCallId: "c1", content: [], isError: false },
        }),
        assistant("a3", "2026-08-22T00:00:10.500Z"), // candidate: 500ms
      ].join("\n")}\n`,
    );

    const report = await analyzeSessionFiles([file]);

    expect(report.totals.responseLatency).toEqual({
      count: 2,
      totalMs: 2500,
      minMs: 500,
      maxMs: 2000,
    });
    expect(report.totals.malformedLatency).toBe(0);
    expect(report.totals.malformedUsage).toBe(0);
  });

  it("counts invalid and out-of-order latency candidates as malformedLatency", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-bad-latency-"));
    tempDirs.push(dir);
    const file = path.join(dir, "session.jsonl");
    const assistant = (id: string, at: string) =>
      entry({
        id,
        timestamp: at,
        message: { role: "assistant", stopReason: "stop", content: [], usage: zeroUsage },
      });

    fs.writeFileSync(
      file,
      `${[
        // unparseable user timestamp -> eligible pair with an invalid timestamp
        entry({ id: "u1", timestamp: "not-a-date", message: { role: "user", content: "go" } }),
        assistant("a1", "2026-08-22T00:00:03.000Z"),
        // out-of-order pair -> negative delta
        entry({
          id: "u2",
          timestamp: "2026-08-22T00:00:09.000Z",
          message: { role: "user", content: "go" },
        }),
        assistant("a2", "2026-08-22T00:00:04.000Z"),
        // a valid pair still records normally
        entry({
          id: "u3",
          timestamp: "2026-08-22T00:00:10.000Z",
          message: { role: "user", content: "go" },
        }),
        assistant("a3", "2026-08-22T00:00:12.000Z"),
      ].join("\n")}\n`,
    );

    const report = await analyzeSessionFiles([file]);

    expect(report.totals.malformedLatency).toBe(2);
    expect(report.totals.responseLatency).toEqual({
      count: 1,
      totalMs: 2000,
      minMs: 2000,
      maxMs: 2000,
    });
    expect(report.totals.malformedUsage).toBe(0);
  });

  it("emits no identifiers, paths, or content for a privacy-sensitive corpus", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-privacy-secret-"));
    tempDirs.push(dir);
    const secretName = "sk-live-dir-secret-name";
    const secretFile = "sk-live-file-secret-name.jsonl";
    const file = path.join(dir, secretFile);

    const sensitive = {
      ...state([]),
      summary: "dcp-secret-summary",
      token: "dcp-secret-state-token",
    };
    fs.writeFileSync(
      file,
      `${[
        entry({ type: "session", id: "dcp-secret-session-id", cwd: "/tmp/dcp-secret-cwd" }),
        entry({
          id: "dcp-secret-entry-id",
          timestamp: "2026-08-22T00:00:01.000Z",
          message: {
            role: "user",
            content: "dcp-secret-message-text",
          },
        }),
        entry({
          id: "a1",
          timestamp: "2026-08-22T00:00:02.000Z",
          message: {
            role: "assistant",
            stopReason: "stop",
            provider: "dcp-secret-provider",
            model: "dcp-secret-model",
            errorMessage: "dcp-secret-model-error",
            content: [
              {
                type: "toolCall",
                id: "dcp-secret-tool-call",
                name: "read",
                arguments: { filePath: "/tmp/dcp-secret-argument" },
              },
            ],
            usage: usage({ input: 1, output: 1, cacheRead: 1, cacheWrite: 1, totalTokens: 4 }),
          },
        }),
        entry({
          type: "usage",
          id: "u1",
          timestamp: "2026-08-22T00:00:03.000Z",
          kind: "dcp-secret-usage-kind",
          note: "dcp-secret-usage-note",
          provider: "dcp-secret-provider",
          model: "dcp-secret-model",
          usage: usage({ input: 2, output: 2, cacheRead: 2, cacheWrite: 2, totalTokens: 8 }),
        }),
        entry({
          type: "compaction",
          id: "c1",
          timestamp: "2026-08-22T00:00:04.000Z",
          summary: "dcp-secret-compaction-summary",
        }),
        entry({
          type: "branch_summary",
          id: "b1",
          timestamp: "2026-08-22T00:00:05.000Z",
          summary: "dcp-secret-branch-summary",
        }),
        entry({
          type: "custom",
          id: "s1",
          timestamp: "2026-08-22T00:00:06.000Z",
          customType: "pi-dcp-state",
          data: sensitive,
        }),
      ]
        .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
        .join("\n")}\n`,
    );

    const report = await analyzeSessionFiles([file]);
    const serialized = JSON.stringify(report);

    for (const secret of [
      secretName,
      secretFile,
      "dcp-secret-dir",
      "dcp-secret-cwd",
      "dcp-secret-session-id",
      "dcp-secret-entry-id",
      "dcp-secret-message-text",
      "dcp-secret-tool-call",
      "dcp-secret-argument",
      "dcp-secret-provider",
      "dcp-secret-model",
      "dcp-secret-model-error",
      "dcp-secret-usage-kind",
      "dcp-secret-usage-note",
      "dcp-secret-compaction-summary",
      "dcp-secret-branch-summary",
      "dcp-secret-summary",
      "dcp-secret-state-token",
    ]) {
      expect(serialized).not.toContain(secret);
    }

    // Only a one-based ordinal identifies the file.
    expect(report.files[0]?.fileIndex).toBe(1);
    expect(report.totals.files).toBe(1);
    expect(report.totals.usage.input).toBe(3);
    expect(report.totals.responseLatency.count).toBe(1);
  });
});
