# Design: strip residual DCP metadata, notify on sanitizer failure

**Date**: 2026-08-16
**Status**: design approved, pending spec review
**Author**: brainstorming skill output
**Supersedes**: nothing — additive to existing strip pipeline

## Context

`MiniMax-M3` (provider `minimax-openai`) intermittently echoes the model-visible XML metadata that `pi-dcp` injects into every user/assistant message (`<dcp-message-id>m####</dcp-message-id>`). The existing sanitizer in `src/messages/strip.ts` only matches the canonical `<dcp…` form, so fragments that lost their opening `<` survive. They reach the user, the turn ends with `stopReason: "stop"` and no tool call, and no notification fires. Documented in `docs/01-minimax-dcp-tag-leak.md` and the subsequent chain (`docs/02-` … `docs/08-`).

Three concrete leak shapes from session logs:

| shape                                                | example                | line               |
| ---------------------------------------------------- | ---------------------- | ------------------ |
| prefix-less residual opener                          | `-dcp-message-id>`     | `docs/01` line 174 |
| bare ref                                             | `m0103`                | `docs/01` line 152 |
| malformed wire format (separate, not addressed here) | `<invoke name="bash">` | `docs/01` line 210 |

## Goals

1. Strip the two addressable shapes (`-dcp-message-id>`, bare known refs) without false-positive risk on legitimate user prose.
2. Surface sanitizer failures to the user when stripping leaves a known-bad shape in the text.
3. Keep existing sanitizer behavior unchanged for cases already covered.

## Non-goals

- Provider fail-closed for MiniMax-M3 `<invoke>` output. Lives in the `pi-providers` package; tracked separately, not in this spec.
- Changing the in-context tag delimiter format. Would force migration.
- Auto-retry of unproductive turns. Notify-only this iteration.

## Design

### Component 1: residual regex additions (`src/messages/strip.ts`)

Add two new regex constants and a small helper, run after the existing four patterns.

```ts
// 5. Inline residual: prefix-less dcp-* fragment with closing `>`.
// Anchored on (^|[^\w-]) so it doesn't match inside identifiers like
// "m0103-dcp-message-id>". Requires `>` so prose that merely mentions
// the namespace is not swallowed.
const DCP_RESIDUAL_INLINE =
  /(^|[^\w-])-?dcp-(?:message-id|system-reminder)\b[^<>\n]*>/gi;

// 6. End-of-line residual: same shape on its own line, no closing `>`.
// Covers the line-174 mechanism (partial opener truncated mid-attribute,
// newline, residual opener on next line).
const DCP_RESIDUAL_EOL =
  /(^|\s)-?dcp-(?:message-id|system-reminder)\b[^\n]*$/gim;
```

Order of operations in `stripHallucinationsFromString`:

```
DCP_COMPLETE_PAIR  (existing)
  → DCP_TRUNCATED_PAIR (existing)
  → DCP_UNPAIRED_TAG   (existing)
  → DCP_PARTIAL_TAG    (existing)
  → DCP_RESIDUAL_INLINE (new)
  → DCP_RESIDUAL_EOL   (new)
```

The two residuals are last because they don't require a leading `<`. Running them earlier would consume parts of well-formed tags before the upstream patterns matched.

Documented false positive (test asserts exact post-state):

- Input: `dcp-message-id foo>bar`
- Output: `bar`
- Rationale: namespace phrase is rare in English prose, trailing `>` is unusual, and the residual leak is the more common case. Test description references `docs/07` and explains why this is the chosen tradeoff.

### Component 2: state-aware bare-ref stripping (`src/messages/strip.ts`)

Add a helper that strips bare `m####` refs only if they were injected during this session's lifetime:

```ts
function stripKnownRefsFromString(
  text: string,
  knownRefs: ReadonlySet<string>,
): string {
  if (knownRefs.size === 0) return text;
  const alts = [...knownRefs].sort((a, b) => b.length - a.length).join("|");
  const re = new RegExp(`(?<![\\w-])(?:${alts})(?![\\w-])`, "g");
  return text.replace(re, "");
}
```

The regex is built dynamically from the set because the set is per-session. Static enumeration of every possible `m\d{4}` was rejected by `docs/04-` (false-positive risk on legitimate numeric tokens). Sorted longest-first to prevent `m01` from matching inside `m0103`. Word boundaries on both sides prevent `m0103` from matching inside `xem0103y` or `m01034`.

