import { describe, it, expect } from "vitest";
import {
  buildCompressNotificationMinimal,
  buildCompressNotificationDetailed,
} from "../src/tui/notification.ts";

describe("compression notification", () => {
  it.each([
    [12_400, 2_100, 5, "DCP · compressed ~12.4k tokens · summary ~2.1k · 5 messages"],
    [1, 1, 1, "DCP · compressed ~1 token · summary ~1 · 1 message"],
  ])(
    "minimal: compressed %d, summary %d, messages %d",
    (compressedTokens, summaryTokens, messagesCompressed, expected) => {
      expect(
        buildCompressNotificationMinimal({
          compressedTokens,
          summaryTokens,
          messagesCompressed,
          topic: "Auth System",
        }),
      ).toBe(expected);
    },
  );

  it("minimal: reports metrics even for zero messages", () => {
    expect(
      buildCompressNotificationMinimal({
        compressedTokens: 0,
        summaryTokens: 0,
        messagesCompressed: 0,
        topic: "Auth System",
      }),
    ).toBe("DCP · compressed ~0 tokens · summary ~0 · 0 messages");
  });

  it("detailed: appends the flattened topic", () => {
    const msg = buildCompressNotificationDetailed({
      compressedTokens: 12_400,
      summaryTokens: 2_100,
      messagesCompressed: 5,
      topic: "  Auth\r\n\t system ",
    });
    expect(msg).toBe(
      "DCP · compressed ~12.4k tokens · summary ~2.1k · 5 messages\nTopic: Auth system",
    );
  });

  it("detailed: includes the multiline summary verbatim when showCompression is true", () => {
    const msg = buildCompressNotificationDetailed({
      compressedTokens: 12_400,
      summaryTokens: 2_100,
      messagesCompressed: 5,
      topic: "Auth System",
      summary: "First line\nsecond line",
      showCompression: true,
    });
    expect(msg).toBe(
      "DCP · compressed ~12.4k tokens · summary ~2.1k · 5 messages\nTopic: Auth System\nSummary (~2.1k): First line\nsecond line",
    );
  });

  it("detailed: omits summary when showCompression is false", () => {
    const msg = buildCompressNotificationDetailed({
      compressedTokens: 12_400,
      summaryTokens: 2_100,
      messagesCompressed: 5,
      topic: "Auth System",
      summary: "User explored authentication flows and decided on JWT.",
      showCompression: false,
    });
    expect(msg).toBe(
      "DCP · compressed ~12.4k tokens · summary ~2.1k · 5 messages\nTopic: Auth System",
    );
  });

  it("detailed: omits summary when showCompression is omitted", () => {
    const msg = buildCompressNotificationDetailed({
      compressedTokens: 12_400,
      summaryTokens: 2_100,
      messagesCompressed: 5,
      topic: "Auth System",
      summary: "User explored authentication flows.",
    });
    expect(msg).not.toContain("Summary (");
  });

  it("detailed: omits summary when showCompression is true but summary is empty", () => {
    const msg = buildCompressNotificationDetailed({
      compressedTokens: 12_400,
      summaryTokens: 2_100,
      messagesCompressed: 5,
      topic: "Auth System",
      summary: "",
      showCompression: true,
    });
    expect(msg).not.toContain("Summary (");
  });
});
