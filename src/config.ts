import * as fs from "node:fs";

export interface ExperimentalConfig {
  allowSubAgents: boolean;
}

export interface DcpConfig {
  enabled: boolean;
  debug: boolean;
  compress: CompressConfig;
  manualMode: ManualModeConfig;
  strategies: StrategiesConfig;
  protectedFilePatterns: string[];
  nudgeNotification: "off" | "minimal" | "detailed";
  nudgeNotificationType: "toast" | "status";
  experimental: ExperimentalConfig;
}

export interface CompressConfig {
  mode: "range" | "message";
  permission: "allow" | "deny";
  maxContextPercent: number;
  minContextPercent: number;
  nudgeFrequency: number;
  iterationNudgeThreshold: number;
  nudgeForce: "strong" | "soft";
  protectedTools: string[];
  protectUserMessages: boolean;
  protectTags: boolean;
  /** When true, active summary tokens are excluded from the max-threshold comparison to prevent cascading compressions. */
  summaryBuffer: boolean;
  maxContextLimit: number | string | undefined;
  minContextLimit: number | string | undefined;
  modelMaxLimits: Record<string, number | string> | undefined;
  modelMinLimits: Record<string, number | string> | undefined;
}

export interface ManualModeConfig {
  default: false | "active";
  automaticStrategies: boolean;
}

export interface StrategiesConfig {
  deduplication: DeduplicationConfig;
  purgeErrors: PurgeErrorsConfig;
}

export interface DeduplicationConfig {
  enabled: boolean;
  protectedTools: string[];
}

export interface PurgeErrorsConfig {
  enabled: boolean;
  turns: number;
  protectedTools: string[];
}

