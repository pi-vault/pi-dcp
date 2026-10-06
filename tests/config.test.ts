import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BASE_PROTECTED_TOOLS,
  DEFAULT_CONFIG,
  isDcpEnabledForModel,
  loadConfig,
} from "../src/config.ts";
import { CompressConfigSchema, DcpConfigSchema } from "../src/config-schema.ts";
import { createSessionState } from "../src/state/state.ts";
import { isContextOverLimits } from "../src/utils/context-limits.ts";

describe("config loading", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const configPath = path.join(tempDir, "dcp.json");
    const { config } = loadConfig(configPath);
    expect(config.enabled).toBe(true);
    expect(config.debug).toBe(false);
    expect(config.compress.mode).toBe("range");
    expect(config.compress.permission).toBe("allow");
    expect(config.compress.showCompression).toBe(false);
    expect(config.compress.protectedTools).toEqual(["compress"]);
    expect(config.strategies.deduplication.enabled).toBe(true);
    expect(config.strategies.deduplication.turnProtection).toBe(0);
    expect(config.strategies.purgeErrors.enabled).toBe(true);
    expect(config.nudgeNotification).toBe("minimal");
    expect(config.nudgeNotificationType).toBe("status");
    expect(config.experimental.allowSubAgents).toBe(false);
  });

  it("defaults disabledModels to an empty list", () => {
    expect(loadConfig(path.join(tempDir, "missing.json")).config.disabledModels).toEqual([]);
  });

  it("loads exact disabled model keys", () => {
    const file = path.join(tempDir, "dcp.json");
    fs.writeFileSync(file, JSON.stringify({ disabledModels: ["openai-codex/gpt-5.6-sol"] }));

    expect(loadConfig(file).config.disabledModels).toEqual(["openai-codex/gpt-5.6-sol"]);
  });

  it("replaces the global disabled model list with the project list", () => {
    const globalPath = path.join(tempDir, "global.json");
    const projectPath = path.join(tempDir, "project.json");
    fs.writeFileSync(globalPath, JSON.stringify({ disabledModels: ["openai-codex/gpt-5.6-sol"] }));
    fs.writeFileSync(
      projectPath,
      JSON.stringify({ disabledModels: ["openai-codex/gpt-5.6-terra"] }),
    );

    expect(loadConfig(globalPath, projectPath).config.disabledModels).toEqual([
      "openai-codex/gpt-5.6-terra",
    ]);
  });

  it("resets disabledModels when any entry is not a string", () => {
    const file = path.join(tempDir, "dcp.json");
    fs.writeFileSync(file, JSON.stringify({ disabledModels: ["openai-codex/gpt-5.6-sol", 123] }));

    const result = loadConfig(file);

    expect(result.config.disabledModels).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("/disabledModels/1"))).toBe(true);
  });

  it("defaults top-level turn protection to zero", () => {
    expect(loadConfig(path.join(tempDir, "missing.json")).config.turnProtection).toBe(0);
  });

  it("accepts a non-negative top-level turn protection", () => {
    const file = path.join(tempDir, "dcp.json");
    fs.writeFileSync(file, JSON.stringify({ turnProtection: 2 }));
    expect(loadConfig(file).config.turnProtection).toBe(2);
  });

  it("resets a negative top-level turn protection", () => {
    const file = path.join(tempDir, "dcp.json");
    fs.writeFileSync(file, JSON.stringify({ turnProtection: -1 }));
    const result = loadConfig(file);
    expect(result.config.turnProtection).toBe(0);
    expect(result.warnings.some((warning) => warning.includes("turnProtection"))).toBe(true);
  });

  it("resets fractional top-level turn protection", () => {
    const file = path.join(tempDir, "dcp.json");
    fs.writeFileSync(file, JSON.stringify({ turnProtection: 1.5 }));
    const result = loadConfig(file);
    expect(result.config.turnProtection).toBe(0);
    expect(result.warnings.some((warning) => warning.includes("turnProtection"))).toBe(true);
  });

  it("loads partial config and fills defaults", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        debug: true,
        compress: { mode: "message" },
      }),
    );

    const { config } = loadConfig(configPath);
    expect(config.debug).toBe(true);
    expect(config.compress.mode).toBe("message");
    // Other compress fields should have defaults
    expect(config.compress.permission).toBe("allow");
    expect(config.compress.showCompression).toBe(false);
    expect(config.compress.nudgeFrequency).toBe(5);
    expect(config.enabled).toBe(true);
  });

  it("handles invalid JSON gracefully", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, "not valid json {{{");

    const { config } = loadConfig(configPath);
    expect(config.enabled).toBe(true);
  });

  it("merges defaults, global, and project layers", () => {
    const globalPath = path.join(tempDir, "global.json");
    const projectPath = path.join(tempDir, "project.json");
    fs.writeFileSync(
      globalPath,
      JSON.stringify({
        enabled: false,
        compress: { mode: "message", protectedTools: ["read"] },
        protectedFilePatterns: ["**/*.secret"],
      }),
    );
    fs.writeFileSync(
      projectPath,
      JSON.stringify({
        enabled: true,
        compress: { showCompression: true, protectedTools: ["write"] },
        protectedFilePatterns: ["**/*.key"],
      }),
    );

    const { config } = loadConfig(globalPath, projectPath);

    expect(config.enabled).toBe(true);
    expect(config.compress.mode).toBe("message");
    expect(config.compress.showCompression).toBe(true);
    expect(config.compress.protectedTools).toEqual(["write"]);
    expect(config.protectedFilePatterns).toEqual(["**/*.key"]);
  });

  it("skips a missing layer and warns for malformed JSON", () => {
    const globalPath = path.join(tempDir, "global.json");
    fs.writeFileSync(globalPath, "{");

    const result = loadConfig(globalPath, path.join(tempDir, "missing.json"));

    expect(result.config).toEqual(DEFAULT_CONFIG);
    expect(result.warnings).toContain(`Unable to parse config file: ${globalPath}`);
  });

  it("cleans unknown keys and warns for invalid values", () => {
    const globalPath = path.join(tempDir, "global.json");
    fs.writeFileSync(globalPath, JSON.stringify({ unknown: true, compress: { mode: "invalid" } }));

    const result = loadConfig(globalPath);

    expect("unknown" in (result.config as Record<string, unknown>)).toBe(false);
    expect(result.config.compress.mode).toBe(DEFAULT_CONFIG.compress.mode);
    expect(result.warnings.some((warning) => warning.includes("/compress/mode"))).toBe(true);
  });

  it("returns a fresh config for every call", () => {
    const configPath = path.join(tempDir, "missing.json");
    const first = loadConfig(configPath).config;
    first.compress.protectedTools.push("read");
    first.disabledModels.push("openai-codex/gpt-5.6-sol");

    const second = loadConfig(configPath).config;
    expect(second.compress.protectedTools).toEqual(["compress"]);
    expect(second.disabledModels).toEqual([]);
  });

  it("does not merge prototype mutation keys", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, '{"__proto__":{"dcpPolluted":true}}');

    try {
      const { warnings } = loadConfig(configPath);
      expect(({} as Record<string, unknown>).dcpPolluted).toBeUndefined();
      expect(warnings.some((warning) => warning.includes(`${configPath}#/__proto__`))).toBe(true);
    } finally {
      delete (Object.prototype as Record<string, unknown>).dcpPolluted;
    }
  });

  it("deep merges nested config without losing sibling defaults", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        compress: { mode: "message" },
        strategies: { deduplication: { turnProtection: 5 } },
      }),
    );

    const { config } = loadConfig(configPath);
    expect(config.compress.mode).toBe("message");
    expect(config.compress.permission).toBe("allow"); // sibling default preserved
    expect(config.strategies.deduplication.turnProtection).toBe(5);
    expect(config.strategies.deduplication.enabled).toBe(true); // sibling default preserved
    expect(config.strategies.purgeErrors.enabled).toBe(true); // sibling default preserved
  });

  it("enforces maxContextPercent > minContextPercent", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        compress: { maxContextPercent: 40, minContextPercent: 60 },
      }),
    );

    const { config, warnings } = loadConfig(configPath);
    expect(config.compress.maxContextPercent).toBeGreaterThan(config.compress.minContextPercent);
    expect(
      warnings.some((w) => w.includes("maxContextPercent") || w.includes("minContextPercent")),
    ).toBe(true);
  });

  it("parses nudgeNotificationType toast", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, JSON.stringify({ nudgeNotificationType: "toast" }));
    const { config } = loadConfig(configPath);
    expect(config.nudgeNotificationType).toBe("toast");
  });

  it("parses experimental.allowSubAgents", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, JSON.stringify({ experimental: { allowSubAgents: true } }));
    const { config } = loadConfig(configPath);
    expect(config.experimental.allowSubAgents).toBe(true);
  });

  it("parses showCompression true", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, JSON.stringify({ compress: { showCompression: true } }));
    const { config } = loadConfig(configPath);
    expect(config.compress.showCompression).toBe(true);
  });

  it("accepts ask compression permission without warnings", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, JSON.stringify({ compress: { permission: "ask" } }));
    const { config, warnings } = loadConfig(configPath);
    expect(config.compress.permission).toBe("ask");
    expect(warnings).toEqual([]);
  });

  it("defaults compression permission to allow", () => {
    const configPath = path.join(tempDir, "missing.json");
    const { config } = loadConfig(configPath);
    expect(config.compress.permission).toBe("allow");
  });

  it("parses turnProtection", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        strategies: { deduplication: { turnProtection: 5 } },
      }),
    );
    const { config } = loadConfig(configPath);
    expect(config.strategies.deduplication.turnProtection).toBe(5);
  });

  it("resets wrong-typed values to defaults", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        debug: "yes",
        compress: { showCompression: "yes", mode: "range" },
      }),
    );
    const { config, warnings } = loadConfig(configPath);
    expect(config.debug).toBe(false); // reset to default
    expect(config.compress.showCompression).toBe(false); // reset to default
    expect(config.compress.mode).toBe("range"); // valid value preserved
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("config validation warnings", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-config-warn-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns no warnings for valid config", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, JSON.stringify({ enabled: true, debug: false }));
    const { warnings } = loadConfig(configPath);
    expect(warnings).toHaveLength(0);
  });

  it("warns when maxContextPercent exceeds 100", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, JSON.stringify({ compress: { maxContextPercent: 150 } }));
    const { config, warnings } = loadConfig(configPath);
    expect(
      warnings.some((warning) => warning.includes(`${configPath}#/compress/maxContextPercent`)),
    ).toBe(true);
    expect(config.compress.maxContextPercent).toBe(80); // reset to default
  });

  it("inherits a valid global percentage after an invalid project override", () => {
    const globalPath = path.join(tempDir, "global.json");
    const projectPath = path.join(tempDir, "project.json");
    fs.writeFileSync(globalPath, JSON.stringify({ compress: { maxContextPercent: 90 } }));
    fs.writeFileSync(projectPath, JSON.stringify({ compress: { maxContextPercent: 150 } }));

    const { config, warnings } = loadConfig(globalPath, projectPath);

    expect(config.compress.maxContextPercent).toBe(90);
    expect(
      warnings.some((warning) => warning.includes(`${projectPath}#/compress/maxContextPercent`)),
    ).toBe(true);
  });

  it("reports both source pointers for a cross-layer percentage conflict", () => {
    const globalPath = path.join(tempDir, "global.json");
    const projectPath = path.join(tempDir, "project.json");
    fs.writeFileSync(globalPath, JSON.stringify({ compress: { maxContextPercent: 70 } }));
    fs.writeFileSync(projectPath, JSON.stringify({ compress: { minContextPercent: 75 } }));

    const { config, warnings } = loadConfig(globalPath, projectPath);
    const conflict = warnings.find(
      (warning) => warning.includes("must be greater than") && warning.includes(globalPath),
    );

    expect(config.compress.maxContextPercent).toBe(DEFAULT_CONFIG.compress.maxContextPercent);
    expect(config.compress.minContextPercent).toBe(DEFAULT_CONFIG.compress.minContextPercent);
    expect(conflict).toContain(`${globalPath}#/compress/maxContextPercent`);
    expect(conflict).toContain(`${projectPath}#/compress/minContextPercent`);
  });

  it("warns about invalid enum values", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, JSON.stringify({ nudgeNotificationType: "popup" }));
    const { config, warnings } = loadConfig(configPath);
    expect(warnings.length).toBeGreaterThan(0);
    expect(config.nudgeNotificationType).toBe("status"); // reset to default
  });
});

