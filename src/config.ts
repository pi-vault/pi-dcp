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
import { sanitizeConfigLayer } from "./config-validation.ts";

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
  const percentSources = {
    maxContextPercent: "built-in defaults",
    minContextPercent: "built-in defaults",
  };

  for (const filePath of [configFilePath, projectConfigPath]) {
    if (!filePath) continue;
    const parsed = parseConfigFile(filePath);
    if (parsed.warning) warnings.push(parsed.warning);
    if (parsed.value) {
      const { value: sanitized, warnings: layerWarnings } = sanitizeConfigLayer(
        parsed.value,
        filePath,
      );
      warnings.push(...layerWarnings);
      const compress = sanitized.compress;
      if (isPlainObject(compress)) {
        if (Object.hasOwn(compress, "maxContextPercent")) {
          percentSources.maxContextPercent = filePath;
        }
        if (Object.hasOwn(compress, "minContextPercent")) {
          percentSources.minContextPercent = filePath;
        }
      }
      deepMerge(merged, sanitized);
    }
  }

  const config = merged as unknown as DcpConfig;

  // The ordering constraint can span two layers, so report the effective source
  // of each participating value after the independently sanitized layers merge.
  if (config.compress.maxContextPercent <= config.compress.minContextPercent) {
    warnings.push(
      `${percentSources.maxContextPercent}#/compress/maxContextPercent and ${percentSources.minContextPercent}#/compress/minContextPercent: maxContextPercent (${config.compress.maxContextPercent}) must be greater than minContextPercent (${config.compress.minContextPercent}), reset to defaults`,
    );
    config.compress.maxContextPercent = DEFAULT_CONFIG.compress.maxContextPercent;
    config.compress.minContextPercent = DEFAULT_CONFIG.compress.minContextPercent;
  }

  return { config, warnings };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
