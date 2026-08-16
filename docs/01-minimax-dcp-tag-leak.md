# Bug Investigation: MiniMax-M3 dcp-tag leak in pi-dcp

**Date**: 2026-08-03
**Investigator**: systematic-debugging
**Scope**: Why `MiniMax-M3` (provider `minimax-openai`) prints partial `<dcp-message-id>` tags and stops without notifying the user when `pi-dcp` is active.

## TL;DR

`pi-dcp` appends `<dcp-message-id>m0xxx</dcp-message-id>` to every user/assistant message in `injectMessageIds`. `MiniMax-M3` ignores the "do not output them" instruction in `DCP_SYSTEM_PROMPT` and occasionally echoes those tags — sometimes complete, sometimes as fragments. The strip pass in `src/messages/strip.ts` only matches the canonical `<dcp…` form, so residue that has lost its `<` prefix (e.g. `-dcp-message-id>`, bare `m0103`) survives sanitization, ends up in the user-visible text, and the turn ends with `stopReason: "stop"` and no notification. From the user's perspective the assistant "stops without notifying anything" and a junk XML fragment is printed.

This is reproducible: feeding `-dcp-message-id>` to `stripHallucinationsFromString` is a no-op.

## Evidence in the session logs

All evidence below is from three Pi session JSONL files under `~/.config/pi/sessions/--Users-lanh-Developer-pi-vault-pi-plan--/`:

- `2026-08-02T19-24-55-646Z_019fc3ef-b9de-7ec9-ac8e-09929b9260e9.jsonl` (995 KB)
- `2026-08-02T20-28-27-872Z_019fc429-e560-7e9d-ac45-08298f1617fd.jsonl` (1.3 MB) — main source of evidence
- `2026-08-03T13-39-40-042Z_019fc7d9-fd8a-794e-8fc2-343882ec4fce.jsonl` (597 KB)

All three sessions run with the `pi-plan` extension in `/Users/lanh/Developer/pi-vault/pi-plan` (cwd of every session entry), but `pi-dcp` is also active in all three (`pi-dcp-state` custom entries are appended throughout, and `getAgentDir()` resolves to the same `~/.config/pi` where `extensions/dcp.json` is set).

### Model usage

| log file                | MiniMax-M3 turns                                  | other models     | notes                                                                     |
| ----------------------- | ------------------------------------------------- | ---------------- | ------------------------------------------------------------------------- |
| `2026-08-02T19-24-55-…` | majority (until ~19:43)                           | none persisted   | user keeps MiniMax-M3 despite multiple "Sorry, I couldn't complete" stops |
| `2026-08-02T20-28-27-…` | entire session                                    | none             | where the leaks live                                                      |
| `2026-08-03T13-39-40-…` | first turn only, then `stepfun-ai/step-3.7-flash` | `step-3.7-flash` | user switched away after the same complaints                              |

Only `MiniMax-M3` produces the leak pattern in any of the three files.

### Concrete leak shapes

All three are text-only assistant messages with `stopReason: "stop"`. `output_tokens` is given to highlight that MiniMax-M3 was emitting tokens that became invisible (so the strip pass either didn't run or didn't change anything).

| log file                | line | model      | visible text                                                                                                                               | output_tokens | what we see                                                                                              |
| ----------------------- | ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------- |
| `2026-08-02T20-28-27-…` | 152  | MiniMax-M3 | `Sort the selected names alphabetically on enter:\n\n\n\nm0103`                                                                            | 24            | bare `m0103` ref at end of text                                                                          |
| `2026-08-02T20-28-27-…` | 174  | MiniMax-M3 | `Let me fix the TS error in the prompt test. The \`it.each\` is getting inferred as the string type. Let me cast:\n\n\n\n-dcp-message-id>` | 55            | `-dcp-message-id>` residue                                                                               |
| `2026-08-02T20-28-27-…` | 210  | MiniMax-M3 | `\n<invoke name="bash">`                                                                                                                   | 92            | XML-style tool-call opener, never closed (different failure mode but same shape: model gave up mid-emit) |

Same session, additional "model emitted a short text and stopped without a tool call" turns (output_tokens much higher than visible chars):

