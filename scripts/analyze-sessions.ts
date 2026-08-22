import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as readline from "node:readline";
import { pathToFileURL } from "node:url";

export interface ExactDuplicateEvidence {
  firstStateOrdinal: number;
  adjacentTransitions: number;
  parentLinkedTransitions: number;
  minDeltaMs: number | null;
  maxDeltaMs: number | null;
}

export interface SessionCounts {
  fileBytes: number;
  dcpBytes: number;
  dcpStates: number;
  exactDuplicateTransitions: number;
  messageIdOnlyTransitions: number;
  semanticCheckpoints: number;
  compactions: number;
  malformedLines: number;
  unmatchedToolCalls: number;
  unmatchedToolResults: number;
  assistantErrors: number;
  stopReasons: Record<string, number>;
}

export interface SessionFileReport extends SessionCounts {
  file: string;
  exactDuplicateEvidence?: ExactDuplicateEvidence;
}

export interface SessionCorpusReport {
  files: SessionFileReport[];
  totals: SessionCounts & { files: number };
}

function semanticState(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { messageIds: _messageIds, ...semantic } = value as Record<
    string,
    unknown
  >;
  return semantic;
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value) ?? "undefined")
    .digest("hex");
}

const piStopReasons = new Set(["toolUse", "stop", "aborted", "error", "length"]);

function counts(fileBytes = 0): SessionCounts {
  return {
    fileBytes,
    dcpBytes: 0,
    dcpStates: 0,
    exactDuplicateTransitions: 0,
    messageIdOnlyTransitions: 0,
    semanticCheckpoints: 0,
    compactions: 0,
    malformedLines: 0,
    unmatchedToolCalls: 0,
    unmatchedToolResults: 0,
    assistantErrors: 0,
    stopReasons: {},
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

async function analyzeFile(file: string): Promise<SessionFileReport> {
  const report: SessionFileReport = { file, ...counts(fs.statSync(file).size) };
  const openToolCalls = new Map<string, number>();
  let lineNumber = 0;
  let previousStateFingerprint: string | undefined;
  let previousSemanticFingerprint: string | undefined;
  let previousStateLine: number | undefined;
  let previousEntryIdFingerprint: string | undefined;
  let previousTimestamp: number | undefined;

  const lines = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    lineNumber++;
    let entry: Record<string, unknown> | undefined;
    try {
      entry = record(JSON.parse(line));
    } catch {
      report.malformedLines++;
      continue;
    }
    if (
      !entry ||
      typeof entry.type !== "string" ||
      typeof entry.id !== "string" ||
      typeof entry.timestamp !== "string"
    ) {
      report.malformedLines++;
      continue;
    }

    if (entry.type === "compaction") report.compactions++;

    const message = record(entry.message);
    if (entry.type === "message" && message?.role === "assistant") {
      const stopReason = message.stopReason;
      if (typeof stopReason === "string") {
        const reason = piStopReasons.has(stopReason) ? stopReason : "other";
        report.stopReasons[reason] = (report.stopReasons[reason] ?? 0) + 1;
      }
      if (
        stopReason === "error" ||
        (typeof message.errorMessage === "string" && message.errorMessage.length > 0)
      )
        report.assistantErrors++;

      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          const toolCall = record(part);
          if (toolCall?.type !== "toolCall" || typeof toolCall.id !== "string")
            continue;
          const toolCallIdFingerprint = fingerprint(toolCall.id);
          openToolCalls.set(
            toolCallIdFingerprint,
            (openToolCalls.get(toolCallIdFingerprint) ?? 0) + 1,
          );
        }
      }
    } else if (entry.type === "message" && message?.role === "toolResult") {
      const toolCallId = message.toolCallId;
      if (typeof toolCallId !== "string") {
        report.unmatchedToolResults++;
      } else {
        const toolCallIdFingerprint = fingerprint(toolCallId);
        const open = openToolCalls.get(toolCallIdFingerprint) ?? 0;
        if (open === 0) report.unmatchedToolResults++;
        else if (open === 1) openToolCalls.delete(toolCallIdFingerprint);
        else openToolCalls.set(toolCallIdFingerprint, open - 1);
      }
    }

    if (entry.type !== "custom" || entry.customType !== "pi-dcp-state")
      continue;

    let stateFingerprint: string;
    let semanticFingerprint: string;
    try {
      stateFingerprint = fingerprint(entry.data);
      semanticFingerprint = fingerprint(semanticState(entry.data));
    } catch {
      report.malformedLines++;
      continue;
    }
    report.dcpBytes += Buffer.byteLength(line) + 1;
    const stateOrdinal = report.dcpStates + 1;

    if (previousStateFingerprint === undefined) {
      report.semanticCheckpoints++;
    } else if (stateFingerprint === previousStateFingerprint) {
      report.exactDuplicateTransitions++;
      if (!report.exactDuplicateEvidence) {
        report.exactDuplicateEvidence = {
          firstStateOrdinal: stateOrdinal - 1,
          adjacentTransitions: 0,
          parentLinkedTransitions: 0,
          minDeltaMs: null,
          maxDeltaMs: null,
        };
      }
      const evidence = report.exactDuplicateEvidence;
      if (previousStateLine === lineNumber - 1) evidence.adjacentTransitions++;
      if (
        typeof entry.parentId === "string" &&
        previousEntryIdFingerprint !== undefined &&
        fingerprint(entry.parentId) === previousEntryIdFingerprint
      )
        evidence.parentLinkedTransitions++;
      const currentTimestamp = timestamp(entry.timestamp);
      if (currentTimestamp !== undefined && previousTimestamp !== undefined) {
        const delta = currentTimestamp - previousTimestamp;
        if (delta >= 0) {
          evidence.minDeltaMs = Math.min(evidence.minDeltaMs ?? delta, delta);
          evidence.maxDeltaMs = Math.max(evidence.maxDeltaMs ?? delta, delta);
        }
      }
    } else if (semanticFingerprint === previousSemanticFingerprint) {
      report.messageIdOnlyTransitions++;
    } else {
      report.semanticCheckpoints++;
    }

    report.dcpStates = stateOrdinal;
    previousStateFingerprint = stateFingerprint;
    previousSemanticFingerprint = semanticFingerprint;
    previousStateLine = lineNumber;
    previousEntryIdFingerprint = fingerprint(entry.id);
    previousTimestamp = timestamp(entry.timestamp);
  }

  for (const open of openToolCalls.values()) report.unmatchedToolCalls += open;
  return report;
}

