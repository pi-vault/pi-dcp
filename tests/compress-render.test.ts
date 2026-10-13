import { afterEach, describe, expect, it } from "vitest";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
  createCompressionDisplayDetails,
  renderCompressCall,
  renderCompressResult,
} from "../src/tui/compress-render.ts";

interface SpyTheme {
  theme: Theme;
  fg: Array<[string, string]>;
  bg: Array<[string, string]>;
  bold: string[];
  inverse: string[];
}

function makeSpyTheme(): SpyTheme {
  const fg: Array<[string, string]> = [];
  const bg: Array<[string, string]> = [];
  const bold: string[] = [];
  const inverse: string[] = [];
  const theme = {
    fg: (color: string, text: string) => {
      fg.push([color, text]);
      return `\u001b[38;5;1m${text}\u001b[39m`;
    },
    bg: (color: string, text: string) => {
      bg.push([color, text]);
      return `\u001b[48;5;1m${text}\u001b[49m`;
    },
    bold: (text: string) => {
      bold.push(text);
      return `\u001b[1m${text}\u001b[22m`;
    },
    inverse: (text: string) => {
      inverse.push(text);
      return `\u001b[7m${text}\u001b[27m`;
    },
  } as unknown as Theme;
  return { theme, fg, bg, bold, inverse };
}

function visibleLines(component: { render(width: number): string[] }, width = 200): string[] {
  return component.render(width).map((line) => stripTerminalSequences(line).replace(/\s+$/, ""));
}

function visibleText(component: { render(width: number): string[] }, width = 200): string {
  return visibleLines(component, width).join("\n");
}

function makeResult(overrides: Partial<AgentToolResult<unknown>> = {}): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: "Original summary text" }],
    details: {},
    ...overrides,
  } as AgentToolResult<unknown>;
}

const metadata = {
  mode: "range" as const,
  topic: " Auth\n system ",
  messagesCompressed: 5,
  compressedTokens: 12_400,
  summaryTokens: 2_100,
  blockIds: [1, 2],
};

const successResult = makeResult({ details: { dcpCompression: metadata } });
const collapsed = { expanded: false, isPartial: false };
const expanded = { expanded: true, isPartial: false };

afterEach(() => {
  delete process.env.NO_COLOR;
});

describe("createCompressionDisplayDetails", () => {
  it("copies the exact result fields into display metadata", () => {
    const result = {
      text: "Compressed 5 messages into block.",
      messagesCompressed: 5,
      compressedTokens: 12_400,
      summaryTokens: 2_100,
      blockIds: [1, 2],
      topic: "Auth",
    };

    expect(createCompressionDisplayDetails("range", result).dcpCompression).toEqual({
      mode: "range",
      topic: "Auth",
      messagesCompressed: 5,
      compressedTokens: 12_400,
      summaryTokens: 2_100,
      blockIds: [1, 2],
    });
  });

  it("copies blockIds so later state mutation cannot change the result", () => {
    const result = {
      text: "text",
      messagesCompressed: 1,
      compressedTokens: 1,
      summaryTokens: 1,
      blockIds: [1, 2],
      topic: "Auth",
    };
    const details = createCompressionDisplayDetails("range", result);
    result.blockIds.push(3);

    expect(details.dcpCompression?.blockIds).toEqual([1, 2]);
  });

  it("does not include submitted or combined summary text", () => {
    const result = {
      text: "Compressed 1 messages into block.",
      messagesCompressed: 1,
      compressedTokens: 1,
      summaryTokens: 1,
      blockIds: [1],
      topic: "Auth",
    };
    const details = createCompressionDisplayDetails("message", result);

    const serialized = JSON.stringify(details);
    expect(serialized).not.toContain("private summary text");
    expect(serialized).not.toContain("Compressed 1 messages");
  });
});

