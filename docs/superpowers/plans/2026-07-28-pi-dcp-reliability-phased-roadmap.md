# Pi DCP Reliability Phased Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Pi DCP reliability roadmap as five ordered, independently releasable phases.

**Architecture:** Preserve the original reliability roadmap as the requirement source and use this document only as the phase index. Each linked phase plan owns one coherent behavior slice, its documentation, acceptance criteria, verification, and handoff interfaces.

**Tech Stack:** TypeScript ESM, Pi ExtensionAPI 0.80.3-compatible APIs, TypeBox, Vitest, pnpm, and Node standard-library APIs.

---

## Source Documents

- Requirement source: [2026-07-28-pi-dcp-reliability-roadmap.md](2026-07-28-pi-dcp-reliability-roadmap.md)
- Approved phase design: [2026-07-28-pi-dcp-phased-planning-design.md](../specs/2026-07-28-pi-dcp-phased-planning-design.md)
- Comparative audit: [2026-07-28-pi-dcp-comparative-audit-design.md](../specs/2026-07-28-pi-dcp-comparative-audit-design.md)

The requirement source must remain unchanged:

```bash
git diff --exit-code HEAD -- docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md
```

Expected: exit code 0 and no output.

## Phase Index

| Phase                             | Status      | Prerequisite     | Independently usable result                                                                            | Detailed plan                                                          |
| --------------------------------- | ----------- | ---------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1. Pruning Foundation             | complete    | v0.4.1 baseline  | Failed inputs are purged without losing diagnostics; lookup outputs can deduplicate                    | [Phase 1](2026-07-28-pi-dcp-phase-1-pruning-foundation.md)             |
| 2. Turn and Pair Safety           | not started | Phase 1 complete | Fresh user turns are protected consistently and DCP preserves Pi tool-pair invariants                  | [Phase 2](2026-07-28-pi-dcp-phase-2-turn-and-pair-safety.md)           |
| 3. Compression Correctness        | not started | Phase 2 complete | In-session compression has correct ownership, accounting, batching, nesting, and timing                | [Phase 3](2026-07-28-pi-dcp-phase-3-compression-correctness.md)        |
| 4. Native Session State           | not started | Phase 3 complete | Reliability state survives resume, fork, tree navigation, and compaction without cross-session leakage | [Phase 4](2026-07-28-pi-dcp-phase-4-native-session-state.md)           |
| 5. Operator and Release Hardening | not started | Phase 4 complete | Trusted project config, manual compression, benchmarks, and final release documentation are available  | [Phase 5](2026-07-28-pi-dcp-phase-5-operator-and-release-hardening.md) |

Allowed status values are `not started`, `in progress`, `blocked`, and `complete`.

## Execution Order

```text
Phase 1: pruning semantics
    ↓
Phase 2: user-turn and pair safety
    ↓
Phase 3: compression correctness
    ↓
Phase 4: native lifecycle persistence
    ↓
Phase 5: operator controls and release hardening
```

Later phases may depend only on stable interfaces explicitly handed off by completed earlier phases. Earlier phases must not contain shims, branches, or dormant code for unfinished later phases.

## Atomic Phase Contract

A phase may be marked `complete` only when:

- Its prerequisite release and entry checks passed before work began.
- Every task and checkbox in its detailed plan is complete.
- Its focused tests pass.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm pack --dry-run`, and `git diff --check` pass.
- Schema generation is checked when the phase changes configuration.
- Existing lint diagnostics do not increase above the recorded baseline.
- User-facing behavior and release notes are documented.
- Its acceptance criteria are demonstrated without code from a later phase.
- Its final commit leaves no temporary compatibility path intended for a later phase.

If implementation reveals a requirement that crosses phase boundaries, stop and revise this index and the affected detailed plans before continuing.

## Requirement Ownership

| Original roadmap requirement                      | Primary phase |
| ------------------------------------------------- | ------------- |
| Provenance record and verification baseline       | Phase 1       |
| Preserve errors while purging failed inputs       | Phase 1       |
| Mutation/orchestration-only protected defaults    | Phase 1       |
| Top-level user-turn protection                    | Phase 2       |
| Replace agent-iteration age with user-turn age    | Phase 2       |
| Pi-compatible tool-call/result safety             | Phase 2       |
| Real compression tool-call ownership              | Phase 3       |
| Incremental visible-token accounting              | Phase 3       |
| Atomic multi-range batches and nested blocks      | Phase 3       |
| Timing for every block in a batch                 | Phase 3       |
| Versioned Pi custom-entry snapshots               | Phase 4       |
| Resume, fork, tree, and compaction restoration    | Phase 4       |
| Ignore unsafe shared sidecars for restoration     | Phase 4       |
| Accurate per-session lifetime totals              | Phase 4       |
| Trusted project configuration                     | Phase 5       |
| Live command configuration                        | Phase 5       |
| `/dcp:compress [focus]`                           | Phase 5       |
| Deterministic informational benchmarks            | Phase 5       |
| Final README, schema, package, and release checks | Phase 5       |

Every original requirement has one primary owner. A later phase may integrate an earlier interface but must not redefine its semantics.

## Phase Handoffs

- **Phase 1 → Phase 2:** failed-call arguments and protected-tool policy are stable; successful and failed pruning passes are separate.
- **Phase 2 → Phase 3:** `ToolParameterEntry.userTurn`, `DcpConfig.turnProtection`, and the protected-window helper are stable.
- **Phase 3 → Phase 4:** `CompressionBlock.compressToolCallId`, nested relationships, stable boundaries, token accounting, and batch timing are stable.
- **Phase 4 → Phase 5:** `DcpSnapshotV1`, native snapshot append/restore, mutation persistence callbacks, and session-stat aggregation are stable.
- **Phase 5:** produces the final operator-facing and release-ready package; no later reliability phase is assumed.

## Global Verification

Run at the end of every phase:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm pack --dry-run
git diff --check
git diff --exit-code HEAD -- docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md
```

Expected:

- All tests pass.
- TypeScript reports no errors.
- Lint adds no diagnostics beyond the Phase 1 recorded baseline.
- Package dry-run succeeds.
- No whitespace errors are reported.
- The original roadmap remains unchanged.

## Completion

When a phase is released:

1. Change only that phase’s status in the table.
2. Record the release commit or tag in the phase plan’s completion section.
3. Do not pre-mark later phases as in progress.
4. Begin the next phase only after its entry criteria pass against the released branch.
