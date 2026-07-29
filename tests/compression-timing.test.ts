import { describe, expect, it } from "vitest";
import { createSessionState } from "../src/state/state.ts";

describe("CompressionTimingState", () => {
  it("initializes with only in-flight start timestamps", () => {
    const state = createSessionState();
    expect(state.compressionTiming).toEqual({ startTimes: new Map() });
  });
});
