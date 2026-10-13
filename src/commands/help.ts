/**
 * Single source of truth for DCP command help.
 *
 * The plain-text builder and the TUI Help tab both consume this ordered list so
 * command syntax and descriptions cannot drift apart.
 */
export interface DcpCommandHelp {
  /** Stable command identifier, equal to the command name. */
  id: string;
  /** Usage syntax shown in the help listing. */
  syntax: string;
  /** One-line description of the command. */
  description: string;
}

export const DCP_COMMAND_HELP: readonly DcpCommandHelp[] = [
  {
    id: "dcp",
    syntax: "dcp",
    description: "Open the interactive DCP panel",
  },
  {
    id: "dcp:help",
    syntax: "dcp:help",
    description: "Show this help",
  },
  {
    id: "dcp:context",
    syntax: "dcp:context",
    description: "Show context usage breakdown",
  },
  {
    id: "dcp:stats",
    syntax: "dcp:stats",
    description: "Show compression statistics",
  },
  {
    id: "dcp:sweep",
    syntax: "dcp:sweep",
    description: "Force-prune all eligible tool outputs",
  },
  {
    id: "dcp:manual",
    syntax: "dcp:manual [on|off]",
    description: "Toggle manual compression mode",
  },
  {
    id: "dcp:decompress",
    syntax: "dcp:decompress <blockId>",
    description: "Deactivate a compression block",
  },
  {
    id: "dcp:recompress",
    syntax: "dcp:recompress <blockId>",
    description: "Reactivate a deactivated block",
  },
  {
    id: "dcp:lifetime",
    syntax: "dcp:lifetime",
    description: "Show aggregate statistics across all sessions",
  },
  {
    id: "dcp:permission",
    syntax: "dcp:permission",
    description: "Cycle compression permission (allow/ask/deny)",
  },
  {
    id: "dcp:compress",
    syntax: "dcp:compress [focus]",
    description: "Trigger manual compression",
  },
];

const SYNTAX_WIDTH = 28;

export function helpCommand(): string {
  return [
    "DCP Commands:",
    "",
    ...DCP_COMMAND_HELP.map(
      ({ syntax, description }) => `  ${syntax.padEnd(SYNTAX_WIDTH)}- ${description}`,
    ),
  ].join("\n");
}
