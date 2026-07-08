import { describe, it, expect } from "vitest";
import { permissionCommand } from "../src/commands/permission.ts";
import { createSessionState } from "../src/state/state.ts";

describe("permissionCommand", () => {
  it("toggles from allow to deny", () => {
    const state = createSessionState();
    state.compressPermission = "allow";

    const result = permissionCommand(state);
    expect(state.compressPermission).toBe("deny");
    expect(result).toContain("deny");
  });

  it("toggles from deny to allow", () => {
    const state = createSessionState();
    state.compressPermission = "deny";

    const result = permissionCommand(state);
    expect(state.compressPermission).toBe("allow");
    expect(result).toContain("allow");
  });

  it("treats undefined as allow (toggles to deny)", () => {
    const state = createSessionState();
    // compressPermission starts undefined from createSessionState()

    const result = permissionCommand(state);
    expect(state.compressPermission).toBe("deny");
    expect(result).toContain("deny");
  });

  it("returns human-readable status string", () => {
    const state = createSessionState();
    state.compressPermission = "allow";

    const result = permissionCommand(state);
    expect(result).toBe("Compress permission: deny");
  });
});
