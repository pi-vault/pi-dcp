# Architecture Deepening — Multi-Phase Refactor

**Date:** 2026-06-15
**Status:** Approved
**Scope:** 5 refactoring phases, ordered simplest-to-most-complex, each delivering an atomic usable result.

## Goal

Turn shallow modules into deep ones. Improve testability by reducing the test surface area (fewer mocks, more direct unit tests). Improve locality by concentrating related logic. Each phase produces a passing `pnpm check` and a clean commit.

## Ordering Rationale

Bottom-up: early phases clean foundations so later phases land on tidier code. Phases 1-2 are prerequisites that make Phase 5 (the highest-leverage change) a cleaner extraction.

---

## Phase 1: Consolidate ContextUsage Type

**Files touched:**

- `src/state/types.ts` — add `ContextUsage` interface
- `src/messages/inject.ts` — delete local `ContextUsage`, update import
- `src/commands/context.ts` — delete `ContextUsageInfo`, import from types
- `src/index.ts` — remove ad-hoc object construction, pass usage directly

**Change:**
Move the `ContextUsage` interface (`{ tokens: number | null; contextWindow: number; percent: number | null }`) to `src/state/types.ts` as the single canonical definition. Delete the duplicate definitions from `inject.ts` and `context.ts`. Remove the ad-hoc object construction in `index.ts` (line 241-244) and pass the Pi usage object directly — Pi's return type is a structural superset of `ContextUsage`, so TypeScript accepts it without an explicit mapping.

**Behavior change:** None. Type-only refactor.

**Verification:** `pnpm check` (lint + typecheck + tests).

---

## Phase 2: Extract Message Content Editor

**Files touched:**

- `src/utils/message-content.ts` — new file
- `src/messages/inject.ts` — refactor `injectMessageIds` and `injectCompressNudges`
- `src/messages/strip.ts` — refactor `stripHallucinations`
- `tests/message-content.test.ts` — new test file (optional but recommended)

**New module interface:**

```typescript
// src/utils/message-content.ts

/**
 * Append text to the first text part of a message.
 * Idempotent: skips if marker string is already present in the text part.
 * Handles E9 string content, array content, and missing text parts.
 * Returns the original message by reference if no change was made.
 */
appendText(msg: AgentMessage, text: string, marker?: string): AgentMessage

/**
 * Transform all text parts in a message via a mapping function.
 * Returns the original message by reference if fn returns identical strings.
 */
mapText(msg: AgentMessage, fn: (text: string) => string): AgentMessage
```

**Caller refactoring:**

- `injectMessageIds`: the 28-line E9 content manipulation block becomes `appendText(msg, tag, "<dcp-message-id")`.
- `injectCompressNudges`: the 30-line reverse-search block uses `appendText(msg, nudgeText, "<dcp-system-reminder>")` on the target message.
- `stripHallucinations`: the manual content iteration becomes `mapText(msg, stripHallucinationsFromString)`.

**What concentrates:** All E9 string-vs-array normalization, text-part discovery (`findIndex`), idempotency marker checking, and immutable cloning live in one 30-line module.

**Behavior change:** None. Same tags appended, same hallucinations stripped.

**Verification:** `pnpm check`. Existing tests pass unchanged. Optionally add direct unit tests for `appendText`/`mapText`.

---

## Phase 3: Deepen the Strategy Module

**Files touched:**

- `src/strategies/runner.ts` — new file
- `src/strategies/deduplication.ts` — shrinks to signature logic + predicate
- `src/strategies/purge-errors.ts` — shrinks to age-check predicate
- `src/commands/sweep.ts` — calls runner instead of reimplementing
- `src/index.ts` — replaces two strategy calls with one
- Tests: update imports, possibly consolidate strategy tests

**New module interface:**

```typescript
// src/strategies/runner.ts

export interface StrategyResult {
  pruned: number;
  tokensSaved: number;
}

/**
 * Run all enabled pruning strategies against the current tool cache.
 * Owns: guard checks, protected-tools resolution, eligibility filtering, stat bookkeeping.
 */
export function runStrategies(
  state: SessionState,
  config: DcpConfig,
): StrategyResult;

/**
 * Sweep variant: prune all non-protected completed tool outputs.
 * Used by the dcp:sweep command.
 */
export function sweepAll(
  state: SessionState,
  config: DcpConfig,
): StrategyResult;
```

**Internal structure of runner:**

1. Guards (checked once): empty toolIdList, manual mode without automatic strategies.
2. Build combined protected-tools set from `BASE_PROTECTED_TOOLS` + all per-strategy lists.
3. Filter eligible tools: `toolIdList` minus already-pruned, minus protected names/file paths.
4. Run deduplication predicate: group by signature, mark all-but-last in each group.
5. Run purge-errors predicate: mark error results older than threshold.
6. Batch-update `state.prune.tools` and `state.stats`.

**What shrinks:**

- `deduplication.ts`: exports `createToolSignature` (used by runner) and `normalizeParams`. Guards and stat mutation deleted.
- `purge-errors.ts`: exports a predicate function. Guards and stat mutation deleted.
- `sweep.ts`: calls `sweepAll(state, config)`, returns formatted string.

**Caller change in index.ts:**

```typescript
// Before:
const dedupResult = deduplicate(state, config);
const purgeResult = purgeErrors(state, config);

// After:
const strategyResult = runStrategies(state, config);
```

**Behavior change:** None. Same tools get pruned under the same conditions.

**Verification:** `pnpm check`. Strategy tests rewritten to test through `runStrategies` or exported predicates. Sweep test updated.

---

## Phase 4: Unify the Compress Handler

**Files touched:**