describe("configuration layer sanitization", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-config-sanitize-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeLayer(name: string, value: unknown): string {
    const file = path.join(tempDir, name);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  }

  it.each([1, 200000, "0.5%", "100%"])("accepts valid maxContextLimit %s", (value) => {
    const file = writeLayer("global.json", { compress: { maxContextLimit: value } });
    const { config, warnings } = loadConfig(file);
    expect(config.compress.maxContextLimit).toBe(value);
    expect(warnings).toEqual([]);
  });

  it.each([0, -1, 1.5, "bogus", "0%", "100.1%"])("rejects invalid maxContextLimit %s", (value) => {
    const file = writeLayer("global.json", { compress: { maxContextLimit: value } });
    const { config, warnings } = loadConfig(file);
    expect(config.compress.maxContextLimit).toBe(DEFAULT_CONFIG.compress.maxContextLimit);
    const matches = warnings.filter(
      (warning) => warning.includes(file) && warning.includes("#/compress/maxContextLimit"),
    );
    expect(matches).toHaveLength(1);
  });

  it("removes one invalid per-model limit and keeps a valid sibling", () => {
    const file = writeLayer("global.json", {
      compress: { modelMaxLimits: { "provider/valid": 100000, "provider/invalid": "bogus" } },
    });
    const { config } = loadConfig(file);
    expect(config.compress.modelMaxLimits).toEqual({ "provider/valid": 100000 });
  });

  it("uses the global maximum for a removed per-model key", () => {
    const file = writeLayer("global.json", {
      compress: {
        maxContextLimit: 300000,
        modelMaxLimits: { "provider/kept": 500000, "provider/removed": "bogus" },
      },
    });
    const { config } = loadConfig(file);
    const state = createSessionState();
    state.modelProvider = "provider";
    state.modelId = "removed";
    state.modelContextWindow = 1_000_000;

    const result = isContextOverLimits(config, state, {
      tokens: 350000,
      contextWindow: 1_000_000,
      percent: 35,
    });

    expect(result.overMaxLimit).toBe(true);
  });

  it("uses the built-in default when the global maximum is invalid", () => {
    const file = writeLayer("global.json", { compress: { maxContextLimit: "bogus" } });
    const { config } = loadConfig(file);
    expect(config.compress.maxContextLimit).toBe(DEFAULT_CONFIG.compress.maxContextLimit);
  });

  it("inherits a valid global maximum after an invalid project maximum", () => {
    const global = writeLayer("global.json", { compress: { maxContextLimit: 300000 } });
    const project = writeLayer("project.json", { compress: { maxContextLimit: 0 } });
    const { config } = loadConfig(global, project);
    expect(config.compress.maxContextLimit).toBe(300000);
  });

  it("inherits a valid global per-model entry after an invalid project override", () => {
    const global = writeLayer("global.json", {
      compress: { modelMaxLimits: { "provider/model": 400000 } },
    });
    const project = writeLayer("project.json", {
      compress: { modelMaxLimits: { "provider/model": "bogus" } },
    });
    const { config } = loadConfig(global, project);
    expect(config.compress.modelMaxLimits).toEqual({ "provider/model": 400000 });
  });

  it("warns for unknown keys with source-qualified pointers", () => {
    const global = writeLayer("global.json", {
      unknownTop: true,
      compress: { mode: "message", unknownNested: true },
    });
    const project = writeLayer("project.json", {
      strategies: { deduplication: { turnProtection: 5, unknownStrategy: true } },
    });
    const { config, warnings } = loadConfig(global, project);

    expect(warnings.some((w) => w.includes(`${global}#/unknownTop`))).toBe(true);
    expect(warnings.some((w) => w.includes(`${global}#/compress/unknownNested`))).toBe(true);
    expect(
      warnings.some((w) => w.includes(`${project}#/strategies/deduplication/unknownStrategy`)),
    ).toBe(true);

    expect("unknownTop" in config).toBe(false);
    expect("unknownNested" in config.compress).toBe(false);
    expect("unknownStrategy" in config.strategies.deduplication).toBe(false);

    expect(config.compress.mode).toBe("message");
    expect(config.strategies.deduplication.turnProtection).toBe(5);
  });

  it("escapes RFC 6901 pointer segments in warnings", () => {
    const file = writeLayer("global.json", { "a~b/c": true });
    const { warnings } = loadConfig(file);
    expect(warnings.some((w) => w.includes(`${file}#/a~0b~1c`))).toBe(true);
  });
});