describe("renderCompressCall", () => {
  const twoContent = [
    { startId: "m1", endId: "m2", summary: "SECRET ONE" },
    { startId: "m3", endId: "m4", summary: "SECRET TWO" },
  ];

  it.each<[string, "range" | "message", unknown, string]>([
    [
      "range with flattened topic and count",
      "range",
      { topic: " Auth\n system ", content: twoContent },
      "compress range · Auth system · 2 ranges",
    ],
    [
      "message with singular count",
      "message",
      { topic: "Auth", targets: [{ messageId: "m1", summary: "SECRET" }] },
      "compress message · Auth · 1 message",
    ],
    ["range with missing topic and content", "range", {}, "compress range"],
    [
      "message with whitespace topic and empty targets",
      "message",
      { topic: "   ", targets: [] },
      "compress message · 0 messages",
    ],
    [
      "range with singular count",
      "range",
      { topic: "One", content: [twoContent[0]] },
      "compress range · One · 1 range",
    ],
    [
      "message with plural count",
      "message",
      { topic: "Many", targets: [{ messageId: "m1" }, { messageId: "m2" }] },
      "compress message · Many · 2 messages",
    ],
  ])("renders %s", (_name, mode, args, expected) => {
    const { theme } = makeSpyTheme();
    expect(visibleText(renderCompressCall(mode, args, theme))).toBe(expected);
  });

  it("counts only the registered mode's array", () => {
    const { theme } = makeSpyTheme();

    expect(
      visibleText(
        renderCompressCall("range", { topic: "T", targets: [{ messageId: "m1" }] }, theme),
      ),
    ).toBe("compress range · T");
    expect(
      visibleText(renderCompressCall("message", { topic: "T", content: [twoContent[0]] }, theme)),
    ).toBe("compress message · T");
  });

  it("flattens Unicode topics", () => {
    const { theme } = makeSpyTheme();
    expect(
      visibleText(
        renderCompressCall(
          "range",
          { topic: "認証\n system ", content: [twoContent[0], twoContent[1]] },
          theme,
        ),
      ),
    ).toBe("compress range · 認証 system · 2 ranges");
  });

  it("never displays submitted summaries", () => {
    const { theme } = makeSpyTheme();
    const text = visibleText(
      renderCompressCall("range", { topic: "Auth", content: twoContent }, theme),
    );
    expect(text).not.toContain("SECRET");
  });

  it("uses the toolTitle, accent, text, and muted roles", () => {
    const spy = makeSpyTheme();
    renderCompressCall("range", { topic: "Auth", content: twoContent }, spy.theme);

    expect(spy.fg).toContainEqual(["toolTitle", "compress"]);
    expect(spy.bold).toHaveLength(1);
    expect(spy.fg).toContainEqual(["accent", "range"]);
    expect(spy.fg).toContainEqual(["text", "Auth"]);
    expect(spy.fg).toContainEqual(["muted", "2 ranges"]);
    expect(spy.fg.some(([role]) => role === "muted")).toBe(true);
  });

  it.each([1, 12, 60])("bounds every rendered line at width %d", (width) => {
    const { theme } = makeSpyTheme();
    const lines = renderCompressCall(
      "range",
      { topic: "Auth system", content: twoContent },
      theme,
    ).render(width);

    expect(lines).toHaveLength(1);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  });
});

