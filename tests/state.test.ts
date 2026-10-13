import { describe, expect, it } from "vitest";
import { createSessionState, resetSessionState } from "../src/state/state.ts";

describe("state", () => {
  describe("createSessionState", () => {
    it("creates empty state", () => {
      const state = createSessionState();
      expect(state.sessionId).toBeNull();
      expect(state.manualMode).toBe(false);
      expect(state.prune.tools.size).toBe(0);
      expect(state.prune.messages.byMessageIndex.size).toBe(0);
      expect(state.prune.messages.blocksById.size).toBe(0);
      expect(state.prune.messages.activeBlockIds.size).toBe(0);
      expect(state.prune.messages.activeByAnchorIndex.size).toBe(0);
      expect(state.prune.messages.nextBlockId).toBe(1);
      expect(state.prune.messages.nextRunId).toBe(1);
      expect(state.stats.totalPruneTokens).toBe(0);
      expect(state.currentUserTurn).toBe(0);
      expect(state.messageIds.nextRefIndex).toBe(1);
      expect(state.isSubAgent).toBe(false);
      expect(state.subAgentResultCache.size).toBe(0);
    });

    it("creates independent block collections per state", () => {
      const first = createSessionState();
      const second = createSessionState();
      expect(first.prune.messages.byMessageIndex).not.toBe(second.prune.messages.byMessageIndex);
      expect(first.prune.messages.blocksById).not.toBe(second.prune.messages.blocksById);
      expect(first.prune.messages.activeBlockIds).not.toBe(second.prune.messages.activeBlockIds);
      expect(first.prune.messages.activeByAnchorIndex).not.toBe(
        second.prune.messages.activeByAnchorIndex,
      );
      first.prune.messages.blocksById.set(3, {} as never);
      first.prune.messages.activeBlockIds.add(3);
      expect(second.prune.messages.blocksById.size).toBe(0);
      expect(second.prune.messages.activeBlockIds.size).toBe(0);
    });
  });

  describe("resetSessionState", () => {
    it("resets mutable state to initial values", () => {
      const state = createSessionState();
      state.sessionId = "test-session";
      state.currentUserTurn = 5;
      state.prune.tools.set("tool1", 100);
      state.prune.messages.blocksById.set(3, {} as never);
      state.prune.messages.byMessageIndex.set(0, {
        tokenCount: 0,
        blockIds: [3],
        activeBlockIds: [3],
      });
      state.prune.messages.activeBlockIds.add(3);
      state.prune.messages.activeByAnchorIndex.set(0, 3);
      state.prune.messages.nextBlockId = 4;
      state.prune.messages.nextRunId = 3;
      state.stats.totalPruneTokens = 500;
      state.isSubAgent = true;
      state.subAgentResultCache.set("x", "y");

      const blockContainer = state.prune.messages;
      const blockMap = state.prune.messages.blocksById;
      const activeBlockIds = state.prune.messages.activeBlockIds;
      const messageIndex = state.prune.messages.byMessageIndex;
      const anchorIndex = state.prune.messages.activeByAnchorIndex;

      resetSessionState(state);

      expect(state.sessionId).toBeNull();
      expect(state.currentUserTurn).toBe(0);
      expect(state.prune.tools.size).toBe(0);
      expect(state.stats.totalPruneTokens).toBe(0);
      expect(state.isSubAgent).toBe(false);
      expect(state.subAgentResultCache.size).toBe(0);

      expect(state.prune.messages.blocksById.size).toBe(0);
      expect(state.prune.messages.byMessageIndex.size).toBe(0);
      expect(state.prune.messages.activeBlockIds.size).toBe(0);
      expect(state.prune.messages.activeByAnchorIndex.size).toBe(0);
      expect(state.prune.messages.nextBlockId).toBe(1);
      expect(state.prune.messages.nextRunId).toBe(1);

      // Reset clears the existing container and collections in place.
      expect(state.prune.messages).toBe(blockContainer);
      expect(state.prune.messages.blocksById).toBe(blockMap);
      expect(state.prune.messages.activeBlockIds).toBe(activeBlockIds);
      expect(state.prune.messages.byMessageIndex).toBe(messageIndex);
      expect(state.prune.messages.activeByAnchorIndex).toBe(anchorIndex);
    });

    it("preserves object reference", () => {
      const state = createSessionState();
      const ref = state;
      resetSessionState(state);
      expect(state).toBe(ref);
    });
  });
});
