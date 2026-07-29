import { describe, it, expect } from "vitest";
import { handleCompress } from "../src/compress/handler.ts";
import { createSessionState } from "../src/state/state.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  makeDefaultConfig,
  makeUserMessage,
  makeAssistantMessage,
  makeToolResultMessage,
} from "./helpers.ts";

describe("handleCompress with protected content", () => {
  it("enriches summary with protected user messages when enabled", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ protectUserMessages: true });

    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(1, "m0002");
    state.messageIds.nextRefIndex = 3;

    const messages: AgentMessage[] = [
      makeUserMessage("Remember this instruction"),
      makeAssistantMessage("Got it"),
    ];

    handleCompress(state, config, messages, "compress-call-1", {
      topic: "test",
      content: [
        {
          startId: "m0001",
          endId: "m0002",
          summary: "User gave instruction",
        },
      ],
      mode: "range",
    });

    const block = [...state.prune.messages.blocksById.values()][0];
    expect(block.summary).toContain("[Protected User Message]");
    expect(block.summary).toContain("Remember this instruction");
  });

  it("enriches summary with protect-tag content when enabled", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ protectTags: true });

    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(1, "m0002");
    state.messageIds.nextRefIndex = 3;

    const messages: AgentMessage[] = [
      makeUserMessage("Normal <protect>critical secret</protect> text"),
      makeAssistantMessage("Noted"),
    ];

    handleCompress(state, config, messages, "compress-call-1", {
      topic: "test",
      content: [
        { startId: "m0001", endId: "m0002", summary: "Exchange summary" },
      ],
      mode: "range",
    });

    const block = [...state.prune.messages.blocksById.values()][0];
    expect(block.summary).toContain("[Protected Content]");
    expect(block.summary).toContain("critical secret");
  });

  it("enriches summary with protected tool outputs when protectedTools set", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ protectedTools: ["read"] });

    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(1, "m0002");
    state.messageIds.byIndex.set(2, "m0003");
    state.messageIds.nextRefIndex = 4;

    const messages: AgentMessage[] = [
      makeUserMessage("read the file"),
      makeToolResultMessage("c1", "read", "file content here"),
      makeAssistantMessage("Here is the content"),
    ];

    handleCompress(state, config, messages, "compress-call-1", {
      topic: "test",
      content: [
        { startId: "m0001", endId: "m0003", summary: "Read file" },
      ],
      mode: "range",
    });

    const block = [...state.prune.messages.blocksById.values()][0];
    expect(block.summary).toContain("[Protected Tool Output: read]");
    expect(block.summary).toContain("file content here");
  });

  it("does not enrich when protection flags are off (default)", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(1, "m0002");
    state.messageIds.nextRefIndex = 3;

    const messages: AgentMessage[] = [
      makeUserMessage("Regular message"),
      makeAssistantMessage("Reply"),
    ];

    handleCompress(state, config, messages, "compress-call-1", {
      topic: "test",
      content: [
        { startId: "m0001", endId: "m0002", summary: "Basic summary" },
      ],
      mode: "range",
    });

    const block = [...state.prune.messages.blocksById.values()][0];
    expect(block.summary).not.toContain("[Protected");
  });
});
