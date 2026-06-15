import type { SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { sweepAll } from "../strategies/runner.ts";

export function sweepCommand(state: SessionState, config: DcpConfig): string {
  const result = sweepAll(state, config);
  return `Sweep complete: ${result.pruned} tool outputs pruned, ~${result.tokensSaved} tokens saved.`;
}
