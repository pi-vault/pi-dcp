import type { CompressConfig } from "../config.ts";
import type { ContextUsage, SessionState } from "../state/types.ts";

/**
 * Resolve a context limit value (number or percentage string) to an absolute token count.
 * Returns undefined if the value cannot be resolved (e.g., percentage with no context window).
 *
 * @param value - The limit value: absolute number, percentage string ("80%"), or undefined.
 * @param contextWindow - The context window size to resolve percentages against.
 */
export function resolveContextTokenLimit(
  value: number | string | undefined,
  contextWindow: number | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;

  // Parse percentage string like "80%"
  const match = value.match(/^(\d+(?:\.\d+)?)%$/);
  if (!match) return undefined;

  const percent = Number.parseFloat(match[1]);
  if (percent <= 0 || percent > 100) return undefined;
  if (contextWindow === undefined) return undefined;

  return Math.round((percent / 100) * contextWindow);
}

/**
 * Determine if context usage exceeds the configured limits.
 * Resolution order for each threshold:
 *   1. Per-model override (modelMaxLimits/modelMinLimits[provider/modelId])
 *   2. Global absolute limit (maxContextLimit/minContextLimit)
 *   3. Legacy percentage fallback (maxContextPercent/minContextPercent * contextWindow)
 *
 * The effective context window is state.modelContextWindow if set, otherwise
 * contextUsage.contextWindow. This ensures the legacy fallback works even
 * when state hasn't captured the window yet (e.g., in tests or first context pass).
 */
export function isContextOverLimits(
  config: { compress: CompressConfig },
  state: SessionState,
  contextUsage: ContextUsage,
): { overMaxLimit: boolean; overMinLimit: boolean } {
  if (contextUsage.tokens == null) {
    return { overMaxLimit: false, overMinLimit: false };
  }

  const tokens = contextUsage.tokens;
  const modelKey =
    state.modelProvider && state.modelId
      ? `${state.modelProvider}/${state.modelId}`
      : undefined;

  // Effective window: prefer state (persisted), fall back to contextUsage (current)
  const effectiveWindow =
    state.modelContextWindow ??
    (contextUsage.contextWindow > 0 ? contextUsage.contextWindow : undefined);

  const maxLimit = resolveMaxLimit(config.compress, effectiveWindow, modelKey);
  const minLimit = resolveMinLimit(config.compress, effectiveWindow, modelKey);

  return {
    overMaxLimit: maxLimit !== undefined ? tokens >= maxLimit : false,
    overMinLimit: minLimit !== undefined ? tokens >= minLimit : false,
  };
}

function resolveMaxLimit(
  compress: CompressConfig,
  contextWindow: number | undefined,
  modelKey: string | undefined,
): number | undefined {
  // 1. Per-model override
  if (modelKey && compress.modelMaxLimits?.[modelKey] !== undefined) {
    return resolveContextTokenLimit(compress.modelMaxLimits[modelKey], contextWindow);
  }

  // 2. Global absolute limit
  if (compress.maxContextLimit !== undefined) {
    return resolveContextTokenLimit(compress.maxContextLimit, contextWindow);
  }

  // 3. Legacy percentage fallback
  if (contextWindow !== undefined) {
    return Math.round((compress.maxContextPercent / 100) * contextWindow);
  }

  return undefined;
}

function resolveMinLimit(
  compress: CompressConfig,
  contextWindow: number | undefined,
  modelKey: string | undefined,
): number | undefined {
  // 1. Per-model override
  if (modelKey && compress.modelMinLimits?.[modelKey] !== undefined) {
    return resolveContextTokenLimit(compress.modelMinLimits[modelKey], contextWindow);
  }

  // 2. Global absolute limit
  if (compress.minContextLimit !== undefined) {
    return resolveContextTokenLimit(compress.minContextLimit, contextWindow);
  }

  // 3. Legacy percentage fallback
  if (contextWindow !== undefined) {
    return Math.round((compress.minContextPercent / 100) * contextWindow);
  }

  return undefined;
}
