# Tool Chain Safety + Token Reporting

Fix two bugs and harden pi-dcp against provider 400 errors caused by broken tool call chains.

## Context

Pi's message model separates tool calls from their results:

```
AssistantMessage { content: [..., { type: "toolCall", id: "call-123" }] }
ToolResultMessage { role: "toolResult", toolCallId: "call-123" }
```

Providers (DeepSeek, Anthropic, OpenAI) require every `toolResult` to have a preceding `assistant` message containing the matching `toolCall`. When compression removes messages from the middle of a conversation, it can split these pairs — producing a 400 error.

Separately, `syncToolCache` creates `ToolParameterEntry` with `tokenCount: undefined`. All strategy runs report `tokensSaved: 0` because they read `entry?.tokenCount ?? 0`.

## Bugs Fixed

1. **400 Error** — `filterCompressedRanges` removes messages in a range without checking if it orphans `toolResult` messages from their `assistant` parent.
2. **0 Tokens Saved** — `syncToolCache` never computes `tokenCount` for cached tool entries.

---

## Phase 1: Fix Token Counting in syncToolCache

**Goal:** Populate `tokenCount` on every `ToolParameterEntry` so strategies report real savings.

### Changes

**`src/state/tool-cache.ts`** — In `syncToolCache`, after finding a tool call in an assistant message, locate the corresponding `toolResult` message and compute its token count.

```typescript
// Current (broken):
const entry: ToolParameterEntry = {
  tool: (p.name as string) ?? "unknown",
  parameters: p.arguments ?? {},
  status: result ? (result.isError ? "error" : "completed") : "pending",
  error: result?.errorText,
  turn: state.currentTurn,
  tokenCount: undefined, // ← always undefined
};

// Fixed:
const entry: ToolParameterEntry = {
  tool: (p.name as string) ?? "unknown",
  parameters: p.arguments ?? {},
  status: result ? (result.isError ? "error" : "completed") : "pending",
  error: result?.errorText,
  turn: state.currentTurn,
  tokenCount: result?.tokenCount, // ← computed from toolResult content
};
```

The first pass (collecting tool results) already iterates `toolResult` messages. Extend it to also compute and store `countMessageTokens(msg)` for each result. Use the existing `countMessageTokens` from `utils/tokens.ts`.

### Verification

- Existing `strategy-runner.test.ts` tests pass (behavior unchanged, just non-zero numbers now).
- New unit test: `syncToolCache` with a conversation containing tool calls produces entries with `tokenCount > 0`.
- `dcp:stats` shows non-zero `totalPruneTokens` after deduplication fires.

---

## Phase 2: Report Token Savings in Compress Response

**Goal:** The compress tool tells the model how many tokens were saved, giving visibility into compression effectiveness.

### Changes

**`src/compress/state.ts`** — `applyCompressionState` already sums `totalTokens` from `entry.tokenCount` for messages in the range. Store this on the block as `compressedTokens` (already exists on `CompressionBlock` but always reads 0 because entries have no token counts until Phase 1).

**`src/compress/handler.ts`** — Change the return string:

```typescript
// Before:
return `Compressed ${totalCompressed} messages into ${COMPRESSED_BLOCK_HEADER}.`;

// After:
const totalOriginalTokens = entries.reduce((sum, e) => sum + e.compressedTokens, 0);
const totalSummaryTokens = entries.reduce((sum, e) => sum + e.summaryTokens, 0);
const savings = totalOriginalTokens > 0
  ? ` (~${totalOriginalTokens} tokens replaced by ~${totalSummaryTokens} token summary)`
  : "";
return `Compressed ${totalCompressed} messages into ${COMPRESSED_BLOCK_HEADER}${savings}.`;
```

Add `compressedTokens` and `summaryTokens` to the `NormalizedEntry` interface returned by `normalizeEntries`.

### Verification

- Existing `compress-range.test.ts` tests pass (message still contains "Compressed").
- New test: with populated token counts, compress response includes token numbers.

---

## Phase 3: Protect Tool Call Chains During Compression

**Goal:** Compression never produces a filtered message array that splits a `toolCall` from its `toolResult`.

### Problem Detail

In Pi's message array:
```
[0] user: "read the file"
[1] assistant: { toolCall id:"c1", name:"read" }
[2] toolResult: { toolCallId:"c1", text:"file contents..." }
[3] assistant: "Here's what I found..."
[4] user: "now compress m0001-m0003"
```

If the model compresses range m0001..m0003 (indices 0-2), filtering removes indices 0, 1, 2 and injects a summary at anchor 0. Result is valid — both the assistant toolCall (index 1) and its toolResult (index 2) are removed together.

But if the model compresses m0001..m0002 (indices 0-1), index 2 (the toolResult for "c1") survives as an orphan → provider rejects.

### Solution: Two Layers

#### Layer 1: Expand range at compression time