export async function analyzeSessionFiles(
  files: string[],
): Promise<SessionCorpusReport> {
  const reports = await Promise.all(files.map(analyzeFile));
  const totals = { files: reports.length, ...counts() };

  for (const report of reports) {
    totals.fileBytes += report.fileBytes;
    totals.dcpBytes += report.dcpBytes;
    totals.dcpStates += report.dcpStates;
    totals.exactDuplicateTransitions += report.exactDuplicateTransitions;
    totals.messageIdOnlyTransitions += report.messageIdOnlyTransitions;
    totals.semanticCheckpoints += report.semanticCheckpoints;
    totals.compactions += report.compactions;
    totals.malformedLines += report.malformedLines;
    totals.unmatchedToolCalls += report.unmatchedToolCalls;
    totals.unmatchedToolResults += report.unmatchedToolResults;
    totals.assistantErrors += report.assistantErrors;
    for (const [reason, count] of Object.entries(report.stopReasons))
      totals.stopReasons[reason] = (totals.stopReasons[reason] ?? 0) + count;
  }

  return { files: reports, totals };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const files = process.argv.slice(2);
  if (files[0] === "--") files.shift();
  if (files.length === 0) {
    process.stderr.write(
      "Usage: tsx scripts/analyze-sessions.ts <session.jsonl>...\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `${JSON.stringify(await analyzeSessionFiles(files), null, 2)}\n`,
    );
  }
}
