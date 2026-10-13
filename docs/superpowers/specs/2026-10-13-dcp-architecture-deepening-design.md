# DCP reporting, branch persistence, and compression run depth

This approved design follows the architecture review at `41da383`. It reduces
caller-managed knowledge in three modules without changing DCP behavior.

The user chose to explore all three candidates from simplest to most complex,
preserve current reporting output, combine branch restoration with checkpoint
writes, and combine compression execution with completion. Those are agreed
scope decisions. The module paths and implementation arrangements below are
author recommendations. The user approved this design for implementation
planning on 13 October 2026. Implementation is a separate execution step.

## Order and success criteria

1. Shared read-only reporting facts: text commands and dashboard tabs obtain
   common metric values from one module while retaining their current output.
2. Branch persistence: one module owns branch restoration and checkpoint
   decisions, including fallback, repair, owner-session handling, and fingerprint
   memory.
3. Compression run execution: one module owns per-call execution and completion
   ordering while retaining the compression block owner and native approval.

Each phase must be independently usable and verifiable. No phase introduces
an unused scaffold for a later phase. Depth must come from knowledge absorbed by
the module, not from moving the same coordination into another file.

## Compatibility constraints

- Preserve current commands, text output, dashboard rows, notifications, tool
  result text, optional display metadata, error messages, and UI routing.
- Preserve pruning/compression algorithms, protected content, message references,
  compression priority, nudges, tool selection, and statistics calculations.
- Preserve snapshot version `2`, reading versions `1` and `2`, durable field
  names, fingerprints, owner-session statistics rules, and repair behavior.
- Preserve the identities of the root `SessionState` and configuration objects.
  Read replaceable nested state and current configuration at operation time.
- Preserve host event order, per-call approval, approval cancellation, policy
  rechecks, unexpected exception propagation, and checkpoint trigger locations.
- Keep Node, TypeScript/ESM, current dependencies, and existing configuration.
  Add no configuration option, dependency, generic event framework, or release.
- Preserve meaningful behavior coverage. Replace implementation-specific tests
  only after equivalent coverage exists at the owning module's interface.

## Phase 1: Read-only reporting facts

The reporting module will concentrate context, session statistics, and lifetime
statistics facts currently selected independently by text commands and the
dashboard projection. Proposed location: `src/reporting.ts`.

Its implementation reads the current values needed for those reports and
produces a read-only snapshot. It must not retain state references as the result,
cache reports across actions, mutate state, perform lifetime file scanning, or
turn display strings into the shared source of truth.

The text and TUI adapters keep labels, row identities/order, headings,
alignment, token formatting, rounding, pluralization, and availability text.
In particular, text context percentages retain `toFixed(1)` while dashboard
percentages retain their current precision. Text manual-mode values and dashboard
on/off labels also remain different. Missing usage, null tokens/percentages,
zero values, missing lifetime totals, and unavailable models retain each
adapter's current behavior.

Common fact selection must be used by `contextCommand`, `statsCommand`,
`lifetimeCommand`, and `buildDcpPanelModel`; do not create a second projection
that only tests call. Dashboard controls, compression block lifecycle projection,
policy checks, model identity/limit resolution, and shared Help descriptors keep
their existing owners unless an existing reporting fact directly needs them.

Lifetime scanning stays in the existing persistence implementation.
`lifetimeCommand` continues to load totals for its invocation, and the panel
continues to load totals once before its action/rebuild loop. The reporting
module receives the loaded totals rather than deciding when to load them.

The repeated text table formatter is not sufficient justification for this
phase: depth comes from sharing factual selection across the two real adapters.
Use the smallest concrete fact projection that removes duplicate selection;
do not introduce a reporting registry or a universal dashboard row model.

Verification must prove shared metric values, unchanged exact text output,
unchanged dashboard field sources and row identities, missing/zero cases,
read-only behavior, fresh nested state after restoration, and one lifetime load
per panel invocation. Existing narrow-terminal and routing tests remain.

## Phase 2: Branch restoration and checkpoints

The branch persistence module will concentrate the closure-local restoration
and checkpoint decisions in `src/index.ts`. Proposed location:
`src/state/checkpoints.ts`.

The module owns:

- Reset/default/restore sequencing common to session start and branch navigation,
  delegating reset to `resetSessionState` and decoded restoration to the codec.
- Reverse branch scanning and selection of the newest valid DCP snapshot.
- Owner-session and skipped-invalid-snapshot decisions that require a repair
  checkpoint, including the baseline checkpoint when no valid snapshot exists.
- The last successfully persisted fingerprint and the force decision awaiting
  the restoration event's checkpoint attempt, outside serialized state.
- Changed-state deduplication, append attempts, and the existing warning on
  append failure.

The snapshot codec retains validation, decoding, serialization, fingerprint
calculation, and owner-session statistics materialization. The compression
block module retains every block-state write, allocation counter, relationship,
and visibility rule. No new graph repair or snapshot validation is added.

Restoration must remain separate in time from the later checkpoint attempt:
session-start configuration reload precedes restoration, and existing model,
subagent, prompt, tool-registration, selection, and context-window updates occur
before the checkpoint. Branch navigation similarly retains its current
tool-selection ordering. The module should remember the repair decision so the
host adapter does not have to manage snapshot/fingerprint internals between
those steps.

Configuration reload, prompt setup, model refresh, tool selection, raw-context
cache reset, and unrelated host event work remain in the extension adapter.
The common reset operation must not absorb those responsibilities merely to
make the interface smaller.

