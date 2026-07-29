# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Trusted project configuration from `<ctx.cwd>/.pi/dcp.json`, layered over global configuration at session start.
- `dcp:compress [focus]` to send Pi a hidden manual-compression follow-up.
- Deterministic whole-workload benchmark evidence for clean messages, repeated tool pairs, and restored nested compression blocks.

### Changed

- Project prompt overrides now load only for trusted projects; global overrides remain available everywhere.

### Fixed

- Top-level user-turn protection now consistently preserves recent raw user turns and complete tool pairs across pruning and compression.
- Preserve failed tool diagnostics while removing stale failed inputs.
- Allow lookup and shell outputs to participate in pruning.
- Keep compression, file mutations, and sub-agent results protected by default.
- Record source provenance and the verification baseline.
- Validate and commit compression batches atomically after fixed-point expansion of tool pairs and active blocks.
- Preserve nested-block visibility through decompress/recompress cycles, count only visible replaced tokens, and record batch duration on every created block.
- Persist versioned DCP snapshots in Pi session branches, restoring safely across resume, fork, tree navigation, and compaction without shared sidecars.
- Rebuild runtime compression state from stable message keys and aggregate `dcp:lifetime` totals from native Pi JSONL sessions.

## 2026-07-27 - [0.4.1]

### Fixed

- Long sessions no longer repeatedly invoke the Anthropic tokenizer during context processing, preventing high CPU usage and TUI stalls.

## 2026-07-08 - [0.4.0]

### Added

- Compression notifications can now include summary text when `compress.showCompression` is enabled.
- New `dcp:permission` command toggles compress tool permission at runtime.
- Deduplication now supports `strategies.deduplication.turnProtection` to keep recent duplicate tool output from being pruned too aggressively.
- Generated `dcp.schema.json` is now shipped with the package for config tooling and validation.

### Changed

- Configuration loading and validation now derive from TypeBox schemas, keeping runtime validation, defaults, and published schema aligned.

### Fixed

- Config validation now resets invalid values more consistently and warns when `maxContextPercent` is not greater than `minContextPercent`.
- Generated JSON Schema no longer emits misleading `required` arrays for optional user config.

## 2026-06-23 - [0.3.0]

### Added

- Absolute token limits via `compress.maxContextLimit` / `minContextLimit` (default 200000/100000) plus per-model overrides via `compress.modelMaxLimits` / `modelMinLimits`. Percentage fields now derive from the active model's detected context window.
- Summary buffer via `compress.summaryBuffer` (default `true`) so active compression summaries don't push usage over the threshold and trigger cascading compressions.
- UI notifications via `nudgeNotificationType` (`"toast"` or `"status"`, default `"status"`) on top of the existing `nudgeNotification` verbosity (`off|minimal|detailed`).
- Anchored nudge system: context-limit, turn, and iteration nudges are now anchored to specific messages (content-derived keys) with `nudgeFrequency`-throttled spacing, so they persist across turns and don't drift.
- Protected content preserved in compression summaries: verbatim append of `compress.protectedTools` outputs, user messages when `compress.protectUserMessages: true`, and `<protect>...</protect>` tag content when `compress.protectTags: true`.
- Sub-agent support (experimental, opt-in via `experimental.allowSubAgents`): detects `PI_SUBAGENT_CHILD=1`, skips DCP processing in child sessions, and caches sub-agent tool results so they can be merged into parent compression summaries. `"subagent"` added to base protected tools.
- Custom prompts (experimental, opt-in via `experimental.customPrompts`): `PromptStore` reads `system.md`, `context-limit-nudge.md`, `turn-nudge.md`, `iteration-nudge.md` from project `.pi/dcp-prompts/overrides/` then global `~/.pi/agent/extensions/dcp-prompts/overrides/`, with hot-reload on every context pass and bundled defaults written on first run for reference.
- Compression timing: each compression block now records `durationMs`, populated via `tool_execution_start`/`tool_execution_end` handlers.
- Hallucination guard: a `message_end` handler strips truncated or malformed `<dcp-message-id>` / `<dcp-system-reminder>` tags from assistant messages before storage, and inject pre-strips existing tags for idempotency.

### Changed

- Message refs (`m0001`, `m0002`, ...) are now assigned via content-derived stable keys (`user:<timestamp>`, `assistant:<timestamp>`, `toolResult:<toolCallId>`) and persisted across sessions and compactions, replacing the previous index-based mapping.
- Strategy runner, message ID handling, context pipeline, and per-strategy protection checks refactored; behavior unchanged but tool-output file-path protection (`protectedFilePatterns`) is now honored by both deduplication and purge-errors.
- Default notification mode changed from implicit-none to explicit `status` mode with cumulative session stats shown after pruning runs.

### Fixed

- Truncated DCP tags emitted by the model (e.g. `<dcp-message-id>m0093</dcp`) are stripped on output and prevented from blocking re-injection on input.
- Token counts in the tool cache now sync from `toolResult` content instead of remaining `undefined` after rehydration.
- Anchor sets no longer shift with new messages (anchored to keys, not indices) and persist across sessions.

## 2026-06-16 - [0.2.0]

### Added

- Token savings reporting in compress responses (total replaced vs. summary tokens).
- Tool-chain safety: automatic range expansion so tool-call / tool-result pairs stay together.
- Cached assistant/result index lookups for faster range expansion.
- `manualMode` config section with `default` and `automaticStrategies` options.
- `nudgeNotification` config setting (`"off"`, `"minimal"`, `"detailed"`).
- `iterationNudgeThreshold` and `nudgeForce` compress config options.
- `protectUserMessages` and `protectTags` compress config options.
- `protectedFilePatterns` top-level config for files that should never lose their tool output.

### Changed

- Orphan safety net: `filterCompressedRanges` now catches tool-results whose assistant parent was removed.
- Strategies runner extracted and refactored with tool-input file-path protection.
- Context pipeline extracted into standalone `src/pipeline.ts`.
- `syncToolCache` now populates `tokenCount`, `assistantIndex`, and `resultIndex`.

### Fixed

- Token counts in tool cache now sync from toolResult content instead of remaining undefined.

## 2026-06-15 - [0.1.0]

### Added

- Dynamic context pruning for Pi sessions, including stale duplicate tool-output removal.
- Error-pruning strategies that clear old failed tool results after they stop being useful.
- A `compress` tool with range-based and message-based compression modes.
- DCP message IDs, compression block tracking, and proactive high-context nudges.
- Slash commands for operational control: `dcp:help`, `dcp:context`, `dcp:stats`, `dcp:sweep`, `dcp:manual`, `dcp:decompress`, `dcp:recompress`, and `dcp:lifetime`.
- Session-state persistence, lifetime statistics, debug logging, and status-bar reporting.
- Vitest coverage across config loading, strategies, message transforms, compression state, commands, persistence, pipeline behavior, and end-to-end extension lifecycle integration.
