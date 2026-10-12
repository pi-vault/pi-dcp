# DCP Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for these sequential changes) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Concentrate DCP action decisions, compression-tool selection, and compression block writes behind deep modules without changing behavior.

**Architecture:** Commands and the panel share guarded action execution. A selection module owns ephemeral tool-selection transitions. A compression block module owns ordinary transitions first and restoration/reset/timing next; its public interface hides its graph implementation.

**Tech Stack:** Existing TypeScript/ESM, Node `>=24.15.0`, Pi extension interfaces, Vitest, TypeBox, and Biome; no new dependencies.

**Spec:** [Approved design](../specs/2026-10-12-dcp-architecture-design.md).

## Global constraints

- Preserve messages, argument parsing, UI delivery, compression results, policy rules, token statistics, and model-visible context.
- Preserve snapshot serialization version `2` and reading of versions `1` and `2`; no migration, schema change, configuration change, or package version bump.
- Preserve live root state/config identities; nested config values and maps can be replaced.
- Keep informational commands and per-call model compression approval with their existing owners.
- Run the existing state-change callback once after every normally completed, policy-allowed operator attempt, including errors and no-ops; not after rejection or an implementation throw.
- Preserve first-session versus branch-local selection memory, Pi's selection authority, user deselection, and overlapping suppression reasons.
- Preserve the distinction between consumed blocks and user-deactivated blocks.
- Every phase integrates production callers and passes `pnpm check` before its atomic commit. No phase depends on unimplemented later code.

## Review focus

| Condition | Expected behavior | Owning phase |
| --- | --- | --- |
| Allowed invalid/no-op action with a current model change | Callback still receives the original context once and can reconcile selection; no duplicate snapshot is appended. | 1, 2 |
| Policy changes while the panel is open | Execution rechecks current policy; permission denial alone leaves operator controls available. | 1 |
| Config reload or branch navigation after suppression | Current config is read, old branch memory is discarded, and restored host deselection stays intact. | 2 |
| A user-deactivated child is consumed by a later block | Deactivating the parent never reactivates that child. | 3 |
| Restore/compaction/timing interact | Restore rebuilds visibility on the next context pass; compaction retains counters; failed completion clears timing without writing duration. | 4 |

## Baseline and execution rules

Base commit: `2258ca5`. The architecture review observed `819` passing tests across `58` suites. This is historical evidence, not a substitute for checks during execution; test counts may change as redundant cases are replaced.

- [ ] Confirm a clean or understood worktree and run `pnpm check` before phase 1. Isolate implementation using the execution workflow's worktree rules.
- [ ] Execute phases in order; do not parallelize edits across these phases because they share `src/index.ts`, state contracts, and action integrations.
- [ ] Within a phase, characterize current behavior, add the new interface's tests, demonstrate the expected failure, implement and integrate, then verify.
- [ ] Commit only a complete phase after its narrow tests and `pnpm check` pass. Red tests or an unused new module are intermediate work, never a phase result.
- [ ] Record completed checkboxes and the phase commit when execution actually happens. This planning change completes no implementation checkbox.

## Phase sequence

| Phase | Plan | Usable result | Dependency |
| --- | --- | --- | --- |
| 1 — Lowest complexity | [Guarded actions](2026-10-12-dcp-architecture-phase-01-guarded-actions.md) | Commands and the panel share policy, mutation, and callback ordering. | Current code |
| 2 — Moderate complexity | [Tool selection](2026-10-12-dcp-architecture-phase-02-tool-selection.md) | All selection transitions use one owner while action callbacks still work. | Phase 1 |
| 3 — Higher complexity | [Ordinary block lifecycle](2026-10-12-dcp-architecture-phase-03-block-lifecycle.md) | Creation, controls, and synchronization use one owner; restore/reset/timing still work through existing paths. | Phase 2 |
| 4 — Highest integration complexity | [Complete block ownership](2026-10-12-dcp-architecture-phase-04-block-durability.md) | Initialization, restore, reset, compaction, and duration also use that owner; storage stays compatible. | Phase 3 |

Each row is a valid stopping point. Phase 3's remaining writers are documented exceptions, not unfinished runtime paths. Phase 4 removes those exceptions. The final write owner is one logical module: public `src/compress/blocks.ts` plus its private `src/compress/block-graph.ts` implementation.

## File responsibilities

| File | Responsibility after its owning phase |
| --- | --- |
| `src/commands/actions.ts` | Current policy check, typed action dispatch, synchronous callback ordering, and domain outcome. |
| `src/commands/register.ts` | Command registration, raw argument adaptation, and notifications. |
| `src/tui/panel-model.ts` | Read-only status, statistics, rows, and action requests. |
| `src/tui/panel.ts` | TUI interaction and outcome presentation through the shared action seam. |
| `src/tool-selection.ts` | Model identity and ephemeral compression-tool selection transitions using the existing host adapter. |
| `src/index.ts` | Extension registration and lifecycle adaptation; per-call approval, persistence orchestration, prompts, and runtime start-time bookkeeping. |
| `src/compress/blocks.ts` | Public compression run and block lifecycle operations, then restoration/reset/duration operations. |
| `src/compress/block-graph.ts` | Private allocation, storage, relationship, and visibility implementation; no production caller outside `blocks.ts`. |
| `src/state/persistence.ts` | Versioned value codec, fingerprints, owner-session/statistics restoration, and delegation of block materialization. |
| `src/state/state.ts` | Session-wide state creation/reset with block initialization/reset delegated in phase 4. |
| `src/pipeline.ts` | Production context ordering through the block owner. |

## Atomicity and rollback

- No phase changes the snapshot format, so its complete commit can be reverted without migrating saved sessions.
- Revert dependent later phases first. A phase-2 commit can be reverted while keeping phase 1; a phase-4 commit can be reverted while keeping phase 3.
- Do not retain old production dispatchers, compatibility forwarding files, or parallel implementations once their callers have moved. Delete each obsolete path in the same phase as its complete replacement.
- Keep algorithm/codec/host contract tests. Replace obsolete private-helper assertions only after their behavior is covered through the relevant public seam; meaningful graph algorithm tests can use the private implementation seam.

## Final acceptance

- [ ] Every affected production action uses `executeDcpAction` and every tool-selection transition uses the selection owner.
- [ ] Production writes to live compression block state occur only in `blocks.ts` or its private graph implementation; snapshot value parsing remains separate.
- [ ] No imports refer to deleted transition modules and no new runtime import cycle exists.
- [ ] `pnpm check` passes, including SDK/host contracts and deterministic benchmark token gates.
- [ ] A final review verifies compatibility and scope across the four phase commits.
- [ ] Report the completed phase commits, observed checks, and any explicit deviations from this plan.
