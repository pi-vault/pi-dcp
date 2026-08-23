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
