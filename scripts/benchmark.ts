import { pathToFileURL } from "node:url";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { runPipeline } from "../src/pipeline.ts";
import { restoreDcpSnapshot } from "../src/state/persistence.ts";
import { createSessionState } from "../src/state/state.ts";
import type { DcpSnapshotV1, SessionState } from "../src/state/types.ts";
import { extractMessageText, countMessageTokens } from "../src/utils/tokens.ts";

export interface BenchmarkWorkloadReport {
  name: string;
  medianMs: number;
  p95Ms: number;
  inputEstimatedTokens: number;
  outputEstimatedTokens: number;
  reductionEstimatedTokens: number;
}

export interface BenchmarkReport {
  nodeVersion: string;
  iterations: number;
  workloads: BenchmarkWorkloadReport[];
}

interface ToolResultProjection {
  name: string;
  isError: boolean;
  text: string;
  ownerPresent: boolean;
}

interface WorkloadRun {
  messages: AgentMessage[];
  state: SessionState;
  inputEstimatedTokens: number;
  outputEstimatedTokens: number;
  toolResults: ToolResultProjection[];
}

interface BenchmarkWorkload {
  name: string;
  run(): WorkloadRun;
}

function messageTokens(messages: AgentMessage[]): number {
  return messages.reduce((total, message) => total + countMessageTokens(message), 0);
}

function assistantToolCall(id: string, name: string, arguments_: Record<string, unknown>, timestamp: number): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name, arguments: arguments_ }],
    stopReason: "toolUse",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
    timestamp,
  } as unknown as AgentMessage;
}

function toolResult(id: string, name: string, text: string, isError: boolean, timestamp: number): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text }],
    isError,
    timestamp,
  } as AgentMessage;
}

function projectToolResults(messages: AgentMessage[]): ToolResultProjection[] {
  const owners = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "toolCall") owners.add(part.id);
    }
  }
  return messages.flatMap((message) => message.role === "toolResult" ? [{
    name: message.toolName,
    isError: message.isError,
    text: extractMessageText(message),
    ownerPresent: owners.has(message.toolCallId),
  }] : []);
}

function runMessages(messages: AgentMessage[], snapshot?: DcpSnapshotV1): WorkloadRun {
  const input = structuredClone(messages);
  const state = createSessionState();
  if (snapshot && !restoreDcpSnapshot(structuredClone(snapshot), state, "benchmark-restored")) {
    throw new Error("benchmark snapshot must restore");
  }
  const result = runPipeline(state, structuredClone(DEFAULT_CONFIG), input, undefined);
  return {
    messages: result.messages,
    state,
    inputEstimatedTokens: messageTokens(input),
    outputEstimatedTokens: messageTokens(result.messages),
    toolResults: projectToolResults(result.messages),
  };
}

export function buildCleanWorkload(): BenchmarkWorkload {
  const fixture: AgentMessage[] = Array.from({ length: 2_000 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: [{ type: "text", text: `clean message ${index}` }],
    ...(index % 2 === 0 ? {} : {
      stopReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
    }),
    timestamp: 1_000 + index,
  } as AgentMessage));
  return { name: "clean-2000-messages", run: () => runMessages(fixture) };
}

export function buildRepeatedToolWorkload(): BenchmarkWorkload {
  const fixture: AgentMessage[] = [];
  for (let index = 0; index < 2_000; index++) {
    const timestamp = 10_000 + index * 3;
    if (index % 20 === 0) {
      fixture.push({
        role: "user",
        content: [{ type: "text", text: `tool group ${index / 20}` }],
        timestamp: timestamp - 1,
      } as AgentMessage);
    }
    const id = `benchmark-tool-${index}`;
    const isWrite = index % 25 === 0;
    const isError = !isWrite && index % 10 === 0;
    const name = isWrite ? "write" : "read";
    const arguments_ = isError
      ? { path: `/stable/${index % 5}.txt`, payload: "error-input ".repeat(160) }
      : isWrite
        ? { path: `/protected/${index}.txt`, content: `protected write ${index}` }
        : { path: `/stable/${index % 5}.txt` };
    fixture.push(assistantToolCall(id, name, arguments_, timestamp));
    fixture.push(toolResult(
      id,
      name,
      isWrite ? `protected write ${index}` : isError ? `stale error ${index}` : "repeated read output ".repeat(100),
      isError,
      timestamp + 1,
    ));
  }
  return { name: "repeated-tool-pairs-2000", run: () => runMessages(fixture) };
}

