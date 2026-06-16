import { describe, expect, it } from "vitest";
import { handleCompress } from "../src/compress/handler.ts";
import { createSessionState } from "../src/state/state.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { makeDefaultConfig } from "./helpers.ts";

describe("handleCompress (range mode)", () => {
  it("compresses a valid range", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    // Assign message refs (both forward and reverse maps)
    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byRef.set("m0001", 0);
    state.messageIds.byIndex.set(1, "m0002");
    state.messageIds.byRef.set("m0002", 1);
    state.messageIds.byIndex.set(2, "m0003");
    state.messageIds.byRef.set("m0003", 2);
    state.messageIds.byIndex.set(3, "m0004");
    state.messageIds.byRef.set("m0004", 3);
    state.messageIds.nextRefIndex = 5;

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 0 } as AgentMessage,
      { role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: 0 } as unknown as AgentMessage,
      { role: "user", content: [{ type: "text", text: "do stuff" }], timestamp: 0 } as AgentMessage,
      { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 0 } as unknown as AgentMessage,
    ];

    const result = handleCompress(state, config, messages, {
      topic: "Initial greeting",
      content: [
        { startId: "m0001", endId: "m0002", summary: "User greeted, assistant responded" },
      ],
      mode: "range",
    });

    expect(result).toContain("Compressed");
    expect(state.prune.messages.blocksById.size).toBe(1);
    expect(state.prune.messages.activeBlockIds.size).toBe(1);
  });

  it("throws for invalid boundary IDs", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [];

    expect(() =>
      handleCompress(state, config, messages, {
        topic: "test",
        content: [{ startId: "invalid", endId: "m0001", summary: "text" }],
        mode: "range",
      })
    ).toThrow();
  });

  it("throws when content array is empty", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [];

    expect(() =>
      handleCompress(state, config, messages, {
        topic: "test",
        content: [],
        mode: "range",
      })
    ).toThrow();
  });
});