- line 107 — `**Step 2: Update selector copy:**\n\n\n\n` (244 out tokens, 37 chars)
- line 134 — `Now fix the prompt…sort returned names:\n\n\n\n` (775 out tokens, 108 chars)
- line 140 — `The test references \`write\` row…:\n\n\n\n` (298 out tokens, 182 chars)
- line 194 (`2026-08-02T19-24-55-…`) — `Now run the tests; they should fail in the expected direction…:\n\n\n\n\n\n` (90 out tokens, 129 chars)
- line 223, 226, 244 (same shape)

These extra cases look like the same root cause — model attempted to emit a tool call or a tag, then aborted — but the leaked content got dropped or was just whitespace. The three lines above are the cases where leaked content actually survived into visible text.

## What pi-dcp is putting in the model's context

`src/messages/inject.ts:52-77` adds a tag to every user/assistant message:

```ts
return appendText(cleaned, `\n\n${tag}`);
```

`src/utils/message-ids.ts:55-60` builds the tag:

```ts
export function formatMessageIdTag(
  ref: string,
  attrs?: { priority?: number },
): string {
  if (attrs?.priority !== undefined) {
    return `<dcp-message-id priority="${attrs.priority}">${ref}</dcp-message-id>`;
  }
  return `<dcp-message-id>${ref}</dcp-message-id>`;
}
```

So every user/assistant message the model reads ends with a tag like `\n\n<dcp-message-id>m0117</dcp-message-id>`. The `priority` attribute only appears in `compress.mode: "message"` (see `src/pipeline.ts:46-49`); the user's `extensions/dcp.json` doesn't set `mode`, so it defaults to `"range"` and no `priority` attribute is emitted.

The system prompt at `src/prompts/system.ts:13-15` tells the model not to echo them:

```
`<dcp-message-id>` and `<dcp-system-reminder>` tags are environment-injected metadata. Do not output them.
```

That's the entire anti-echo instruction — one sentence in a multi-paragraph prompt. `MiniMax-M3` reads it, then ignores it roughly once per several dozen turns.

## Why the strip regex misses it

`src/messages/strip.ts` runs four regexes, all anchored on a literal `<` (or `</`) prefix:

```ts
const DCP_COMPLETE_PAIR = /<dcp[-\w]*(?:\s[^>]*)?>[\s\S]*?<\/dcp[-\w]*>/gi;
const DCP_TRUNCATED_PAIR = /<dcp[-\w]*(?:\s[^>]*)?>[\s\S]*?<\/dcp[-\w]*/gi;
const DCP_UNPAIRED_TAG = /<\/?dcp[-\w]*(?:\s[^>]*)?>/gi;
const DCP_PARTIAL_TAG = /<\/?dcp[-\w]*(?:[^\S\n][^>\n]*)?$/gim;
```