const DEFAULT_CONFIG: DcpConfig = {
  enabled: true,
  debug: false,
  compress: {
    mode: "range",
    permission: "allow",
    maxContextPercent: 80,
    minContextPercent: 50,
    nudgeFrequency: 5,
    iterationNudgeThreshold: 15,
    nudgeForce: "soft",
    protectedTools: ["compress"],
    protectUserMessages: false,
    protectTags: false,
    summaryBuffer: true,
    maxContextLimit: 200000,
    minContextLimit: 100000,
    modelMaxLimits: undefined,
    modelMinLimits: undefined,
  },
  manualMode: {
    default: false,
    automaticStrategies: true,
  },
  strategies: {
    deduplication: {
      enabled: true,
      protectedTools: [],
    },
    purgeErrors: {
      enabled: true,
      turns: 4,
      protectedTools: [],
    },
  },
  protectedFilePatterns: [],
  nudgeNotification: "minimal",
  nudgeNotificationType: "status",
  experimental: {
    allowSubAgents: false,
  },
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

const KNOWN_TOP_LEVEL_KEYS = new Set([
  "enabled", "debug", "compress", "manualMode", "strategies",
  "protectedFilePatterns", "nudgeNotification", "nudgeNotificationType",
  "experimental",
]);

const KNOWN_COMPRESS_KEYS = new Set([
  "mode", "permission", "maxContextPercent", "minContextPercent",
  "nudgeFrequency", "iterationNudgeThreshold", "nudgeForce",
  "protectedTools", "protectUserMessages", "protectTags", "summaryBuffer",
  "maxContextLimit", "minContextLimit", "modelMaxLimits", "modelMinLimits",
]);

export interface LoadConfigResult {
  config: DcpConfig;
  warnings: string[];
}

/**
 * Load DCP configuration from a single JSON file.
 * Falls back to defaults on missing file, parse error, or invalid content.
 * Returns warnings for unknown keys and out-of-range values.
 *
 * @param configFilePath - Absolute path to dcp.json (typically resolved via getAgentDir())
 */
export function loadConfig(configFilePath: string): LoadConfigResult {
  const config = structuredClone(DEFAULT_CONFIG);
  const warnings: string[] = [];

  const parsed = parseConfigFile(configFilePath);
  if (parsed) {
    // Check for unknown top-level keys
    for (const key of Object.keys(parsed)) {
      if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
        warnings.push(`Unknown config key "${key}" — ignored`);
      }
    }

    // Check for unknown compress keys
    if (parsed.compress && typeof parsed.compress === "object") {
      for (const key of Object.keys(parsed.compress as object)) {
        if (!KNOWN_COMPRESS_KEYS.has(key)) {
          warnings.push(`Unknown compress key "${key}" — ignored`);
        }
      }
    }

    mergeConfig(config, parsed);
  }

  // Validate ranges
  if (config.compress.maxContextPercent > 100) {
    warnings.push(`maxContextPercent (${config.compress.maxContextPercent}) exceeds 100, reset to default`);
    config.compress.maxContextPercent = DEFAULT_CONFIG.compress.maxContextPercent;
  }
  if (config.compress.minContextPercent > 100) {
    warnings.push(`minContextPercent (${config.compress.minContextPercent}) exceeds 100, reset to default`);
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

function mergeConfig(target: DcpConfig, source: Record<string, unknown>): void {
  if (typeof source.enabled === "boolean") target.enabled = source.enabled;
  if (typeof source.debug === "boolean") target.debug = source.debug;
  if (typeof source.nudgeNotification === "string") {
    if (["off", "minimal", "detailed"].includes(source.nudgeNotification)) {
      target.nudgeNotification = source.nudgeNotification as
        | "off"
        | "minimal"
        | "detailed";
    }
  }
  if (typeof source.nudgeNotificationType === "string") {
    if (["toast", "status"].includes(source.nudgeNotificationType)) {
      target.nudgeNotificationType = source.nudgeNotificationType as
        | "toast"
        | "status";
    }
  }
  if (Array.isArray(source.protectedFilePatterns)) {
    target.protectedFilePatterns = source.protectedFilePatterns.filter(
      (p): p is string => typeof p === "string",
    );
  }

  if (source.compress && typeof source.compress === "object") {
    const c = source.compress as Record<string, unknown>;
    if (c.mode === "range" || c.mode === "message")
      target.compress.mode = c.mode;
    if (c.permission === "allow" || c.permission === "deny")
      target.compress.permission = c.permission;
    if (typeof c.maxContextPercent === "number" && c.maxContextPercent > 0)
      target.compress.maxContextPercent = c.maxContextPercent;
    if (typeof c.minContextPercent === "number" && c.minContextPercent > 0)
      target.compress.minContextPercent = c.minContextPercent;
    if (typeof c.nudgeFrequency === "number" && c.nudgeFrequency >= 1)
      target.compress.nudgeFrequency = c.nudgeFrequency;
    if (
      typeof c.iterationNudgeThreshold === "number" &&
      c.iterationNudgeThreshold >= 1
    )
      target.compress.iterationNudgeThreshold = c.iterationNudgeThreshold;
    if (c.nudgeForce === "strong" || c.nudgeForce === "soft")
      target.compress.nudgeForce = c.nudgeForce;
    if (Array.isArray(c.protectedTools))
      target.compress.protectedTools = c.protectedTools.filter(
        (t): t is string => typeof t === "string",
      );
    if (typeof c.protectUserMessages === "boolean")
      target.compress.protectUserMessages = c.protectUserMessages;
    if (typeof c.protectTags === "boolean")
      target.compress.protectTags = c.protectTags;
    if (typeof c.summaryBuffer === "boolean")
      target.compress.summaryBuffer = c.summaryBuffer;
    if (typeof c.maxContextLimit === "number" && c.maxContextLimit > 0)
      target.compress.maxContextLimit = c.maxContextLimit;
    else if (typeof c.maxContextLimit === "string")
      target.compress.maxContextLimit = c.maxContextLimit;
    if (typeof c.minContextLimit === "number" && c.minContextLimit > 0)
      target.compress.minContextLimit = c.minContextLimit;
    else if (typeof c.minContextLimit === "string")
      target.compress.minContextLimit = c.minContextLimit;
    if (
      c.modelMaxLimits &&
      typeof c.modelMaxLimits === "object" &&
      !Array.isArray(c.modelMaxLimits)
    ) {
      const validated: Record<string, number | string> = {};
      for (const [key, val] of Object.entries(
        c.modelMaxLimits as Record<string, unknown>,
      )) {
        if (typeof val === "number" && val > 0) validated[key] = val;
        else if (typeof val === "string") validated[key] = val;
      }
      if (Object.keys(validated).length > 0)
        target.compress.modelMaxLimits = validated;
    }
    if (
      c.modelMinLimits &&
      typeof c.modelMinLimits === "object" &&
      !Array.isArray(c.modelMinLimits)
    ) {
      const validated: Record<string, number | string> = {};
      for (const [key, val] of Object.entries(
        c.modelMinLimits as Record<string, unknown>,
      )) {
        if (typeof val === "number" && val > 0) validated[key] = val;
        else if (typeof val === "string") validated[key] = val;
      }
      if (Object.keys(validated).length > 0)
        target.compress.modelMinLimits = validated;
    }
  }

  if (source.manualMode && typeof source.manualMode === "object") {
    const m = source.manualMode as Record<string, unknown>;
    if (m.default === false || m.default === "active")
      target.manualMode.default = m.default;
    if (typeof m.automaticStrategies === "boolean")
      target.manualMode.automaticStrategies = m.automaticStrategies;
  }

  if (source.strategies && typeof source.strategies === "object") {
    const s = source.strategies as Record<string, unknown>;
    if (s.deduplication && typeof s.deduplication === "object") {
      const d = s.deduplication as Record<string, unknown>;
      if (typeof d.enabled === "boolean")
        target.strategies.deduplication.enabled = d.enabled;
      if (Array.isArray(d.protectedTools))
        target.strategies.deduplication.protectedTools =
          d.protectedTools.filter((t): t is string => typeof t === "string");
    }
    if (s.purgeErrors && typeof s.purgeErrors === "object") {
      const p = s.purgeErrors as Record<string, unknown>;
      if (typeof p.enabled === "boolean")
        target.strategies.purgeErrors.enabled = p.enabled;
      if (typeof p.turns === "number" && p.turns >= 1)
        target.strategies.purgeErrors.turns = p.turns;
      if (Array.isArray(p.protectedTools))
        target.strategies.purgeErrors.protectedTools = p.protectedTools.filter(
          (t): t is string => typeof t === "string",
        );
    }
  }

  if (source.experimental && typeof source.experimental === "object") {
    const e = source.experimental as Record<string, unknown>;
    if (typeof e.allowSubAgents === "boolean")
      target.experimental.allowSubAgents = e.allowSubAgents;
  }
}
