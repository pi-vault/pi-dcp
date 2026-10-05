# Pi DCP Improvement Roadmap Design

**Date:** 2026-10-03

**Revised:** 2026-10-04

**Status:** Approved in chat; reordered from simplest to most complex; Phases 2 and 4 clarified
after implementation-readiness reviews, including Phase 4 tool-guidance and restoration decisions

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
does not return a complete `systemPrompt` or alter another extension's forced prompt. Custom prompts
reload once at the start of `before_agent_start`. The resulting prompt snapshot is shared by the
system section and every subsequent context pass until the next `before_agent_start`; edits made
during a run become effective on the next run. Trusted-project, global, and bundled precedence
remain unchanged.

A single capability calculation supplies two related decisions:

- The pipeline may run only when DCP is globally enabled, the model is enabled, and the current
  process is an allowed sub-agent.
- Model-driven compression is available only when the pipeline may run and compression permission
  is not `deny`.

`getDcpCapabilities` exposes these policy decisions as `pipelineEnabled` and `compressionEnabled`.
Applicable suppression reasons are evaluated independently and reported in the fixed order
`config`, `model`, `subagent`, `permission`. Active-tool selection and manual mode are not policy
suppression reasons. Compression instructions and nudges additionally require that `compress` is
active. A deselected tool therefore receives no guidance, while automatic deduplication, stale-error
pruning, reference assignment, and existing compression summaries continue when the pipeline is
eligible. Nudges retain their existing manual-mode behavior.

Register the single `compress` tool during extension creation with the global mode's provisional
schema, `defaultActive: false`, and `executionMode: "sequential"`. Session start refreshes the
definition after loading trusted project configuration. Pi's reload path activates default-active
extension tools, so early registration alone cannot preserve a user's inactive selection.

Implicit activation happens only on this extension instance's first session-start event when the
reason is not `reload`, the active branch has no structured system message declaring a tool loadout,
and the host includes `compress` among configured tools. A system message with `sections`,
`toolsAdded`, or `toolsRemoved` declares a loadout even when those collections are empty.
This provides the fresh-session default without overriding exclusions. Perform it before policy
suppression; a fresh denied session can
then restore that default selection when permission allows. Never implicitly activate on subsequent
session events, tree navigation, reload, or resume of a declared loadout.

Restore branch state and establish model identity and process sub-agent status before reconciling
exposure. Reconcile after session/tree restoration, model selection, command state changes, and
before prompt/context processing. Command state callbacks have type
`(ctx: ExtensionCommandContext) => void` and receive the current context so permission changes
immediately after startup cannot use stale model identity. Cached messages are cleared on
session/tree changes.

Within a branch, remember whether the tool was active at the first suppression transition. Keep
that value through overlapping reasons and restore only a recorded active selection when all
reasons clear. On session/tree changes, discard previous-branch suppression memory and honor Pi's
selected loadout. Keep this memory out of snapshots. Definition refresh, resume, and reload must
not reactivate a host-selected inactive tool.

Guard both the `tool_call` event and registered `execute` function against every policy suppression
reason. Mutating commands require pipeline eligibility; `dcp:compress` additionally requires
compression availability and an active tool, and never activates the tool implicitly. Informational
commands remain available. Permission denial does not disable automatic strategies or existing
block activation controls.

The `compress` tool executes sequentially because it mutates shared session state. Public Pi
session-manager methods are used directly rather than hidden behind `unknown` casts. A typed
extension harness supplies checked events and fixtures; offline public-SDK contract tests cover
registration, selection, and structured prompts. Refactor characterization tests pass before cast
removal; behavioral changes have separate failing tests.

The Phase 4 review used Pi revision `1b094148b91d737fb398bf1591604de58ec169e1` (v1.0.2) and OpenCode
DCP revision `f8232fde1e63c2251687e4d9634bd53ce11568cb` (v3.2.0). Pi's relevant lifecycle contracts
are unchanged from `83692682f` and supported by installed v1.0.1 development packages. This phase
adds no dependencies or package upgrades and retains snapshot v1, existing configuration, command
names, marker syntax, and pruning/protection/benchmark behavior.

## Phase 5: Permission and Panel UX

Compression permission becomes `allow | ask | deny`:

- `allow` exposes and executes `compress` normally.
- `ask` exposes it and requests Pi confirmation for every model-issued call. The dialog includes
  the topic and number of targets/ranges. Rejection blocks the call. A non-interactive session
  fails closed with an explanatory reason.
- `deny` hides the tool, removes its prompt section and nudges, and blocks defensive direct calls.

Allow and ask preserve Phase 4's selection rules: neither activates a user-deselected tool, and
instructions/nudges require an active tool. Permission changes and panel actions reconcile through
the current command context; restored Pi loadouts remain authoritative across session/tree changes.

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