Change `stripHallucinationsFromString` signature:

```ts
export function stripHallucinationsFromString(
  text: string,
  knownRefs?: ReadonlySet<string>,
): string;
```

The known-refs strip is the **final** step (after both residuals).

### Component 3: known-refs wiring (`src/index.ts`)

Two call sites:

`stripHallucinations(messages)` — backward-compatible, no known-refs passed. Used at the top of `src/pipeline.ts` where messages are still raw.

`message_end` handler — takes a snapshot of `state.messageIds.byRawId.values()`:

```ts
pi.on("message_end", async (event, ctx) => {
  if (!config.enabled) return;
  if (event.message.role !== "assistant") return;

  const knownRefs = new Set(state.messageIds.byRawId.values());
  const stripped = mapText(event.message, (t) =>
    stripHallucinationsFromString(t, knownRefs),
  );

  if (stripped !== event.message) {
    if (ctx.hasUI) {
      ctx.ui.notify(
        "dcp: stripped residual metadata from model output",
        "info",
      );
    }
    return { message: stripped };
  }

  // Sanitizer returned the message unchanged (no strip matched). If the
  // visible text still carries a dcp-* shape AND the turn produced no
  // tool call, the strip pipeline missed a case we need to investigate.
  // Per docs/06: notification is a UX safeguard, not a replacement for
  // provider validation. This branch is expected to be rare — it fires
  // only on shapes the regex set doesn't yet cover.
  const text = collectText(event.message);
  if (looksLikeUnproductiveTurn(text, event.message)) {
    if (ctx.hasUI) {
      ctx.ui.notify(
        "dcp: model output looked malformed (no tool call, residual metadata present). Try re-prompting.",
        "warning",
      );
    }
  }
});
```

Helpers in the same file:

```ts
function collectText(msg: AgentMessage): string {
  if (!("content" in msg) || !Array.isArray(msg.content)) return "";
  return msg.content
    .filter(
      (p): p is { type: "text"; text: string } =>
        typeof p === "object" &&
        p !== null &&
        (p as { type?: unknown }).type === "text",
    )
    .map((p) => p.text)
    .join("\n");
}

function looksLikeUnproductiveTurn(text: string, msg: AgentMessage): boolean {
  const stopReason = (msg as { stopReason?: string }).stopReason;
  if (stopReason !== "stop") return false;
  const hasToolCall =
    Array.isArray((msg as { content?: unknown[] }).content) &&
    ((msg as { content: Array<{ type?: string }> }).content ?? []).some(
      (p) => p?.type === "toolCall",
    );
  if (hasToolCall) return false;
  return /[-]?dcp-(message-id|system-reminder)/.test(text);
}
```

### Lifecycle correctness

`state.messageIds.byRawId` is cleared in `session_compact` (`src/index.ts`) and reset by `resetSessionState(state)` in `session_start`. Stale refs from prior sessions do not leak. Refs from prior passes within the same session stay in the set — intentional: the model can legitimately echo an older ref.

The `Set` snapshot is built at strip time, not reused across turns. Minor allocation cost, no correctness concern.

## Data flow

```
model emits text
   ↓
message_end handler
   ↓
build knownRefs = Set(state.messageIds.byRawId.values())
   ↓
mapText(msg, t => stripHallucinationsFromString(t, knownRefs))
   ↓
strip pipeline:
   DCP_COMPLETE_PAIR     → strips well-formed pairs
   DCP_TRUNCATED_PAIR    → strips pairs missing close >
   DCP_UNPAIRED_TAG      → strips lone <dcp-...> or </dcp-...>
   DCP_PARTIAL_TAG       → strips partial at end of line/string
   DCP_RESIDUAL_INLINE   → strips -dcp-message-id> shape
   DCP_RESIDUAL_EOL      → strips residual on its own line
   stripKnownRefs        → strips bare m#### from injected set
   ↓
if changed: notify "info" + return { message: stripped }
elif looksLikeUnproductiveTurn: notify "warning"
else: nothing
```

## Error handling

