import * as fs from "node:fs";

export interface DcpConfig {
  enabled: boolean;
  debug: boolean;
  compress: CompressConfig;
  manualMode: ManualModeConfig;
  strategies: StrategiesConfig;
  protectedFilePatterns: string[];
  nudgeNotification: "off" | "minimal" | "detailed";
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
];

/**
 * Load DCP configuration from a single JSON file.
 * Falls back to defaults on missing file, parse error, or invalid content.
 *
 * @param configFilePath - Absolute path to dcp.json (typically resolved via getAgentDir())
 */
export function loadConfig(configFilePath: string): DcpConfig {
  const config = structuredClone(DEFAULT_CONFIG);

  const parsed = parseConfigFile(configFilePath);
  if (parsed) mergeConfig(config, parsed);

  if (config.compress.maxContextPercent <= config.compress.minContextPercent) {
    config.compress.maxContextPercent = DEFAULT_CONFIG.compress.maxContextPercent;
    config.compress.minContextPercent = DEFAULT_CONFIG.compress.minContextPercent;
  }

  return config;
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
}
