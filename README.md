# pi-dcp

Keep long Pi sessions usable by pruning stale tool output and nudging the model to compress old context before the window fills up.

## Install

Install from npm with Pi:

```bash
pi install npm:@pi-vault/pi-dcp
```

Then restart Pi.

To try the repo locally before publishing:

```bash
pi -e /absolute/path/to/pi-dcp
```

## Configure

Create `~/.pi/agent/extensions/dcp.json`:

```json
{
  "enabled": true,
  "debug": false,
  "compress": {
    "mode": "range",
    "permission": "allow",
    "maxContextPercent": 80,
    "minContextPercent": 50,
    "nudgeFrequency": 5
  },
  "strategies": {
    "deduplication": { "enabled": true },
    "purgeErrors": { "enabled": true, "turns": 4 }
  }
}
```

All fields are optional. If the file is missing, pi-dcp uses built-in defaults.

## What it does

- Removes stale duplicate tool outputs automatically
- Prunes older error-heavy tool results that no longer help the model
- Injects context warnings before the conversation gets too large
- Exposes a `compress` tool so the model can summarize older context instead of losing it

## Common commands

- `dcp:help` — list available commands
- `dcp:context` — show current context usage and active compression state
- `dcp:stats` — show session token savings and compression counts
- `dcp:sweep` — force-prune all currently eligible tool outputs
- `dcp:manual on` — pause automatic compression and switch to manual control
- `dcp:manual off` — resume automatic compression
- `dcp:decompress <blockId>` — restore a compressed block
- `dcp:recompress <blockId>` — reactivate a decompressed block
- `dcp:lifetime` — show aggregate stats across saved sessions

## Recommended usage

1. Install the package and start with the default config.
2. Let automatic pruning handle duplicate and stale outputs.
3. Use `dcp:stats` when you want to confirm token savings.
4. Turn on `dcp:manual on` if you want to decide when compression happens.
5. Use `dcp:sweep` before a long design or debugging session if the context already contains a lot of dead tool output.

## Debug logging

Set `"debug": true` in `~/.pi/agent/extensions/dcp.json` to write logs to:

```text
{sessionDir}/dcp/logs/YYYY-MM-DD.log
```

## Development

```bash
pnpm install
pnpm run check
pnpm run release:check
```
