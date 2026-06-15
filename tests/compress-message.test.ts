import { describe, expect, it } from "vitest";
import { handleMessageCompress } from "../src/compress/message.ts";
import { createSessionState } from "../src/state/state.ts";
import { assignMessageRefs } from "../src/messages/inject.ts";
import {
  makeUserMessage,
  makeAssistantMessage,
  makeDefaultConfig,
} from "./helpers.ts";

describe("handleMessageCompress", () => {
  it("compresses targeted messages", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });
    const messages = [
      makeUserMessage("hello"),
      makeAssistantMessage("long response..."),
      makeUserMessage("next"),
    ];
    assignMessageRefs(state, messages);

    const result = handleMessageCompress(state, config, messages, {
      topic: "Greeting",
      targets: [
        { messageId: "m0001", summary: "User greeted" },
        { messageId: "m0002", summary: "Assistant responded with greeting" },
      ],
    });

    expect(result).toContain("Compressed 2 messages");
    expect(state.prune.messages.blocksById.size).toBe(2);

    // Verify blocks have mode "message" and startIndex === endIndex
    for (const [, block] of state.prune.messages.blocksById) {
      expect(block.mode).toBe("message");
      expect(block.startIndex).toBe(block.endIndex);
    }
  });

  it("throws for unknown message ID", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });
    const messages = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);

    expect(() =>
      handleMessageCompress(state, config, messages, {
        topic: "test",
        targets: [{ messageId: "m9999", summary: "text" }],
      }),
    ).toThrow("m9999 is not available. It may have been pruned or compressed.");
  });

  it("throws for empty targets array", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });

    expect(() =>
      handleMessageCompress(state, config, [], {
        topic: "test",
        targets: [],
      }),
    ).toThrow("targets array is required");
  });

  it("marks compressed messages in prune state", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });
    const messages = [makeUserMessage("hello"), makeAssistantMessage("world")];
    assignMessageRefs(state, messages);

    handleMessageCompress(state, config, messages, {
      topic: "test",
      targets: [{ messageId: "m0001", summary: "User said hello" }],
    });

    const entry = state.prune.messages.byMessageIndex.get(0);
    expect(entry).toBeDefined();
    expect(entry!.activeBlockIds.length).toBeGreaterThan(0);
  });
});