describe("isDcpEnabledForModel", () => {
  it("matches disabled models exactly", () => {
    const config = {
      enabled: true,
      disabledModels: ["openai-codex/gpt-5.6-sol"],
    };

    expect(isDcpEnabledForModel(config, "openai-codex", "gpt-5.6-sol")).toBe(false);
    expect(isDcpEnabledForModel(config, "openai", "gpt-5.6-sol")).toBe(true);
    expect(isDcpEnabledForModel(config, "openai-codex", "gpt-5.6-terra")).toBe(true);
    expect(isDcpEnabledForModel(config, "OPENAI-CODEX", "gpt-5.6-sol")).toBe(true);
  });

  it("honors global disablement and treats missing identity as unmatched", () => {
    const config = {
      enabled: true,
      disabledModels: ["openai-codex/gpt-5.6-sol"],
    };

    expect(isDcpEnabledForModel(config, undefined, "gpt-5.6-sol")).toBe(true);
    expect(isDcpEnabledForModel(config, "openai-codex", undefined)).toBe(true);
    expect(isDcpEnabledForModel({ ...config, enabled: false }, "openai", "other")).toBe(false);
  });

  it.each([
    ["", "model", "/model"],
    ["provider", "", "provider/"],
  ])("matches present empty identity strings exactly", (provider, modelId, disabledModel) => {
    expect(
      isDcpEnabledForModel({ enabled: true, disabledModels: [disabledModel] }, provider, modelId),
    ).toBe(false);
  });
});

describe("BASE_PROTECTED_TOOLS", () => {
  it('includes "subagent"', () => {
    expect(BASE_PROTECTED_TOOLS).toContain("subagent");
  });
});

describe("configuration schema", () => {
  it("rejects unknown properties in declared configuration objects", () => {
    expect(DcpConfigSchema).toMatchObject({ additionalProperties: false });
    expect(CompressConfigSchema).toMatchObject({ additionalProperties: false });
  });
});
