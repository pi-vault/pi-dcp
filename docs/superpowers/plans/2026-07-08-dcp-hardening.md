# DCP Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close feature gaps between pi-dcp and opencode-dynamic-context-pruning: showCompression toggle, permission gating, turn protection, accurate token counting, and TypeBox-based config validation with JSON Schema.

**Architecture:** Five independent phases ordered simplest-to-most-complex. Each phase has its own plan file. Phase 5 (TypeBox config refactor) absorbs config fields added in Phases 1-3, so run it last.

**Tech Stack:** TypeScript, Vitest, TypeBox, @anthropic-ai/tokenizer, Biome

**Spec:** `docs/superpowers/specs/2026-07-08-dcp-hardening-design.md`

---

## Phase Plans

Each phase is a standalone plan with full task breakdowns. Execute them in order:

1. **Phase 1: showCompression Config** — `docs/superpowers/plans/2026-07-08-phase-1-show-compression.md`
2. **Phase 2: Permission Gating** — `docs/superpowers/plans/2026-07-08-phase-2-permission-gating.md`
3. **Phase 3: Turn Protection** — `docs/superpowers/plans/2026-07-08-phase-3-turn-protection.md`
4. **Phase 4: Accurate Token Counting** — `docs/superpowers/plans/2026-07-08-phase-4-token-counting.md`
5. **Phase 5: TypeBox Config + JSON Schema** — `docs/superpowers/plans/2026-07-08-phase-5-typebox-config.md`

---

## File Map (all phases)

### Phase 1: showCompression
- Modify: `src/config.ts` — add `showCompression` to `CompressConfig` and defaults
- Modify: `src/messages/prune.ts` — thread `showCompression` through pruning functions
- Modify: `src/pipeline.ts` — pass config to `applyPruning`
- Modify: `tests/helpers.ts` — add `showCompression` to `makeDefaultConfig`
- Test: `tests/show-compression.test.ts` (new)

### Phase 2: Permission Gating
- Modify: `src/index.ts` — add `tool_call` handler, init `state.compressPermission`
- Modify: `src/state/state.ts` — no change needed (field already exists)
- Create: `src/commands/permission.ts` — toggle command handler
- Modify: `src/commands/register.ts` — register `dcp:permission` command
- Test: `tests/permission-gating.test.ts` (new)

### Phase 3: Turn Protection
- Modify: `src/config.ts` — add `turnProtection` to `DeduplicationConfig` and defaults
- Modify: `src/strategies/runner.ts` — add turn check in dedup loop
- Modify: `tests/helpers.ts` — add `turnProtection` to `makeDefaultConfig`
- Test: `tests/turn-protection.test.ts` (new)

### Phase 4: Accurate Token Counting
- Modify: `package.json` — add `@anthropic-ai/tokenizer` dependency
- Modify: `src/utils/tokens.ts` — use Anthropic tokenizer with fallback
- Test: `tests/tokens.test.ts` (update existing)

### Phase 5: TypeBox Config + JSON Schema
- Create: `src/config-schema.ts` — TypeBox schema definitions
- Modify: `src/config.ts` — replace hand-written validation with TypeBox
- Create: `scripts/generate-schema.ts` — JSON Schema generator script
- Generate: `dcp.schema.json` — committed to repo root
- Modify: `package.json` — move typebox to dependencies, add generate:schema script
- Modify: `tests/helpers.ts` — update `makeDefaultConfig` to match TypeBox types
- Test: `tests/config.test.ts` (rewrite existing)

---

## Verification

After each phase:

```bash
pnpm check   # lint + typecheck + test
```
