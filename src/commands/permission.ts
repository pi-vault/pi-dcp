import type { SessionState } from "../state/types.ts";

export function permissionCommand(state: SessionState): string {
  const current = state.compressPermission ?? "allow";
  state.compressPermission = current === "allow" ? "deny" : "allow";
  return `Compress permission: ${state.compressPermission}`;
}
