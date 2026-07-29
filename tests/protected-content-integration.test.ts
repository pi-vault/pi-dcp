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

function assignRefs(state: ReturnType<typeof createSessionState>, count: number): void {
  for (let index = 0; index < count; index++) {
    const ref = `m${String(index + 1).padStart(4, "0")}`;
    state.messageIds.byIndex.set(index, ref);
    state.messageIds.byRef.set(ref, `message:${index}`);
  }
}

describe("handleCompress with protected content", () => {
  it("enriches summary with protected user messages when enabled", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ protectUserMessages: true });

    assignRefs(state, 2);
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

    assignRefs(state, 2);
    state.messageIds.nextRefIndex = 3;

    const messages: AgentMessage[] = [
      makeUserMessage("Normal <protect>critical secret</protect> text"),
      makeAssistantMessage("Noted"),
    ];

    handleCompress(state, config, messages, "compress-call-1", {
      topic: "test",
      content: [{ startId: "m0001", endId: "m0002", summary: "Exchange summary" }],
      mode: "range",
    });

    const block = [...state.prune.messages.blocksById.values()][0];
    expect(block.summary).toContain("[Protected Content]");
    expect(block.summary).toContain("critical secret");
  });

  it("enriches summary with protected tool outputs when protectedTools set", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ protectedTools: ["read"] });

    assignRefs(state, 3);
    state.messageIds.nextRefIndex = 4;

    const messages: AgentMessage[] = [
      makeUserMessage("read the file"),
      makeToolResultMessage("c1", "read", "file content here"),
      makeAssistantMessage("Here is the content"),
    ];

    handleCompress(state, config, messages, "compress-call-1", {
      topic: "test",
      content: [{ startId: "m0001", endId: "m0003", summary: "Read file" }],
      mode: "range",
    });

    const block = [...state.prune.messages.blocksById.values()][0];
    expect(block.summary).toContain("[Protected Tool Output: read]");
    expect(block.summary).toContain("file content here");
  });

  it("does not enrich when protection flags are off (default)", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    assignRefs(state, 2);
    state.messageIds.nextRefIndex = 3;

    const messages: AgentMessage[] = [
      makeUserMessage("Regular message"),
      makeAssistantMessage("Reply"),
    ];

    handleCompress(state, config, messages, "compress-call-1", {
      topic: "test",
      content: [{ startId: "m0001", endId: "m0002", summary: "Basic summary" }],
      mode: "range",
    });

    const block = [...state.prune.messages.blocksById.values()][0];
    expect(block.summary).not.toContain("[Protected");
  });
});
