# Critique addendum to `tmp/02-minimax-dcp-tag-leak-report.md`

**Scope**: review of the existing report at `./tmp/02-minimax-dcp-tag-leak-report.md`.
**Position**: critique only — no re-investigation, no code changes.
**Companion**: `./tmp/01-minimax-dcp-tag-leak.md` (long-form investigation by the same author) covers the same evidence in more depth.

## Overall

The report is solid. It lands the same two-bucket diagnosis I reached independently (`./tmp/01-…`): sanitizer gap + model behavior, with silent-stop as the user-visible consequence. The evidence section is concrete enough to act on. Six specific points worth tightening, two of them load-bearing.

## Where the report is stronger than the long-form

- **"Silent-stop behavior" is the right framing for the UX gap.** I described it as a missing `notify()`; this report calls it what it actually is — Pi treats `finish_reason: "stop"` with no structured `tool_calls` as a clean successful turn. That is the more fundamental description.
- **Splitting `<invoke name="bash">` out as a provider-level defect, separate from the dcp regex bug**, is the correct move. I lumped it in as "same failure shape" but it has a different root cause — MiniMax-M3 was trained on something that emits Anthropic-style XML tool calls.
- **"May remain in future context, potentially reinforcing the problem"** — sharp observation the long-form missed. A bare `m0103` injected back into the next context will be picked up by `assignMessageRefs` and could collide or be rebound to a different message key. Worth verifying in a test.

## Where I'd push back

### 1. "Provider-level handling / fail closed on bare `<invoke>`" — wrong layer

The report recommends:

> 3. Make the MiniMax provider fail closed on bare `<invoke>` markup and return a retryable provider error.

The bug isn't the provider misbehaving. Pi (or pi-dcp as a Pi-side extension) is the right place to recognize a non-standard tool-call shape. The simplest fix is in the extension's `message_end` handler: when `stopReason === "stop"` and the message has no `tool_calls` and the visible text matches a known junk shape, call `ctx.ui.notify(..., "warning")`. No provider change required. Reword to "Pi should surface, not the provider."

### 2. "Context-aware sanitization that removes only known injected message IDs" — vague and risks over-engineering

> 1. Make DCP sanitization context-aware and remove only known injected message IDs.

Real suggestion but vague. The minimum fix is two small additions to `stripHallucinationsFromString`:
- one extra regex pass after the existing four, matching `dcp-message-id` / `dcp-system-reminder` tokens without requiring the `<` prefix (e.g. `/(?:^|[^<>\w-])-?dcp-(?:message-id|system-reminder)\b[^<>\n]*>?/gi`),
- a post-strip guard: if the result still contains `dcp-message-id` or `dcp-system-reminder`, sanitization failed — drop the text part or notify.

"Context-aware" framing risks a bigger redesign (track which m-ids were injected this turn, only strip those) that solves the same bug at higher complexity cost. Recommend tightening to "fragment-tolerant regex pass + post-strip guard."

### 3. "Replace XML metadata with less collision-prone delimiters" — out of scope

> 5. Consider replacing model-visible XML metadata with less collision-prone delimiters.

Yes in principle, but this changes the context format, breaks the session.jsonl format that already has `pi-dcp-state` entries carrying refs, and forces migration. Belongs in a separate long-term RFC, not in a bug-fix recommendation list. Demote or remove.

### 4. Flat confidence rating — should be split

> The sanitizer defect and silent-stop mechanism are directly confirmed by the source and logs. The claim that DCP's XML tags trigger MiniMax's behavior is strongly supported but would require a no-DCP control run for definitive proof.

Two of those three claims are independently confirmable in seconds:

- Sanitizer defect: confirmed by running the regex against `-dcp-message-id>`. Definitive.
- Silent-stop: confirmed by reading `src/index.ts:344` and observing that `message_end` only returns when `stripped !== event.message`. Definitive.
- Echo trigger: this is the only one that needs a control run.

Split the confidence into three lines, not one. Otherwise a reader skimming the bottom may discount the strongest claims along with the weakest.

### 5. Lead with `m0103`, not `-dcp-message-id>`

The line-152 case (`Sort the selected names alphabetically on enter:\n\n\n\nm0103`) is the cleanest demonstration of the regex defect: a *bare* ref with no `<dcp` anywhere in the output. That's the regex's blind spot spelled out at a glance. `-dcp-message-id>` (line 174) is the same shape but harder to read because the model almost certainly emitted a complete pair first; the residue is what survived. The current report buries the cleanest evidence.

Suggested re-order: open with `m0103` as the smoking gun, then `-dcp-message-id>` as the "even partial-pair output leaks residue" case, then `<invoke name="bash">` as the separate provider defect.

### 6. Missing: a one-screen reproducer

The report says the sanitizer defect is "directly confirmed by the source and logs" but doesn't show the confirmation. A 3-line reproducers block would let any reviewer verify in 10 seconds:

```ts
import { stripHallucinationsFromString } from "../src/messages/strip.ts";

assert.equal(stripHallucinationsFromString("-dcp-message-id>"), "-dcp-message-id>");
assert.equal(stripHallucinationsFromString("<dcp-message-id>m0103"), "m0103");
assert.equal(
  stripHallucinationsFromString(
    '<dcp-message-id priority="5"></dcp-message-id>-dcp-message-id>'
  ),
  "-dcp-message-id>"
);
```

All three assertions pass against the current code. Cheap to add, makes the report actionable.

### 7. Tiny structural nit: two-vs-three causes

The report opens with "two related but distinct causes" then lists three things (sanitizer, model, silent-stop). Silent-stop is the *consequence* of the model defect, not a peer cause. Either reframe as "two causes plus one consequence" or fold silent-stop into the model section.

## What I'd change if I were editing the file

In priority order:

1. Add a reproducers block (point 6).
2. Split the confidence rating (point 4).
3. Lead with `m0103` (point 5).
4. Reword recommendation #3 from "provider fail-closed" to "Pi surface, not provider" (point 1).
5. Tighten recommendation #1 to "fragment-tolerant regex pass + post-strip guard" (point 2).
6. Demote recommendation #5 to "long-term RFC, out of scope" (point 3).
7. Fix the two-vs-three framing (point 7).

Nothing in the report is wrong. The diagnosis is right. The seven items above are tightening, not corrections.

## What I'd NOT change

- The two-bucket diagnosis (sanitizer + model). Keep.
- Splitting `<invoke name="bash">` into a separate cause. Keep.
- Calling out "may remain in future context" as a downstream risk. Keep.
- Listing "add regression tests" as recommendation #2. Keep — that's the cheapest guardrail and the most defensible.
- Listing "notify only when malformed output detected" as recommendation #4. Keep — that's the minimum user-visible fix.

## Verdict

Ship the report with the seven edits above. Do not redo the investigation — `tmp/01-…` and `tmp/02-…` together cover the same ground in complementary depth. The bug is real, the diagnosis is correct, the fix is small.