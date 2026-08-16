# Addendum: concrete residual regex and test list

**Amends**: `docs/06-amend-02-regex-safety.md`, `docs/05-amend-01-and-03-regex-safety.md`, `docs/01-minimax-dcp-tag-leak.md`.

**Scope**: supplies the actual replacement regex(es), the test cases that prove them out, and the verification I ran before recommending. Resolves the gap between `05-`/`06-`'s "use a narrow regex" recommendation and the concrete code change a fix would require.

## TL;DR

One additional regex in `stripHallucinationsFromString` catches the line-174 case (`-dcp-message-id>` and similar `>`-terminated residuals) without false-positive risk:

```ts
// Match prefix-less residual fragments of dcp-* tags whose opener was lost.
// Requires a closing '>' so the match can't swallow following prose that
// merely mentions the namespace. Anchored on non-word/word-boundary before
// the namespace so we don't match inside larger identifiers like "fdcp-..."
// or "m0103-dcp-message-id>".
const DCP_RESIDUAL =
  /(^|[^\w-])-?dcp-(?:message-id|system-reminder)\b[^<>\n]*>/gi;
```

This handles the `-dcp-message-id>` shape (line 174) and the trailing residue after a stripped complete pair (`<dcp-message-id priority="N"></dcp-message-id>-dcp-message-id>` → `""`).

The EOL / truncated-no-`>` case is **not** safely regex-able and should be addressed at the detection layer (see "What this regex does NOT fix" below).

## Verification

I ran the proposed regex against 16 test cases before recommending it. All pass. Cases below correspond to tests that should land in `tests/strip.test.ts`.

### Cases the regex handles correctly

```ts
import { stripHallucinationsFromString } from "../src/messages/strip.ts";

// Smoke: existing behavior unchanged
expect(
  stripHallucinationsFromString(
    "hello <dcp-message-id>m0001</dcp-message-id> world",
  ),
).toBe("hello  world");
expect(stripHallucinationsFromString("text </dcp-foo> more")).toBe(
  "text  more",
);
expect(stripHallucinationsFromString("Some text <dcp-message-id")).toBe(
  "Some text ",
);

// New: prefix-less residual opener
expect(stripHallucinationsFromString("-dcp-message-id>")).toBe("");
expect(stripHallucinationsFromString("dcp-message-id>")).toBe("");

// New: complete pair followed by trailing residual (the line-174 mechanism)
expect(
  stripHallucinationsFromString(
    '<dcp-message-id priority="5"></dcp-message-id>-dcp-message-id>',
  ),
).toBe("");

// New: <dcp-message-id priority="N">…</dcp-message-id>-dcp-message-id> works
// because DCP_COMPLETE_PAIR strips the pair first, then DCP_RESIDUAL strips
// the trailing '-dcp-message-id>'.

// Multiline: opener-with-priority truncated mid-attribute, then newline,
// then residual on its own line
expect(
  stripHallucinationsFromString(
    'line1\n<dcp-message-id priority="3\n-dcp-message-id>\nline2',
  ),
).toBe("line1\n\nline2");
// DCP_PARTIAL_TAG strips '<dcp-message-id priority="3' at end of line,
// then DCP_RESIDUAL strips '-dcp-message-id>'. Clean.

// system-reminder variant
expect(stripHallucinationsFromString("-dcp-system-reminder>")).toBe("");

// Residual alone on its own line still caught (the `^` boundary allows it)
expect(stripHallucinationsFromString("hello\n-dcp-message-id>\nworld")).toBe(
  "hello\nworld",
);
```

### Cases the regex MUST NOT match (false-positive guards)

