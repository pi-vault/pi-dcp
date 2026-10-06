export function helpCommand(): string {
  return [
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
  ].join("\n");
}
