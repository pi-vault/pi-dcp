export function helpCommand(): string {
  return [
    "DCP Commands:",
    "",
    "  dcp:help                    - Show this help",
    "  dcp:context                 - Show context usage breakdown",
    "  dcp:stats                   - Show compression statistics",
    "  dcp:sweep                   - Force-prune all eligible tool outputs",
    "  dcp:manual [on|off]         - Toggle manual compression mode",
    "  dcp:decompress <blockId>    - Deactivate a compression block",
    "  dcp:recompress <blockId>    - Reactivate a deactivated block",
    "  dcp:lifetime                - Show aggregate statistics across all sessions",
  ].join("\n");
}
