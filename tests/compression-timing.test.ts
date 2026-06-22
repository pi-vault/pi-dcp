import { describe, it, expect } from "vitest";
import { createSessionState } from "../src/state/state.ts";

describe("CompressionTimingState", () => {
  it("initializes with empty maps", () => {
    const state = createSessionState();
    expect(state.compressionTiming).toBeDefined();
    expect(state.compressionTiming.startTimes.size).toBe(0);
    expect(state.compressionTiming.callIdToBlockId.size).toBe(0);
    expect(state.compressionTiming.pendingDurations.size).toBe(0);
  });
});