- Sanitizer failure (stripped text still contains `dcp-message-id` / `dcp-system-reminder`): not separately checked. If the residuals + known-refs strips leave residual text, the warning notify in `looksLikeUnproductiveTurn` covers the user-visible failure mode. Per `docs/06` we explicitly chose notify-not-fail. Expected to be rare — fires only on shapes the regex set doesn't yet cover.
- Empty `knownRefs` set: short-circuits in `stripKnownRefsFromString`. No regex build, no scan.
- Provider error: unchanged, out of scope.
- `ctx.hasUI === false`: notify calls are guarded. No-op.

## Testing

`tests/strip.test.ts` — append cases. Existing 9 cases must continue to pass.

```ts
// Layer 1: residual regexes
expect(stripHallucinationsFromString("-dcp-message-id>")).toBe("");
expect(stripHallucinationsFromString("dcp-message-id>")).toBe("");
expect(
  stripHallucinationsFromString(
    '<dcp-message-id priority="5"></dcp-message-id>-dcp-message-id>',
  ),
).toBe("");
expect(
  stripHallucinationsFromString(
    'line1\n<dcp-message-id priority="3\n-dcp-message-id>\nline2',
  ),
).toBe("line1\n\nline2");
expect(stripHallucinationsFromString("-dcp-system-reminder>\n")).toBe("");

// Layer 1: false-positive guards
expect(stripHallucinationsFromString("dcp-message-id foo>bar")).toBe("bar");
// documented false positive — see docs/07
expect(stripHallucinationsFromString("dcp-message-id is generally safe")).toBe(
  "dcp-message-id is generally safe",
);
expect(stripHallucinationsFromString("m0103-dcp-message-id>")).toBe(
  "m0103-dcp-message-id>",
);

// Layer 2: known refs
expect(stripHallucinationsFromString("m0103", new Set())).toBe("m0103");
expect(stripHallucinationsFromString("m0103", new Set(["m0103"]))).toBe("");
expect(
  stripHallucinationsFromString(
    "Sort the selected names alphabetically on enter:\n\n\n\nm0103",
    new Set(["m0103"]),
  ),
).toBe("Sort the selected names alphabetically on enter:\n\n\n\n");
expect(
  stripHallucinationsFromString("the m1024 model", new Set(["m0103"])),
).toBe("the m1024 model");
expect(stripHallucinationsFromString("xem0103y", new Set(["m0103"]))).toBe(
  "xem0103y",
);
expect(stripHallucinationsFromString("m01034", new Set(["m0103"]))).toBe(
  "m01034",
);
```

`tests/message-end-sanitize-failure.test.ts` — new file. Mock the existing `createMockPi` / `createMockContext` pattern from `tests/index.test.ts`. Three cases:

1. message has `-dcp-message-id>` residual → sanitizer strips → notify "info" called → return `{ message }` with stripped text.
2. message has bare `m0103` matching known refs → sanitizer strips → notify "info" called.
3. message has no residual but `looksLikeUnproductiveTurn` matches (heuristic-only case) → notify "warning" called, no message return.

## Verification

- `pnpm check` (biome lint + tsc + vitest).
- New tests pass; existing 9 strip.test.ts cases continue to pass.
- The existing partial-tag case (`'<dcp-message-id priority="3"'`) must still strip to `"Text "` — verify by re-running after the regex additions.
- Smoke: read `tests/strip.test.ts` after edit to confirm no test was accidentally renamed or removed.

## Files touched

| file                                         | change                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/messages/strip.ts`                      | add 2 regex constants, extend `stripHallucinationsFromString` signature, add `stripKnownRefsFromString` helper                       |
| `src/index.ts`                               | extend `message_end` handler with known-refs snapshot + post-check + notify; add `collectText` + `looksLikeUnproductiveTurn` helpers |
| `tests/strip.test.ts`                        | append Layer 1 + Layer 2 cases                                                                                                       |
| `tests/message-end-sanitize-failure.test.ts` | new file for Layer 3                                                                                                                 |

## Out of scope (tracked separately)

- `pi-providers` package: fail-closed handling of `<invoke>` XML tool syntax from MiniMax-M3. See `docs/04-`, `docs/06-`.
- Auto-retry of unproductive turns.
- New `state.contextInjectedRefs` field (per-pass refs); reused `state.messageIds.byRawId` per user choice.

## Migration

None. The two new regexes are pure additions. The signature change to `stripHallucinationsFromString` adds an optional parameter — backward compatible. The `message_end` notify additions are additive.
