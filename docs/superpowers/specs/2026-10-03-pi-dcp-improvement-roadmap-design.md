# Pi DCP Improvement Roadmap Design

**Date:** 2026-10-03

**Revised:** 2026-10-04

**Status:** Approved in chat; reordered from simplest to most complex; Phase 2 clarified after
implementation-readiness review

## Purpose

Bring pi-dcp into precise alignment with the current Pi 1.0 extension API while preserving its
Pi-native persistence, compression correctness, and incremental pruning behavior. Low-risk
maintenance establishes a clean baseline first, correctness and marker changes follow, lifecycle
coordination comes after those foundations, and the stateful interactive UX ships last.

The work is split into five independently releasable phases in increasing implementation
complexity:

1. Warning-free maintenance and prompt-cache evidence.
2. Pi path protection and configuration correctness.
3. Compact message markers without persisted-state migration.
4. Current Pi prompt and tool-lifecycle integration.
5. `ask` permission and a Pi-native DCP panel.

## Project-Wide Constraints

- Preserve support for existing JSON configuration; JSONC is explicitly out of scope.
- New releases must read existing version-1 snapshots, padded message IDs, and legacy XML markers.
- Keep canonical persisted message references as `m0001`, `m0002`, and so on.
- Use the current Pi checkout as the API authority. Phase 2 targets the Pi 1.0.1 message types at
  revision `83692682f`; host-provided packages remain `"*"` peers while development dependencies
  and the lockfile track that API. OpenCode DCP is behavioral inspiration only; do not copy its
  AGPL source.
- Do not add OpenCode-specific adapters, authentication, auto-update, or sandbox infrastructure.
- Keep incremental deduplication and stale-error pruning behavior unchanged until cache evidence
  demonstrates a better policy.
- Do not add new runtime dependencies unless Pi provides them. Host-provided packages remain exact
  `"*"` peers with compatible development dependencies.
- Each phase uses test-driven development, updates its user-facing documentation, and passes the
  complete repository verification before release.

## Phase 1: Maintenance and Cache Evidence

All existing Biome warnings are resolved without blanket rule suppression. The lint script uses
`--error-on-warnings`, making zero warnings part of `pnpm check`.

`compress-pending` and `pendingManualTrigger` are removed after the stale command test is replaced
and tests confirm that no command, lifecycle handler, or snapshot uses them. Other state is retained
unless the same proof exists. A concise provenance document records the historical adaptation and
behavioral-comparison boundaries, repository revisions, and licenses without making a legal or
clean-room claim.

Session analysis aggregates every usage carrier recognized by the current Pi session model:
assistant messages, standalone usage entries, and optional tool-result, compaction, and branch
summary usage. It reports uncached input, output, cache reads and writes, optional one-hour cache
writes and reasoning, reported token totals and cost components, and response-latency samples from
adjacent session-entry timestamps. Reports expose only numeric aggregates and ordinal file indices;
they never retain paths, basenames, IDs, hashes, provider/model metadata, notes, prompt contents,
tool arguments, errors, summaries, or credentials. Invalid usage and invalid latency samples have
separate diagnostics and do not abort analysis. Incremental pruning remains unchanged in this phase;
the report supplies evidence for a later proposal.

The package is verified against exact Node 22.19.0 and the current Node 24 line. The existing engine
floor remains in place until the Node 22.19.0 CI job passes. If both jobs pass unchanged,
`engines.node` becomes `>=22.19.0`; otherwise the existing floor remains and the incompatibility is
documented instead of patched speculatively.

## Phase 2: Correctness and Configuration Safety

### Protected paths

Pi's built-in `read`, `write`, and `edit` tools use `path`, while pi-dcp currently recognizes only
`filePath`. Direct calls to those three tools must recognize `path`; the legacy `filePath` key
remains supported for all tools. Candidate paths are normalized from backslashes to forward slashes
before glob matching, but `matchesGlob` itself retains its POSIX-oriented contract. A generic
`path` argument on an unrelated tool is not assumed to identify a file.

Pi records calls made by orchestration tools under
`toolResult.nestedCalls.calls[].{name,arguments}`. The tool cache must aggregate paths from the
parent call and every well-formed nested call. If any aggregated path matches
`protectedFilePatterns`, deduplication, stale-error purging, and manual sweep must preserve the
parent tool result. Missing, truncated, or malformed nested arguments are ignored without losing
valid paths from other calls. Pi may omit `arguments` when its bounded nested-call record exceeds a
size limit and marks such records with `complete: false`; this is expected input, not a fatal error.

### Configuration

An absolute context limit is a positive finite integer. A percentage is a decimal string ending in
`%` whose numeric value is greater than zero and no greater than 100. The same rule applies to
global and per-model min/max limits.

