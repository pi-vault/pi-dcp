# @pi-vault/pi-dcp

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-dcp)](https://www.npmjs.com/package/@pi-vault/pi-dcp)
[![Quality](https://github.com/pi-vault/pi-dcp/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-dcp/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Keep long Pi sessions usable by pruning stale tool output, reporting what changed, and nudging the model to compress older context before the window fills up.

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

```text
dcp:context
dcp:help
dcp:stats
dcp:sweep
```

Use `dcp:context` to see token usage and active DCP state, `dcp:help` to list commands, `dcp:stats` to check savings, and `dcp:sweep` to clear dead tool output before a heavy session.

## What it does

- **Prunes automatically** — deduplicates repeated tool outputs and clears stale failed tool results.
- **Compresses with the model** — exposes a `compress` tool in `range` or `message` mode while keeping tool-call/tool-result pairs intact.
- **Nudges before the window fills** — context-limit, turn, and iteration nudges are anchored and frequency-throttled.
- **Shows operational feedback** — pruning and compression can surface in toast or status notifications.
- **Lets you tune behavior** — config, manual mode, runtime permission control, and schema-backed validation are all built in.

## Commands

All commands are also discoverable in-session via `dcp:help`.

| Command                    | Purpose                                         |
| -------------------------- | ----------------------------------------------- |
| `dcp:help`                 | List all available commands                     |
| `dcp:context`              | Show context usage and DCP state                |
| `dcp:stats`                | Show compression and token savings statistics   |
| `dcp:sweep`                | Force-prune all eligible tool outputs           |
| `dcp:manual on`            | Pause automatic compression                     |
| `dcp:manual off`           | Resume automatic compression                    |
| `dcp:decompress <blockId>` | Deactivate a compression block                  |
| `dcp:recompress <blockId>` | Reactivate a compression block                  |
| `dcp:lifetime`             | Show aggregate statistics across saved sessions |
| `dcp:permission`           | Toggle compress permission between allow/deny   |

## Typical workflows

**Default:** install it and let DCP prune duplicates and stale errors automatically.

**Need a cleanup pass first?** Run `dcp:sweep`, then `dcp:context`.

**Want manual compression control?** Use `dcp:manual on`, compress selectively, then `dcp:manual off`.

**Need to block compression temporarily?** Run `dcp:permission` to flip between `allow` and `deny`.

**Need to undo a compression block?** Use `dcp:decompress <blockId>` and `dcp:recompress <blockId>`.

**Need lifetime totals?** Use `dcp:lifetime` to see aggregate savings across saved sessions.

**Customize prompts (experimental).** Enable `experimental.customPrompts`, then edit prompt overrides in either:

- Project: `.pi/dcp-prompts/overrides/<file>.md`
- Global: `~/.pi/agent/extensions/dcp-prompts/overrides/<file>.md`

Files: `system.md`, `context-limit-nudge.md`, `turn-nudge.md`, `iteration-nudge.md`.

## Configuration

Create `~/.pi/agent/extensions/dcp.json` to override defaults. Every field is optional; missing keys fall back to built-in defaults.

You can also use the shipped [`dcp.schema.json`](dcp.schema.json) for editor tooling or config validation workflows.

```json
{
  "enabled": true,
  "debug": false,
  "nudgeNotification": "minimal",
  "nudgeNotificationType": "status",
  "protectedFilePatterns": [],
  "compress": {
    "mode": "range",
    "permission": "allow",
    "showCompression": false,
    "maxContextPercent": 80,
    "minContextPercent": 50,
    "maxContextLimit": 200000,
    "minContextLimit": 100000,
    "modelMaxLimits": {},
    "modelMinLimits": {},
    "nudgeFrequency": 5,
    "iterationNudgeThreshold": 15,
    "nudgeForce": "soft",
    "protectedTools": ["compress"],
    "protectUserMessages": false,
    "protectTags": false,
    "summaryBuffer": true
  },
  "manualMode": {
    "default": false,
    "automaticStrategies": true
  },
  "strategies": {
    "deduplication": {
      "enabled": true,
      "protectedTools": [],
      "turnProtection": 0
    },
    "purgeErrors": {
      "enabled": true,
      "turns": 4,
      "protectedTools": []
    }
  },
  "experimental": {
    "allowSubAgents": false,
    "customPrompts": false
  }
}
```

### Top-level

- `enabled` — set to `false` to disable the extension entirely without uninstalling.
- `debug` — when `true`, writes per-session logs to `{sessionDir}/dcp/logs/YYYY-MM-DD.log`.
- `nudgeNotification` — notification verbosity: `"off"`, `"minimal"`, or `"detailed"`.
- `nudgeNotificationType` — notification delivery: `"toast"` or `"status"`.
- `protectedFilePatterns` — file-path globs whose related tool outputs should never be pruned.

### `compress`

- `mode` — compression mode: `"range"` or `"message"`.
- `permission` — runtime allow/deny gate for the `compress` tool; `dcp:permission` toggles it in-session.
- `showCompression` — when `true`, detailed notifications include the compression summary text.
- `maxContextPercent` / `minContextPercent` — legacy percentage thresholds.
- `maxContextLimit` / `minContextLimit` — accept either absolute token counts or percentage strings such as `"80%"`.
- `modelMaxLimits` / `modelMinLimits` — per-model overrides keyed by `provider/modelId`.
- `nudgeFrequency` — minimum messages between non-urgent nudges.
- `iterationNudgeThreshold` — assistant iterations without user input before an iteration nudge fires.
- `nudgeForce` — nudge strength: `"soft"` or `"strong"`.
- `protectedTools` — tool outputs preserved during compression.
- `protectUserMessages` — append user message text to compression summaries.
- `protectTags` — preserve `<protect>...</protect>` tag content in summaries.
- `summaryBuffer` — exclude active summary tokens from threshold comparison to prevent cascading compressions.

### `manualMode`

- `default` — start in automatic mode (`false`) or manual mode (`"active"`).
- `automaticStrategies` — continue running automatic pruning strategies while manual compression mode is active.

### `strategies`

- `deduplication.enabled` — enable or disable deduplication.
- `deduplication.protectedTools` — tool names excluded from deduplication.
- `deduplication.turnProtection` — keeps recent duplicate tool output for N turns before it becomes prune-eligible.
- `purgeErrors.enabled` — enable or disable stale error pruning.
- `purgeErrors.turns` — age threshold for failed tool-result pruning.
- `purgeErrors.protectedTools` — tool names excluded from error purging.

### `experimental`

- `allowSubAgents` — run DCP inside sub-agent child sessions.
- `customPrompts` — load prompt overrides from the filesystem.

## What's new in 0.4.0

- Compression notifications can now surface summary text with `compress.showCompression`.
- `dcp:permission` adds runtime control over compress-tool usage.
- Deduplication can preserve recent duplicates via `turnProtection`.
- Config validation and the shipped `dcp.schema.json` now come from the same TypeBox source of truth.

## What's new in 0.4.1

- Long sessions no longer repeatedly invoke the Anthropic tokenizer during context processing.
- Per-message token estimates are restored to the lightweight character-based heuristic.

## Development and verification

```bash
pnpm install
pnpm check
pnpm release:check
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

MIT — see [`LICENSE`](LICENSE).