describe("renderCompressResult", () => {
  it("renders the collapsed success header", () => {
    const { theme } = makeSpyTheme();
    expect(
      visibleText(renderCompressResult(successResult, collapsed, theme, { isError: false })),
    ).toBe("Range compression · Auth system · 5 messages · ~12.4k input · ~2.1k summary");
  });

  it("renders the expanded success header, original text, then blocks", () => {
    const { theme } = makeSpyTheme();
    const lines = visibleLines(
      renderCompressResult(successResult, expanded, theme, { isError: false }),
    );

    expect(lines).toEqual([
      "Range compression · Auth system · 5 messages · ~12.4k input · ~2.1k summary",
      "Original summary text",
      "Blocks: b1, b2",
    ]);
  });

  it("uses the toolTitle, accent, text, muted, and toolOutput roles", () => {
    const spy = makeSpyTheme();
    renderCompressResult(successResult, expanded, spy.theme, { isError: false });

    expect(spy.fg).toContainEqual(["toolTitle", "Range compression"]);
    expect(spy.fg).toContainEqual(["accent", "Auth system"]);
    expect(spy.fg).toContainEqual(["text", "5 messages"]);
    expect(spy.fg).toContainEqual(["text", "~12.4k input"]);
    expect(spy.fg).toContainEqual(["text", "~2.1k summary"]);
    expect(spy.fg).toContainEqual(["toolOutput", "Original summary text"]);
    expect(spy.fg).toContainEqual(["accent", "b1"]);
    expect(spy.fg).toContainEqual(["accent", "b2"]);
  });

  it("joins every text content item in source order", () => {
    const { theme } = makeSpyTheme();
    const result = makeResult({
      content: [
        { type: "text", text: "first line" },
        { type: "image", data: "ignored", mimeType: "image/png" },
        { type: "text", text: "second line" },
      ],
      details: { dcpCompression: metadata },
    } as AgentToolResult<unknown>);

    const lines = visibleLines(renderCompressResult(result, expanded, theme, { isError: false }));
    expect(lines.slice(1, 3)).toEqual(["first line", "second line"]);
  });

  it("omits the topic segment when flattened empty", () => {
    const { theme } = makeSpyTheme();
    const result = makeResult({
      details: { dcpCompression: { ...metadata, topic: "   " } },
    });

    expect(visibleText(renderCompressResult(result, collapsed, theme, { isError: false }))).toBe(
      "Range compression · 5 messages · ~12.4k input · ~2.1k summary",
    );
  });

  it("omits the blocks line when blockIds is empty", () => {
    const { theme } = makeSpyTheme();
    const result = makeResult({
      details: { dcpCompression: { ...metadata, blockIds: [] } },
    });

    const lines = visibleLines(renderCompressResult(result, expanded, theme, { isError: false }));
    expect(lines).toEqual([
      "Range compression · Auth system · 5 messages · ~12.4k input · ~2.1k summary",
      "Original summary text",
    ]);
  });

  it.each([
    [0, "0 messages"],
    [1, "1 message"],
    [5, "5 messages"],
  ])("renders %d as %s", (count, label) => {
    const { theme } = makeSpyTheme();
    const result = makeResult({
      details: { dcpCompression: { ...metadata, messagesCompressed: count } },
    });

    expect(visibleText(renderCompressResult(result, collapsed, theme, { isError: false }))).toBe(
      `Range compression · Auth system · ${label} · ~12.4k input · ~2.1k summary`,
    );
  });

  it("shows partial progress before inspecting metadata", () => {
    const { theme } = makeSpyTheme();
    const text = visibleText(
      renderCompressResult(successResult, { expanded: false, isPartial: true }, theme, {
        isError: false,
      }),
    );

    expect(text).toBe("Compression in progress");
    expect(text).not.toContain("~12.4k");
  });

  it("renders original text with the error role even with valid metadata", () => {
    const spy = makeSpyTheme();
    const text = visibleText(
      renderCompressResult(successResult, collapsed, spy.theme, { isError: true }),
    );

    expect(text).toBe("Original summary text");
    expect(text).not.toContain("~12.4k");
    expect(spy.fg.some(([role]) => role === "error")).toBe(true);
  });

  it("preserves all original lines for an expanded error", () => {
    const { theme } = makeSpyTheme();
    const result = makeResult({ content: [{ type: "text", text: "line one\nline two" }] });

    const lines = visibleLines(renderCompressResult(result, expanded, theme, { isError: true }));
    expect(lines).toEqual(["line one", "line two"]);
  });

  it("uses Compression failed when the error has no text", () => {
    const { theme } = makeSpyTheme();
    const result = makeResult({ content: [] });

    expect(visibleText(renderCompressResult(result, collapsed, theme, { isError: true }))).toBe(
      "Compression failed",
    );
  });

  it("renders original text with toolOutput when details are absent", () => {
    const spy = makeSpyTheme();
    const result = makeResult();

    expect(
      visibleText(renderCompressResult(result, collapsed, spy.theme, { isError: false })),
    ).toBe("Original summary text");
    expect(spy.fg.every(([role]) => role === "toolOutput")).toBe(true);
  });

  it("uses Compression result unavailable when legacy text is empty", () => {
    const { theme } = makeSpyTheme();
    const result = makeResult({ content: [] });

    expect(visibleText(renderCompressResult(result, collapsed, theme, { isError: false }))).toBe(
      "Compression result unavailable",
    );
  });

  it.each([
    [
      "bad mode",
      {
        mode: "other",
        topic: "T",
        messagesCompressed: 1,
        compressedTokens: 1,
        summaryTokens: 1,
        blockIds: [1],
      },
    ],
    [
      "non-string topic",
      {
        mode: "range",
        topic: 3,
        messagesCompressed: 1,
        compressedTokens: 1,
        summaryTokens: 1,
        blockIds: [1],
      },
    ],
    [
      "negative count",
      {
        mode: "range",
        topic: "T",
        messagesCompressed: -1,
        compressedTokens: 1,
        summaryTokens: 1,
        blockIds: [1],
      },
    ],
    [
      "non-finite count",
      {
        mode: "range",
        topic: "T",
        messagesCompressed: Number.POSITIVE_INFINITY,
        compressedTokens: 1,
        summaryTokens: 1,
        blockIds: [1],
      },
    ],
    [
      "missing count",
      { mode: "range", topic: "T", compressedTokens: 1, summaryTokens: 1, blockIds: [1] },
    ],
    [
      "blockIds not array",
      {
        mode: "range",
        topic: "T",
        messagesCompressed: 1,
        compressedTokens: 1,
        summaryTokens: 1,
        blockIds: 1,
      },
    ],
    [
      "blockIds non-integer",
      {
        mode: "range",
        topic: "T",
        messagesCompressed: 1,
        compressedTokens: 1,
        summaryTokens: 1,
        blockIds: [1.5],
      },
    ],
    [
      "blockIds negative",
      {
        mode: "range",
        topic: "T",
        messagesCompressed: 1,
        compressedTokens: 1,
        summaryTokens: 1,
        blockIds: [-1],
      },
    ],
  ])("takes the legacy path for malformed metadata: %s", (_name, malformed) => {
    const { theme } = makeSpyTheme();
    const result = makeResult({ details: { dcpCompression: malformed } });

    expect(visibleText(renderCompressResult(result, collapsed, theme, { isError: false }))).toBe(
      "Original summary text",
    );
  });

  it("preserves multiline Unicode content", () => {
    const { theme } = makeSpyTheme();
    const result = makeResult({ content: [{ type: "text", text: "一行目\n二行目" }] });

    const lines = visibleLines(renderCompressResult(result, expanded, theme, { isError: false }));
    expect(lines).toEqual(["一行目", "二行目"]);
  });

  it("renders plain text when NO_COLOR is present", () => {
    process.env.NO_COLOR = "1";
    const spy = makeSpyTheme();

    const raw = renderCompressResult(successResult, collapsed, spy.theme, {
      isError: false,
    }).render(200)[0];
    expect(raw).not.toContain("\u001b");
    expect(
      visibleText(renderCompressResult(successResult, collapsed, spy.theme, { isError: false })),
    ).toBe("Range compression · Auth system · 5 messages · ~12.4k input · ~2.1k summary");
    expect(spy.fg).toHaveLength(0);
  });

  it("stays readable when a theme method throws", () => {
    const theme = {
      fg: () => {
        throw new Error("broken");
      },
      bg: () => {
        throw new Error("broken");
      },
      bold: (text: string) => text,
      inverse: (text: string) => text,
    } as unknown as Theme;

    expect(
      visibleText(renderCompressResult(successResult, collapsed, theme, { isError: false })),
    ).toBe("Range compression · Auth system · 5 messages · ~12.4k input · ~2.1k summary");
  });

  it("bounds every expanded line at narrow width", () => {
    const { theme } = makeSpyTheme();
    const result = makeResult({
      content: [{ type: "text", text: "a very long line of original text that should wrap" }],
      details: { dcpCompression: metadata },
    });

    for (const width of [1, 12, 60]) {
      const lines = renderCompressResult(result, expanded, theme, { isError: false }).render(width);
      for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });
});
