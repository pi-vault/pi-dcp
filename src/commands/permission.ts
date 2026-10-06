import type { CompressPermission, SessionState } from "../state/types.ts";

const CYCLE: Record<CompressPermission, CompressPermission> = {
  allow: "ask",
  ask: "deny",
  deny: "allow",
};

export function permissionCommand(
  state: SessionState,
  defaultPermission: CompressPermission = "allow",
): string {
  const current = state.compressPermission ?? defaultPermission;
  state.compressPermission = CYCLE[current];
  return `Compress permission: ${state.compressPermission}`;
}
