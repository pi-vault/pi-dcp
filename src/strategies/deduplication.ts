import { BASE_PROTECTED_TOOLS, type DcpConfig } from "../config.ts";
import type { SessionState } from "../state/types.ts";
import {
  isToolNameProtected,
  getFilePathsFromParameters,
  isFilePathProtected,
} from "./protected-patterns.ts";

export interface DeduplicationResult {
  pruned: number;
  tokensSaved: number;
}

export function deduplicate(
  state: SessionState,
  config: DcpConfig,
): DeduplicationResult {
  if (!config.strategies.deduplication.enabled) {
    return { pruned: 0, tokensSaved: 0 };
  }

  if (state.manualMode === "active" && !config.manualMode.automaticStrategies) {
    return { pruned: 0, tokensSaved: 0 };
  }

  if (state.toolIdList.length === 0) {
    return { pruned: 0, tokensSaved: 0 };
  }

  const protectedTools = [
    ...BASE_PROTECTED_TOOLS,
    ...config.strategies.deduplication.protectedTools,
  ];

  const unpruned = state.toolIdList.filter((id) => !state.prune.tools.has(id));

  // Group by signature
  const groups = new Map<string, string[]>();
  for (const callId of unpruned) {
    const entry = state.toolParameters.get(callId);
    if (!entry) continue;

    if (isToolNameProtected(entry.tool, protectedTools)) continue;

    const filePaths = getFilePathsFromParameters(
      entry.tool,
      entry.parameters as Record<string, unknown>,
    );
    if (isFilePathProtected(filePaths, config.protectedFilePatterns)) continue;

    const sig = createToolSignature(entry.tool, entry.parameters);
    const group = groups.get(sig) ?? [];
    group.push(callId);
    groups.set(sig, group);
  }

  // For each group with duplicates, prune all but the last (most recent)
  let pruned = 0;
  let tokensSaved = 0;
  for (const [, callIds] of groups) {
    if (callIds.length <= 1) continue;

    for (let i = 0; i < callIds.length - 1; i++) {
      const callId = callIds[i];
      const entry = state.toolParameters.get(callId);
      const tokens = entry?.tokenCount ?? 0;
      state.prune.tools.set(callId, tokens);
      pruned++;
      tokensSaved += tokens;
    }
  }

  state.stats.totalPruneTokens += tokensSaved;
  state.stats.toolsPruned += pruned;

  return { pruned, tokensSaved };
}

export function createToolSignature(toolName: string, parameters: unknown): string {
  const normalized = normalizeParams(parameters);
  return `${toolName}::${JSON.stringify(normalized)}`;
}

function normalizeParams(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizeParams);

  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = normalizeParams(obj[key]);
    if (v !== undefined) {
      sorted[key] = v;
    }
  }
  return sorted;
}
