# Model-specific DCP Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add exact per-model DCP opt-out while preserving independent per-model compression limits.

**Architecture:** Keep eligibility inside `pi-dcp` as a pure config helper, then apply it at command and runtime boundaries. Use Pi's existing model event and active-tool APIs for live switching, with a sentinel that preserves the user's prior `compress` activation across repeated disabled reconciliations.

**Tech Stack:** TypeScript, Node.js `>=24.15.0`, TypeBox, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-26-model-specific-dcp-controls-design.md`

## Global Constraints

- Match models exactly using `${provider}/${modelId}`; do not add glob matching.
- `disabledModels` is top-level and defaults to `[]`.
- Any non-string `disabledModels` entry resets the whole list to `[]` with a validation warning.
- A disabled model takes precedence over its configured max/min limits.
- Preserve existing `compress.modelMaxLimits` and `compress.modelMinLimits` resolution and merge behavior.
- Modify only `pi-dcp`; the three reference repositories remain read-only.
- Add no dependencies.
- Retain DCP state across model switches; existing compaction/tree lifecycle handling remains authoritative.
- Do not commit changes unless the user explicitly requests a commit.

---

## Controlling phase plans

Execute these plans in order. They contain the authoritative file lists, interfaces, test fixtures, and red-green steps; this parent plan is the sequencing overview.

1. `docs/superpowers/plans/2026-08-26-model-specific-dcp-controls/phase-01-config-contract.md`
2. `docs/superpowers/plans/2026-08-26-model-specific-dcp-controls/phase-02-static-model-disablement.md`
3. `docs/superpowers/plans/2026-08-26-model-specific-dcp-controls/phase-03-live-model-switching.md`
4. `docs/superpowers/plans/2026-08-26-model-specific-dcp-controls/phase-04-transition-hardening.md`
5. `docs/superpowers/plans/2026-08-26-model-specific-dcp-controls/phase-05-integrated-verification.md`

### Phase 1: Config contract

- Add `DcpConfig.disabledModels` and `isDcpEnabledForModel`.
- Update the shared test config factory and prove fresh defaults plus global/project array replacement.
- Reset invalid `disabledModels` lists at the config boundary without refactoring unrelated validation.
- Prove exact eligibility matching and existing two-model percentage limits.
- Regenerate the schema without documenting runtime behavior prematurely.

### Phase 2: Static-model disablement

- Apply eligibility to commands and all runtime boundaries for the current model.
- Reconcile the initially active `compress` tool.
- Provide concrete command and extension test harnesses.
- Publish the configuration only after static-model behavior is usable end to end.

### Phase 3: Live model switching

- Add `model_select` handling.
- Preserve active/inactive `compress` choice across enabled-to-disabled-to-enabled switches.
- Update runtime model identity without resetting DCP state.

### Phase 4: Transition hardening

- Cover repeated disabled reconciliation and disabled-to-disabled switches.
- Verify disabled event boundaries, stale tool blocking, state retention, and lifecycle authority.
- Make no host or reference-repository changes.

### Phase 5: Integrated verification

- Verify Node.js `>=24.15.0` before running checks.
- Run the complete package checks and regenerate the schema.
- Confirm parent/spec consistency, scope, generated output, and clean reference repositories.

## Acceptance criteria

- Different exact model keys continue to resolve independent max/min thresholds.
- Invalid `disabledModels` lists reset to `[]`, and project lists replace global lists.
- Listed models receive no DCP processing or mutating command effects.
- Unlisted and unidentified models retain existing behavior when global DCP is enabled.
- Live switching removes and conditionally restores only `compress`.
- Repeated disabled reconciliation never overwrites the remembered activation state.
- All focused and full checks pass under the declared Node.js engine.
