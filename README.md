# pi-dcp

Pi extension for dynamic context pruning — incremental tool output pruning and conversation compression.

## Installation

Add `pi-dcp` to your Pi workspace:

```bash
# In your Pi config, add the extension path:
# ~/.pi/config.json -> pi.extensions: ["path/to/pi-dcp/src/index.ts"]
```

Or link locally during development:

```bash
git clone https://github.com/pi-vault/pi-dcp.git
cd pi-dcp
pnpm install
```

## Configuration

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

All fields are optional — missing fields use defaults shown above.

## Debug Logging

Set `"debug": true` in the config file. Logs are written to:

```
{sessionDir}/dcp/logs/YYYY-MM-DD.log
```

where `sessionDir` is resolved from `ctx.sessionManager.getSessionDir()` at session start.

## Development

```bash
pnpm install
pnpm run check      # lint + typecheck + test
pnpm test           # tests only
pnpm run typecheck  # tsc --noEmit
pnpm run lint       # biome lint
pnpm run format     # biome format --write
```

## License

MIT
