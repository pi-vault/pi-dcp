import { describe, expect, it } from "vitest";
import { deduplicate, createToolSignature } from "../src/strategies/deduplication.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";

describe("deduplication", () => {
  describe("createToolSignature", () => {
    it("creates deterministic signature", () => {
      const sig1 = createToolSignature("read", { filePath: "/tmp/a.ts" });
      const sig2 = createToolSignature("read", { filePath: "/tmp/a.ts" });
      expect(sig1).toBe(sig2);
    });

    it("normalizes key order", () => {
      const sig1 = createToolSignature("edit", { filePath: "a", content: "b" });
      const sig2 = createToolSignature("edit", { content: "b", filePath: "a" });
      expect(sig1).toBe(sig2);
    });

    it("strips null/undefined values", () => {
      const sig1 = createToolSignature("read", { filePath: "a" });
      const sig2 = createToolSignature("read", { filePath: "a", extra: null });
      expect(sig1).toBe(sig2);
    });
  });

  describe("deduplicate", () => {
    it("marks older duplicate tool calls for pruning", () => {
      const state = createSessionState();
      const config = makeDefaultConfig();

      state.toolParameters.set("call1", {
        tool: "glob",
        parameters: { pattern: "**/*.ts" },
        status: "completed",
        error: undefined,
        turn: 1,
        tokenCount: 100,
      });
      state.toolParameters.set("call2", {
        tool: "glob",
        parameters: { pattern: "**/*.ts" },
        status: "completed",
        error: undefined,
        turn: 2,
        tokenCount: 100,
      });
      state.toolIdList = ["call1", "call2"];

      const result = deduplicate(state, config);
      expect(result.pruned).toBe(1);
      expect(state.prune.tools.has("call1")).toBe(true);
      expect(state.prune.tools.has("call2")).toBe(false);
    });

    it("skips protected tools (BASE_PROTECTED_TOOLS)", () => {
      const state = createSessionState();
      const config = makeDefaultConfig();

      state.toolParameters.set("call1", {
        tool: "bash",
        parameters: { command: "ls" },
        status: "completed",
        error: undefined,
        turn: 1,
        tokenCount: 50,
      });
      state.toolParameters.set("call2", {
        tool: "bash",
        parameters: { command: "ls" },
        status: "completed",
        error: undefined,
        turn: 2,
        tokenCount: 50,
      });
      state.toolIdList = ["call1", "call2"];

      const result = deduplicate(state, config);
      expect(result.pruned).toBe(0);
    });

    it("does nothing when disabled", () => {
      const state = createSessionState();
      const config = makeDefaultConfig();
      config.strategies.deduplication.enabled = false;

      state.toolParameters.set("call1", {
        tool: "glob",
        parameters: { pattern: "**/*.ts" },
        status: "completed",
        error: undefined,
        turn: 1,
        tokenCount: 100,
      });
      state.toolParameters.set("call2", {
        tool: "glob",
        parameters: { pattern: "**/*.ts" },
        status: "completed",
        error: undefined,
        turn: 2,
        tokenCount: 100,
      });
      state.toolIdList = ["call1", "call2"];

      const result = deduplicate(state, config);
      expect(result.pruned).toBe(0);
    });

    it("does not prune already-pruned IDs", () => {
      const state = createSessionState();
      const config = makeDefaultConfig();

      state.prune.tools.set("call1", 100);
      state.toolParameters.set("call1", {
        tool: "glob",
        parameters: { pattern: "**/*.ts" },
        status: "completed",
        error: undefined,
        turn: 1,
        tokenCount: 100,
      });
      state.toolParameters.set("call2", {
        tool: "glob",
        parameters: { pattern: "**/*.ts" },
        status: "completed",
        error: undefined,
        turn: 2,
        tokenCount: 100,
      });
      state.toolIdList = ["call1", "call2"];

      const result = deduplicate(state, config);
      expect(result.pruned).toBe(0);
    });

    it("skips when manual mode active and automaticStrategies disabled", () => {
      const state = createSessionState();
      const config = makeDefaultConfig();
      state.manualMode = "active";
      config.manualMode.automaticStrategies = false;

      state.toolParameters.set("call1", {
        tool: "glob",
        parameters: { pattern: "**/*.ts" },
        status: "completed",
        error: undefined,
        turn: 1,
        tokenCount: 100,
      });
      state.toolParameters.set("call2", {
        tool: "glob",
        parameters: { pattern: "**/*.ts" },
        status: "completed",
        error: undefined,
        turn: 2,
        tokenCount: 100,
      });
      state.toolIdList = ["call1", "call2"];

      const result = deduplicate(state, config);
      expect(result.pruned).toBe(0);
    });

    it("skips tools operating on protected file paths", () => {
      const state = createSessionState();
      const config = makeDefaultConfig();
      config.protectedFilePatterns = ["src/**/*.ts"];

      state.toolParameters.set("call1", {
        tool: "glob",
        parameters: { filePath: "src/index.ts" },
        status: "completed",
        error: undefined,
        turn: 1,
        tokenCount: 100,
      });
      state.toolParameters.set("call2", {
        tool: "glob",
        parameters: { filePath: "src/index.ts" },
        status: "completed",
        error: undefined,
        turn: 2,
        tokenCount: 100,
      });
      state.toolIdList = ["call1", "call2"];

      const result = deduplicate(state, config);
      expect(result.pruned).toBe(0);
    });
  });
});
