import { describe, expect, it } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { createDcpTheme } from "../src/tui/theme.ts";

type ThemeOverrides = {
  fg?: Theme["fg"];
  bg?: Theme["bg"];
  bold?: Theme["bold"];
  inverse?: Theme["inverse"];
};

function makeTheme(overrides: ThemeOverrides = {}): Theme {
  return {
    fg: (color: string, text: string) => `fg:${color}:${text}`,
    bg: (color: string, text: string) => `bg:${color}:${text}`,
    bold: (text: string) => `bold:${text}`,
    inverse: (text: string) => `inverse:${text}`,
    ...overrides,
  } as unknown as Theme;
}

describe("createDcpTheme", () => {
  it("delegates every method to the active theme", () => {
    const theme = createDcpTheme(makeTheme(), {});

    expect(theme.fg("accent", "x")).toBe("fg:accent:x");
    expect(theme.bg("toolSuccessBg", "x")).toBe("bg:toolSuccessBg:x");
    expect(theme.bold("x")).toBe("bold:x");
    expect(theme.inverse("x")).toBe("inverse:x");
  });

  it("delegates at call time so a live theme change is observed", () => {
    let prefix = "first";
    const theme = createDcpTheme(
      makeTheme({ fg: (_color: string, text: string) => `${prefix}:${text}` }),
      {},
    );

    expect(theme.fg("accent", "x")).toBe("first:x");
    prefix = "second";
    expect(theme.fg("accent", "x")).toBe("second:x");
  });

  it.each(["", "0", "false"])("treats NO_COLOR=%j as disabling all styling", (value) => {
    const theme = createDcpTheme(makeTheme(), { NO_COLOR: value });

    expect(theme.fg("accent", "x")).toBe("x");
    expect(theme.bg("toolSuccessBg", "x")).toBe("x");
    expect(theme.bold("x")).toBe("x");
    expect(theme.inverse("x")).toBe("x");
  });

  it("does not disable styling when NO_COLOR is absent", () => {
    const theme = createDcpTheme(makeTheme(), {});

    expect(theme.fg("accent", "x")).toBe("fg:accent:x");
  });

  it("falls back only the throwing method to its input text", () => {
    const theme = createDcpTheme(
      makeTheme({
        fg: () => {
          throw new Error("broken");
        },
      }),
      {},
    );

    expect(theme.fg("accent", "x")).toBe("x");
    expect(theme.bg("toolSuccessBg", "x")).toBe("bg:toolSuccessBg:x");
    expect(theme.bold("x")).toBe("bold:x");
    expect(theme.inverse("x")).toBe("inverse:x");
  });

  it("falls back to the input text when a method returns a non-string", () => {
    const theme = createDcpTheme(makeTheme({ bold: (() => 42) as unknown as Theme["bold"] }), {});

    expect(theme.bold("x")).toBe("x");
  });
});
