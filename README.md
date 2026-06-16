# @pi-vault/pi-dcp

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-dcp)](https://www.npmjs.com/package/@pi-vault/pi-dcp)
[![Quality](https://github.com/pi-vault/pi-dcp/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-dcp/actions/workflows/quality.yml)
[![Node >=22.19.0](https://img.shields.io/badge/node-%3E%3D22.19.0-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](https://github.com/pi-vault/pi-dcp/blob/master/README.md#license)

Keep long Pi sessions usable by pruning stale tool output and nudging the model to compress old context before the window fills up.

## Install

```sh
pi install npm:@pi-vault/pi-dcp
```

Restart Pi after install.

To try a local checkout before publishing:

```sh
pi -e /absolute/path/to/pi-dcp
```

## Quick Start

pi-dcp works out of the box — no configuration needed.

Check that it's loaded and see what it knows about your session:

```text
dcp:context
```

List all available commands:

```text
dcp:help
```

After a long session, see how many tokens the extension has saved:

```text
dcp:stats
```

Before an intensive design or debugging session, force-prune dead output:

```text
dcp:sweep
```

## Commands

| Command                    | Purpose                                                                |
| -------------------------- | ---------------------------------------------------------------------- |
| `dcp:help`                 | List all available commands                                            |
| `dcp:context`              | Current token usage, pruned outputs, active blocks, manual mode status |
| `dcp:stats`                | Session token savings and compression counts                           |
| `dcp:sweep`                | Force-prune all eligible tool outputs immediately                      |
| `dcp:manual on`            | Pause automatic compression (take manual control)                      |
| `dcp:manual off`           | Resume automatic compression                                           |
| `dcp:decompress <blockId>` | Restore a previously compressed block                                  |
| `dcp:recompress <blockId>` | Re-activate a decompressed block                                       |
| `dcp:lifetime`             | Aggregate statistics across all saved sessions                         |

## What it does

- **Deduplication** — removes repeated tool outputs (e.g. two identical file reads) without losing the first occurrence.
- **Error pruning** — clears old failed tool results after they've aged past a configurable turn threshold.
- **Context nudges** — warns the model when the conversation is growing large so it can compress before hitting the window limit.
- **Manual mode** — pause automatic compression so you decide when to compress, decompress, or recompress blocks.
- **Compress tool** — exposes a `compress` tool to the model for summarizing older conversation ranges into compact blocks.
- **Tool-chain safety** — when compressing a range, automatically expands boundaries so tool-call / tool-result pairs are never split across the compression boundary.
- **Token savings reporting** — every `compress` call reports how many tokens were replaced by the shorter summary.
- **Cached index lookups** — faster range expansion using pre-built assistant/result position caches.

## Configuration

Create `~/.pi/agent/extensions/dcp.json` to override defaults:

```json
{
  "enabled": true,
  "debug": false,
  "compress": {
    "mode": "range",
    "permission": "allow",
    "maxContextPercent": 80,
    "minContextPercent": 50,
    "nudgeFrequency": 5,
    "iterationNudgeThreshold": 15,
    "nudgeForce": "soft",
    "protectedTools": ["compress"],
    "protectUserMessages": false,
    "protectTags": false
  },
  "manualMode": {
    "default": false,
    "automaticStrategies": true
  },
  "strategies": {
    "deduplication": { "enabled": true },
    "purgeErrors": { "enabled": true, "turns": 4 }
  },
  "nudgeNotification": "minimal"
}
```

All fields are optional. Missing ones fall back to built-in defaults.

### Top-level fields

- `enabled` — set to `false` to disable the extension entirely without uninstalling.
- `debug` — when `true`, writes per-session logs to `{sessionDir}/dcp/logs/YYYY-MM-DD.log`.
- `nudgeNotification` — how verbosely the model is warned about context pressure: `"off"`, `"minimal"` (default), or `"detailed"`.
- `protectedFilePatterns` — array of glob patterns. Tool outputs that reference matching file paths are never pruned.

### `compress`

- `mode` — compression style: `"range"` (default, compress a span of messages) or `"message"` (compress individual messages one at a time).
- `permission` — whether the model is allowed to compress: `"allow"` (default) or `"deny"`.
- `maxContextPercent` — context threshold (percentage of the window) above which the model receives compression nudges. Default: `80`.
- `minContextPercent` — context drops below this after a compress; nudges stop until it climbs again. Default: `50`.
- `nudgeFrequency` — minimum turns between successive compression nudges. Default: `5`.
- `iterationNudgeThreshold` — number of iterations (tool-use turns) without a user message before an iteration-specific nudge fires. Default: `15`.
- `nudgeForce` — strength of the nudge message: `"soft"` (default, suggestive) or `"strong"` (more insistent).
- `protectedTools` — tool names whose outputs should never be compressed. Default: `["compress"]`.
- `protectUserMessages` — when `true`, user messages are never compressed. Default: `false`.
- `protectTags` — when `true`, DCP metadata tags are never compressed. Default: `false`.

### `manualMode`

- `default` — start the session in manual compression mode: `false` (default, automatic) or `"active"`.
- `automaticStrategies` — when manual mode is active, keep running deduplication and error pruning automatically. Default: `true`.

### `strategies`

- `deduplication.enabled` — remove repeated tool outputs. Default: `true`.
- `deduplication.protectedTools` — tool names whose outputs are never deduplicated. Default: `[]`.
- `purgeErrors.enabled` — clear old failed tool results after a configurable number of turns. Default: `true`.
- `purgeErrors.turns` — age in turns before an error result is eligible for pruning. Default: `4`.
- `purgeErrors.protectedTools` — tool names whose error outputs are never pruned. Default: `[]`.

## Typical Usage

1. Install and let pi-dcp run with defaults.
2. Automatic pruning keeps duplicate and stale outputs from piling up.
3. Run `dcp:stats` after a long session to confirm token savings.
4. Run `dcp:sweep` before a long design or debugging session to clear dead weight.
5. When context is tight, the model is nudged to compress. Use `dcp:manual on` if you prefer to decide when compression happens.
6. Undo a compressed block with `dcp:decompress b1`; re-apply it with `dcp:recompress b1`.

## Compatibility

- Node `>=22.19.0`
- Peer dependencies: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-agent-core`, `typebox`
- Intended for Pi sessions with package and extension support

## Development

```sh
pnpm install
pnpm run check
pnpm run pack --dry-run
```

## License

MIT
