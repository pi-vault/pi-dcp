import { describe, expect, it } from "vitest";
import { flattenDcpLabel, formatDcpTokens } from "../src/tui/formatters.ts";

describe("formatDcpTokens", () => {
  it.each([
    [0, false, "0"],
    [0, true, "~0"],
    [999, false, "999"],
    [999.9, false, "999"],
    [1_000, false, "1k"],
    [1_050, false, "1.1k"],
    [12_400, true, "~12.4k"],
    [156_000, false, "156k"],
    [999_999, false, "1000k"],
    [1_000_000, false, "1M"],
    [1_250_000, true, "~1.3M"],
  ])("formats %d (estimated=%s) as %s", (tokens, estimated, expected) => {
    expect(formatDcpTokens(tokens, estimated)).toBe(expected);
  });

  it("does not add an estimate marker by default", () => {
    expect(formatDcpTokens(12_400)).toBe("12.4k");
  });
});

describe("flattenDcpLabel", () => {
  it.each([
    ["  Auth\r\n\t system  ", "Auth system"],
    ["\t\n", ""],
    [" 認証\n system ", "認証 system"],
    ["multiple   spaces", "multiple spaces"],
  ])("flattens %j to %j", (value, expected) => {
    expect(flattenDcpLabel(value)).toBe(expected);
  });
});
