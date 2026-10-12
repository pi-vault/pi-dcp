# DCP architecture improvements

The approved design concentrates shared action decisions, compression-tool selection, and compression block lifecycle behavior behind deeper modules. The aim is leverage for callers, locality for maintainers, and behavior tests that cross the same seams as production callers.

The user approved the design during the architecture discussion on 2026-10-12. This document records that agreement; file names, interface details, and the four-phase split below are planning choices made by the author.

## Goals

- Commands and the TUI panel share one guarded execution path for manual mode, compression permission changes, sweep, decompression, and recompression.
- One module owns compression-tool selection memory, model identity updates, fresh-session selection, suppression, and restoration.
- One module ultimately owns every production write to compression block state, including derived visibility and allocation counters.
- Every implementation phase leaves DCP working and can be reviewed, shipped, or reverted as a complete change.

## Compatibility constraints

- Preserve current user-visible command messages, argument parsing, notification delivery, panel behavior, and compression tool results.
- Preserve automatic tool pruning, compression selection and protection rules, message references, priorities, nudges, model-visible context, and token statistics.
- Preserve snapshot serialization version `2` and reading of versions `1` and `2`; preserve existing field names and values, fingerprints, repair checkpoints, and owner-session statistics behavior.
- Keep Node `>=24.15.0`, the existing TypeScript/ESM tooling, and current dependencies. Introduce no dependency or configuration option.
- Keep informational commands and model compression execution/approval outside the guarded action module. Approval must still happen per call and be rechecked after the wait.
- Permission denial alone still permits automatic tool pruning, manual mode changes, sweep, and block controls.
- Preserve the existing root `SessionState` and config identities. Read their nested values at call time because reload and restoration can replace nested objects or maps.
- Preserve unexpected exception propagation. Invoke the state-change callback after a normally completed, policy-allowed action, including validation-error and no-op results; skip it for policy rejection, panel close, and a command that throws.
- Keep all current meaningful behavior coverage. Replace obsolete tests of private graph helpers only when equivalent public-seam coverage exists.

## Guarded DCP actions

The module accepts an action request, the caller's current command context, and the existing state/config/callback dependencies. It checks current capability policy, performs the requested action, invokes the existing state-change callback exactly once after normal completion, and returns the permitted status and domain message.

Commands and the panel are the two real adapters. They keep notification and rendering work. The panel remains a read-only projection and rechecks policy and block state at execution time. A stale missing-block action continues to return its existing error message as a permitted attempt and still runs the callback.

The callback is significant even when the requested action changes no durable fields: it refreshes model identity, reconciles compression-tool selection, and attempts persistence. Fingerprint deduplication continues to suppress duplicate snapshots without suppressing those other effects.

The first refactor retains the existing manual, permission, sweep, decompression, and recompression implementations internally. It removes duplicated policy/dispatch/callback ordering from their adapters rather than introducing a general command framework.

All five existing implementations and the callback execute synchronously. The new execution interface remains synchronous; this plan introduces no asynchronous action implementation. An implementation that throws never reaches the callback. A callback that itself throws propagates its error and is not retried.

## Compression-tool reconciliation

The module retains the live root state/config references and uses the existing Pi host tool-selection operations. The production host and existing extension harness are the two adapters at that seam. Capability calculation stays in `src/capabilities.ts` for independent use by compression execution, commands, and projections.

The module owns both kinds of ephemeral memory:

- First-session processing belongs to the extension instance.
- Pre-suppression selection belongs to the current branch and is cleared when that branch is reset.

Neither becomes snapshot data. Pi's restored selection remains authoritative. Fresh-session selection stays first-session-only, respects reload, declared selections, and host exclusions, and happens after tool registration. A suppressed tool is restored only when every policy reason clears and it was selected before suppression. User deselection is preserved.

Preserve the existing selection predicate exactly: on the first `session_start`, skip implicit selection for reason `reload`, a structured loadout declaration in the branch, an unregistered/excluded `compress` tool, or an already-active tool. Do not add a new event-reason filter. Later `session_start` events and `session_tree` transitions clear pre-suppression memory without repeating implicit selection. Neither compaction nor ordinary model/context transitions resets the extension-instance first-session flag.

Model identity changes only when a model is supplied. Model-select, context, prompt setup, session start, branch navigation, and action callbacks retain their current observable ordering. A policy-only capability query does not acquire new tool-selection side effects.

## Compression block lifecycle

The module owns compression run creation, block allocation, summary wrapping, block relationships, decompression, recompression, synchronization, and derived visibility. Existing selection, protected-content, message-reference, and token-estimation computations are retained; this work changes ownership rather than algorithms.

