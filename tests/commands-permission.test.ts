import { describe, expect, it } from "vitest";
import { permissionCommand } from "../src/commands/permission.ts";
import { createSessionState } from "../src/state/state.ts";

describe("permissionCommand", () => {
  it("cycles allow -> ask", () => {
    const state = createSessionState();
    state.compressPermission = "allow";

    expect(permissionCommand(state)).toBe("Compress permission: ask");
    expect(state.compressPermission).toBe("ask");
  });

  it("cycles ask -> deny", () => {
    const state = createSessionState();
    state.compressPermission = "ask";

    expect(permissionCommand(state)).toBe("Compress permission: deny");
    expect(state.compressPermission).toBe("deny");
  });

  it("cycles deny -> allow", () => {
    const state = createSessionState();
    state.compressPermission = "deny";

    expect(permissionCommand(state)).toBe("Compress permission: allow");
    expect(state.compressPermission).toBe("allow");
  });

  it("treats undefined as the standalone allow default (allow -> ask)", () => {
    const state = createSessionState();

    expect(permissionCommand(state)).toBe("Compress permission: ask");
    expect(state.compressPermission).toBe("ask");
  });

  it("uses a configured ask fallback for an undefined session override (ask -> deny)", () => {
    const state = createSessionState();

    expect(permissionCommand(state, "ask")).toBe("Compress permission: deny");
    expect(state.compressPermission).toBe("deny");
  });

  it("uses a configured deny fallback for an undefined session override (deny -> allow)", () => {
    const state = createSessionState();

    expect(permissionCommand(state, "deny")).toBe("Compress permission: allow");
    expect(state.compressPermission).toBe("allow");
  });

  it("prefers the session override over the configured fallback", () => {
    const state = createSessionState();
    state.compressPermission = "ask";

    expect(permissionCommand(state, "deny")).toBe("Compress permission: deny");
    expect(state.compressPermission).toBe("deny");
  });
});
