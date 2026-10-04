import { describe, expect, expectTypeOf, it } from "vitest";
import { manualCommand } from "../src/commands/manual.ts";
import { createSessionState } from "../src/state/state.ts";
import type { SessionState } from "../src/state/types.ts";

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

  it("reports off when manual mode is disabled and no argument is given", () => {
    const state = createSessionState();
    state.manualMode = false;
    const result = manualCommand(state, "");
    expect(result).toContain("off");
  });

  it("exposes manualMode as exactly false | 'active'", () => {
    expectTypeOf<SessionState["manualMode"]>().toEqualTypeOf<false | "active">();
  });

  it("returns error for invalid argument", () => {
    const state = createSessionState();
    const result = manualCommand(state, "maybe");
    expect(result).toContain("Usage");
  });
});
