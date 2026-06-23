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

## What it does

- **Prunes automatically** — deduplicates repeated tool outputs (e.g. two identical file reads) without losing the first occurrence; clears old failed tool results after `strategies.purgeErrors.turns`.
- **Compresses with the model** — exposes a `compress` tool in `range` or `message` mode. Tool-call / tool-result pairs are never split across a compression boundary; protected tool outputs, user messages (when enabled), and `<protect>` tag content survive summaries verbatim.
- **Nudges the model** — anchored, frequency-throttled nudges fire when context crosses configured limits. They persist across turns and don't drift as new messages arrive.
- **Notifies you** — toast or status-bar updates with per-pass pruning stats.
- **Respects sub-agents** — skips child sessions by default; with `experimental.allowSubAgents` enabled, caches child results so they can be merged into parent-side compression summaries.
- **Reports savings** — `dcp:stats` for the session, `dcp:lifetime` across all sessions.
- **Survives the long session** — persisted anchor sets, stable message IDs, and rehydrated state on resume.

## Commands

All commands are also discoverable in-session via `dcp:help`.

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

## Typical workflows

**Default — just install it.** DCP prunes duplicates and stale errors on its own and nudges the model when context fills up. Watch `dcp:context` to see what's happening.

**Long design or debug session.** Run `dcp:sweep` first to clear dead weight, then check `dcp:context` periodically.

**Take manual control of compression.** Turn automatic compression off:

```text
dcp:manual on
```

Then use the `compress` tool directly on whatever you decide is safe to summarize. Resume automatic mode with:

```text
dcp:manual off
```

**Undo a bad compression.** Get the block ID from `dcp:context` or `dcp:stats`, then:

```text
dcp:decompress b3
```

Re-activate it with:

```text
dcp:recompress b3
```

**Check the savings.** Session totals:

```text
dcp:stats
```

Across all saved sessions:

```text
dcp:lifetime
```

**Customize prompts (experimental).** Enable the prompt store in your config:

```json
{ "experimental": { "customPrompts": true } }
```

On first run, defaults are written to `~/.pi/agent/extensions/dcp-prompts/defaults/` for reference. Edit overrides at either of these paths (project wins):

- Project: `.pi/dcp-prompts/overrides/<file>.md`
- Global: `~/.pi/agent/extensions/dcp-prompts/overrides/<file>.md`

Files: `system.md`, `context-limit-nudge.md`, `turn-nudge.md`, `iteration-nudge.md`. Reloaded on every context pass.

## Configuration

Create `~/.pi/agent/extensions/dcp.json` to override defaults. Every field is optional; missing keys fall back to built-in defaults:

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
    "deduplication": { "enabled": true, "protectedTools": [] },
    "purgeErrors": { "enabled": true, "turns": 4, "protectedTools": [] }
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
- `nudgeNotification` — how verbosely the model is warned about context pressure: `"off"`, `"minimal"`, or `"detailed"`.
- `nudgeNotificationType` — where notifications appear: `"toast"` (transient popups) or `"status"` (persistent status line, default).
- `protectedFilePatterns` — array of glob patterns. Tool outputs that reference matching file paths are never pruned.

### `compress`

- `mode` — compression style: `"range"` (compress a span) or `"message"` (compress individual messages).
- `permission` — whether the model is allowed to compress: `"allow"` or `"deny"`.
- `maxContextPercent` / `minContextPercent` — percentage-based thresholds. Used as a fallback when `maxContextLimit` / `minContextLimit` are not set.
- `maxContextLimit` / `minContextLimit` — absolute token thresholds (default `200000` / `100000`). Use these for predictable behavior across large and small context windows.
- `modelMaxLimits` / `modelMinLimits` — per-model overrides keyed by `provider/modelId`, accepting either a token count or a percentage string.
- `nudgeFrequency` — minimum messages between successive compression nudges.
- `iterationNudgeThreshold` — iterations (tool-use turns) without a user message before an iteration-specific nudge fires.
- `nudgeForce` — strength of the nudge message: `"soft"` (suggestive) or `"strong"` (insistent).
- `protectedTools` — tool names whose outputs are never compressed.
- `protectUserMessages` — when `true`, user messages in a compressed range are appended verbatim to the summary.
- `protectTags` — when `true`, content inside `<protect>...</protect>` tags is extracted from user messages and appended to the summary.
- `summaryBuffer` — when `true` (default), active compression summaries are excluded from the max-threshold comparison, preventing feedback loops.

### `manualMode`

- `default` — start the session in manual compression mode: `false` (automatic) or `"active"`.
- `automaticStrategies` — when manual mode is active, keep running deduplication and error pruning automatically.

### `strategies`

- `deduplication.enabled` / `deduplication.protectedTools` — turn off dedup or exclude specific tools.
- `purgeErrors.enabled` / `purgeErrors.turns` / `purgeErrors.protectedTools` — error-result purging, age threshold, and exclusions.

### `experimental`

- `allowSubAgents` — when `true`, DCP runs inside sub-agent child sessions. Default `false` (DCP skips child sessions to avoid interfering with their context).
- `customPrompts` — when `true`, prompts are loaded from the filesystem override paths described in [Typical workflows](#typical-workflows). Default `false` (bundled prompts used directly, zero filesystem access).

## What's new in 0.3.0

- **Absolute token limits** — `compress.maxContextLimit` / `minContextLimit` with per-model overrides via `modelMaxLimits` / `modelMinLimits`.
- **Anchored, persistent nudges** — context-limit, turn, and iteration nudges are anchored to message keys with `nudgeFrequency` spacing, so they persist across turns and don't drift.
- **Protected content survives compression** — protected tool outputs, user messages, and `<protect>` tag content are appended to summaries verbatim.
- **UI notifications** — toast or status-bar mode via `nudgeNotificationType`, on top of the existing verbosity setting.
- **Experimental opt-ins** — sub-agent support (`experimental.allowSubAgents`) and custom prompts via `PromptStore` (`experimental.customPrompts`).
- **Stable message IDs and compression timing** — refs persist across sessions and compactions; each compression block records its duration.

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
