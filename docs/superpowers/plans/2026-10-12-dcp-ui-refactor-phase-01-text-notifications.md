# DCP UI Phase 1: Consistent Text and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for these sequential changes) or superpowers:subagent-driven-development to implement this plan step-by-step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship compact, consistent DCP text reports and single-line status notifications without changing command or panel interaction.

**Architecture:** Introduce the two formatting functions and integrate them into current plain-text reports and automatic notifications. Keep transport selection and notification timing in the existing extension adapters; the current panel and command entrypoints continue working.

**Tech Stack:** Existing TypeScript/ESM, Node `>=24.15.0`, installed Pi coding-agent/TUI SDK, Vitest, TypeBox, and Biome; no new dependencies.

**Spec:** [Approved design in the parent plan](2026-10-12-dcp-ui-refactor-plan.md#approved-design). The parent remains the source of truth for the overall design; this file extracts its phase 1 implementation content.

## Global Constraints

- Use `/Users/lanh/Developer/pi-vault/pi-status` as a visual/code reference only; no runtime imports, dependency on pi-status, or edits to that repository.
- Match its frame, spacing, tabs, semantic theme roles, selection marker, compact metrics, and persistent keyboard footer. Use the active Pi theme; no palette presets or editor.
- Adapt reference primitives to DCP's installed SDK. The inspected pi-status checkout uses Pi `0.84.4`; DCP uses Pi `1.1.0`.
- Preserve command names and arguments, pruning/compression algorithms, policy, tool selection, model-visible content, statistics calculations, and compression result text.
- Preserve snapshot serialization version `2`, reading versions `1` and `2`, persistence ordering, live state/config identities, and unexpected exception propagation.
- Operator actions continue through `executeDcpAction`: fresh policy check, one callback after a normally completed permitted attempt, no callback after rejection or an implementation throw. Permission denial alone does not disable operator controls.
- Keep per-call compression approval through Pi's native `ui.confirm`, including RPC support, cancellation, abort handling, and policy recheck after approval.
- No new configuration, dependencies, sidebar integration, search, block drilldown, domain actions, package version bump, or speculative abstractions.
- Earlier architecture documents' UI/message compatibility constraints are intentionally superseded for presentation only. Their domain and persistence contracts still apply.
- Each phase includes its production integration, relevant tests, README/CHANGELOG updates, `pnpm check`, and one atomic commit. No phase ships unused helpers or depends on future code.

## Review Focus

| Input or condition | Required behavior | Owning check |
| --- | --- | --- |
| Detailed compression/status delivery | Compact one-line metrics, never topic or summary. | Step 1 delivery matrix |
| Detailed compression/toast with showCompression toggled | Topic remains; summary appears only when configured. | Step 1 detailed cases |
| Off, no UI, or zero completed work | Existing notification suppression and timing remain intact. | Step 1 suppression cases |
| Singular counts and compact estimated tokens | Exact grammar and estimate markers remain correct. | Step 1 formatting cases |
| Unavailable context or existing informational counters | All current data and help commands remain accessible as plain text. | Step 1 informational builder cases |

---

## Complexity and Atomic Result

Lowest complexity: mostly pure formatting, with one compression-notification delivery decision. Review exact copy, metric provenance, and configuration gates rather than navigation or domain state.

**Usable result:** Informational reports and automatic notifications share compact formatting; detailed status output stays on one line. Existing commands and the current single-list panel remain usable.

**Prerequisites:** Current production code. No prerequisite UI phase.

**Boundary:** Include production integration, tests, documentation, and verification in one phase commit. Do not ship unused helpers, break existing callers, or require unimplemented later code. After this complete commit, continue with [phase 2](2026-10-12-dcp-ui-refactor-phase-02-compression-rendering.md).

## Execution Rules

- [ ] Confirm a clean or understood worktree and the prerequisite implementation/checks before editing product code; follow the execution workflow's isolation rules.
- [ ] Run `pnpm check` as a fresh baseline. The parent's observation of 83 passing focused tests is historical evidence, not this phase's verification.
- [ ] Execute this phase sequentially. Demonstrate its expected test failures, integrate the complete behavior, and verify before committing.
- [ ] Record completed checkboxes and the phase commit only when implementation happens. All implementation steps are initially unchecked.

## Implementation Steps (Extracted from Parent Phase 1)

**Files:** Create `src/tui/formatters.ts` and `tests/formatters.test.ts`. Modify `src/tui/notification.ts`, `src/index.ts`, `src/commands/context.ts`, `src/commands/stats.ts`, `src/commands/lifetime.ts`, and `src/commands/help.ts`. Update the corresponding command/notification tests and `tests/index.test.ts`. Update README and CHANGELOG for this phase's visible output changes.

**Interfaces:**

- Produce `formatDcpTokens(tokens: number, estimated?: boolean): string`: use lowercase `k`/uppercase `M`, at most one fractional digit, remove trailing `.0`, and prefix estimates with `~`. Counts remain integer counts; missing values are handled by callers as Unavailable.
- Produce `flattenDcpLabel(value: string): string` for single-line topics/labels: collapse whitespace and trim.
- Retain existing notification builder and informational command signatures. Preserve the action executor's domain messages; this phase changes the informational reports and automatic-notification copy, not action dispatch outcomes.
- Exact minimal copy: `DCP · saved ~12.4k tokens · pruned 8 outputs`; compression copy: `DCP · compressed ~12.4k tokens · summary ~2.1k · 5 messages`, with singular nouns when the count is one.

- [ ] **Step 1: Add failing formatting and delivery tests.** Pin these representative assertions and extend them to zero, singular, detailed, and unavailable cases:

  ```ts
  expect(formatDcpTokens(12_400, true)).toBe("~12.4k");
  expect(formatDcpTokens(1_000_000)).toBe("1M");
  expect(flattenDcpLabel("Auth\r\n  system")).toBe("Auth system");
  expect(buildMinimalMessage({ tokensSaved: 12_400, pruned: 8 }))
    .toBe("DCP · saved ~12.4k tokens · pruned 8 outputs");
  ```

  In extension-harness tests, assert detailed compression/status invokes `setStatus("dcp", message)` with no `\r`, `\n`, topic, or summary; detailed compression/toast retains topic and configured summary. Preserve off/no-UI/zero-work suppression. Pruning toasts retain per-pass metrics and statuses retain cumulative metrics. Informational builders retain every current metric and command entry, without ANSI.
- [ ] **Step 2: Demonstrate failure.** Run `pnpm exec vitest run tests/formatters.test.ts tests/notification.test.ts tests/compress-notification.test.ts tests/index.test.ts tests/commands-help.test.ts tests/commands-context.test.ts tests/commands-stats.test.ts tests/commands-lifetime.test.ts tests/commands-register.test.ts`. Expect failure on new formatting/delivery assertions before implementation.
- [ ] **Step 3: Implement formatting and wire actual callers.** Keep aligned label/value text reports and all current information. In `sendCompressNotification`, select detailed output only for detailed/toast; status always uses the minimal builder. Do not change delivery timing, notification severity, the `dcp` status key, configuration warnings, model content, or pruning/compression statistics.
- [ ] **Step 4: Verify the phase.** Run the step-2 command and `pnpm check`; expect all checks to exit `0`. Inspect exact notification strings for singular/plural, estimates, and summary gates.
- [ ] **Step 5: Document and commit the usable result.** Describe compact formatting and single-line statuses in README/CHANGELOG; run `git diff --check`, stage only phase files, and commit with `feat: unify DCP text and notification presentation`.

## Phase Completion and Rollback

- [ ] The usable result above works in production without future-phase scaffolding.
- [ ] The focused commands and `pnpm check` pass; document concrete visual checks or explain any real-Pi check that could not be performed.
- [ ] README/CHANGELOG describe this phase's actual delivered behavior, and the complete diff forms one atomic commit.
- [ ] Confirm unchanged domain algorithms, policy/callback semantics, metric calculations, and snapshot compatibility for the affected paths.

Revert dependent later phases before reverting this phase. No snapshot migration is introduced. Optional compression display metadata is backward-compatible with the legacy-result fallback from phase 2.
