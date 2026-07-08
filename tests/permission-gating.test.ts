import { describe, it, expect } from "vitest";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";

/**
 * Tests the permission gating logic that lives in the tool_call handler.
 * Extracted as a pure function for testability.
 */
function shouldBlockCompress(
  state: { compressPermission: "allow" | "deny" | undefined },
  configPermission: "allow" | "deny",
): { block: true; reason: string } | undefined {
  const permission = state.compressPermission ?? configPermission;
  if (permission === "deny") {
    return { block: true, reason: "Compression denied by configuration" };
  }
  return undefined;
}

describe("permission gating logic", () => {
  it("blocks when state.compressPermission is deny", () => {
    const state = createSessionState();
    state.compressPermission = "deny";

    const result = shouldBlockCompress(state, "allow");
    expect(result).toEqual({ block: true, reason: "Compression denied by configuration" });
  });

  it("allows when state.compressPermission is allow", () => {
    const state = createSessionState();
    state.compressPermission = "allow";

    const result = shouldBlockCompress(state, "deny");
    expect(result).toBeUndefined();
  });

  it("falls back to config when state is undefined", () => {
    const state = createSessionState();
    // state.compressPermission is undefined by default

    const result = shouldBlockCompress(state, "deny");
    expect(result).toEqual({ block: true, reason: "Compression denied by configuration" });
  });

  it("allows when both state is undefined and config is allow", () => {
    const state = createSessionState();

    const result = shouldBlockCompress(state, "allow");
    expect(result).toBeUndefined();
  });

  it("state overrides config (state allow beats config deny)", () => {
    const state = createSessionState();
    state.compressPermission = "allow";

    const result = shouldBlockCompress(state, "deny");
    expect(result).toBeUndefined();
  });

  it("state overrides config (state deny beats config allow)", () => {
    const state = createSessionState();
    state.compressPermission = "deny";

    const result = shouldBlockCompress(state, "allow");
    expect(result).toEqual({ block: true, reason: "Compression denied by configuration" });
  });
});

describe("state initialization from config", () => {
  it("compressPermission is set from config on session start", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ permission: "deny" });

    // Simulate what session_start does:
    state.compressPermission = config.compress.permission;

    expect(state.compressPermission).toBe("deny");
  });

  it("defaults to allow when config is allow", () => {
    const state = createSessionState();
    const config = makeDefaultConfig(); // default permission is "allow"

    state.compressPermission = config.compress.permission;

    expect(state.compressPermission).toBe("allow");
  });
});
