# DCP Depth Phase 1: Shared Reporting Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for these coupled changes) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share read-only context and statistics facts between text commands and the dashboard while preserving their current output.

**Architecture:** Add one in-process reporting module that reads current state and copies metric facts. Text and TUI are the two adapters; each keeps formatting, availability display, labels, and row structure. Lifetime scanning stays with its existing owner.

**Tech Stack:** TypeScript/ESM, Node `>=24.15.0`, existing Pi SDK, Vitest, Biome, pnpm; no new dependency.

**Spec:** [Approved three-phase design](../specs/2026-10-13-dcp-architecture-deepening-design.md), especially Phase 1 and compatibility constraints.

**Planning baseline:** `41da383`; fresh `pnpm check` passed on 13 October 2026: formatting, lint, type checking, and 66 test files / 1,153 tests. Implementation has not started.

## Global Constraints

- Preserve current commands, text output, dashboard rows, notifications, tool result text, optional display metadata, error messages, and UI routing.
- Preserve pruning/compression algorithms, protected content, message references, compression priority, nudges, tool selection, and statistics calculations.
- Preserve snapshot version `2`, reading versions `1` and `2`, durable field names, fingerprints, owner-session statistics rules, and repair behavior.
- Preserve root `SessionState` and configuration identities; read replaceable nested state at operation time.
- Preserve host event order, per-call approval, approval cancellation, policy rechecks, exception propagation, and checkpoint trigger locations.
- Keep Node `>=24.15.0`, TypeScript/ESM, current dependencies, and configuration. Add no configuration option, dependency, generic event framework, or release.
- Preserve meaningful behavior coverage; replace private tests only after equivalent interface coverage exists.
- This is the first phase. Do not implement checkpoint or compression-execution changes here.

## Review Focus

| Input / condition | Required behavior | Owning checks |
| --- | --- | --- |
| Fractional percentage or missing percentage | Keep text precision/availability distinct from the dashboard | Task 1 output matrix |
| Zero counters or unavailable lifetime totals | Show zero as data; retain existing unavailable text | Tasks 1–2 |
| Restoration replaces nested maps/statistics | Read new values; previous facts remain snapshots | Task 2 snapshot tests |
| Panel rebuild after an action | Load lifetime totals once; rebuild current session facts | Existing panel controller test, Task 2 |
| Block/policy/help projection | Keep lifecycle, controls, help descriptors, row IDs, and order | Existing panel-model tests, Task 2 |

## File Map and Fixed Interfaces

- Create `src/reporting.ts`: fact selection only.
- Modify `src/commands/context.ts`, `stats.ts`, `lifetime.ts`: consume facts; retain their formatter and output builders.
- Modify `src/tui/panel-model.ts`: consume shared facts for Overview/Statistics; retain other projection responsibilities.
- Create `tests/reporting.test.ts`; extend the existing command/panel-model tests only for missing behavior.
- Retain `src/state/persistence.ts`, `src/tui/panel.ts`, renderer, config, and state types unchanged unless a necessary type-only import adjustment is needed.

Define these exports in `src/reporting.ts` using existing `ContextUsage`, `SessionState`, `SessionStats`, and `LifetimeStats` types:

```ts
export interface DcpContextFacts {
  readonly usage: Readonly<ContextUsage> | undefined;
  readonly prunedToolCalls: number;
  readonly activeBlocks: number;
  readonly totalBlocks: number;
  readonly toolCacheEntries: number;
  readonly currentUserTurn: number;
  readonly manualMode: SessionState["manualMode"];
}
export function readDcpContextFacts(
  state: SessionState, usage: ContextUsage | undefined,
): DcpContextFacts;
export function readDcpSessionFacts(state: SessionState): Readonly<SessionStats>;
export function readDcpLifetimeFacts(stats: LifetimeStats): Readonly<LifetimeStats>;
```

The context counts come from `prune.tools.size`, `activeBlockIds.size`, `blocksById.size`, `toolParameters.size`, and `currentUserTurn`, respectively. Copy supplied usage and scalar statistics/totals; return no live maps, sets, or statistics objects. TypeScript readonly is sufficient; no runtime freezing or cache is required. Panel adapters handle undefined lifetime totals before calling `readDcpLifetimeFacts`.

## Task 1: Pin Current Adapter Output

**Files:** `tests/commands-context.test.ts`, `tests/panel-model.test.ts`; retain `tests/commands-stats.test.ts`, `tests/commands-lifetime.test.ts`, and `tests/panel.test.ts` coverage.

**Interfaces:** Consumes existing `contextCommand(state, usage, modelDisabled?)`, `statsCommand(state)`, `lifetimeCommand(parentDir)`, and `buildDcpPanelModel(input)`. Produces characterization tests used unchanged by Task 2.

