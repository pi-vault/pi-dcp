import type { SessionState } from "../state/types.ts";

export function manualCommand(state: SessionState, args: string): string {
  const arg = args.trim().toLowerCase();

  if (!arg) {
    return `Manual mode: ${state.manualMode || "off"}`;
  }

  if (arg === "on") {
    state.manualMode = "active";
    return "Manual mode: on. Automatic compression is paused.";
  }

  if (arg === "off") {
    state.manualMode = false;
    return "Manual mode: off. Automatic compression resumed.";
  }

  return "Usage: dcp:manual [on|off]";
}
