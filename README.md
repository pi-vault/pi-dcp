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

- **Prunes automatically** — deduplicates repeated tool outputs and purges stale failed tool inputs while preserving diagnostics.
- **Compresses with the model** — exposes a `compress` tool in `range` or `message` mode while keeping tool-call/tool-result pairs intact.
- **Nudges before the window fills** — context-limit, turn, and iteration nudges are anchored and frequency-throttled.
- **Shows operational feedback** — pruning and compression can surface in toast or status notifications.
- **Lets you tune behavior** — config, manual mode, runtime permission control, and schema-backed validation are all built in.

## What's new in 0.5.0

- Trusted project configuration loads from `<ctx.cwd>/.pi/dcp.json` and layers over global configuration at session start; untrusted projects fall back to the global config only.
- `dcp:compress [focus]` sends Pi a hidden manual-compression follow-up so you can trigger a compression pass on demand.
- Compression batches validate completely before state changes, then commit atomically; selection expands tool-call/result pairs and active blocks to a fixed point.
- Nested compression blocks restore coherent visibility when decompressed or recompressed; savings count only visible context, without nested double-counting.
- DCP state lives in versioned `pi-dcp-state` entries on the active Pi session branch. Resume, fork, and tree navigation recover the newest valid entry; forks inherit settings but start with fresh statistics. Legacy `dcp/state.json` sidecars are ignored.
- Compression memberships, message indices, tool caches, and nudge positions rebuild from current messages; corrupt entries are skipped and compaction persists its reset.
- `dcp:lifetime` scans Pi session JSONL files and totals the newest snapshot for each owning session.
- Top-level user-turn protection preserves recent raw user turns and complete tool pairs across pruning and compression; failed tool diagnostics survive while stale failed inputs are purged.
- Deterministic benchmark evidence (`pnpm benchmark`) covers clean messages, repeated tool pairs, and restored nested compression blocks.

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
| `dcp:compress [focus]`     | Ask Pi to run compression on stale context      |

## Typical workflows

**Default:** install it and let DCP prune duplicates and stale failed inputs automatically.

**Need a cleanup pass first?** Run `dcp:sweep`, then `dcp:context`.

**Want manual compression control?** Use `dcp:manual on`, compress selectively, then `dcp:manual off`.

**Need to block compression temporarily?** Run `dcp:permission` to flip between `allow` and `deny`.

**Need compression now?** Run `dcp:compress [focus]`. It sends Pi a hidden follow-up that asks it to use the `compress` tool; it does nothing while DCP or compression permission is disabled.

**Need to undo a compression block?** Use `dcp:decompress <blockId>` and `dcp:recompress <blockId>`.

**Need lifetime totals?** Use `dcp:lifetime` to see aggregate savings across saved sessions.

**Customize prompts (experimental).** Enable `experimental.customPrompts`, then edit prompt overrides in either trusted project or global locations:

- Trusted project: `.pi/dcp-prompts/overrides/<file>.md`
- Global: `~/.pi/agent/extensions/dcp-prompts/overrides/<file>.md`

Files: `system.md`, `context-limit-nudge.md`, `turn-nudge.md`, `iteration-nudge.md`.

## Configuration

Create `<agentDir>/extensions/dcp.json` (normally `~/.pi/agent/extensions/dcp.json`) to override defaults. On each session start, DCP merges built-in defaults, this global file, and `<ctx.cwd>/.pi/dcp.json` when Pi marks the project trusted. Nested objects merge recursively; arrays replace earlier arrays. Untrusted project configuration is ignored, and a previously registered compression tool safely reports that DCP is disabled after a later disable.

You can also use the shipped [`dcp.schema.json`](dcp.schema.json) for editor tooling or config validation workflows.

