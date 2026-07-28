import { describe, expect, it } from "vitest";
import { createSessionState, resetSessionState } from "../src/state/state.ts";

describe("state", () => {
  describe("createSessionState", () => {
    it("creates empty state", () => {
      const state = createSessionState();
      expect(state.sessionId).toBeNull();
      expect(state.manualMode).toBe(false);
      expect(state.prune.tools.size).toBe(0);
      expect(state.prune.messages.nextBlockId).toBe(1);
      expect(state.prune.messages.nextRunId).toBe(1);
      expect(state.stats.totalPruneTokens).toBe(0);
      expect(state.currentUserTurn).toBe(0);
      expect(state.messageIds.nextRefIndex).toBe(1);
      expect(state.isSubAgent).toBe(false);
      expect(state.subAgentResultCache.size).toBe(0);
    });
  });

  describe("resetSessionState", () => {
    it("resets mutable state to initial values", () => {
      const state = createSessionState();
      state.sessionId = "test-session";
      state.currentUserTurn = 5;
      state.prune.tools.set("tool1", 100);
      state.stats.totalPruneTokens = 500;
      state.isSubAgent = true;
      state.subAgentResultCache.set("x", "y");

      resetSessionState(state);

      expect(state.sessionId).toBeNull();
      expect(state.currentUserTurn).toBe(0);
      expect(state.prune.tools.size).toBe(0);
      expect(state.stats.totalPruneTokens).toBe(0);
      expect(state.isSubAgent).toBe(false);
      expect(state.subAgentResultCache.size).toBe(0);
    });

    it("preserves object reference", () => {
      const state = createSessionState();
      const ref = state;
      resetSessionState(state);
      expect(state).toBe(ref);
    });
  });
});