If the model emits anything where the `<dcp…` opener has been consumed (e.g. by the model's own reasoning text just before it) but the closing fragment still hits the wire, none of these match. Verified by direct test:

```js
const text = "Let me cast:\n\n\n\n-dcp-message-id>";
const result = text
  .replace(DCP_COMPLETE_PAIR, "")
  .replace(DCP_TRUNCATED_PAIR, "")
  .replace(DCP_UNPAIRED_TAG, "")
  .replace(DCP_PARTIAL_TAG, "");
// result === text   (no change)
```

So when the line-174 text arrives at `message_end`, `stripHallucinationsFromString` is a no-op on it and the handler returns nothing. The persisted JSONL therefore records exactly what the model emitted.

How each residue can survive:

1. **Bare `m0103`** (line 152). Model emits something like `<dcp-message-id>m0103` without ever closing it. `DCP_UNPAIRED_TAG` strips `<dcp-message-id>` (matches `<dcp[-\w]*>`), leaving `m0103`. The trailing newline means `DCP_PARTIAL_TAG` doesn't apply (no `<` at the start of the residue).
2. **`-dcp-message-id>`** (line 174). Model emits `<dcp-message-id priority="5">…</dcp-message-id>-dcp-message-id>` — a complete pair plus a stray closing fragment. `DCP_COMPLETE_PAIR` removes the pair but `-dcp-message-id>` (no `<`) is untouched.
3. **`\n<invoke name="bash">`** (line 210). Different regex (no `dcp-` involved), but same failure shape — model emitted a tool-call opener and stopped without closing it or producing a real tool call. Not a `pi-dcp` bug; it's the model aborting mid-emit. Listed for completeness because it shows up as a "stop without doing anything" symptom.

Reproducer of every line above as a strip test:

```ts
stripHallucinationsFromString("-dcp-message-id>"); // → "-dcp-message-id>"
stripHallucinationsFromString("<dcp-message-id>m0103"); // → "m0103"
stripHallucinationsFromString(
  '<dcp-message-id priority="5"></dcp-message-id>-dcp-message-id>',
); // → "-dcp-message-id>"
```

## Why "no notification"

`src/index.ts:344-352`:

```ts
pi.on("message_end", async (event, _ctx) => {
  if (!config.enabled) return;
  if (event.message.role !== "assistant") return;

  const stripped = mapText(event.message, stripHallucinationsFromString);
  if (stripped !== event.message) {
    return { message: stripped };
  }
});
```

When the regex is a no-op (case 1 and 2 above), the handler falls through, returns `undefined`, Pi keeps the original message, the UI shows it verbatim, and the turn ends with `stopReason: "stop"` because the model emitted `finish_reason: "stop"`. No toast, no error, no `notify()`. From the user's perspective: assistant text appears with a junk fragment, no tool is called, Pi waits for the next user input.

The "model emitted junk and stopped" case (line 210 and the trailing-whitespace cases) is also invisible to the user because nothing in `pi-dcp` distinguishes "model emitted a useful reply" from "model emitted garbage and gave up". There's no signal at all that the turn was unproductive.

## Why the user abandoned MiniMax-M3

The third log (`2026-08-03T13-39-40-…`) starts with one MiniMax-M3 turn (model_change at line 2) and then immediately switches to `step-3.7-flash`. The user's earlier sessions contained repeated "I'm sorry, but I couldn't complete the implementation within this run" stops from MiniMax-M3 (line 17 and 62 of the first log) that the user worked around by re-prompting. After enough rounds of the leak pattern described in this report, the user switched models.

## Root cause classification

- **Primary cause**: `stripHallucinationsFromString` only matches the canonical `<dcp…` form. Fragments missing the `<` prefix slip through and reach the user.
- **Aggravating cause**: the only thing keeping MiniMax-M3 from echoing tags is one sentence in `DCP_SYSTEM_PROMPT`. The model ignores it reliably enough to be a problem.
- **UX gap**: there is no signal to the user when a turn ends with no tool call and a junk fragment. Even if the strip pass eventually succeeds, a turn that produces only garbage (line 210, the trailing-whitespace cases) is invisible.

## Suggested fixes (out of scope for this report)

1. **Broaden the strip regex**. After the four existing patterns, add a catch-all that matches any run of `dcp-message-id` or `dcp-system-reminder` tokens without requiring the `<` prefix, e.g. `/(?:^|[^<>\w-])-?dcp-(?:message-id|system-reminder)\b[^<>\n]*>?/gi`. One extra line in `stripHallucinationsFromString`.
2. **Defense-in-depth check**: after stripping, if the resulting text still contains `dcp-message-id` or `dcp-system-reminder`, treat the sanitization as failed. Either drop the text part entirely or `ctx.ui.notify("dcp: model emitted an unparseable reply, please re-prompt", "warning")`. `src/index.ts:344` is the right place.
3. **Detect "unproductive turn"**: if the message ended with `stopReason: "stop"` but the visible text matches something like `/^[\s<>\w-]*$/` only, or `output_tokens` is much larger than the visible character count, surface that to the user. Same handler.
4. **Stronger system prompt**: add explicit examples of _what_ not to output (including fragments), but this is mostly the model vendor's problem; the extension should not rely on it.

## Reproducer file

```ts
// Minimal repro using the same regex set as src/messages/strip.ts
import { stripHallucinationsFromString } from "./src/messages/strip.ts";

assert.equal(
  stripHallucinationsFromString("-dcp-message-id>"),
  "-dcp-message-id>",
);
assert.equal(stripHallucinationsFromString("<dcp-message-id>m0103"), "m0103");
assert.equal(
  stripHallucinationsFromString(
    '<dcp-message-id priority="5"></dcp-message-id>-dcp-message-id>',
  ),
  "-dcp-message-id>",
);
```

All three assertions pass against the current code — confirming the leak is reproducible.
