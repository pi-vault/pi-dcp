# Report: MiniMax-M3 DCP-Tag Leak

## Executive summary

The incident has two related but distinct causes:

1. **MiniMax-M3 sometimes echoes or partially emits pi-dcp’s XML metadata.**
2. **pi-dcp’s sanitizer cannot remove fragments whose opening `<` was lost.**

A separate failure occurs when MiniMax emits:

```xml
<invoke name="bash">
```

instead of a structured OpenAI tool call. Pi interprets that as ordinary text followed by a normal `stop`, so no tool runs and no error notification appears.

## Evidence

pi-dcp injects model-visible tags into every user and assistant message:

```xml
<dcp-message-id>m0103</dcp-message-id>
```

This happens in `src/messages/inject.ts`.

The system prompt tells MiniMax not to emit these tags, but the instruction is not enforced by the provider.

The sanitizer in `src/messages/strip.ts` only matches patterns beginning with `<dcp` or `</dcp`. Therefore these outputs survive:

```text
-dcp-message-id>
m0103
```

The supplied session log contains both forms:

- Line 152: trailing `m0103`
- Line 174: trailing `-dcp-message-id>`
- Line 210: `<invoke name="bash">`

All are assistant messages with:

```json
"stopReason": "stop"
```

and no structured tool call or error.

## Root-cause classification

### Primary DCP defect

`stripHallucinationsFromString()` is not fragment-safe. It assumes the model preserves the opening `<` character. When MiniMax emits only part of a tag, the residue reaches the UI and session history.

### Model/provider defect

MiniMax-M3, through the `minimax-openai` OpenAI-compatible provider, sometimes emits XML-style tool syntax instead of native `tool_calls`. The `<invoke>` case is not caused by the DCP regex and requires provider-level handling.

### Silent-stop behavior

`finish_reason: "stop"` is treated by Pi as a successful normal completion. Since no structured tool call exists, the agent loop ends normally. pi-dcp has no handler that identifies malformed protocol output and calls `notify()`.

## Impact

- Tool execution stops unexpectedly.
- Junk XML fragments become visible to the user.
- The user receives no actionable error or retry prompt.
- The malformed output may remain in future context, potentially reinforcing the problem.

## Recommended fixes

1. Make DCP sanitization context-aware and remove only known injected message IDs.
2. Add regression tests for:
   - incomplete `<dcp-message-id>` tags
   - `-dcp-message-id>`
   - known bare IDs such as `m0103`
3. Make the MiniMax provider fail closed on bare `<invoke>` markup and return a retryable provider error.
4. Notify the user only when malformed protocol output is detected.
5. Consider replacing model-visible XML metadata with less collision-prone delimiters.

## Confidence

The sanitizer defect and silent-stop mechanism are directly confirmed by the source and logs. The claim that DCP’s XML tags trigger MiniMax’s behavior is strongly supported but would require a no-DCP control run for definitive proof.