- `src/compress/handler.ts` — new file
- `src/compress/range.ts` — deleted
- `src/compress/message.ts` — deleted
- `src/index.ts` — simplified tool registration
- Tests: `compress-range.test.ts` and `compress-message.test.ts` rewrite imports

**New module interface:**

```typescript
// src/compress/handler.ts

export interface CompressArgs {
  topic: string;
  mode: "range" | "message";
  content?: Array<{ startId: string; endId: string; summary: string }>;
  targets?: Array<{ messageId: string; summary: string }>;
}

/**
 * Handle any compress tool call regardless of mode.
 * Normalizes input, resolves boundaries, applies compression state.
 */
export function handleCompress(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  args: CompressArgs,
): string;
```

**Internal structure:**

1. Validate: either `content` (range) or `targets` (message) must be non-empty.
2. Normalize to common form: `Array<{ startIndex: number; endIndex: number; summary: string }>`.
   - Range: resolve `startId`/`endId` via `resolveBoundaryIndex`.
   - Message: resolve `messageId`, use same index for both start and end.
3. Allocate run ID.
4. Loop normalized entries: allocate block → `wrapCompressedSummary` → `countTokens` → `applyCompressionState`.
5. Return success message.

**Tool registration simplification:**

```typescript
pi.registerTool({
  name: "compress",
  label: "Compress",
  description:
    config.compress.mode === "message"
      ? COMPRESS_MESSAGE_PROMPT
      : RANGE_DESCRIPTION,
  parameters: config.compress.mode === "message" ? messageSchema : rangeSchema,
  async execute(_toolCallId, params) {
    const resultText = handleCompress(state, config, latestMessages, {
      ...(params as any),
      mode: config.compress.mode,
    } as CompressArgs);
    return { content: [{ type: "text", text: resultText }], details: {} };
  },
});
```

Schema definitions (the `Type.Object` calls) stay — they define the model-facing tool interface. But the execute body is one call regardless of mode.

**What's deleted:** `src/compress/range.ts` and `src/compress/message.ts`. Their types (`RangeCompressArgs`, `MessageCompressArgs`) are replaced by `CompressArgs`.

**What's unchanged:** `compress/search.ts`, `compress/state.ts` — the handler imports from them as before.

**Behavior change:** None. Same compression logic, same error messages.

**Verification:** `pnpm check`. Compression tests update imports to `handleCompress` with appropriate args.

---

## Phase 5: Extract the Context Pipeline

**Files touched:**

- `src/pipeline.ts` — new file
- `src/index.ts` — context handler collapses to ~12 lines
- `tests/pipeline.test.ts` — new test file
- `tests/integration.test.ts` — lightened (wiring smoke test only)

**New module interface:**

```typescript
// src/pipeline.ts

export interface PipelineResult {
  messages: AgentMessage[];
}

/**
 * Run the full DCP context processing pipeline.
 * Pure function of (state, config, messages, usage) → transformed messages.
 * State is mutated (tool cache, pruning marks, stats) as a side effect.
 */
export function runPipeline(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  contextUsage: ContextUsage | undefined,
): PipelineResult;
```

**Internal steps (same sequence as today):**

1. `syncCompressionBlocks(state, messages.length)`
2. `messages = stripHallucinations(messages)` — uses `mapText` from Phase 2
3. `syncToolCache(state, messages)` + `buildToolIdList(state, messages)`
4. `runStrategies(state, config)` — from Phase 3
5. `assignMessageRefs(state, messages)`
6. Build priority map if `config.compress.mode === "message"`
7. `messages = injectMessageIds(state, messages, priorityMap)` — uses `appendText` from Phase 2
8. `messages = applyPruning(state, messages)`
9. `messages = injectCompressNudges(state, config, messages, contextUsage)` — uses `appendText` from Phase 2
10. Return `{ messages }`

**index.ts context handler after extraction:**

```typescript
pi.on("context", async (event, ctx) => {
  if (!config.enabled) return;

  const usage = ctx.getContextUsage() ?? undefined;
  if (usage) state.modelContextWindow = usage.contextWindow;
  latestMessages = event.messages;

  const result = runPipeline(state, config, event.messages, usage);

  if (ctx.hasUI && state.stats.totalPruneTokens > 0) {
    ctx.ui.setStatus(
      "dcp",
      `DCP: ${state.stats.totalPruneTokens} tokens saved`,
    );
  }

  return { messages: result.messages };
});
```

**What stays in index.ts:** Tool registration, session lifecycle events, command registration, config reload, UI status updates. All wiring, no logic.

**Logger:** The pipeline does not log. Logging remains in index.ts (observability is a wiring concern). If logging inside the pipeline is needed later, an optional logger parameter can be added.

**Testing:**

- `tests/pipeline.test.ts`: tests the full pipeline directly with plain state + config + messages. No Pi mock needed. Covers: deduplication, compression block handling, nudge injection, hallucination stripping.
- `tests/integration.test.ts`: remains as a lighter wiring smoke test (verifies events reach the pipeline and results propagate back).

**Behavior change:** None. Same message transformations, same ordering.

**Verification:** `pnpm check`. New pipeline tests pass. Integration test still passes.

---

## Summary

| Phase | Depth gained                       | Lines added | Lines removed (approx) |
| ----- | ---------------------------------- | ----------- | ---------------------- |
| 1     | Type locality                      | ~5          | ~15                    |
| 2     | E9 knowledge concentrated          | ~35         | ~90                    |
| 3     | Strategy guards/stats concentrated | ~60         | ~80                    |
| 4     | Compression mode as impl detail    | ~70         | ~120                   |
| 5     | Pipeline testable without mocks    | ~80         | ~70                    |

Each phase: one commit, `pnpm check` green, no behavior change.
