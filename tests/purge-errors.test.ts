import { describe, expect, it } from "vitest";
import { isStaleError } from "../src/strategies/purge-errors.ts";

describe("isStaleError", () => {
  it("returns true for old errors past threshold", () => {
    const entry = { status: "error" as const, userTurn: 3 };
    expect(isStaleError(entry, 10, 4)).toBe(true);
  });

  it("returns false for recent errors within threshold", () => {
    const entry = { status: "error" as const, userTurn: 3 };
    expect(isStaleError(entry, 5, 4)).toBe(false);
  });

  it("returns true for errors exactly at threshold boundary", () => {
    const entry = { status: "error" as const, userTurn: 6 };
    // currentUserTurn=10, threshold=4, age=4: 4 >= 4 is true
    expect(isStaleError(entry, 10, 4)).toBe(true);
  });

  it("returns false for non-error entries", () => {
    const completed = { status: "completed" as const, userTurn: 1 };
    expect(isStaleError(completed, 10, 4)).toBe(false);

    const pending = { status: "pending" as const, userTurn: 1 };
    expect(isStaleError(pending, 10, 4)).toBe(false);
  });

  it("returns false for undefined status", () => {
    const entry = { status: undefined, userTurn: 1 };
    expect(isStaleError(entry, 10, 4)).toBe(false);
  });
});
