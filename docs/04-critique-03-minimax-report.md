# Critique of `03-critique-02-minimax-report.md`

## Assessment

The critique is useful and improves the report’s structure, but it should not be accepted wholesale. It correctly separates the DCP-tag leak from MiniMax’s malformed `<invoke>` output, yet its most important recommendation—moving `<invoke>` handling entirely into pi-dcp—is backwards.

## What it gets right

- Separating DCP-tag residue from MiniMax’s malformed `<invoke>` output.
- Reframing silent stopping as a normal `finish_reason: "stop"` with no structured tool call.
- Leading with the clean `m0103` example.
- Adding a minimal reproducer.
- Splitting confidence into:
  - sanitizer defect: confirmed
  - silent-stop behavior: confirmed
  - DCP XML causing MiniMax’s behavior: plausible, but not proven without a no-DCP control
- Describing the issue as two causes plus one consequence.

## Where it is wrong or incomplete

### 1. `<invoke>` belongs primarily at the provider boundary

The `minimax-openai` adapter promises to convert MiniMax’s stream into Pi’s native message format. Passing malformed XML tool syntax through as ordinary text with `stopReason: "stop"` violates that boundary.

The provider should fail closed and return a retryable error. pi-dcp may additionally notify the user, but a `message_end` notification alone cannot retry the turn or repair the missing tool call.

### 2. The proposed generic regex is unsafe

A fragment-tolerant regex can address `-dcp-message-id>`, but it does not safely address bare `m0103`. Removing arbitrary `m####` tokens risks deleting legitimate text.

The safer fix is either:

- strip only known message refs currently injected by DCP, or
- change the injected marker format so fragments remain identifiable.

### 3. The `assignMessageRefs` collision claim is incorrect

`assignMessageRefs()` does not parse assistant text. It derives keys from role/timestamp or tool-call IDs. A leaked `m0103` may pollute future context, but it will not be “picked up,” rebound, or collide in the DCP reference map.

### 4. The XML-format migration is a long-term design option

It is reasonable to defer, but it does not inherently require a session JSONL migration because the injected tags are context transformations rather than persisted message metadata.

## Recommended final framing

> **Two root causes, one consequence:**
>
> 1. MiniMax echoes DCP’s model-visible XML metadata, while pi-dcp fails to sanitize fragments safely.
> 2. MiniMax sometimes emits XML tool syntax, while the OpenAI-compatible provider passes it through as normal text.
> 3. Pi treats the resulting `stop` as a clean turn, producing no retry or notification.

The best solution is **provider fail-closed handling plus optional pi-dcp user notification**, not one or the other.

## Verdict

Accept the critique’s structural edits: add the reproducer, lead with `m0103`, split confidence, and clarify causes versus consequence. Reject its claim that the provider is the wrong layer for `<invoke>` handling, and correct its unsupported `assignMessageRefs` collision theory.
