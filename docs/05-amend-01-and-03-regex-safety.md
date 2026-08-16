# Amendment to `01-` and `03-`: the fragment-tolerant regex recommendation is unsafe

**Scope**: corrects a recommendation that appears in both `docs/01-minimax-dcp-tag-leak.md` and `docs/03-critique-02-minimax-report.md`.
**Trigger**: critique at `docs/04-critique-03-minimax-report.md` flagged that a fragment-tolerant regex which strips bare `m####` tokens is unsafe.
**Position**: the critique is right on this point. Both earlier files should be amended.

## What was wrong

Both `01-` and `03-` recommended a regex that would match bare `m####` tokens (the `m0103` shape) without a `<dcp-` prefix. The motivation was that `m0103` is one of the documented leak shapes from the session logs.

The problem: `m####` matches far more than leaked dcp tags. It matches:

- File sizes (`m1024` in a build log)
- Markdown ordered-list indices followed by digits (`m1.`/`m2.`)
- Hex colors with `m` prefix in non-standard notations
- Variable names, code identifiers, commit refs
- Plain prose: "a 200m³ room", "the m500 model", "case m1024"
- Currency, units, model numbers, part numbers
- Anything the user wrote earlier in the same session

Stripping `m\d{4}` blindly would silently corrupt legitimate assistant output and user-visible text. The current strip regex is conservative for good reason.

## What to recommend instead

The safe fragment set is exactly the cases where `dcp-message-id` or `dcp-system-reminder` itself appears in the residue, **without** a leading `<`. Specifically the residue shapes we've observed:

- `-dcp-message-id>` (line 174)
- `dcp-message-id>` (variant if the leading `-` is absent)
- `</dcp-message-id>` (already caught by current regex, but only when it follows a matching opener; lone close after a long emit is also a known case)
- Same shapes for `dcp-system-reminder`

These are unambiguous because `dcp-message-id` and `dcp-system-reminder` are namespace-prefixed strings controlled by the extension. They will not appear in legitimate user/assistant content unless the user is actively debugging pi-dcp.

The narrow regex:

```ts
// Match residual fragment of a dcp-* tag whose opener was lost.
// Anchored on the namespace prefix so we don't touch arbitrary text.
const DCP_RESIDUAL = /-?dcp-(?:message-id|system-reminder)\b[^<>\n]*>?/gi;
```

Run this _after_ the existing four patterns. It catches `-dcp-message-id>` and `<dcp-message-id priority="N">…</dcp-message-id>-dcp-message-id>` (the opener-pair is caught first by `DCP_COMPLETE_PAIR`, leaving only the trailing residue). It does **not** strip `m0103`.

What to do about `m0103` (the line-152 case) is a separate problem — see below.

## The `m0103` case

`m0103` is a real leak (line 152) but it is **not** safely strippable from text alone. Two principled fixes, both out of scope for the immediate bug:

1. **State-aware stripping** — track which `m####` refs were injected this session and only strip those. More code, but correct. This is what the `04-` critique author suggested as the right framing.
2. **Change the delimiter format** — pick a tag shape that the model can't easily drop the prefix of. e.g. random suffixes (`m0103-7f3a`), uncommon Unicode brackets (`〔dcp-message-id〕m0103〔/dcp-message-id〕`), or wrap each message-id tag in a paired marker that includes a checksum. Bigger change, longer-term.

For the immediate fix, the right call is: accept that bare `m0103`-shaped leaks are uncatchable by text-only stripping, and address them at the **detection** layer instead:

- Add a `message_end` post-check: if `stopReason === "stop"` and no tool calls and the visible text matches a residual dcp pattern (e.g. ends with `m\d{4}\b` alone, or contains `dcp-message-id` anywhere), call `ctx.ui.notify("dcp: model emitted an unparseable reply, please re-prompt", "warning")`.
- Optionally drop the text part entirely if the only content is a bare ref or known dcp residue.

This pairs the safe strip pass with a notification guard, which is what the `04-` critique's "two causes plus one consequence" framing was really after.

## Specific edits to `01-`

Replace "Suggested fix #1" in `tmp/01-minimax-dcp-tag-leak.md`:

> ~~Add a catch-all that matches any run of `dcp-message-id` or `dcp-system-reminder` tokens without requiring the `<` prefix, e.g. `/(?:^|[^<>\w-])-?dcp-(?:message-id|system-reminder)\b[^<>\n]*>?/gi`.~~
>
> The fix must strip only the unambiguous residual shapes (`-dcp-message-id>`, `dcp-message-id>`, `</dcp-message-id>` or `dcp-system-reminder>` variants). The bare-`m####` shape (line 152) is not safely strippable by text alone — handle it at the detection layer instead (see fix #2 in this report).

Replace the suggested regex with the narrower one above.

## Specific edits to `03-`

In the bullet titled "Context-aware sanitization that removes only known injected message IDs", the critique (`03-`) recommended:

> Tighten to "fragment-tolerant regex pass + post-strip guard."

This needs to be tightened further: "fragment-tolerant regex pass" must explicitly **not** include bare `m####` matching. Updated recommendation:

> Tighten to "namespace-anchored residual regex pass (only `-?dcp-(?:message-id|system-reminder)…` shapes) plus post-strip guard. Bare `m####` leaks are not safely strippable from text; address them via notification on unproductive turns, not via the regex."

And in the "What I'd change if I were editing the file" list, item 5 ("Tighten recommendation #1") should be updated to reflect the narrower regex.

## What stays as-is

- The diagnosis of the regex defect is correct in both `01-` and `03-`. The narrow residual regex above still demonstrates it: `-dcp-message-id>` is a no-op against the existing four patterns, and a single new line catches it.
- The `m0103` "lead with this" framing in `03-` is fine for **diagnosis** (it's the cleanest demonstration that the regex is prefix-anchored) but not for **fix recommendations**. The cleaner fix target is `-dcp-message-id>`.
- The `assignMessageRefs` collision claim from `03-` is separately wrong (per `04-`); amend that too if not already done.
- The "<invoke name="bash">" provider-handling disagreement from `03-` vs `04-` is a separate discussion and not affected by this amendment.

## Summary of corrections

| claim                                                | source                                        | status                                                                                                             |
| ---------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Strip regex should match bare `m####`                | `01-` fix #1; `03-` recommendations           | **wrong — unsafe**, replace with namespace-anchored residual regex                                                 |
| `assignMessageRefs` collides with leaked `m0103`     | `03-` "may remain in future context"          | **wrong** — `assignMessageRefs` derives keys from `role:timestamp` / `toolCallId`, not from text                   |
| XML-format migration requires JSONL migration        | `03-` point 5                                 | **wrong** — dcp tags are in-context, not in the persisted message body                                             |
| `<invoke>` should be handled at provider layer       | `02-` recommendation #3; pushed back in `03-` | **disagreement held** — pi-dcp is the right primary layer because that's where the user-visible signal has to live |
| `m0103` is the cleanest evidence of the regex defect | `03-` point 5                                 | **kept for diagnosis**, not for fix                                                                                |

## Verdict

Accept the `04-` corrections on regex safety, the `assignMessageRefs` claim, and the JSONL migration claim. Hold the line on the provider-vs-pidcp layer question. Update `01-` and `03-` with the narrower regex and the corrected rationale. The `m0103` case is the new edge that pushes the fix from "regex only" to "regex plus unproductive-turn detection" — that's the more honest scope of the bug.
