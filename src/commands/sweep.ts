import type { SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { BASE_PROTECTED_TOOLS } from "../config.ts";

export function sweepCommand(state: SessionState, config: DcpConfig): string {
  const protectedTools = new Set([
    ...BASE_PROTECTED_TOOLS,
    ...config.compress.protectedTools,
  ]);

  let swept = 0;
  let tokensSaved = 0;

  for (const [toolCallId, entry] of state.toolParameters) {
    if (state.prune.tools.has(toolCallId)) continue;
    if (protectedTools.has(entry.tool)) continue;
    if (entry.status !== "completed") continue;

    const tokens = entry.tokenCount ?? 0;
    state.prune.tools.set(toolCallId, tokens);
    state.stats.toolsPruned++;
    state.stats.totalPruneTokens += tokens;
    state.stats.pruneTokenCounter += tokens;
    swept++;
    tokensSaved += tokens;
  }

  return `Sweep complete: ${swept} tool outputs pruned, ~${tokensSaved} tokens saved.`;
}