Unknown top-level and nested keys are detected before TypeBox cleaning. Global and trusted-project
layers are sanitized independently before merging: an invalid global field inherits the built-in
default, while an invalid project field inherits the valid global value. Invalid optional map
entries are removed individually so valid siblings remain and resolution falls back through the
same layer order. Every diagnostic identifies the source file and JSON-pointer path. Each
configuration reload shows at most one summarized UI warning, while the logger retains individual
warnings. A bad configuration must never abort session startup.

### Nudge force

When a user turn crosses the minimum threshold, pi-dcp records both that user message and the
preceding assistant message as a pair. `nudgeForce: "strong"` injects the turn nudge on the user
message; `"soft"` injects it on the preceding assistant message. If no preceding assistant exists,
the turn nudge is skipped. A preceding assistant message containing only tool calls receives a
synthetic text part before its first tool call so soft mode still injects visibly. Context-limit and
iteration nudges retain their existing behavior, and the version-1 snapshot shape is unchanged.

## Phase 3: Compact Markers

Canonical state references remain padded, but messages presented to the model use compact markers:

- Range mode: `@m1@`
- Message mode, priority 3: `@m1:3@`

Tool inputs accept bare compact IDs (`m1`), wrapped compact markers (`@m1@` and `@m1:3@`), padded
legacy IDs (`m0001`), and existing block IDs (`b1`). All message variants normalize to the padded
canonical reference before lookup.

Sanitization removes complete and bounded malformed compact markers in addition to existing XML
forms. It must not consume email addresses, prose containing an `@`, or unrelated identifiers.
Prompts and tool descriptions teach the new marker syntax and tell the model not to reproduce it.

The deterministic clean-session benchmark must reduce marker overhead by at least 70 percent from
the retained 20,000-token baseline. Repeated-tool and nested-block workloads must retain at least
their existing qualitative reductions and must not regress by more than five percentage points.

## Phase 4: Current Pi Lifecycle Integration

The DCP system instructions are written to `event.systemPromptOptions.sections.dcp`; the extension
does not return a complete `systemPrompt`. Custom prompts reload at the start of
`before_agent_start`, so the prompt section and later context transformation use the same values in
the same turn.

A single capability calculation supplies two related decisions:

- The pipeline may run only when DCP is globally enabled, the model is enabled, and the current
  process is an allowed sub-agent.
- Model-driven compression is available only when the pipeline may run and compression permission
  is not `deny`.

Compression permission controls the `compress` tool, its prompt section, and its nudges. It does
not disable automatic deduplication or stale-error pruning, preserving current behavior. Tool
exposure is reconciled after session restoration, model changes, permission changes, and sub-agent
detection. If DCP removes an active tool temporarily, it restores it only when it was active before
suppression. An already user-disabled tool remains disabled.

The `compress` tool executes sequentially because it mutates shared session state. Public Pi
session-manager methods are used directly rather than hidden behind `unknown` casts.

## Phase 5: Permission and Panel UX

Compression permission becomes `allow | ask | deny`:

- `allow` exposes and executes `compress` normally.
- `ask` exposes it and requests Pi confirmation for every model-issued call. The dialog includes
  the topic and number of targets/ranges. Rejection blocks the call. A non-interactive session
  fails closed with an explanatory reason.
- `deny` hides the tool, removes its prompt section and nudges, and blocks defensive direct calls.

The permission command cycles `allow -> ask -> deny -> allow`. Snapshot version 2 persists the new
union; its parser continues accepting version 1 unchanged.

The new `dcp` command opens a Pi custom panel. It displays the active model, context usage, resolved
thresholds, compression and manual modes, permission, compression blocks, session savings, and
lifetime totals. Selectable actions toggle manual mode, cycle permission, sweep eligible outputs,
and deactivate or reactivate a selected block. Existing commands remain stable shortcuts and the
fallback when no TUI is available.

The panel uses arrow keys or `j`/`k`, Enter, and Escape or `q`. Rendering is usable at 60, 80, and
120 columns. A pure view-model builder and action executor isolate behavior from the terminal
component; the component only renders, tracks selection, and returns an action.

`@earendil-works/pi-tui` is added as a host-provided `"*"` peer and a development dependency, not a
runtime dependency.

## Acceptance

Every phase passes formatting, warning-free lint, TypeScript, all Vitest tests, generated-schema
comparison, package dry-run, and its focused benchmarks. Manual Pi verification covers system
prompt sections, tool visibility, permission confirmation, session resume/fork/tree restoration,
and panel input at narrow and wide widths. Publishing is not part of implementation; release
metadata and changelog entries prepare each phase for a separate publish decision.
