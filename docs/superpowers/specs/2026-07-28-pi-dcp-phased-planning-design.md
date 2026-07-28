# Pi DCP Phased Reliability Planning Design

Date: 2026-07-28

## Purpose

Split the existing Pi DCP reliability roadmap into a new phased parent/index plan and five independently releasable phase plans. Preserve the existing roadmap unchanged as the source of detailed requirements.

Every phase must end with coherent behavior, documentation, full verification, and no dependency on unfinished later phases.

## Source Preservation

The source roadmap remains:

`docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md`

It must remain byte-for-byte unchanged while the phased plans are created. The documentation workflow verifies this with:

```bash
git diff --exit-code HEAD -- docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md
```

The new documents extract and reorganize its content; they do not replace it.

## Document Structure

Create these files under `docs/superpowers/plans/`:

- `2026-07-28-pi-dcp-reliability-phased-roadmap.md`
- `2026-07-28-pi-dcp-phase-1-pruning-foundation.md`
- `2026-07-28-pi-dcp-phase-2-turn-and-pair-safety.md`
- `2026-07-28-pi-dcp-phase-3-compression-correctness.md`
- `2026-07-28-pi-dcp-phase-4-native-session-state.md`
- `2026-07-28-pi-dcp-phase-5-operator-and-release-hardening.md`

The parent/index contains phase order, dependencies, user-visible outcomes, entry and exit criteria, status, and links. It does not duplicate detailed implementation steps.

Each phase plan is self-contained and uses the standard writing-plans header. It includes:

1. Source-roadmap mapping.
2. Prerequisites limited to completed earlier phases.
3. Exact file map.
4. Bite-sized TDD tasks with code, commands, expected failures, expected passes, and commit boundaries.
5. User-facing documentation changes.
6. Focused verification followed by full release checks.
7. Acceptance criteria proving the phase is usable.
8. Explicit exclusions delegated to named later phases.
9. Stable interfaces available to the next phase.

## Phase Sequence

### Phase 1: Pruning Foundation

Source: parent Tasks 1 and 4.

Deliver:

- Provenance and verification baselines.
- Failed assistant arguments are purged while error diagnostics remain intact.
- Default protected tools become `compress`, `write`, `edit`, and `subagent`.
- Pruning behavior and release notes are documented.

Usable result: safer and more effective pruning without changing persistence, compression structure, or configuration shape.

Exclude:

- User-turn protection.
- Compression block changes.
- Native session snapshots.
- Project configuration and manual compression.

### Phase 2: Turn and Pair Safety

Source: remaining safety work from parent Task 4.

Prerequisite: Phase 1 released.

Deliver:

- Opt-in top-level `turnProtection: 0`.
- Tool-call age derived from user turns rather than agent iterations.
- Protection applied to deduplication, stale errors, sweep, and compression.
- Tool-pair handling aligned with Pi’s native missing-result normalization.
- Generated schema and configuration documentation updated.

Usable result: fresh work is protected consistently during normal context rebuilding.

Exclude:

- Compression ownership, nesting, and accounting.
- Native session persistence.
- Project configuration and manual compression.

### Phase 3: Compression Correctness

Source: parent Task 3.

Prerequisite: Phase 2 released.

Deliver:

- Blocks owned by the real compression `toolCallId`.
- All batch selections validated before state mutation.
- Nonzero incremental visible-token accounting.
- Complete nested-block consumption and relationships.
- Duration applied to every block produced by a batch.
- Corrected compression and notification behavior documented.

Usable result: deterministic compression within a running session, including batches and nesting.

Exclude:

- Resume, fork, and tree restoration.
- Lifetime-session aggregation.
- Project configuration and manual compression.

### Phase 4: Native Session State

Source: parent Tasks 2 and the lifetime portion of Task 6.

Prerequisite: Phase 3 released.

Deliver:

- Versioned `pi-dcp-state` snapshots stored as Pi custom entries.
- Correct restoration across resume, fork, tree navigation, and compaction.
- Rebuilding Phase 2 user-turn metadata and rehydrating the final Phase 3 compression shape.
- Shared legacy sidecars ignored for restoration and left untouched.
- Lifetime totals derived from real Pi session snapshots without fork double-counting.
- Recovery, migration, snapshot, and lifetime semantics documented.

Usable result: all reliability behavior from Phases 1–3 survives Pi lifecycle operations safely.

Exclude:

- Trusted project configuration.
- Manual compression trigger.
- Deterministic benchmarks.

### Phase 5: Operator and Release Hardening

Source: parent Tasks 5 and the benchmark/release portion of Task 6.

Prerequisite: Phase 4 released.

Deliver:

- Trusted project configuration resolved from `ctx.cwd`.
- Commands consume current configuration rather than a captured stale object.
- `/dcp:compress [focus]` uses Pi’s custom follow-up message API.
- Command mutations persist through Phase 4 snapshots.
- Deterministic informational benchmarks.
- Final README, schema, package, and release verification.

Usable result: complete operator-facing behavior with trusted configuration, manual control, benchmark evidence, and release-ready documentation.

## Atomicity and Execution Rules

- Execute phases strictly in order: 1 → 2 → 3 → 4 → 5.
- A phase begins only when its prerequisite release and entry checks pass.
- A phase is incomplete if it contains deferred fixes, failing checks, undocumented behavior, or temporary compatibility code that depends on a later phase.
- Later phases may depend on stable interfaces from completed earlier phases. Earlier phases must never depend on unfinished later behavior.
- If implementation reveals a requirement crossing a boundary, revise the affected phase plans before continuing.
- A blocked phase does not invalidate already released phases.
- Each phase updates its own user-facing documentation and release notes.

## Verification Contract

Every phase ends with:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm pack --dry-run
git diff --check
```

Run schema generation and consistency checks in phases that change configuration or the shipped schema.

Focused tests must pass before the full suite. Lint may retain the recorded baseline warnings but must not introduce new diagnostics.

The parent/index records each phase’s status as `not started`, `in progress`, `blocked`, or `complete`. A phase changes to `complete` only after its acceptance criteria, documentation, and full verification pass.

## Success Criteria

- The source roadmap is unchanged.
- The new parent/index links to all five phase plans and contains no duplicated implementation checklist.
- Every requirement in the source roadmap maps to exactly one primary phase.
- Every phase has a usable, independently releasable outcome.
- Every phase names its prerequisites, exclusions, tests, documentation, acceptance criteria, and handoff interfaces.
- No phase assumes code or behavior from a later phase.
- The five phase plans collectively retain the full approved scope of the source roadmap.
