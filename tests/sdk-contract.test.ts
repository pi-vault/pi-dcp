import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import createExtension from "../src/index.ts";

const FAKE_MODEL = {
  provider: "test",
  id: "test-model",
  name: "Test Model",
  api: "openai-completions",
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
  reasoning: false,
};

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const sessions: AgentSession[] = [];
const tempDirs: string[] = [];

async function createHostSession(
  options: { tools?: string[]; excludeTools?: string[]; noTools?: "all" | "builtin" } = {},
): Promise<{ session: AgentSession; agentDir: string }> {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-sdk-contract-"));
  tempDirs.push(agentDir);
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd: agentDir,
    agentDir,
    settingsManager,
    extensionFactories: [{ name: "dcp", factory: createExtension }],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: agentDir,
    agentDir,
    model: FAKE_MODEL as never,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
    ...options,
  });
  sessions.push(session);
  // `createAgentSession` does not bind UI/command context, so the host normally
  // emits session_start from its runtime. Emit it through the public runner.
  await session.extensionRunner.emit({ type: "session_start", reason: "new" });
  return { session, agentDir };
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
});

describe("DCP public SDK contract", () => {
  it("activates the early-registered compress tool for a fresh default session", async () => {
    const { session } = await createHostSession();

    expect(session.getActiveToolNames()).toContain("compress");
  });

  it("keeps a host-selected inactive compress tool inactive across reload", async () => {
    const { session } = await createHostSession({ tools: ["read"] });

    expect(session.getActiveToolNames()).not.toContain("compress");
    expect(session.getAllTools().some((tool) => tool.name === "compress")).toBe(false);

    await session.reload();
    expect(session.getActiveToolNames()).not.toContain("compress");
  });

  it.each([
    { name: "allowlist", options: { tools: ["read"] } },
    { name: "denylist", options: { excludeTools: ["compress"] } },
    { name: "noTools all", options: { noTools: "all" as const } },
  ])("respects a host $name exclusion", async ({ name: _name, options }) => {
    const { session } = await createHostSession(options);

    expect(session.getActiveToolNames()).not.toContain("compress");
    expect(session.getAllTools().some((tool) => tool.name === "compress")).toBe(false);
  });

  it("sets the dcp system prompt section through the real extension runner", async () => {
    const { session, agentDir } = await createHostSession();
    const result = await session.extensionRunner.emitBeforeAgentStart("hello", undefined, {
      cwd: agentDir,
    });

    expect(result.systemPromptOptions.sections.dcp).toContain("compress");
  });

  it("omits the dcp section when the host excludes the tool", async () => {
    const { session, agentDir } = await createHostSession({ tools: ["read"] });
    const result = await session.extensionRunner.emitBeforeAgentStart("hello", undefined, {
      cwd: agentDir,
    });

    expect(result.systemPromptOptions.sections.dcp).toBeUndefined();
  });
});
