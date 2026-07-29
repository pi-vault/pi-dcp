import { describe, expect, it } from "vitest";
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
});
