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

## What's new in 0.8.0

- **Compact message markers replace verbose XML tags** — each injectable user/assistant message now ends with a standalone `@mN@` line, or `@mN:P@` when a compression priority is assigned. On a 2,000-message clean workload this cut metadata overhead from roughly 20,000 estimated tokens to about 4,000.
- **Every accepted tool input still resolves to the same message** — `compress` accepts `m1`, `m0001`, `@m1@`, and `@m1:3@` in `range` mode, and `m2`, `m0002`, `@m2@`, `@m2:1@` in `message` mode, alongside `b1`-style block refs. Input is normalized to the stored canonical reference before lookup, so the accepted formats are interchangeable rather than merely parseable.
- **Stored and persisted references stay canonical** — `messageIds` and version-1 snapshots continue to use the padded `m0001` form. Nothing is migrated: a snapshot pair is validated as canonical and discarded if it is not, and `nextRefIndex` remains authoritative.
- **Safer marker sanitization** — a marker is removed only when it occupies a whole line (complete or truncated, LF or CRLF, with optional indentation). Inline markers, `person@m1@example.com`, `@mention`, and marker text inside a sentence are left alone. Legacy XML marker cleanup remains active.
- **Benchmark token gates are release-blocking** — deterministic token budgets for all three workloads are asserted in `tests/benchmark.test.ts`. Elapsed-time reporting stays informational.

## Message markers and IDs

DCP shows the model a compact marker for each message it can compress:

| Form           | Meaning                             |
| -------------- | ----------------------------------- |
| `@m12@`        | Message 12, no priority assigned    |
| `@m12:3@`      | Message 12, compression priority 3  |
| `b3`           | Compression block 3                 |

The marker is injected on its own line at the end of the message. Copy it exactly as shown when calling `compress`.

Accepted `startId` / `endId` / `messageId` values in `range` mode:

- `m1` and `@m1@` — the bare or wrapped compact form
- `@m1:3@` — a compact form carrying a priority
- `m0001` — the canonical padded form
- `b2` — a compression block anchor

Priorities run from 1 to 5: 1-2 for the highest compression value, 3 moderate, 4-5 low.

Compact input is exact, case-sensitive, and whitespace-free. `m01`, `@m0001@`, `@m1@ `, and `m1:3` are rejected. What DCP stores and persists is always the padded canonical `m0001`; the compact form exists only so the model-facing text stays short.

## What's new in 0.7.0

- **Pi-native file paths are protected** — `read`, `write`, and `edit` tool arguments now use Pi's `path` field (and legacy `filePath`), with Windows separators normalized before glob matching. Nested calls made by tools such as `codemode` are inspected too, so a parent tool result is protected when any direct or nested file path matches `protectedFilePatterns`.
- **Unsafe context limits are rejected** — `maxContextLimit` / `minContextLimit` and their per-model entries accept only positive integers or percentages greater than 0 and at most 100. Invalid fields are dropped with a warning instead of aborting startup.
- **Configuration layers fall back independently** — an invalid global field keeps the built-in default, and an invalid project field inherits the valid global value rather than resetting it. Unknown keys and invalid values are reported with a source-qualified JSON pointer.
- **Configuration problems are visible once per reload** — each problem is written to the DCP log even when debug logging is off, and an interactive session shows exactly one warning notification with the problem count and the participating config paths.
- **`nudgeForce` selects the role** — `strong` injects the turn nudge into the user message; `soft` injects it into the assistant message, including a synthetic text part prepended before a tool-only assistant call. Both halves of an eligible user/assistant pair are anchored without changing the version-1 snapshot shape, and older user-only version-1 anchors are upgraded when their messages reappear.

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

Configuration is sanitized field-by-field. Invalid, unsafe, or unknown fields are dropped with a warning that names the source file and JSON pointer; valid siblings are retained, and an invalid project value inherits the valid global value instead of resetting it. The shipped schema rejects unknown properties in declared configuration objects while keeping per-model maps open. Startup never aborts because of configuration. Each reload writes every problem to the DCP log even when `debug` is `false` and, in an interactive session, shows a single warning notification containing the problem count and the participating config paths.

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
- `debug` — when `true`, writes operational per-session logs to `{sessionDir}/dcp/logs/YYYY-MM-DD.log`. Configuration warnings are always written there so headless sessions retain diagnostics.
- `nudgeNotification` — notification verbosity: `"off"`, `"minimal"`, or `"detailed"`.
- `nudgeNotificationType` — notification delivery: `"toast"` or `"status"`.
- `protectedFilePatterns` — file-path globs whose related tool outputs should never be pruned. Direct arguments from Pi's `read`, `write`, and `edit` tools (`path`, plus legacy `filePath` on any tool) and nested calls recorded on a tool result are both checked; candidate paths are normalized to `/` separators before matching.

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

