import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { compressCommand } from "../src/commands/compress.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";

describe("compressCommand", () => {
  it("sends a hidden generic follow-up", () => {
    const sendMessage = vi.fn();

    const message = compressCommand(
      { sendMessage } as unknown as ExtensionAPI,
      createSessionState(),
      makeDefaultConfig(),
      "",
    );

    expect(message).toBe("Compression triggered.");
    expect(sendMessage).toHaveBeenCalledWith(
      {
        customType: "dcp-compress-trigger",
        content:
          "Run the compress tool now on stale, completed context. Preserve details needed for active work.",
        display: false,
      },
      { triggerTurn: true, deliverAs: "followUp" },
    );
  });

  it("trims and includes focus", () => {
    const sendMessage = vi.fn();

    compressCommand(
      { sendMessage } as unknown as ExtensionAPI,
      createSessionState(),
      makeDefaultConfig(),
      "  database migrations  ",
    );

    expect(sendMessage.mock.calls[0][0].content).toContain(
      "Focus especially on: database migrations",
    );
  });

  it("does not send when disabled or denied", () => {
    const sendMessage = vi.fn();
    const state = createSessionState();
    state.compressPermission = "deny";

    expect(
      compressCommand(
        { sendMessage } as unknown as ExtensionAPI,
        state,
        makeDefaultConfig(),
        "focus",
      ),
    ).toBe("Compression is denied by configuration.");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(
      compressCommand(
        { sendMessage } as unknown as ExtensionAPI,
        createSessionState(),
        { ...makeDefaultConfig(), enabled: false },
        "focus",
      ),
    ).toBe("DCP is disabled by configuration.");
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
