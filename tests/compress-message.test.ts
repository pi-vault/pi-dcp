import { describe, expect, it } from "vitest";
import { handleCompress } from "../src/compress/handler.ts";
import { createSessionState } from "../src/state/state.ts";
import { assignMessageRefs } from "../src/messages/inject.ts";
import {
  makeUserMessage,
  makeAssistantMessage,
  makeDefaultConfig,
} from "./helpers.ts";

describe("handleCompress (message mode)", () => {
  it("compresses targeted messages", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });
    const messages = [
      makeUserMessage("hello"),
      makeAssistantMessage("long response..."),
      makeUserMessage("next"),
    ];
    assignMessageRefs(state, messages);

    const result = handleCompress(state, config, messages, {
      topic: "Greeting",
      targets: [
        { messageId: "m0001", summary: "User greeted" },
        { messageId: "m0002", summary: "Assistant responded with greeting" },
      ],
      mode: "message",
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
      handleCompress(state, config, messages, {
        topic: "test",
        targets: [{ messageId: "m9999", summary: "text" }],
        mode: "message",
      }),
    ).toThrow("m9999 is not available. It may have been pruned or compressed.");
  });

  it("throws for empty targets array", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });

    expect(() =>
      handleCompress(state, config, [], {
        topic: "test",
        targets: [],
        mode: "message",
      }),
    ).toThrow("targets array is required");
  });

  it("marks compressed messages in prune state", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });
    const messages = [makeUserMessage("hello"), makeAssistantMessage("world")];
    assignMessageRefs(state, messages);

    handleCompress(state, config, messages, {
      topic: "test",
      targets: [{ messageId: "m0001", summary: "User said hello" }],
      mode: "message",
    });

    const entry = state.prune.messages.byMessageIndex.get(0);
    expect(entry).toBeDefined();
    expect(entry!.activeBlockIds.length).toBeGreaterThan(0);
  });

  it("includes token savings in message mode", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });
    const messages = [makeUserMessage("hello"), makeAssistantMessage("world")];
    assignMessageRefs(state, messages);

    // Pre-populate token count for the target message
    state.prune.messages.byMessageIndex.set(0, { tokenCount: 120, blockIds: [], activeBlockIds: [] });

    const result = handleCompress(state, config, messages, {
      topic: "test",
      targets: [{ messageId: "m0001", summary: "greeting" }],
      mode: "message",
    });

    expect(result).toContain("~120 tokens");
    expect(result).toContain("Compressed 1 messages");
  });
});