For a session using `openai-codex/gpt-5.6-sol`, DCP leaves messages unchanged, rejects mutating DCP commands, and removes `compress` from the active tools. The configured `sol` thresholds remain dormant while that model is disabled. The independent `terra` thresholds remain active for sessions using `openai-codex/gpt-5.6-terra`. Changing models during a live session immediately removes or restores `compress` according to `disabledModels`. Existing DCP state remains intact while the selected model is disabled and is available again after switching to an enabled model.

### `compress`

- `mode` — compression mode: `"range"` or `"message"`.
- `permission` — runtime allow/deny gate for the `compress` tool; `dcp:permission` toggles it in-session.
- `showCompression` — when `true`, detailed notifications include the compression summary text.
- `maxContextPercent` / `minContextPercent` — legacy percentage thresholds.
- `maxContextLimit` / `minContextLimit` — accept a positive integer token count or a percentage string greater than 0 and at most 100 (for example `"80%"`). Anything else is dropped with a warning.
- `modelMaxLimits` / `modelMinLimits` — per-model overrides keyed by `provider/modelId`; each value follows the same context-limit rules as the global limits.
- `nudgeFrequency` — minimum messages between non-urgent nudges.
- `iterationNudgeThreshold` — assistant iterations without user input before an iteration nudge fires.
- `nudgeForce` — nudge strength. `"strong"` injects the turn nudge into the user message; `"soft"` injects it into the assistant message.
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

## Development and verification

```bash
pnpm install
pnpm check
pnpm release:check
```

### Benchmarks

`pnpm benchmark` runs three deterministic workloads through the production DCP pipeline and writes one JSON report to stdout. The retained [`benchmarks/result.json`](benchmarks/result.json) was recorded on Node 24.21.0 with 30 timed iterations per workload, after one untimed warm-up.

Each timed iteration includes cloning the fixture, creating fresh session state, cloning the default configuration, restoring persisted state when applicable, running the pipeline, projecting the transformed messages, and estimating input and output tokens.

| Workload                     | What it exercises                                                     | Median   | p95      | Input tokens | Output tokens | Reduction |
| ---------------------------- | --------------------------------------------------------------------- | -------- | -------- | ------------ | ------------- | --------- |
| `clean-2000-messages`        | Baseline pipeline processing for alternating user/assistant messages  | 11.29 ms | 14.18 ms | 9,000        | 12,992        | -3,992    |
| `repeated-tool-pairs-2000`   | Deduplication, stale-error input purging, and protected write results | 41.40 ms | 54.02 ms | 1,017,575    | 53,977        | 963,598   |
| `restored-nested-blocks-100` | Snapshot restoration and relationship rebuilding for nested blocks    | 3.03 ms  | 3.95 ms  | 1,291        | 120           | 1,171     |

The clean workload intentionally reports a negative reduction: no content is pruned, while DCP adds compact message markers to all 2,000 messages. It is a baseline for pipeline and metadata overhead, not a token-savings case. Compact markers reduced that overhead from -20,000 to -3,992 estimated tokens.

The repeated-tool workload reduces the estimate by 94.7%. It models 2,000 assistant/tool-result pairs with repeated reads, stale failures, and unique writes. Production strategies replace superseded read output and stale failed-call arguments while preserving protected write output, error diagnostics, and complete tool-call ownership.

The restored-nesting workload reduces the estimate by 90.7%. It restores 100 persisted compression blocks arranged as ten nested chains, rebuilds their runtime relationships from real `compress` call/result owners, and leaves the ten outer blocks active.

**Enforced token gates.** `tests/benchmark.test.ts` asserts three deterministic budgets, so a token regression fails `pnpm check` rather than waiting for a human to read a report:

- `clean-2000-messages` — marker overhead (`output - input`) must stay at or below 6,000 tokens.
- `repeated-tool-pairs-2000` — the reduction ratio must stay within 5 percentage points of the retained `962873 / 1017575` baseline.
- `restored-nested-blocks-100` — the reduction ratio must stay within 5 percentage points of the retained `1171 / 1291` baseline.

The ratios are compared as exact fractions rather than rounded percentages, so the tolerance is precisely five percentage points.

**Informational timing.** `medianMs` and `p95Ms` are reported for comparison only and are not gated. Elapsed times vary with hardware and system load; compare timing reports only from the same machine and Node version.

Report fields:

- `nodeVersion` and `iterations` describe the runtime and timed sample count.
- `medianMs` is the middle elapsed time; `p95Ms` represents the slower tail.
- `inputEstimatedTokens` and `outputEstimatedTokens` use DCP's lightweight character-based estimator, not provider billing tokens.
- `reductionEstimatedTokens` is exactly input minus output, so it may be negative.

To refresh the retained evidence, capture the report and update [`benchmarks/result.json`](benchmarks/result.json) with it:

```bash
pnpm benchmark > benchmarks/result.json
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

MIT — see [`LICENSE`](LICENSE).
