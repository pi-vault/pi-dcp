# Amendment 2: Bound the Residual Regex and Keep Layered Handling

**Amends**: `docs/05-amend-01-and-03-regex-safety.md`

## Summary

The previous amendment correctly rejected stripping arbitrary bare `m####` values. Two further corrections are needed:

1. The proposed namespace-anchored residual regex is still too greedy because its closing `>` is optional.
2. Malformed MiniMax tool syntax should be handled at both layers: the provider should fail closed, while pi-dcp may surface a user notification.

## 1. The residual regex must be bounded

The proposed pattern was:

```ts
/-?dcp-(?:message-id|system-reminder)\b[^<>\n]*>?/gi;
```

The optional `>?` means it can consume ordinary prose after a phrase such as `dcp-message-id is ...`. It also lacks a boundary before `dcp`, so it may match inside a larger identifier.

A safer implementation should:

- require a closing `>` for inline residual-tag matches;
- require a valid boundary before the namespace;
- use a separate, tightly bounded end-of-line pattern for genuinely truncated fragments;
- never match arbitrary bare `m####` references.

The exact regex should be covered by tests for both valid residuals and ordinary prose containing the namespace.

## 2. Lone closing tags are already handled

The existing `DCP_UNPAIRED_TAG` pattern in `src/messages/strip.ts` matches a complete lone closing tag such as:

```text
</dcp-message-id>
```

It does not require a matching opener. Therefore the issue is not that lone complete closing tags are missed; the remaining gap is malformed or prefix-less residual text such as:

```text
-dcp-message-id>
```

## 3. Keep responsibility layered

The previous amendment favored pi-dcp as the primary layer for `<invoke>` handling. That is incomplete.

The `minimax-openai` adapter is responsible for converting MiniMax’s wire stream into Pi’s native assistant-message format. Passing XML tool syntax through as ordinary text with `stopReason: "stop"` violates that conversion boundary. The provider should fail closed and return a retryable provider error.

pi-dcp can additionally inspect the completed message and notify the user when malformed output is visible. Notification is a UX safeguard, not a replacement for provider validation or retry behavior.

## 4. Treatment of bare `m0103`

The bare `m0103` leak remains a real diagnostic example but is not safely removable by a stateless text regex. A future state-aware sanitizer could compare it against the set of refs injected during the current context pass. Until then, it should be detected conservatively and surfaced as an unproductive or malformed turn rather than blindly deleted.

A generic `m\d{4}` detector is also unsafe: model names, identifiers, measurements, and user-provided text can match it. Prefer known DCP refs or stronger surrounding evidence.

## Final position

- Keep the diagnosis that MiniMax leaks DCP metadata.
- Use a narrowly bounded namespace residual matcher for prefix-less DCP fragments.
- Do not strip arbitrary bare `m####` values.
- Keep provider fail-closed handling for malformed `<invoke>` output.
- Add optional pi-dcp notification for the user-visible failure.
- Add regression tests covering residual tags, ordinary prose, lone closing tags, and bare refs.
