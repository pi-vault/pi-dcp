# Phase 4: Disabled-Model Transition Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the model-disable state machine remains correct across repeated events, consecutive disabled models, runtime boundaries, and existing session lifecycle operations.

**Architecture:** Exercise the public event handlers rather than exporting internal runtime state. Use active tools, persisted entries, message output, and existing state-bearing commands as observable behavior. Change production code only if a failing regression exposes a mismatch with the spec.

**Tech Stack:** TypeScript, Node.js `>=24.15.0`, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-26-model-specific-dcp-controls-design.md`

## Global Constraints

- Repeated disabled reconciliation must not overwrite the activation sentinel.
- Disabled-to-disabled transitions preserve the state captured on first entry.
- Existing compaction and tree handlers remain authoritative.
- Keep test additions focused in `tests/index.test.ts`; add no production abstraction solely for testing.
- Add no dependencies or reference-repository changes.
- Do not commit unless the user explicitly requests a commit.

---

### Task 1: Harden active-tool transitions

**Files:**

- Test: `tests/index.test.ts`
- Modify if required by the failing test: `src/index.ts`

**Interfaces:**

- Consumes the Phase 2 sentinel and Phase 3 `model_select` handler.
- Observes active tools through the existing mock API.

- [ ] **Step 1: Add repeated-reconciliation coverage**

Start enabled with `compress` active, switch to `disabledModel`, invoke the disabled model's `context` handler twice, and return to `enabledModel`. Assert `compress` is restored exactly once and active tools equal `["read", "compress"]`.

Use a fresh messages array for each context call and `sessionContext(disabledModel)` so the test exercises the same reconciliation path used in production.

- [ ] **Step 2: Add disabled-to-disabled coverage**

Define:

```ts
const secondDisabledModel = {
  provider: "openai-codex",
  id: "gpt-5.6-luna",
};
```

Configure both disabled keys, then execute enabled→disabledModel→secondDisabledModel→enabled. Assert `compress` is restored when it was initially active. Repeat with `compress` manually inactive before the first disabled transition and assert it remains inactive.

- [ ] **Step 3: Run the tests**

Run: `pnpm vitest run tests/index.test.ts`

Expected: PASS when `compressWasActiveBeforeModelDisable` is assigned only while it is `undefined`. If it fails, correct only the sentinel branch in `reconcileCompressTool` and rerun.

### Task 2: Re-verify disabled runtime boundaries

**Files:**

- Verify: `tests/index.test.ts`
- Modify if required by a failing test: `src/index.ts`

**Interfaces:**

- Reuses the Phase 2 tests proving disabled event handlers produce no DCP cleanup, timing, caching, persistence, or transformed messages.

- [ ] **Step 1: Re-run the existing boundary tests**

Run:

```bash
pnpm vitest run tests/index.test.ts -t "does not sanitize|does not record compression timing|does not cache subagent"
```

Expected: PASS using the tests added in Phase 2. Do not add duplicates.

- [ ] **Step 2: Run the complete index suite**

Run: `pnpm vitest run tests/index.test.ts`

Expected: PASS.

### Task 3: Verify state retention and lifecycle authority

**Files:**

- Test: `tests/index.test.ts`

**Interfaces:**

- Model selection does not append a reset snapshot.
- Compaction and tree navigation retain their existing reset/restore behavior regardless of model eligibility.

- [ ] **Step 1: Test model-switch state retention**

Start on `enabledModel`, invoke `dcp:manual on`, and assert the command reports manual mode is active. Clear the captured `entries`, switch enabled→disabled→enabled, and assert neither `model_select` event appended a `pi-dcp-state` entry. Invoke `dcp:context` and assert its notification still reports `Manual mode: active`.

- [ ] **Step 2: Re-run existing compaction and tree tests**

Run: `pnpm vitest run tests/index.test.ts -t "compaction|session_tree|branch"`

Expected: PASS without changing lifecycle implementation.

- [ ] **Step 3: Run all feature tests**

Run: `pnpm vitest run tests/config.test.ts tests/context-limits.test.ts tests/commands-register.test.ts tests/commands-context.test.ts tests/index.test.ts`

Expected: PASS.
