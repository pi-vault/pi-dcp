import * as fs from "node:fs";
import { Value } from "typebox/value";
import {
  DcpConfigSchema,
  type DcpConfig,
  type CompressConfig,
  type DeduplicationConfig,
  type PurgeErrorsConfig,
  type ManualModeConfig,
  type ExperimentalConfig,
  type StrategiesConfig,
} from "./config-schema.ts";

// Re-export types so existing imports from config.ts continue to work
export type {
  DcpConfig,
  CompressConfig,
  DeduplicationConfig,
  PurgeErrorsConfig,
  ManualModeConfig,
  ExperimentalConfig,
  StrategiesConfig,
};

/**
 * Tool names always protected from pruning strategies.
 * Pi's core tools that should never have their outputs removed.
 */
export const BASE_PROTECTED_TOOLS = ["compress", "write", "edit", "subagent"];

// Value.Create fills all schema defaults, but Optional fields without
// defaults resolve to undefined. Override the context limits that need
// concrete defaults for threshold calculations.
export const DEFAULT_CONFIG: DcpConfig = (() => {
  const config = Value.Create(DcpConfigSchema) as DcpConfig;
  // Protect compress tool outputs from being pruned to prevent recursive compression
  config.compress.protectedTools = ["compress"];
  // Optional fields without schema defaults — set concrete values for threshold calculations
  config.compress.maxContextLimit = 200000;
  config.compress.minContextLimit = 100000;
  return config;
})();

export function isDcpEnabledForModel(
  config: Pick<DcpConfig, "enabled" | "disabledModels">,
  provider: string | undefined,
  modelId: string | undefined,
): boolean {
  if (!config.enabled) return false;
  if (provider === undefined || modelId === undefined) return true;
  return !config.disabledModels.includes(`${provider}/${modelId}`);
}

/**
 * Load DCP configuration from global and optional trusted project JSON files.
 * Falls back to defaults on missing file, parse error, or invalid content.
 * Returns warnings for validation errors and out-of-range values.
 * Invalid-typed values are reset to their defaults.
 *
 * @param configFilePath - Absolute path to dcp.json (typically resolved via getAgentDir())
 */
export function loadConfig(
  configFilePath: string,
  projectConfigPath?: string,
): { config: DcpConfig; warnings: string[] } {
  const warnings: string[] = [];
  const merged = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>;

  for (const filePath of [configFilePath, projectConfigPath]) {
    if (!filePath) continue;
    const parsed = parseConfigFile(filePath);
    if (parsed.warning) warnings.push(parsed.warning);
    if (parsed.value) deepMerge(merged, parsed.value);
  }

  // Deep merge raw user config over defaults so partial nested objects
  // (e.g. { compress: { mode: "message" } }) don't wipe sibling defaults.
  // Clean unknown properties first
  Value.Clean(DcpConfigSchema, merged);

  // Validate and reset invalid values to defaults.
  // Union types produce multiple errors for the same path (one per branch);
  // deduplicate so each property emits at most one warning.
  if (!Value.Check(DcpConfigSchema, merged)) {
    const seenPaths = new Set<string>();
    for (const error of Value.Errors(DcpConfigSchema, merged)) {
      if (!error.instancePath) continue; // skip empty-path container errors
      if (seenPaths.has(error.instancePath)) continue; // deduplicate Union branches
      seenPaths.add(error.instancePath);
      warnings.push(`Config error at ${error.instancePath}: ${error.message}`);
      const defaultValue = getByPath(
        DEFAULT_CONFIG as unknown as Record<string, unknown>,
        error.instancePath,
      );
      if (defaultValue !== undefined) {
        setByPath(merged, error.instancePath, structuredClone(defaultValue));
      }
    }
  }

  const disabledModels = merged.disabledModels;
  if (
    !Array.isArray(disabledModels) ||
    disabledModels.some((modelKey) => typeof modelKey !== "string")
  ) {
    merged.disabledModels = [];
  }

  const config = merged as unknown as DcpConfig;

  // Post-validation range fixes (semantic constraints TypeBox can't express)
  if (config.compress.maxContextPercent > 100) {
    warnings.push(
      `maxContextPercent (${config.compress.maxContextPercent}) exceeds 100, reset to default`,
    );
    config.compress.maxContextPercent = DEFAULT_CONFIG.compress.maxContextPercent;
  }
  if (config.compress.minContextPercent > 100) {
    warnings.push(
      `minContextPercent (${config.compress.minContextPercent}) exceeds 100, reset to default`,
    );
    config.compress.minContextPercent = DEFAULT_CONFIG.compress.minContextPercent;
  }
  if (config.compress.maxContextPercent <= config.compress.minContextPercent) {
    warnings.push(
      `maxContextPercent (${config.compress.maxContextPercent}) must be greater than minContextPercent (${config.compress.minContextPercent}), reset to defaults`,
    );
    config.compress.maxContextPercent = DEFAULT_CONFIG.compress.maxContextPercent;
    config.compress.minContextPercent = DEFAULT_CONFIG.compress.minContextPercent;
  }

  return { config, warnings };
}

function parseConfigFile(filePath: string): { value?: Record<string, unknown>; warning?: string } {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { value: parsed as Record<string, unknown> };
    }
    return { warning: `Unable to parse config file: ${filePath}` };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    return { warning: `Unable to parse config file: ${filePath}` };
  }
}

/**
 * Recursively merge source into target.
 * Objects merge recursively. Primitives and arrays in source overwrite target.
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else {
      target[key] = srcVal;
    }
  }
}

/**
 * Get a value from a nested object using a JSON Pointer path (e.g. "/compress/mode").
 */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split("/").filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Set a value in a nested object using a JSON Pointer path (e.g. "/compress/mode").
 */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return;
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = current[parts[i]];
    if (next === null || typeof next !== "object") return;
    current = next as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}
