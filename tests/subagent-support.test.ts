import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseChildSessionResults } from "../src/subagents/subagent-results.ts";

describe("parseChildSessionResults", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-subagent-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("extracts assistant message text from jsonl session file", async () => {
    const sessionFile = path.join(tempDir, "session.jsonl");
    const entries = [
      JSON.stringify({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "Do task" }] },
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I completed the task. Result: OK" }],
        },
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Final summary here" }],
        },
      }),
    ];
    fs.writeFileSync(sessionFile, entries.join("\n"));

    const result = await parseChildSessionResults(sessionFile);
    expect(result).toContain("I completed the task. Result: OK");
    expect(result).toContain("Final summary here");
  });

  it("returns empty string for non-existent file", async () => {
    const result = await parseChildSessionResults("/nonexistent/path.jsonl");
    expect(result).toBe("");
  });

  it("skips non-assistant entries", async () => {
    const sessionFile = path.join(tempDir, "session.jsonl");
    const entries = [
      JSON.stringify({
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "User msg" }],
        },
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Result" }],
        },
      }),
      JSON.stringify({ type: "tool_call", toolName: "read" }),
    ];
    fs.writeFileSync(sessionFile, entries.join("\n"));

    const result = await parseChildSessionResults(sessionFile);
    expect(result).toBe("Result");
    expect(result).not.toContain("User msg");
  });

  it("handles malformed JSON lines gracefully", async () => {
    const sessionFile = path.join(tempDir, "session.jsonl");
    const entries = [
      "not valid json",
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Good line" }],
        },
      }),
    ];
    fs.writeFileSync(sessionFile, entries.join("\n"));

    const result = await parseChildSessionResults(sessionFile);
    expect(result).toBe("Good line");
  });

  it("handles string content (non-array)", async () => {
    const sessionFile = path.join(tempDir, "session.jsonl");
    const entries = [
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: "Plain string content",
        },
      }),
    ];
    fs.writeFileSync(sessionFile, entries.join("\n"));

    const result = await parseChildSessionResults(sessionFile);
    expect(result).toBe("Plain string content");
  });

  it("handles empty file", async () => {
    const sessionFile = path.join(tempDir, "session.jsonl");
    fs.writeFileSync(sessionFile, "");

    const result = await parseChildSessionResults(sessionFile);
    expect(result).toBe("");
  });
});
