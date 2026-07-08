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
export const BASE_PROTECTED_TOOLS = [
  "compress",
  "bash",
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
  "subagent",
];

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

export interface LoadConfigResult {
  config: DcpConfig;
  warnings: string[];
}

/**
 * Load DCP configuration from a single JSON file.
 * Falls back to defaults on missing file, parse error, or invalid content.
 * Returns warnings for validation errors and out-of-range values.
 * Invalid-typed values are reset to their defaults.
 *
 * @param configFilePath - Absolute path to dcp.json (typically resolved via getAgentDir())
 */
export function loadConfig(configFilePath: string): LoadConfigResult {
  const warnings: string[] = [];
  const defaults = structuredClone(DEFAULT_CONFIG);

  const parsed = parseConfigFile(configFilePath);
  if (!parsed) return { config: defaults, warnings };

  // Deep merge raw user config over defaults so partial nested objects
  // (e.g. { compress: { mode: "message" } }) don't wipe sibling defaults.
  const merged = deepMerge(
    structuredClone(defaults) as Record<string, unknown>,
    parsed,
  );

  // Clean unknown properties first
  Value.Clean(DcpConfigSchema, merged);

  // Validate and reset invalid values to defaults.
  // TypeBox 1.x emits errors with `instancePath` (AJV-compatible format).
  // Union types produce multiple errors for the same path (one per branch);
  // deduplicate so each property emits at most one warning.
  if (!Value.Check(DcpConfigSchema, merged)) {
    const seenPaths = new Set<string>();
    for (const error of Value.Errors(DcpConfigSchema, merged)) {
      // Runtime property is `instancePath`, not `path`
      const instancePath = (error as unknown as Record<string, unknown>)
        .instancePath as string | undefined;
      if (!instancePath) continue; // skip empty-path container errors
      if (seenPaths.has(instancePath)) continue; // deduplicate Union branches
      seenPaths.add(instancePath);
      warnings.push(`Config error at ${instancePath}: ${error.message}`);
      // Reset the invalid value to its default
      const defaultValue = getByPath(
        defaults as unknown as Record<string, unknown>,
        instancePath,
      );
      if (defaultValue !== undefined) {
        setByPath(merged, instancePath, structuredClone(defaultValue));
      }
    }
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
    config.compress.maxContextPercent = DEFAULT_CONFIG.compress.maxContextPercent;
    config.compress.minContextPercent = DEFAULT_CONFIG.compress.minContextPercent;
  }

  return { config, warnings };
}

function parseConfigFile(
  filePath: string,
): Record<string, unknown> | undefined {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Recursively merge source into target.
 * Objects merge recursively. Primitives and arrays in source overwrite target.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of Object.keys(source)) {
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
      target[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else {
      target[key] = srcVal;
    }
  }
  return target;
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
function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
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
