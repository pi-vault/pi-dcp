import { beforeEach, describe, it, expect } from "vitest";
import { handleCompress } from "../src/compress/handler.ts";
import { createSessionState } from "../src/state/state.ts";
import {
  buildCompressNotificationMinimal,
  buildCompressNotificationDetailed,
} from "../src/ui/notification.ts";
import {
  makeUserMessage,
  makeAssistantMessage,
  makeDefaultConfig,
  resetTestTimestamp,
} from "./helpers.ts";

describe("showCompression integration", () => {
  beforeEach(() => {
    resetTestTimestamp();
  });

  function compressAndNotify(showCompression: boolean) {
    const state = createSessionState();
    const config = makeDefaultConfig({ showCompression });
    const messages = [
      makeUserMessage("hello"),
      makeAssistantMessage("world"),
      makeUserMessage("more"),
    ];

    // Assign message IDs
    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(1, "m0002");
    state.messageIds.byIndex.set(2, "m0003");

    // Populate token counts for savings reporting
    state.prune.messages.byMessageIndex.set(0, { tokenCount: 50, blockIds: [], activeBlockIds: [] });
    state.prune.messages.byMessageIndex.set(1, { tokenCount: 50, blockIds: [], activeBlockIds: [] });

    const result = handleCompress(state, config, messages, {
      topic: "Setup",
      mode: "range",
      content: [
        {
          startId: "m0001",
          endId: "m0002",
          summary: "Initial setup discussion",
        },
      ],
    });

    // Build summary from blocks (strip delimiters)
    const summary = result.blockIds
      .map((id) => {
        const block = state.prune.messages.blocksById.get(id);
        return (
          block?.summary
            ?.replace(/^\[Compressed Block b\d+\]\n/, "")
            .replace(/\n\[End Block b\d+\]$/, "") ?? ""
        );
      })
      .filter(Boolean)
      .join("\n\n");

    const notifParams = {
      compressedTokens: result.compressedTokens,
      summaryTokens: result.summaryTokens,
      messagesCompressed: result.messagesCompressed,
      topic: result.topic,
      summary,
      showCompression,
    };

    return {
      result,
      state,
      minimal: buildCompressNotificationMinimal(notifParams),
      detailed: buildCompressNotificationDetailed(notifParams),
    };
  }

  it("returns structured CompressResult", () => {
    const { result } = compressAndNotify(false);
    expect(result.messagesCompressed).toBe(2);
    expect(result.blockIds).toHaveLength(1);
    expect(result.topic).toBe("Setup");
    expect(result.text).toContain("Compressed 2 messages");
  });

  it("increments messagesCompressed stat", () => {
    const { state } = compressAndNotify(false);
    expect(state.stats.messagesCompressed).toBe(2);
  });

  it("minimal notification excludes summary regardless", () => {
    const { minimal } = compressAndNotify(true);
    expect(minimal).toContain("DCP:");
    expect(minimal).not.toContain("Initial setup");
  });

  it("detailed notification includes summary when showCompression=true", () => {
    const { detailed } = compressAndNotify(true);
    expect(detailed).toContain("Setup");
    expect(detailed).toContain("Initial setup");
  });

  it("detailed notification excludes summary when showCompression=false", () => {
    const { detailed } = compressAndNotify(false);
    expect(detailed).toContain("Setup");
    expect(detailed).not.toContain("Initial setup");
  });
});