```ts
// Bare ref - never strip
expect(stripHallucinationsFromString("m0103")).toBe("m0103");
expect(stripHallucinationsFromString("the m1024 model")).toBe(
  "the m1024 model",
);

// Prose mentioning the namespace without a closing '>'
expect(stripHallucinationsFromString("dcp-message-id is generally safe")).toBe(
  "dcp-message-id is generally safe",
);
expect(stripHallucinationsFromString("dcp-system-reminder is active")).toBe(
  "dcp-system-reminder is active",
);

// Identifier containing dcp-message-id as a substring (boundary check)
expect(stripHallucinationsFromString("m0103-dcp-message-id>")).toBe(
  "m0103-dcp-message-id>",
);
// (^|[^\w-]) requires non-word before the namespace. `-` is a word
// character so the pattern doesn't match here.

// Prose between dcp-message-id and '>' with non-tag content. This is the
// one borderline case the regex DOES match:
//   dcp-message-id foo>bar  ->  ""+"" = "" (the prefix and '>' eat 'foo')
// It's a false positive only if the user wrote this exact prose. Given
// (a) how rare the literal phrase is, (b) how unusual the trailing '>'
// is in English prose, (c) the result is shorter prose, not data loss —
// I judge this acceptable. Document it in the test as expected behavior.
expect(stripHallucinationsFromString("dcp-message-id foo>bar")).toBe("bar"); // <- documented false positive
```

## What this regex does NOT fix

Three cases from the original report are deliberately out of scope:

1. **Bare `m0103` (line 152).** This is a real leak but a regex can't distinguish it from `m1024` in `the m1024 model` or any other numeric token following `m`. The fix here is state-aware stripping: track the refs `injectMessageIds` actually injected during this context pass, and only strip those. Larger change, separate fix. Until then, surface as an unproductive turn via `message_end` notify (see `06-`).

2. **`<invoke name="bash">` (line 210).** This is MiniMax-M3 emitting Anthropic-style XML tool syntax. Not a dcp regex issue. Provider-level fail-closed is the right layer (see `06-`'s "keep responsibility layered").

3. **End-of-line truncated residual without `>`** — e.g. a line containing just `-dcp-message-id` (no closing `>`). I attempted to write an EOL regex that catches this without false positives, and could not. The fundamental issue: prose that _mentions_ the namespace (`dcp-message-id is generally safe`) is indistinguishable from a genuine truncated residual on a line, unless we know we injected `dcp-message-id` in the current context pass. The conservative answer is to leave this case to the state-aware sanitizer when it lands.

## Order of operations in `stripHallucinationsFromString`

```ts
return text
  .replace(DCP_COMPLETE_PAIR, "")
  .replace(DCP_TRUNCATED_PAIR, "")
  .replace(DCP_UNPAIRED_TAG, "")
  .replace(DCP_PARTIAL_TAG, "") // existing
  .replace(DCP_RESIDUAL, ""); // new — must come last
```

`DCP_RESIDUAL` runs last because it doesn't require a leading `<`. If it ran first, it would consume parts of well-formed tags before `DCP_COMPLETE_PAIR` got a chance to match them.

## What I'd NOT recommend

- **`m\d{4}` regex.** Caught by `04-` critique and confirmed in my own test run. False positives everywhere.
- **A general EOL residual regex.** Can't tell genuine truncated residual from prose that mentions the namespace.
- **Replacing the existing four patterns.** They're already correct for their stated cases; adding `DCP_RESIDUAL` covers the gap.

## Summary of fixes to land

1. Add `DCP_RESIDUAL` constant in `src/messages/strip.ts`:
   ```ts
   const DCP_RESIDUAL =
     /(^|[^\w-])-?dcp-(?:message-id|system-reminder)\b[^<>\n]*>/gi;
   ```
2. Add it as the last `.replace(...)` in `stripHallucinationsFromString`.
3. Add the test cases above to `tests/strip.test.ts`.
4. Document the known false positive (`dcp-message-id foo>bar`) as expected behavior in the test description, so future maintainers don't try to tighten the regex and break the cases that matter.

The bare `m0103` and provider-level `<invoke>` cases are separate fixes tracked elsewhere in this document chain.
