import { describe, expect, it } from "vitest";
import {
  readDcpContextFacts,
  readDcpLifetimeFacts,
  readDcpSessionFacts,
} from "../src/reporting.ts";
import type { LifetimeStats } from "../src/state/persistence.ts";
import { createSessionState } from "../src/state/state.ts";

describe("reporting facts", () => {
  it("reads current context counts without mutation", () => {
    const state = createSessionState();
    state.prune.tools.set("a", 10);
    state.prune.tools.set("b", 20);
    state.prune.messages.activeBlockIds.add(7);
    state.prune.messages.blocksById.set(7, {} as never);
    state.toolParameters.set("t", {} as never);
    state.currentUserTurn = 9;
    state.manualMode = "active";
    const usage = { tokens: 5, contextWindow: 100, percent: 5 };
    const before = structuredClone(state);

    const facts = readDcpContextFacts(state, usage);

    expect(facts.usage).toEqual(usage);
    expect(facts.prunedToolCalls).toBe(2);
    expect(facts.activeBlocks).toBe(1);
    expect(facts.totalBlocks).toBe(1);
    expect(facts.toolCacheEntries).toBe(1);
    expect(facts.currentUserTurn).toBe(9);
    expect(facts.manualMode).toBe("active");
    expect(state).toEqual(before);
  });

  it("copies usage and statistics instead of retaining references", () => {
    const state = createSessionState();
    state.stats.totalPruneTokens = 1000;
    const usage = { tokens: 12345, contextWindow: 200000, percent: 6.1725 };

    const context = readDcpContextFacts(state, usage);
    const session = readDcpSessionFacts(state);
    usage.tokens = 0;
    state.stats.totalPruneTokens = 2500;

    expect(context.usage?.tokens).toBe(12345);
    expect(session.totalPruneTokens).toBe(1000);
    expect(readDcpSessionFacts(state).totalPruneTokens).toBe(2500);
  });

  it("reads replaced nested state on the next call", () => {
    const state = createSessionState();
    state.prune.tools.set("original", 1);
    const first = readDcpContextFacts(state, undefined);

    const fresh = createSessionState();
    fresh.prune.tools.set("x", 1);
    fresh.prune.tools.set("y", 1);
    fresh.prune.messages.activeBlockIds.add(3);
    fresh.prune.messages.blocksById.set(3, {} as never);
    state.prune.tools = fresh.prune.tools;
    state.prune.messages = fresh.prune.messages;
    state.stats = {
      pruneTokenCounter: 10,
      totalPruneTokens: 20,
      toolsPruned: 30,
      messagesCompressed: 40,
    };

    const second = readDcpContextFacts(state, undefined);
    const session = readDcpSessionFacts(state);

    expect(first.prunedToolCalls).toBe(1);
    expect(second.prunedToolCalls).toBe(2);
    expect(second.activeBlocks).toBe(1);
    expect(second.totalBlocks).toBe(1);
    expect(session.messagesCompressed).toBe(40);
  });

  it("copies zero lifetime totals", () => {
    const stats: LifetimeStats = {
      totalTokensSaved: 0,
      totalToolsPruned: 0,
      totalMessagesCompressed: 0,
      sessionCount: 0,
    };

    const facts = readDcpLifetimeFacts(stats);
    stats.totalToolsPruned = 9;

    expect(facts).toEqual({
      totalTokensSaved: 0,
      totalToolsPruned: 0,
      totalMessagesCompressed: 0,
      sessionCount: 0,
    });
    expect(facts).not.toBe(stats);
  });
});