Keep the current checkpoint triggers: normally completed permitted operator
actions, session start, branch navigation, compaction, shutdown, compression
completion, and context processing. Do not add eager writes or change the order
relative to selection, timing, or notifications. Compaction retains its distinct
reset semantics, including stable message-reference and allocation sequences.

The fingerprint advances only after a successful host append. A failed append
does not mark changed state as persisted. Preserve the existing retry behavior,
fingerprint exclusions, and no-op behavior. The internally remembered force
decision replaces the current caller-local force flag for that event's attempt;
it must not introduce a new durable or recurring forced-retry policy.
Session-start and branch-navigation memory handling must follow their existing
observable behavior rather than introducing a new branch policy.

The Pi host adapter supplies current branch entries/session identity and append
behavior. Tests use the existing host harness and a recording/throwing append
adapter; no filesystem or transport framework is needed for the module seam.

Verification must cover same-owner resume, inherited-owner statistics,
malformed/unsupported snapshot fallback, baseline and repair checkpoints,
unchanged-state deduplication, append failure followed by retry, and shutdown
persistence. Existing codec, compaction, command-callback, block-restoration,
and host contract coverage remains.

## Phase 3: Compression run execution and completion

The compression run module will concentrate policy and lifecycle knowledge
currently spread across tool preflight, direct execution, and completion in
`src/index.ts`. Proposed location: `src/compress/execution.ts`.

The module owns current per-call policy evaluation, execution-time permission
decisions, approval coordination, the existing post-approval abort/policy
rechecks, timing start/cleanup, and completion sequencing. Both range mode and
message mode use it. Tool-call rejection and direct-execution rejection retain
their distinct existing messages and result shapes.

The extension adapter retains registration, mode-specific schemas/descriptions,
host event translation, and model refresh/tool-selection effects. Tool preflight
can delegate compression-run policy knowledge only after the existing model
refresh; policy queries acquire no tool-selection or persistence side effects.

`requestCompressionApproval` remains the native approval adapter and continues
to support TUI/RPC confirmations, unavailable UI, cancellation, and signal
handling. The run module awaits it for every `ask` call. Approval remains outside
the guarded operator-action module. Preserve the current recheck conditions;
do not introduce new cancellation behavior for the `allow` path.

After approval, use current configuration, nested state, and the latest raw
context at the point compression work begins. Do not capture stale nested maps
or a raw-context array when the run module is created. This refactor introduces
no new approval/branch concurrency or cancellation policy.

`handleCompress` and `recordCompressionDuration` remain operations of the
compression block owner. The run module delegates to them. Notification
delivery, display metadata, and host result formatting remain presentation
adapters, with their current order and exception behavior preserved.

Timing starts immediately before actual compression work, after approved
`ask` checks. Denied calls create no start-time entry. Completion removes a
matching timing entry even on error or when policy has since changed. A start
time of zero is valid. Errors do not update duration; successful completion
delegates duration recording to the block owner. The current timing state shape
and clearing on full reset/compaction remain compatible.

After every compression completion event, including denied/error/no-matching
timing events, the branch persistence module attempts the same deduplicated
checkpoint as today. Callers must not need to remember a separate
timing-then-checkpoint sequence. Non-compression completion behavior remains in
the extension adapter.

Verification must cover both modes, separate rejection messages, per-call
approval and unavailable UI, denied/cancelled/aborted approvals, policy changes
after approval, no timing before work, time zero, errors, policy changes before
completion, multi-block duration updates, and one post-duration checkpoint.
Keep real host contract tests across context, execution, completion, and the
next context pass; new module tests supplement or replace overlapping private
tests rather than removing host integration evidence.

## Prior placement choices being revisited

No ADR exists for these placements. The approved 12 October architecture design
and its phase-2 plan retained approval/checkpoint orchestration and runtime
timing in their current owners while deepening other modules.

Phases 2 and 3 deliberately revisit that placement after those earlier owners
shipped. The reason is remaining caller-managed ordering and repeated branch
reset sequencing. The new design preserves the earlier codec, block lifecycle,
tool selection, and guarded operator-action responsibilities. Extraction that
only renames/moves existing closures without shrinking caller knowledge does
not satisfy this design.

## Verification and builder discretion

The review baseline passed 12 focused test files / 331 tests. That is evidence
for the starting behavior, not verification of these proposed changes.

For each phase, add necessary characterization/missing behavior tests first,
run the relevant focused checks, integrate all production callers, then run
`pnpm check` and `git diff --check`. A complete phase leaves no obsolete
caller-managed path. Preserve exact output tests rather than approving updated
snapshots to mask presentation changes.

Builders choose concrete types and operation names, private helper layout,
and the smallest dependency injection needed for the real production/test
adapters. The proposed file paths are recommendations. Keep one clear owner
per responsibility; no general event bus, report framework, storage framework,
new behavior, or unrelated cleanup.

Implementation planning follows approval of this design. No product code is
changed by this document.

## Implementation plans

- [Phase 1: Shared reporting facts](../plans/2026-10-13-dcp-depth-phase-01-reporting.md)
- [Phase 2: Branch restoration and checkpoints](../plans/2026-10-13-dcp-depth-phase-02-checkpoints.md)
- [Phase 3: Compression run execution and completion](../plans/2026-10-13-dcp-depth-phase-03-compression-execution.md)

The plans fix concrete interfaces and test cases for the approved scope.
Implementation has not started. At plan-writing time on 13 October 2026,
`pnpm check` passed formatting, lint, type checking, and 66 test files / 1,153
tests against the unchanged product code.
