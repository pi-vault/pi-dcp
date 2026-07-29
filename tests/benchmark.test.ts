import { describe, expect, it } from "vitest";
import {
  buildCleanWorkload,
  buildRepeatedToolWorkload,
  buildRestoredNestedWorkload,
  runBenchmarkSuite,
  type BenchmarkReport,
} from "../scripts/benchmark.ts";

describe("benchmark workloads", () => {
  it("builds 2,000 clean user and assistant messages", () => {
    const result = buildCleanWorkload().run();

    expect(result.messages).toHaveLength(2_000);
    expect(result.messages.every((message) => message.role === "user" || message.role === "assistant")).toBe(true);
  });

  it("prunes repeated tools without orphaning results or changing protected writes and errors", () => {
    const result = buildRepeatedToolWorkload().run();

    expect(result.outputEstimatedTokens).toBeLessThan(result.inputEstimatedTokens);
    expect(
      result.toolResults.some(
        (tool) => tool.name === "write" && tool.text.includes("protected write 0"),
      ),
    ).toBe(true);
    expect(result.toolResults.some((tool) => tool.isError && tool.text.includes("stale error"))).toBe(true);
    expect(result.toolResults.every((tool) => tool.ownerPresent)).toBe(true);
  });

  it("restores nested blocks and rebuilds their relationships", () => {
    const result = buildRestoredNestedWorkload().run();

    expect(result.state.prune.messages.blocksById).toHaveLength(100);
    expect([...result.state.prune.messages.activeBlockIds].sort((a, b) => a - b)).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
    ]);
    for (const block of result.state.prune.messages.blocksById.values()) {
      for (const childId of block.consumedBlockIds) {
        expect(result.state.prune.messages.blocksById.get(childId)?.parentBlockIds).toContain(block.blockId);
      }
    }
  });

  it("reports all workloads with internally consistent measurements", () => {
    const report: BenchmarkReport = runBenchmarkSuite(1);

    expect(report.workloads.map((workload) => workload.name)).toEqual([
      "clean-2000-messages",
      "repeated-tool-pairs-2000",
      "restored-nested-blocks-100",
    ]);
    for (const workload of report.workloads) {
      expect(workload.medianMs).toBeGreaterThanOrEqual(0);
      expect(workload.p95Ms).toBeGreaterThanOrEqual(workload.medianMs);
      expect(workload.inputEstimatedTokens).toBeGreaterThanOrEqual(0);
      expect(workload.outputEstimatedTokens).toBeGreaterThanOrEqual(0);
      expect(workload.reductionEstimatedTokens).toBe(
        workload.inputEstimatedTokens - workload.outputEstimatedTokens,
      );
    }
  });
});
