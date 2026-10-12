import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { registerDcpCommands } from "../src/commands/register.ts";
import * as sweepModule from "../src/commands/sweep.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";
import { createExtensionHarness } from "./extension-harness.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

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
    registerDcpCommands(mockPi as unknown as ExtensionAPI, state, config, () => {});

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
    expect(registered).toContain("dcp");
    expect(registered).toHaveLength(11);
  });

  it("rejects every mutating command for a disabled model", async () => {
    const disabledModel = { provider: "openai-codex", id: "gpt-5.6-sol" };
    const config = {
      ...makeDefaultConfig(),
      disabledModels: ["openai-codex/gpt-5.6-sol"],
    };
    const state = createSessionState();
    type Command = {
      handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    };
    const commands = new Map<string, Command>();
    const sendMessage = vi.fn();
    const onStateChange = vi.fn();
    const notify = vi.fn();
    const pi = {
      registerCommand(name: string, command: Command) {
        commands.set(name, command);
      },
      sendMessage,
    };
    registerDcpCommands(pi as unknown as ExtensionAPI, state, config, onStateChange);
    const ctx = {
      model: disabledModel,
      getContextUsage: () => undefined,
      ui: { notify },
    } as unknown as ExtensionCommandContext;

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

describe("guarded command callback characterization", () => {
  interface Attempt {
    command: string;
    args: string;
    message: string;
  }

  const cases: Array<{ name: string; attempts: Attempt[] }> = [
    {
      name: "manual query",
      attempts: [{ command: "dcp:manual", args: "", message: "Manual mode: off" }],
    },
    {
      name: "invalid manual input",
      attempts: [{ command: "dcp:manual", args: "invalid", message: "Usage: dcp:manual [on|off]" }],
    },
    {
      name: "repeated on",
      attempts: [
        {
          command: "dcp:manual",
          args: "on",
          message: "Manual mode: on. Automatic compression is paused.",
        },
        {
          command: "dcp:manual",
          args: "on",
          message: "Manual mode: on. Automatic compression is paused.",
        },
      ],
    },
    {
      name: "empty sweep",
      attempts: [
        {
          command: "dcp:sweep",
          args: "",
          message: "Sweep complete: 0 tool outputs pruned, ~0 tokens saved.",
        },
      ],
    },
    {
      name: "permission cycle",
      attempts: [{ command: "dcp:permission", args: "", message: "Compress permission: ask" }],
    },
    {
      name: "invalid and missing block arguments",
      attempts: [
        { command: "dcp:decompress", args: "", message: "Usage: dcp:decompress <blockId>" },
        { command: "dcp:recompress", args: "", message: "Usage: dcp:recompress <blockId>" },
        { command: "dcp:decompress", args: "invalid", message: "Invalid block ID: invalid" },
        { command: "dcp:decompress", args: "99", message: "Block 99 not found." },
        { command: "dcp:recompress", args: "99", message: "Block 99 not found." },
      ],
    },
  ];

  it.each(cases)(
    "calls back once with the original context after permitted $name attempts",
    async ({ attempts }) => {
      const harness = createExtensionHarness();
      const state = createSessionState();
      const config = makeDefaultConfig();
      const onStateChange = vi.fn();
      registerDcpCommands(harness.api, state, config, onStateChange);

      for (const attempt of attempts) {
        await harness.runCommand(attempt.command, attempt.args, harness.commandContext);
      }

      expect(onStateChange).toHaveBeenCalledTimes(attempts.length);
      for (const call of onStateChange.mock.calls) {
        expect(call[0]).toBe(harness.commandContext);
      }
      expect(harness.ui.notify).toHaveBeenCalledTimes(attempts.length);
      expect(harness.ui.notify.mock.calls.map(([message, type]) => [message, type])).toEqual(
        attempts.map((attempt) => [attempt.message, "info"]),
      );
      for (let index = 0; index < attempts.length; index++) {
        expect(onStateChange.mock.invocationCallOrder[index]).toBeLessThan(
          harness.ui.notify.mock.invocationCallOrder[index],
        );
      }
    },
  );
});

describe("guarded command error propagation", () => {
  it("propagates a sweep implementation error with no callback or notification", async () => {
    const harness = createExtensionHarness();
    const state = createSessionState();
    const config = makeDefaultConfig();
    const onStateChange = vi.fn();
    const sentinel = new Error("sweep implementation failed");
    vi.spyOn(sweepModule, "sweepCommand").mockImplementation(() => {
      throw sentinel;
    });
    registerDcpCommands(harness.api, state, config, onStateChange);

    let caught: unknown;
    try {
      await harness.runCommand("dcp:sweep", "", harness.commandContext);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(sentinel);
    expect(onStateChange).not.toHaveBeenCalled();
    expect(harness.ui.notify).not.toHaveBeenCalled();
  });

  it("propagates a callback error once with no notification", async () => {
    const harness = createExtensionHarness();
    const state = createSessionState();
    const config = makeDefaultConfig();
    const sentinel = new Error("callback failed");
    const onStateChange = vi.fn(() => {
      throw sentinel;
    });
    registerDcpCommands(harness.api, state, config, onStateChange);

    let caught: unknown;
    try {
      await harness.runCommand("dcp:manual", "on", harness.commandContext);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(sentinel);
    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(harness.ui.notify).not.toHaveBeenCalled();
  });
});