function restoredFixture(): { messages: AgentMessage[]; snapshot: DcpSnapshotV1 } {
  const messages: AgentMessage[] = [];
  const blocks: DcpSnapshotV1["blocks"] = [];
  const refs: Array<[string, string]> = [];
  let refIndex = 1;
  for (let chain = 0; chain < 10; chain++) {
    const firstTimestamp = 100_000 + chain * 100;
    for (let level = 0; level < 10; level++) {
      const blockId = chain * 10 + level + 1;
      const userTimestamp = firstTimestamp + level * 3;
      const ownerTimestamp = userTimestamp + 1;
      const callId = `benchmark-compress-${blockId}`;
      messages.push({
        role: "user",
        content: [{ type: "text", text: `chain ${chain} level ${level}` }],
        timestamp: userTimestamp,
      } as AgentMessage);
      messages.push(assistantToolCall(callId, "compress", { range: `b${blockId}` }, ownerTimestamp));
      messages.push(toolResult(callId, "compress", `summary ${blockId}`, false, ownerTimestamp + 1));
      refs.push(
        [`user:${userTimestamp}:0`, `m${String(refIndex++).padStart(4, "0")}`],
        [`assistant:${ownerTimestamp}:0`, `m${String(refIndex++).padStart(4, "0")}`],
        [`toolResult:${callId}`, `m${String(refIndex++).padStart(4, "0")}`],
      );
      blocks.push({
        blockId,
        runId: blockId,
        deactivatedByUser: false,
        compressedTokens: 0,
        summaryTokens: 1,
        durationMs: 0,
        mode: "range",
        topic: `chain ${chain}`,
        compressToolCallId: callId,
        startKey: `user:${firstTimestamp}:0`,
        endKey: `user:${userTimestamp}:0`,
        anchorKey: `user:${userTimestamp}:0`,
        consumedBlockIds: level === 0 ? [] : [blockId - 1],
        createdAt: blockId,
        summary: `summary ${blockId}`,
      });
    }
  }
  return {
    messages,
    snapshot: {
      version: 1,
      ownerSessionId: "benchmark-owner",
      manualMode: false,
      compressPermission: "allow",
      stats: { pruneTokenCounter: 0, totalPruneTokens: 0, toolsPruned: 0, messagesCompressed: 0 },
      lastCompaction: 0,
      pruneTools: [],
      blocks,
      nextBlockId: 101,
      nextRunId: 101,
      messageIds: { byRawId: refs, nextRefIndex: refIndex },
      nudges: { contextLimitAnchors: [], turnAnchors: [], iterationAnchors: [] },
    },
  };
}

export function buildRestoredNestedWorkload(): BenchmarkWorkload {
  const fixture = restoredFixture();
  return {
    name: "restored-nested-blocks-100",
    run: () => runMessages(fixture.messages, fixture.snapshot),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

export function runBenchmarkSuite(iterations = 30): BenchmarkReport {
  if (!Number.isInteger(iterations) || iterations < 1) throw new RangeError("iterations must be a positive integer");
  const workloads = [buildCleanWorkload(), buildRepeatedToolWorkload(), buildRestoredNestedWorkload()];
  return {
    nodeVersion: process.version,
    iterations,
    workloads: workloads.map((workload) => {
      workload.run();
      const durations: number[] = [];
      let first: WorkloadRun | undefined;
      for (let index = 0; index < iterations; index++) {
        const start = performance.now();
        const result = workload.run();
        durations.push(performance.now() - start);
        first ??= result;
      }
      if (!first) throw new Error("benchmark must run at least once");
      return {
        name: workload.name,
        medianMs: median(durations),
        p95Ms: p95(durations),
        inputEstimatedTokens: first.inputEstimatedTokens,
        outputEstimatedTokens: first.outputEstimatedTokens,
        reductionEstimatedTokens: first.inputEstimatedTokens - first.outputEstimatedTokens,
      };
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(runBenchmarkSuite())}\n`);
}