- [ ] **Step 1: Add missing output characterization.** Reuse `baseInput`/`detail` in panel-model tests, importing `contextCommand` there for the cross-adapter comparison, and normal command fixtures. Assert these cases against the current implementation before changing code:

  | Usage / state | Text context | Dashboard context |
  | --- | --- | --- |
  | `{ tokens: 12345, contextWindow: 200000, percent: 6.1725 }` | `~12.3k / 200k (6.2%)` | `~12.3k / 200k (6.1725%)` |
  | `{ tokens: 12345, contextWindow: 200000, percent: null }` | `Unavailable (context window: 200k)` | `~12.3k / 200k (unknown)` |
  | `{ tokens: null, contextWindow: 0, percent: null }` | `Unavailable (context window: 0)` | `Unavailable` |
  | `{ tokens: 0, contextWindow: 200000, percent: 0 }` | `~0 / 200k (0.0%)` | `~0 / 200k (0%)` |
  | `manualMode: "active"` | `Manual mode` value `active` | Overview `on` |

  Retain exact full text assertions, row IDs/order, distinct session counters, undefined versus zero lifetime values, and integer count formatting. For example:

  ```ts
  it("keeps adapter-specific percentage precision", () => {
    const state = createSessionState();
    const usage = { tokens: 12345, contextWindow: 200000, percent: 6.1725 };
    expect(contextCommand(state, usage)).toContain("~12.3k / 200k (6.2%)");
    const model = buildDcpPanelModel(baseInput({ state, contextUsage: usage }));
    expect(detail(model, "overview", "overview:context"))
      .toBe("~12.3k / 200k (6.1725%)");
  });
  ```

- [ ] **Step 2: Verify the characterization baseline.** Run `pnpm exec vitest run tests/commands-context.test.ts tests/commands-stats.test.ts tests/commands-lifetime.test.ts tests/panel-model.test.ts tests/panel.test.ts`; expect exit `0`. These are preservation tests and should pass before extraction. Investigate any discrepancy instead of changing the required copy.

## Task 2: Implement the Shared Facts and Integrate Both Adapters

**Files:** Create `src/reporting.ts`, `tests/reporting.test.ts`; modify `src/commands/context.ts`, `stats.ts`, `lifetime.ts`, and `src/tui/panel-model.ts`.

**Interfaces:** Produces the three fixed exports above. Existing command and panel entry interfaces remain unchanged. Consumes Task 1's characterization without changing expected values.

- [ ] **Step 1: Write failing interface tests.** In `tests/reporting.test.ts`, import the new exports. Test `reads current context counts without mutation`, `copies usage and statistics instead of retaining references`, `reads replaced nested state on the next call`, and `copies zero lifetime totals`. Use distinct counter values so field swaps fail. A representative assertion is:

  ```ts
  it("copies usage and statistics instead of retaining references", () => {
    const state = createSessionState();
    state.stats.totalPruneTokens = 1000;
    const usage = { tokens: 12345, contextWindow: 200000, percent: 6.1725 };
    const context = readDcpContextFacts(state, usage);
    const session = readDcpSessionFacts(state);
    usage.tokens = 0;
    state.stats.totalPruneTokens = 2500;
    expect(context.usage?.tokens).toBe(12345);
    expect(session.totalPruneTokens).toBe(1000);
    expect(readDcpSessionFacts(state).totalPruneTokens).toBe(2500);
  });
  ```

  The replacement case assigns a fresh `state.prune.messages` from `createSessionState().prune.messages`, a fresh pruning map, and fresh stats with different values; the next read must use them. Compare input state/usage before and after reads to prove no mutation.

- [ ] **Step 2: Demonstrate failure.** Run `pnpm exec vitest run tests/reporting.test.ts`; expect failure because `src/reporting.ts`/its exports do not exist. Do not write implementation before this result.

- [ ] **Step 3: Implement the exports and production integration.** Use current nested values on every call. Route all shared context/session/lifetime field selection through the new module in the four production consumers. Keep each existing formatting branch intact, including explicit null handling and text rounding. Lifetime reads stay outside reporting, once per panel invocation. Keep policy, limits, Controls, Blocks, Help, table alignment, and rendering untouched. Remove imports/local selectors made obsolete by this change; do not extract the table formatter as unrelated cleanup.

- [ ] **Step 4: Verify the completed phase.** Run `pnpm exec vitest run tests/reporting.test.ts tests/commands-context.test.ts tests/commands-stats.test.ts tests/commands-lifetime.test.ts tests/panel-model.test.ts tests/panel-render.test.ts tests/panel.test.ts tests/commands-register.test.ts tests/sdk-contract.test.ts`; expect exit `0`. Inspect all four consumers for duplicate fact selection or an unused new export. Run `pnpm check` and `git diff --check`; expect exit `0`. Do not replace expected text/rows merely to make the suite green.

- [ ] **Step 5: Commit the complete phase.** Stage only the listed source/tests and actual progress updates to this plan, then commit with `refactor: share DCP reporting facts`. Tasks 1–2 are sequential work within this phase; ship the complete integrated change. No README, changelog, version, schema, or behavior update is needed for an output-preserving extraction.

## Completion and Handoff

The phase is complete when the new module serves both adapters, output remains byte-for-byte compatible, meaningful checks pass, and no runtime state/configuration/persistence behavior changed. Phase 2 is [branch persistence](2026-10-13-dcp-depth-phase-02-checkpoints.md). All implementation boxes are intentionally unchecked at plan-writing time.
