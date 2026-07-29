import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, BASE_PROTECTED_TOOLS, DEFAULT_CONFIG } from "../src/config.ts";

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

    expect(loadConfig(configPath).config.compress.protectedTools).toEqual(["compress"]);
  });

  it("does not merge prototype mutation keys", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, '{"__proto__":{"dcpPolluted":true}}');

    try {
      loadConfig(configPath);
      expect(({} as Record<string, unknown>).dcpPolluted).toBeUndefined();
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
    expect(warnings.some((w) => w.includes("maxContextPercent"))).toBe(true);
    expect(config.compress.maxContextPercent).toBe(80); // reset to default
  });

  it("warns about invalid enum values", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, JSON.stringify({ nudgeNotificationType: "popup" }));
    const { config, warnings } = loadConfig(configPath);
    expect(warnings.length).toBeGreaterThan(0);
    expect(config.nudgeNotificationType).toBe("status"); // reset to default
  });
});

describe("BASE_PROTECTED_TOOLS", () => {
  it('includes "subagent"', () => {
    expect(BASE_PROTECTED_TOOLS).toContain("subagent");
  });
});
