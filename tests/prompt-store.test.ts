import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PromptStore, writeDefaultPrompts } from "../src/prompts/store.ts";

describe("PromptStore", () => {
  let tempDir: string;
  let projectDir: string;
  let globalDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-prompts-test-"));
    projectDir = path.join(
      tempDir,
      "project",
      ".pi",
      "dcp-prompts",
      "overrides",
    );
    globalDir = path.join(tempDir, "global", "overrides");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns bundled defaults when no override files exist", () => {
    const store = new PromptStore({
      projectOverrideDir: projectDir,
      globalOverrideDir: globalDir,
    });
    store.reload();
    const prompts = store.getRuntimePrompts();

    expect(prompts.system).toContain("context-constrained environment");
    expect(prompts.contextLimitNudge).toContain("CRITICAL WARNING");
    expect(prompts.turnNudge).toContain("Evaluate the conversation");
    expect(prompts.iterationNudge).toContain("iterating for a while");
  });

  it("project override takes precedence over global", () => {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, "system.md"), "Global system prompt");
    fs.writeFileSync(
      path.join(projectDir, "system.md"),
      "Project system prompt",
    );

    const store = new PromptStore({
      projectOverrideDir: projectDir,
      globalOverrideDir: globalDir,
    });
    store.reload();

    expect(store.getRuntimePrompts().system).toBe("Project system prompt");
  });

  it("global override used when no project override exists", () => {
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, "turn-nudge.md"),
      "Custom turn nudge",
    );

    const store = new PromptStore({
      projectOverrideDir: projectDir,
      globalOverrideDir: globalDir,
    });
    store.reload();

    expect(store.getRuntimePrompts().turnNudge).toBe("Custom turn nudge");
    // Other prompts remain default
    expect(store.getRuntimePrompts().system).toContain("context-constrained");
  });

  it("strips HTML comments from override files", () => {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "system.md"),
      "Prompt <!-- comment --> text",
    );

    const store = new PromptStore({
      projectOverrideDir: projectDir,
      globalOverrideDir: globalDir,
    });
    store.reload();

    expect(store.getRuntimePrompts().system).toBe("Prompt  text");
  });

  it("falls back to default for empty override files", () => {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "system.md"), "   ");

    const store = new PromptStore({
      projectOverrideDir: projectDir,
      globalOverrideDir: globalDir,
    });
    store.reload();

    expect(store.getRuntimePrompts().system).toContain("context-constrained");
  });

  it("hot-reloads on subsequent reload() calls", () => {
    fs.mkdirSync(projectDir, { recursive: true });
    const store = new PromptStore({
      projectOverrideDir: projectDir,
      globalOverrideDir: globalDir,
    });

    store.reload();
    expect(store.getRuntimePrompts().system).toContain("context-constrained");

    fs.writeFileSync(path.join(projectDir, "system.md"), "Updated prompt");
    store.reload();
    expect(store.getRuntimePrompts().system).toBe("Updated prompt");
  });
});

describe("writeDefaultPrompts", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-defaults-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes all default prompt files to target directory", () => {
    const targetDir = path.join(tempDir, "defaults");
    writeDefaultPrompts(targetDir);

    expect(fs.existsSync(path.join(targetDir, "system.md"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "context-limit-nudge.md"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "turn-nudge.md"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "iteration-nudge.md"))).toBe(true);

    const systemContent = fs.readFileSync(path.join(targetDir, "system.md"), "utf-8");
    expect(systemContent).toContain("context-constrained environment");
  });

  it("does not overwrite existing files", () => {
    const targetDir = path.join(tempDir, "defaults");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, "system.md"), "User customized");

    writeDefaultPrompts(targetDir);

    const content = fs.readFileSync(path.join(targetDir, "system.md"), "utf-8");
    expect(content).toBe("User customized");
  });
});
