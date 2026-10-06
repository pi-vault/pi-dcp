# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 2026-10-05 - [0.10.0]

### Added

- Compression permission `ask`. The `compress` tool stays exposed and requests a per-call confirmation in TUI and RPC modes. The dialog names the topic and the number of ranges or targets. Direct executions confirm too, and an approval is never reused between calls.
- Interactive `dcp` panel. One Pi-native TUI view shows the current model, context usage, resolved thresholds, compression and manual modes, permission, policy and tool availability, compression blocks, session savings, and lifetime totals. Arrow keys or `j`/`k` move, Enter runs the selected action, and Escape or `q` closes.
- Snapshot version 2, which persists the wider permission union while readers keep accepting version 1 snapshots with their historical allow/deny validation.
- `@earendil-works/pi-tui` as a host-provided `"*"` peer and a `^1.0.1` development dependency.

### Changed

- `dcp:permission` cycles `allow -> ask -> deny -> allow`. An undefined session override falls back to the configured permission, and the standalone command defaults to `allow`.
- Compression timing starts inside the registered `execute`, after approval and a fresh capability check. Waiting for approval, rejection, cancellation, abort, and confirmation failure create no timing, blocks, statistics, or DCP state entries.
- TUI and RPC confirm `ask`; print/JSON sessions and any mode without dialog UI fail closed with `Compression requires interactive approval`. False, cancelled, aborted, or failed confirmation returns `Compression was not approved`.
- The panel and the direct commands share the same pipeline policy guard. Globally disabled, model-disabled, and disallowed sub-agent sessions retain informational panel access but cannot mutate state. Permission denial alone does not disable sweep, manual mode, or block controls.
- Panel actions toggle manual mode, cycle permission, sweep eligible outputs, and deactivate or reactivate blocks through the existing commands. Only active blocks offer deactivation and only user-deactivated blocks offer reactivation; a stale block returns `Block <id> not found.`

## 2026-10-05 - [0.9.0]

### Added

- Lifecycle-aware `compress` tool reconciliation. DCP registers the tool during extension creation with `defaultActive: false` and refreshes its mode-specific schema from trusted project configuration at session start. A host-selected inactive tool stays inactive across model switches, permission changes, definition refresh, resume, and reload.
- Explicit fresh-session activation: on the first session-start event, when the reason is not `reload`, the branch declares no tool loadout, and the host exposes `compress`, DCP selects it once. Host `tools`/`excludeTools`/`noTools` exclusions are respected, and the tool is never implicitly selected again.
- Structured prompt integration: DCP writes instructions to the `dcp` section of Pi's structured system prompt, preserving unrelated sections and any forced prompt.
- A typed extension harness and offline public-SDK contract tests covering registration, selection, prompt sections, and defensive authorization.

### Changed

- Custom prompt overrides reload once at the start of each agent run, and that snapshot is shared by the system section and context passes until the next run.
- Compression instructions and nudges require an active `compress` tool and non-denied permission. Automatic deduplication, stale-error pruning, reference assignment, and existing compression summaries are unaffected.
- `tool_call` and registered `execute` reject every policy suppression reason in the fixed order `config`, `model`, `subagent`, `permission`. Permission denial alone leaves the pipeline enabled.
- Mutating commands require pipeline eligibility. `dcp:compress` additionally requires compression availability and an active tool, and never activates it.
- Compression timing completion is unconditional, so a call that started under an allowed policy records its duration even if permission changes mid-flight.
- Pi session-manager methods are used directly instead of compatibility casts.

### Removed

- Removed the optional-compatibility session-manager fallbacks and the full `systemPrompt` override in favor of public APIs and structured prompt sections.

## 2026-10-04 - [0.8.0]

### Added

- Compact model-facing message markers. Each injectable user/assistant message ends with a standalone `@mN@` line, or `@mN:P@` when a compression priority from 1 to 5 is assigned. Metadata overhead on a 2,000-message clean workload fell from roughly 20,000 estimated tokens to about 4,000.
- `compress` accepts every supported reference form. `range` mode takes `m1`, `m0001`, `@m1@`, and `@m1:3@` alongside `b1`-style block refs; `message` mode takes the same message forms in `messageId`. A parsed index is normalized back to its canonical padded reference before it is compared with session state, so a copied `@m12:3@` resolves to the same stored message as `m0012` rather than merely parsing.
- Deterministic benchmark token gates in `tests/benchmark.test.ts`: injected-marker overhead on the clean workload must stay at or below 6,000 tokens, and the repeated-tool and nested-block reduction ratios must stay within five percentage points of their retained baselines, expressed as exact fractions rather than rounded percentages.

### Changed

