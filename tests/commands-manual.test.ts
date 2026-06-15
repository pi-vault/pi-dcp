import { describe, expect, it } from "vitest";
import { manualCommand } from "../src/commands/manual.ts";
import { createSessionState } from "../src/state/state.ts";

describe("manual command", () => {
  it("enables manual mode with 'on'", () => {
    const state = createSessionState();
    const result = manualCommand(state, "on");
    expect(state.manualMode).toBe("active");
    expect(result).toContain("on");
  });

  it("disables manual mode with 'off'", () => {
    const state = createSessionState();
    state.manualMode = "active";
    const result = manualCommand(state, "off");
    expect(state.manualMode).toBe(false);
    expect(result).toContain("off");
  });

  it("reports current state with no argument", () => {
    const state = createSessionState();
    state.manualMode = "active";
    const result = manualCommand(state, "");
    expect(result).toContain("active");
  });

  it("reports compress-pending state", () => {
    const state = createSessionState();
    state.manualMode = "compress-pending";
    const result = manualCommand(state, "");
    expect(result).toContain("compress-pending");
  });

  it("returns error for invalid argument", () => {
    const state = createSessionState();
    const result = manualCommand(state, "maybe");
    expect(result).toContain("Usage");
  });
});
