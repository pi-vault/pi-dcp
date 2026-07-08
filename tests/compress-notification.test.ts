import { describe, it, expect } from "vitest";
import {
  buildCompressNotificationMinimal,
  buildCompressNotificationDetailed,
} from "../src/ui/notification.ts";

describe("compression notification", () => {
  it("minimal: shows tokens and message count", () => {
    const msg = buildCompressNotificationMinimal({
      compressedTokens: 12400,
      summaryTokens: 2100,
      messagesCompressed: 5,
      topic: "Auth System",
    });
    expect(msg).toContain("~12.4K");
    expect(msg).toContain("~2.1K");
    expect(msg).toContain("5 messages");
  });

  it("minimal: singular message", () => {
    const msg = buildCompressNotificationMinimal({
      compressedTokens: 500,
      summaryTokens: 100,
      messagesCompressed: 1,
      topic: "Setup",
    });
    expect(msg).toContain("1 message");
    expect(msg).not.toContain("1 messages");
  });

  it("detailed: includes topic", () => {
    const msg = buildCompressNotificationDetailed({
      compressedTokens: 12400,
      summaryTokens: 2100,
      messagesCompressed: 5,
      topic: "Auth System",
    });
    expect(msg).toContain("Auth System");
    expect(msg).toContain("~12.4K");
  });

  it("detailed: includes summary when showCompression is true", () => {
    const msg = buildCompressNotificationDetailed({
      compressedTokens: 12400,
      summaryTokens: 2100,
      messagesCompressed: 5,
      topic: "Auth System",
      summary: "User explored authentication flows and decided on JWT.",
      showCompression: true,
    });
    expect(msg).toContain("Auth System");
    expect(msg).toContain("JWT");
  });

  it("detailed: omits summary when showCompression is false", () => {
    const msg = buildCompressNotificationDetailed({
      compressedTokens: 12400,
      summaryTokens: 2100,
      messagesCompressed: 5,
      topic: "Auth System",
      summary: "User explored authentication flows and decided on JWT.",
      showCompression: false,
    });
    expect(msg).toContain("Auth System");
    expect(msg).not.toContain("JWT");
  });

  it("detailed: omits summary when showCompression not provided", () => {
    const msg = buildCompressNotificationDetailed({
      compressedTokens: 12400,
      summaryTokens: 2100,
      messagesCompressed: 5,
      topic: "Auth System",
      summary: "User explored authentication flows.",
    });
    expect(msg).not.toContain("authentication flows");
  });
});
