import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, BASE_PROTECTED_TOOLS } from "../src/config.ts";

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
    expect(config.strategies.deduplication.enabled).toBe(true);
    expect(config.strategies.deduplication.turnProtection).toBe(0);
    expect(config.strategies.purgeErrors.enabled).toBe(true);
    expect(config.nudgeNotification).toBe("minimal");
    expect(config.nudgeNotificationType).toBe("status");
    expect(config.experimental.allowSubAgents).toBe(false);
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

    const { config } = loadConfig(configPath);
    expect(config.compress.maxContextPercent).toBeGreaterThan(
      config.compress.minContextPercent,
    );
  });

  it("parses nudgeNotificationType toast", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, JSON.stringify({ nudgeNotificationType: "toast" }));
    const { config } = loadConfig(configPath);
    expect(config.nudgeNotificationType).toBe("toast");
  });

  it("parses experimental.allowSubAgents", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ experimental: { allowSubAgents: true } }),
    );
    const { config } = loadConfig(configPath);
    expect(config.experimental.allowSubAgents).toBe(true);
  });

  it("parses showCompression true", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ compress: { showCompression: true } }),
    );
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
    fs.writeFileSync(
      configPath,
      JSON.stringify({ enabled: true, debug: false }),
    );
    const { warnings } = loadConfig(configPath);
    expect(warnings).toHaveLength(0);
  });

  it("warns when maxContextPercent exceeds 100", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ compress: { maxContextPercent: 150 } }),
    );
    const { config, warnings } = loadConfig(configPath);
    expect(warnings.some((w) => w.includes("maxContextPercent"))).toBe(true);
    expect(config.compress.maxContextPercent).toBe(80); // reset to default
  });

  it("warns about invalid enum values", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ nudgeNotificationType: "popup" }),
    );
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
