/**
 * Tool call signature utilities for deduplication.
 *
 * Creates deterministic signatures from tool name + parameters,
 * used by the strategy runner to group duplicate calls.
 */

export function createToolSignature(
  toolName: string,
  parameters: unknown,
): string {
  const normalized = normalizeParams(parameters);
  return `${toolName}::${JSON.stringify(normalized)}`;
}

export function normalizeParams(value: unknown): unknown {
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
