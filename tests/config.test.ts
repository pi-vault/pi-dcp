import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, BASE_PROTECTED_TOOLS } from "../src/config.ts";

describe("config", () => {
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
    expect(config.strategies.deduplication.enabled).toBe(true);
    expect(config.strategies.purgeErrors.enabled).toBe(true);
  });

  it("loads config from file", () => {
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
    expect(config.enabled).toBe(true);
  });

  it("handles invalid JSON gracefully", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, "not valid json {{{");

    const { config } = loadConfig(configPath);
    expect(config.enabled).toBe(true);
  });

  it("ignores unknown keys", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        unknownKey: "value",
        compress: { mode: "range", unknownNested: true },
      }),
    );

    const { config } = loadConfig(configPath);
    expect(config.compress.mode).toBe("range");
  });

  it("validates numeric ranges", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        compress: { maxContextPercent: -5, nudgeFrequency: 0 },
      }),
    );

    const { config } = loadConfig(configPath);
    expect(config.compress.maxContextPercent).toBe(80);
    expect(config.compress.nudgeFrequency).toBe(5);
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

  it("defaults nudgeNotificationType to status", () => {
    const configPath = path.join(tempDir, "dcp.json");
    const { config } = loadConfig(configPath);
    expect(config.nudgeNotificationType).toBe("status");
  });

  it("ignores invalid nudgeNotificationType", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, JSON.stringify({ nudgeNotificationType: "popup" }));
    const { config } = loadConfig(configPath);
    expect(config.nudgeNotificationType).toBe("status");
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

  it("defaults experimental.allowSubAgents to false", () => {
    const configPath = path.join(tempDir, "dcp.json");
    const { config } = loadConfig(configPath);
    expect(config.experimental.allowSubAgents).toBe(false);
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

  it("warns about unknown top-level keys", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ enabled: true, unknownKey: "value", anotherBad: 123 }),
    );
    const { warnings } = loadConfig(configPath);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes("unknownKey"))).toBe(true);
    expect(warnings.some((w) => w.includes("anotherBad"))).toBe(true);
  });

  it("warns about unknown compress keys", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ compress: { mode: "range", badOption: true } }),
    );
    const { warnings } = loadConfig(configPath);
    expect(warnings.some((w) => w.includes("badOption"))).toBe(true);
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
});

describe("BASE_PROTECTED_TOOLS", () => {
  it('includes "subagent"', () => {
    expect(BASE_PROTECTED_TOOLS).toContain("subagent");
  });
});