```json
{
  "enabled": true,
  "disabledModels": [],
  "debug": false,
  "nudgeNotification": "minimal",
  "nudgeNotificationType": "status",
  "protectedFilePatterns": [],
  "turnProtection": 0,
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
- `disabledModels` — exact, case-sensitive `provider/modelId` keys for which DCP processing, mutating commands, and the active `compress` tool are disabled.
- `debug` — when `true`, writes per-session logs to `{sessionDir}/dcp/logs/YYYY-MM-DD.log`.
- `nudgeNotification` — notification verbosity: `"off"`, `"minimal"`, or `"detailed"`.
- `nudgeNotificationType` — notification delivery: `"toast"` or `"status"`.
- `protectedFilePatterns` — file-path globs whose related tool outputs should never be pruned.

Protected tool and file patterns use Node's `path.posix.matchesGlob` semantics: `/` is the path separator, and supported patterns include `*`, `**`, `?`, and character classes such as `[abc]` and `[0-9]`. Wildcards continue to match leading-dot path segments for compatibility with earlier pi-dcp releases.

- `turnProtection` — hard-protect the newest N raw user-message turns from every DCP transformation; defaults to `0`.

```json
{
  "disabledModels": ["openai-codex/gpt-5.6-sol"],
  "compress": {
    "modelMaxLimits": {
      "openai-codex/gpt-5.6-sol": "80%",
      "openai-codex/gpt-5.6-terra": "60%"
    },
    "modelMinLimits": {
      "openai-codex/gpt-5.6-sol": "50%",
      "openai-codex/gpt-5.6-terra": "40%"
    }
  }
}
```

For a session using `openai-codex/gpt-5.6-sol`, DCP leaves messages unchanged, rejects mutating DCP commands, and removes `compress` from the active tools. The configured `sol` thresholds remain dormant while that model is disabled. The independent `terra` thresholds remain active for sessions using `openai-codex/gpt-5.6-terra`. Live model switching is handled separately and is not part of this static-session behavior.

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
- `protectedTools` — Node glob patterns for tool outputs preserved during compression.
- `protectUserMessages` — append user message text to compression summaries.
- `protectTags` — preserve `<protect>...</protect>` tag content in summaries.
- `summaryBuffer` — exclude active summary tokens from threshold comparison to prevent cascading compressions.

### `manualMode`

- `default` — start in automatic mode (`false`) or manual mode (`"active"`).
- `automaticStrategies` — continue running automatic pruning strategies while manual compression mode is active.

### `strategies`

- `deduplication.enabled` — enable or disable deduplication.
- `deduplication.protectedTools` — Node glob patterns for tool names excluded from deduplication.
- `deduplication.turnProtection` — legacy deduplication window; deduplication uses the larger of this and top-level `turnProtection`.
- `purgeErrors.enabled` — enable or disable stale failed-input purging.
- `purgeErrors.turns` — age threshold for failed tool-input purging.
- `purgeErrors.protectedTools` — Node glob patterns for tool names excluded from failed-input purging.

DCP counts turns from raw user messages, not assistant iterations. When the history contains fewer user turns than `turnProtection`, all existing user turns are protected. Deduplication, stale-error pruning, `dcp:sweep`, and both compression modes enforce this boundary. Normal compression expands a tool target to its complete assistant call/result group; DCP removes orphan results it creates, while Pi synthesizes error results for assistant calls that have no result.

DCP preserves failed tool diagnostics and purges only the historical arguments of eligible stale failures. Repeated `read`, `grep`, `find`, `ls`, and `bash` calls may be deduplicated or swept. `compress`, `write`, `edit`, and `subagent` remain protected by default; configured protected-tool patterns are additive.

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

### Benchmarks

`pnpm benchmark` runs three deterministic workloads through the production DCP pipeline and writes one JSON report to stdout. The retained [`benchmarks/result.json`](benchmarks/result.json) was recorded on Node 24.15.0 with 30 timed iterations per workload, after one untimed warm-up.

Each timed iteration includes cloning the fixture, creating fresh session state, cloning the default configuration, restoring persisted state when applicable, running the pipeline, projecting the transformed messages, and estimating input and output tokens.

| Workload                     | What it exercises                                                     | Median   | p95      | Input tokens | Output tokens | Reduction |
| ---------------------------- | --------------------------------------------------------------------- | -------- | -------- | ------------ | ------------- | --------- |
| `clean-2000-messages`        | Baseline pipeline processing for alternating user/assistant messages  | 9.60 ms  | 13.41 ms | 9,000        | 29,000        | -20,000   |
| `repeated-tool-pairs-2000`   | Deduplication, stale-error input purging, and protected write results | 36.32 ms | 47.83 ms | 1,017,575    | 54,702        | 962,873   |
| `restored-nested-blocks-100` | Snapshot restoration and relationship rebuilding for nested blocks    | 2.96 ms  | 4.64 ms  | 1,291        | 120           | 1,171     |

The clean workload intentionally reports a negative reduction: no content is pruned, while DCP adds stable message-ID metadata to all 2,000 messages. It is a baseline for pipeline and metadata overhead, not a token-savings case.

The repeated-tool workload reduces the estimate by 94.6%. It models 2,000 assistant/tool-result pairs with repeated reads, stale failures, and unique writes. Production strategies replace superseded read output and stale failed-call arguments while preserving protected write output, error diagnostics, and complete tool-call ownership.

The restored-nesting workload reduces the estimate by 90.7%. It restores 100 persisted compression blocks arranged as ten nested chains, rebuilds their runtime relationships from real `compress` call/result owners, and leaves the ten outer blocks active.

Report fields:

- `nodeVersion` and `iterations` describe the runtime and timed sample count.
- `medianMs` is the middle elapsed time; `p95Ms` represents the slower tail.
- `inputEstimatedTokens` and `outputEstimatedTokens` use DCP's lightweight character-based estimator, not provider billing tokens.
- `reductionEstimatedTokens` is exactly input minus output, so it may be negative.

Fixtures and token estimates are deterministic, but elapsed times vary with hardware and system load. Compare timing reports only from the same machine and Node version; the benchmark is informational and does not enforce a release threshold.

To refresh the retained evidence:

```bash
pnpm benchmark > benchmarks/result.json
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

MIT — see [`LICENSE`](LICENSE).
