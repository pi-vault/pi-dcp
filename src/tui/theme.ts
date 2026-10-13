import type { Theme } from "@earendil-works/pi-coding-agent";

/**
 * The subset of Pi's active theme DCP renders with. Styling falls back to the
 * input text when a method throws or returns a non-string, and `NO_COLOR`
 * presence disables styling entirely.
 */
export type DcpTheme = Pick<Theme, "fg" | "bg" | "bold" | "inverse">;

function safeThemeCall(call: () => unknown, fallback: string): string {
  try {
    const result = call();
    return typeof result === "string" ? result : fallback;
  } catch {
    return fallback;
  }
}

export function createDcpTheme(theme: Theme, env: NodeJS.ProcessEnv = process.env): DcpTheme {
  if (Object.hasOwn(env, "NO_COLOR")) {
    return {
      fg: (_color, text) => text,
      bg: (_color, text) => text,
      bold: (text) => text,
      inverse: (text) => text,
    };
  }

  return {
    fg: (color, text) => safeThemeCall(() => theme.fg(color, text), text),
    bg: (color, text) => safeThemeCall(() => theme.bg(color, text), text),
    bold: (text) => safeThemeCall(() => theme.bold(text), text),
    inverse: (text) => safeThemeCall(() => theme.inverse(text), text),
  };
}