Its public operations express domain actions rather than caller-managed graph updates. Allocation, storage, eligibility collection, relationship rebuilding, and individual lifecycle flags become private implementation details. Read-only projections may continue reading the current state shape; this design does not redesign every reader or require opaque storage.

The completed module also owns:

- Initial block-state creation and full session reset: empty block state with allocation counters set to `1`.
- Compaction: empty block state while preserving allocation counters and the separately managed stable message-reference sequence.
- Restoration: materialization of already-decoded durable block facts and restoration of counters, with derived visibility rebuilt on the next context pass.
- Duration recording: block duration writes for completed compression calls. Runtime start-time bookkeeping stays in its existing lifecycle adapter.

The snapshot codec remains responsible for version validation, decoding, serialization, and fingerprinting. It delegates block materialization to the owner. Owner-session comparison and session-wide statistics restoration remain in persistence orchestration.

Parsing continues to reject invalid top-level snapshots, discard invalid/duplicate block records with the existing warning, and remove missing/self consumed-block references. Do not add new graph rejection or repair rules. The lifecycle owner accepts these decoded facts, initializes blocks as inactive with runtime indices `-1` and empty derived memberships, and restores each allocation counter to the maximum of its decoded value and every restored identifier plus `1`. Every restore path continues to rebuild relationships and visibility on its next production context pass. The existing branch orchestration selects fallback snapshots and decides when to append repair checkpoints.

Duration recording preserves `applyCompressionTiming`: ignore non-compression events or events without a start time; remove a matching start-time entry even on error; update every block belonging to the call only when `isError` is not true. A timestamp of `0` is a valid start. Calls with no matching blocks write no duration. Approval-denied calls create no start time; cancellation/error completion does not update block duration.

Consumed blocks and user-deactivated blocks remain distinct. Removing an active parent can reveal eligible consumed children; it must not reactivate a user-deactivated child. Recompression restores eligibility using the existing summary and can leave a block hidden by another active parent.

## Atomic implementation sequence

| Phase | Deliverable | Why it is usable on its own |
| --- | --- | --- |
| 1 | Shared guarded action execution | Every affected command and panel action uses the new path; other behavior is unchanged. |
| 2 | Compression-tool selection owner | Every production selection transition uses the new owner; phase 1's callback still works. |
| 3 | Ordinary compression block lifecycle owner | Creation, controls, and synchronization use one owner; existing restore/reset/timing paths continue working. |
| 4 | Complete block write ownership | Restore, initialization, reset, compaction, and duration writes join the owner without changing storage. |

The split between phases 3 and 4 is deliberate. Phase 3 documents its remaining external writers rather than claiming complete ownership. Phase 4 closes those writers. No phase introduces an unused scaffold, requires a later phase to compile, or removes a working path before its replacement is integrated.

The complete phase-3 exception list is: initial block-state creation and full reset in `src/state/state.ts`; block materialization and allocation-counter restoration in `src/state/persistence.ts`; block clearing on compaction and duration updates in `src/index.ts`. Those are exactly the production writers phase 4 migrates. Session-wide statistics, tool-pruning state, message-reference caches, nudge tracking, start-time maps, and persistence fingerprints are not compression block state and retain their current owners.

Every phase includes its behavior tests, production integration, removal of obsolete paths, narrow checks, `pnpm check`, and one reviewable commit. Intermediate work inside a phase is not a release point.

## Verification and success criteria

- Phase 1: command/panel parity, policy rejection, permission-only denial, stale blocks, callback identity/order/count, no-op callbacks, and unexpected exceptions.
- Phase 2: fresh/resume/reload/branch behavior, exclusions, declared selections, repeated and overlapping suppression reasons, user deselection, current model/config values, and unchanged policy-only queries.
- Phase 3: both compression modes, protection and overlap rejection, nested consumption, decompression/recompression, user-deactivated children, stale synchronization, token statistics, and repeated compression through `runPipeline`.
- Phase 4: v1/v2 restoration and round trips, invalid-snapshot fallback/repair behavior, inherited-owner statistics, counter restoration, compaction versus reset, timing completion/error handling, and a production block-write ownership audit.
- Existing SDK/host contract tests and benchmark token gates remain green throughout.
- Each phase passes `pnpm check` before its commit. There is no package version bump or release as part of this work.

## Builder discretion

The phase plans fix module paths, public operation names/types, integration points, and behavioral assertions. Builders choose private helper layout and idiomatic TypeScript details within those contracts. They should avoid extra adapters for in-process computation, generic dispatch infrastructure, speculative configuration, and unrelated cleanup.

The current planning task produces documentation only. Implementing a phase is a separate execution step after plan review.