**`src/compress/search.ts`** — New function `expandRangeForToolChains(messages, startIndex, endIndex)`:

1. Scan messages in [startIndex, endIndex] for assistant messages containing `toolCall` items.
2. For each `toolCall.id` found, check if the corresponding `toolResult` message (by `toolCallId`) is outside the range. If so, expand `endIndex` to include it.
3. Scan messages in range for `toolResult` messages. For each, check if the `assistant` message containing the matching `toolCall.id` is outside the range. If so, expand `startIndex` to include it.
4. Repeat until stable (one pass is sufficient in practice since tool results always follow their calls).

Call this from `resolveSelection` after computing the initial range.

#### Layer 2: Safety net in filterCompressedRanges

**`src/messages/prune.ts`** — After building the filtered result array, scan for orphaned `toolResult` messages:

1. Build a set of all `toolCall.id` values from `assistant` messages in the filtered output.
2. For each `toolResult` in the filtered output, check if its `toolCallId` exists in the set.
3. If orphaned, remove the `toolResult` from the output (it's safer to drop it than to leave it dangling).

This is belt-and-suspenders. Layer 1 prevents the situation; Layer 2 catches any edge case that slips through (e.g., a stale block referencing indices that shifted).

### Files Touched

- `src/compress/search.ts` — add `expandRangeForToolChains`
- `src/messages/prune.ts` — add orphan check in `filterCompressedRanges`

### Verification

- New test: compress a range that includes an assistant toolCall but not its toolResult → range auto-expands.
- New test: `filterCompressedRanges` with a manually-crafted orphan → orphan is removed from output.
- Existing `compress-cycle.test.ts` passes unchanged.

---

## Phase 4: Protect Tool Chains in Pruning Strategies

**Goal:** Deduplication and purge-errors never create a state where `filterCompressedRanges` could produce orphans.

### Problem Detail

Currently, `pruneToolOutputs` and `pruneToolErrors` replace *content* but keep the message structurally intact — the `toolResult` message stays in the array with role "toolResult" and its `toolCallId` intact. This is safe because the message chain remains valid.

The risk is indirect: if strategies prune a toolResult's content, and later compression targets a range that includes the *assistant* message (with the toolCall) but not the pruned toolResult, the filtered output will have an orphaned toolResult.

Phase 3's Layer 2 already handles this. Phase 4 adds an additional index-based lookup for fast validation.

### Changes

**`src/state/types.ts`** — Add to `ToolParameterEntry`:

```typescript
export interface ToolParameterEntry {
  // ... existing fields ...
  /** Index of the assistant message containing this tool call. */
  assistantIndex: number | undefined;
  /** Index of the toolResult message for this tool call. */
  resultIndex: number | undefined;
}
```

**`src/state/tool-cache.ts`** — When building the cache, record both indices:
- `assistantIndex`: the index of the `assistant` message in the messages array where the `toolCall` content item was found.
- `resultIndex`: the index of the `toolResult` message with matching `toolCallId`.

**`src/compress/search.ts`** — `expandRangeForToolChains` can use these cached indices instead of scanning the full message array, making it O(1) per tool call instead of O(n).

### Verification

- `tool-cache.test.ts`: entries include correct `assistantIndex` and `resultIndex`.
- Integration: `expandRangeForToolChains` uses cached indices when available, falls back to scan.

---

## Non-Goals

- No changes to the compress tool's parameter schema.
- No changes to the system prompt or nudge logic.
- No changes to the `dcp:sweep` command behavior (it already replaces content, not removes messages).
- No structural changes to `SessionState` beyond adding two fields to `ToolParameterEntry`.

## Testing Strategy

Each phase has independent tests. Phases are ordered so each is independently shippable:
- Phase 1 alone fixes the stats reporting bug.
- Phase 2 alone (with Phase 1) gives visibility into compression.
- Phase 3 alone fixes the 400 error.
- Phase 4 alone adds lookup efficiency for Phase 3.

Run `pnpm run check` after each phase to verify no regressions.

## File Impact Summary

| File | Phase | Change |
|------|-------|--------|
| `src/state/tool-cache.ts` | 1, 4 | Compute tokenCount; record assistantIndex/resultIndex |
| `src/state/types.ts` | 4 | Add assistantIndex, resultIndex to ToolParameterEntry |
| `src/compress/handler.ts` | 2 | Include token savings in response string |
| `src/compress/state.ts` | 2 | Pass compressedTokens through NormalizedEntry |
| `src/compress/search.ts` | 3, 4 | Add expandRangeForToolChains |
| `src/messages/prune.ts` | 3 | Add orphan safety net in filterCompressedRanges |
| `tests/tool-cache.test.ts` | 1, 4 | Token counting + index fields |
| `tests/compress-range.test.ts` | 2 | Token reporting in response |
| `tests/compress-search.test.ts` | 3 | Range expansion tests |
| `tests/prune.test.ts` | 3 | Orphan removal tests |