- Stored and persisted references remain canonical. `parseMessageRef` is still canonical-only, `messageIds` and version-1 snapshots keep the padded `m0001` form, and the snapshot version is unchanged. No stored map is migrated.
- Snapshot `byRawId` pairs are validated with the strict canonical predicate instead of a permissive boundary parser, making the persistence boundary explicit. A compact persisted ref is discarded rather than normalized; the snapshot's declared `nextRefIndex` stays authoritative.
- Compact marker sanitization is line-bounded. A marker is removed only when it occupies a whole line, in complete or truncated form, under LF or CRLF, with optional horizontal whitespace. Inline markers, `person@m1@example.com`, `@mention`, and marker text inside a sentence are preserved, and surrounding prose is not concatenated across a removed line. Compact cleanup runs before the legacy XML fallbacks, which remain active.
- Model-facing copy describes the compact protocol. The system prompt teaches `@mN@`, `@mN:P@`, and `<dcp-system-reminder>` as injected metadata that must not be output; the message-mode tool description explains priority values; tool parameter descriptions and unavailable-ID errors use `m1` / `@m1@` examples while keeping `bN` block examples and the pruned/unavailable explanation.

### Removed

- The `<dcp-message-id>` XML formatter. Injection now emits compact markers, and the XML tag no longer appears in model-visible text. Legacy XML marker sanitization of stored assistant output is unchanged.

## 2026-10-03 - [0.7.0]

### Added

- Pi-native `path` support for `read`, `write`, and `edit`, plus protection for file paths recorded in a tool result's nested calls. Paths are normalized to `/` separators before glob matching, so Windows-style separators protect correctly without changing glob semantics.

### Changed

- `maxContextLimit` / `minContextLimit` and per-model limit entries now accept only positive integers or percentages greater than 0 and at most 100. Invalid values are dropped with a source-qualified warning; an invalid project value inherits the valid global value instead of resetting to the built-in default.
- Configuration is sanitized one layer at a time: unknown keys and invalid fields are omitted, valid siblings are retained, and every problem is reported with its originating absolute path and RFC 6901-escaped JSON pointer.
- Each configuration reload writes every problem to the DCP log, including in headless sessions with debug logging disabled, and shows at most one interactive warning containing the problem count and participating config paths. Declared schema objects now reject unknown properties, matching runtime sanitization.
- Compression turn nudges now anchor both the eligible user message and the nearest preceding assistant message. `nudgeForce: "strong"` renders in the user role; `nudgeForce: "soft"` renders in the assistant role, including a synthetic text part inserted before a tool-only assistant call. Older user-only anchors are paired when restored; the version-1 snapshot shape is unchanged.

## 2026-10-03 - [0.6.1]

### Added

- Privacy-safe prompt-cache evidence from `pnpm analyze:sessions`: `UsageTotals` and `LatencySummary` aggregates, `responseLatency`, and separate `malformedUsage` / `malformedLatency` diagnostics. Usage is read from every Pi carrier — assistant messages, standalone usage entries, tool results, compactions, and branch summaries.

### Changed

- `pnpm lint` now runs `biome lint --error-on-warnings`, so lint warnings fail the build. All 57 warnings were resolved with types and explicit control flow rather than suppressions; no rule was weakened.
- `SessionState.manualMode` narrowed to `false | "active"`, pinned by a type-level test. Version-1 snapshot compatibility is unchanged.
- Session reports are identifier-free: each file is reported by a one-based `fileIndex` instead of its path, and input paths, basenames, provider/model names, usage kinds, and notes are no longer retained.

### Removed

- Dead manual-trigger state: the unused `pendingManualTrigger` field and the unreachable `compress-pending` manual mode. No command, handler, serializer, or restorer consumed either.

### Notes

- No pruning policy changed in this release. Incremental pruning timing and strategy eligibility are unchanged; this release only collects the evidence that a future change would require.

## 2026-08-28 - [0.6.0]

### Added

- Top-level `disabledModels` config (exact, case-sensitive `provider/modelId` keys) that disables DCP processing, mutating commands, and the active `compress` tool for the configured models.
- Per-model compression thresholds via `compress.modelMaxLimits` / `modelMinLimits` (accept percentage strings such as `"80%"`), dormant while the model is disabled.

### Changed

- `compress` tool is dynamically removed from the active tool set when the live model is in `disabledModels`, and restored when the model switches back to an enabled one; existing DCP state is preserved across disabled windows.
- Session analysis now hashes session content when collecting evidence, and validates DCP state records against expected shapes before reading them.
- DCP disablement now treats empty-string model entries as disabled and checks global configuration in addition to project configuration.

### Fixed

- Skip `pi-dcp-state` snapshots that contain only message references, so the latest valid snapshot is restored on resume.
- Sanitize malformed `<dcp-message-id>` and `<dcp-system-reminder>` references in assistant output, including bound suffix matching and unicode message-like payloads.
- Use Node's native `path.posix.matchesGlob` for protected patterns, with a compatibility fallback for leading-dot path segments so existing configs continue to match `.pi/**` and similar.
- DCP statistics and anchor cleanup now keep cumulative numbers and prune-anchor ordering coherent across session compaction and pruning runs.
- Live model switching no longer leaves stale `compress` registrations or double-registrations when toggling between disabled and enabled models.

## 2026-08-01 - [0.5.0]

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
