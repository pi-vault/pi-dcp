# Addendum: Make the Residual Matcher Conservative

**Amends**: `docs/07-addendum-residual-regex.md`

## Assessment

The previous addendum correctly narrowed the problem to namespace-bearing residuals and kept bare `m####` refs out of the sanitizer. However, its concrete regex still accepts a known false positive and consumes the character before the residual.

It should be revised before implementation.

## Problems with the previous pattern

The proposed pattern was:

```ts
/(^|[^\w-])-?dcp-(?:message-id|system-reminder)\b[^<>\n]*>/gi
```

### It accepts data loss as expected behavior

This documented case is still a false positive:

```ts
stripHallucinationsFromString("dcp-message-id foo>bar") === "bar";
```

The sanitizer silently deletes user text. That is not an acceptable property for a cleanup regex.

### It consumes boundary characters

The `(^|[^\w-])` capture is replaced with an empty string, so a preceding space or newline is removed along with the residual. The sanitizer should remove the malformed marker while preserving surrounding formatting.

### The boundary explanation is inaccurate

`-` is not a JavaScript `\w` character; it is excluded explicitly by the character class. The intent is still valid, but the explanation should describe it as a custom identifier boundary.

## Conservative immediate matcher

The observed DCP residuals are line/message-ending fragments such as `-dcp-message-id>`. A safer immediate matcher should target only that shape and preserve surrounding whitespace:

```ts
// Remove an exact residual marker only when it terminates a line.
// Do not match arbitrary prose between the namespace and `>`.
const DCP_RESIDUAL_LINE =
  /(?<![\w-])-?dcp-(?:message-id|system-reminder)>[ \t]*$/gim;
```

This deliberately does not handle every imaginable malformed tag. It handles the confirmed line-174 shape while avoiding the known `dcp-message-id foo>bar` deletion.

If later evidence requires residual attributes or inline fragments, add narrowly scoped cases with dedicated tests rather than widening this pattern generically.

## Required test cases

### Must strip

```ts
expect(stripHallucinationsFromString("-dcp-message-id>")).toBe("");
expect(stripHallucinationsFromString("dcp-message-id>")).toBe("");
expect(stripHallucinationsFromString("hello\n-dcp-message-id>\nworld")).toBe(
  "hello\n\nworld",
);
expect(stripHallucinationsFromString("-dcp-system-reminder>\n")).toBe("");
```

### Must preserve

```ts
expect(stripHallucinationsFromString("m0103")).toBe("m0103");
expect(stripHallucinationsFromString("the m1024 model")).toBe(
  "the m1024 model",
);
expect(stripHallucinationsFromString("dcp-message-id is generally safe")).toBe(
  "dcp-message-id is generally safe",
);
expect(stripHallucinationsFromString("dcp-message-id foo>bar")).toBe(
  "dcp-message-id foo>bar",
);
expect(stripHallucinationsFromString("m0103-dcp-message-id>")).toBe(
  "m0103-dcp-message-id>",
);
```

The existing four patterns should remain unchanged and `DCP_RESIDUAL_LINE` should run last.

## Out-of-scope cases

- Bare `m0103` remains a detection/state-aware-sanitization problem. Do not add a generic `m\d{4}` regex.
- A residual marker without `>` remains ambiguous with ordinary prose and should be handled only with known injected refs or a separate notification path.
- `<invoke name="bash">` remains a MiniMax/provider protocol problem. The provider should fail closed; pi-dcp may notify the user as a secondary UX safeguard.
- A complete lone `</dcp-message-id>` is already handled by `DCP_UNPAIRED_TAG`.

## Final position

Use the smallest matcher that fixes the confirmed `-dcp-message-id>` leak without accepting documented data loss. Preserve whitespace, avoid arbitrary prose deletion, and leave bare refs and malformed tool calls to their respective state-aware/provider-level fixes.
