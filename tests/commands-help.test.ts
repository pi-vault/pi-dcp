import { describe, expect, it } from "vitest";
import { DCP_COMMAND_HELP, helpCommand } from "../src/commands/help.ts";

describe("help command", () => {
  it("returns the exact list of all eleven commands", () => {
    expect(helpCommand()).toBe(
      [
        "DCP Commands:",
        "",
        "  dcp                         - Open the interactive DCP panel",
        "  dcp:help                    - Show this help",
        "  dcp:context                 - Show context usage breakdown",
        "  dcp:stats                   - Show compression statistics",
        "  dcp:sweep                   - Force-prune all eligible tool outputs",
        "  dcp:manual [on|off]         - Toggle manual compression mode",
        "  dcp:decompress <blockId>    - Deactivate a compression block",
        "  dcp:recompress <blockId>    - Reactivate a deactivated block",
        "  dcp:lifetime                - Show aggregate statistics across all sessions",
        "  dcp:permission              - Cycle compression permission (allow/ask/deny)",
        "  dcp:compress [focus]        - Trigger manual compression",
      ].join("\n"),
    );
  });

  it("contains argument syntax and no ANSI escapes", () => {
    const result = helpCommand();
    expect(result).toContain("dcp:manual [on|off]");
    expect(result).toContain("dcp:decompress <blockId>");
    expect(result).toContain("dcp:recompress <blockId>");
    expect(result).toContain("dcp:compress [focus]");
    expect(result).not.toContain("\u001b[");
  });

  it("exposes an ordered descriptor for every command", () => {
    expect(DCP_COMMAND_HELP.map((entry) => entry.id)).toEqual([
      "dcp",
      "dcp:help",
      "dcp:context",
      "dcp:stats",
      "dcp:sweep",
      "dcp:manual",
      "dcp:decompress",
      "dcp:recompress",
      "dcp:lifetime",
      "dcp:permission",
      "dcp:compress",
    ]);
    expect(DCP_COMMAND_HELP).toHaveLength(11);
    for (const entry of DCP_COMMAND_HELP) {
      expect(helpCommand()).toContain(entry.syntax);
      expect(helpCommand()).toContain(entry.description);
    }
  });
});
