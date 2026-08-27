import { describe, expect, it, vi } from "vitest";
import { registerDcpCommands } from "../src/commands/register.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";

describe("registerDcpCommands", () => {
  it("requires the Phase 4 state-change callback", () => {
    expect(registerDcpCommands).toHaveLength(4);
  });

  it("registers all expected commands", () => {
    const registered: string[] = [];
    const mockPi = {
      registerCommand(name: string, _opts: unknown) {
        registered.push(name);
      },
    };

    const state = createSessionState();
    const config = makeDefaultConfig();
    registerDcpCommands(mockPi as any, state, config, () => {});

    expect(registered).toContain("dcp:help");
    expect(registered).toContain("dcp:context");
    expect(registered).toContain("dcp:stats");
    expect(registered).toContain("dcp:sweep");
    expect(registered).toContain("dcp:manual");
    expect(registered).toContain("dcp:decompress");
    expect(registered).toContain("dcp:recompress");
    expect(registered).toContain("dcp:lifetime");
    expect(registered).toContain("dcp:permission");
    expect(registered).toContain("dcp:compress");
    expect(registered).toHaveLength(10);
  });

  it("rejects every mutating command for a disabled model", async () => {
    const disabledModel = { provider: "openai-codex", id: "gpt-5.6-sol" };
    const config = {
      ...makeDefaultConfig(),
      disabledModels: ["openai-codex/gpt-5.6-sol"],
    };
    const state = createSessionState();
    const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
    const sendMessage = vi.fn();
    const onStateChange = vi.fn();
    const notify = vi.fn();
    const pi = {
      registerCommand(
        name: string,
        command: { handler: (args: string, ctx: any) => Promise<void> },
      ) {
        commands.set(name, command);
      },
      sendMessage,
    };
    registerDcpCommands(pi as any, state, config, onStateChange);
    const ctx = {
      model: disabledModel,
      getContextUsage: () => undefined,
      ui: { notify },
    };

    for (const name of [
      "dcp:compress",
      "dcp:sweep",
      "dcp:manual",
      "dcp:decompress",
      "dcp:recompress",
      "dcp:permission",
    ]) {
      await commands.get(name)?.handler("", ctx);
    }

    expect(sendMessage).not.toHaveBeenCalled();
    expect(onStateChange).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(6);
    expect(notify.mock.calls.map(([message]) => message)).toEqual(
      Array(6).fill("DCP is disabled for the current model."),
    );
  });
});
