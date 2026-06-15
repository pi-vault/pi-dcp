import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Logger } from "../src/logger.ts";

describe("Logger", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-logger-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not write when disabled", () => {
    const logger = new Logger(false, tempDir);
    logger.info("test", "should not appear");
    const files = fs.readdirSync(tempDir, { recursive: true });
    expect(files).toHaveLength(0);
  });

  it("writes log line when enabled", () => {
    const logger = new Logger(true, tempDir);
    logger.info("test-source", "hello world");

    const logFiles = fs.readdirSync(tempDir);
    expect(logFiles).toHaveLength(1);

    const content = fs.readFileSync(path.join(tempDir, logFiles[0]), "utf-8");
    expect(content).toContain("INFO");
    expect(content).toContain("test-source");
    expect(content).toContain("hello world");
  });

  it("formats key-value data", () => {
    const logger = new Logger(true, tempDir);
    logger.info("src", "msg", { count: 5, name: "foo" });

    const logFiles = fs.readdirSync(tempDir);
    const content = fs.readFileSync(path.join(tempDir, logFiles[0]), "utf-8");
    expect(content).toContain("count=5");
    expect(content).toContain('name="foo"');
  });
});
