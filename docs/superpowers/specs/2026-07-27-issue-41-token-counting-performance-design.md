# Issue 41 token-counting performance fix

## Summary

pi-dcp 0.4.0 replaced its character-based token estimate with `@anthropic-ai/tokenizer`. The context hook runs the token counter once for every historical tool result on every context pass. The dependency constructs and frees a Tiktoken instance for each call, so latency grows with the number of tool results in a session.

This change restores the character-based estimator from 0.3.0 and removes the tokenizer dependency. Pi's context API remains the source of accurate total context usage. DCP's per-message estimates continue to support pruning statistics and compression savings.

Issue: https://github.com/pi-vault/pi-dcp/issues/41

## Evidence

The 0.4.0 implementation takes about 1.8 seconds to process 50 tool results containing 4 KiB each. A second pass over the same cached results takes the same amount of time because `syncToolCache` counts every result before checking whether its tool call is already cached. The 0.3.0 implementation completes the same passes in about 0.1 ms on the same machine.

The dependency's setup dominates the cost:

- 50 tokenizer construction and cleanup cycles: about 1,835 ms
- 50 encodes through one tokenizer instance: about 70 ms

The regression first appears in commit `96d64a1f083d50ecef1e6b0e388237cc44877160`.

## Goals

- Remove the long-session CPU spike and TUI stalls reported in issue 41.
- Restore deterministic, provider-neutral per-message token estimates.
- Keep the patch small enough for a 0.4.x bug-fix release.
- Prevent the exact Anthropic tokenizer from being reintroduced through the existing token-counting contract.

## Non-goals

- Redesign `syncToolCache` or the context pipeline.
- Add token-count caching or a tokenizer lifecycle manager.
- Produce model-specific per-message token counts.
- Add a benchmark framework or a timing threshold to CI.
- Change compression thresholds, pruning behavior, or configuration.
- Fix unrelated pending tool-result synchronization behavior.

## Design

### Token estimation

`countTokens` will use the 0.3.0 calculation:

```ts
if (text.length === 0) return 0;
return Math.max(1, Math.round(text.length / 4));
```

The function's signature and callers remain unchanged. `countTokensBatch`, `extractMessageText`, and `countMessageTokens` continue to use `countTokens` as they do now.

The estimator is appropriate for this data because accurate context-level thresholds come from `ctx.getContextUsage()`. The local counts are estimates used for token-savings accounting. A provider-specific tokenizer does not make those values universally accurate when Pi is running a non-Anthropic model.

### Dependencies

Remove `@anthropic-ai/tokenizer` from runtime dependencies and regenerate `pnpm-lock.yaml`. No replacement dependency is needed.

### Context processing

Do not change the context hook, pipeline, or tool cache. They will continue to scan historical tool results. With an arithmetic estimator, the scan avoids repeated tokenizer setup and returns to the behavior measured in 0.3.0.

Keeping cache changes out of this patch avoids mixing a performance rollback with synchronization behavior changes. A separate change can optimize the scan if profiling shows that it remains material after this fix.

### Error handling

The estimator does not allocate external resources and cannot fail for a JavaScript string. Remove the tokenizer fallback `try/catch`; the estimator is the primary path rather than an exception fallback.

### User-facing documentation

Add an `[Unreleased]` entry to `CHANGELOG.md` under `Fixed`. It should state that long sessions no longer repeatedly invoke the Anthropic tokenizer during context processing.

No README or configuration documentation changes are needed because the token-counting implementation is not a user-facing option.

## Testing

Update the token tests to assert deterministic heuristic behavior:

- Empty input returns `0`.
- Non-empty input returns at least `1`.
- Representative text returns `Math.round(text.length / 4)`.
- Longer text produces a larger estimate.

Update the tool-cache token-count assertion from the Anthropic-specific value to the heuristic value. Existing pipeline, strategy, compression, and integration tests must continue to pass.

Do not add a wall-clock assertion to Vitest. Timing limits are machine-dependent and would create a flaky test. The deterministic token tests enforce the implementation choice that removes the regression.

Run the issue reproduction benchmark outside the test suite with 50 tool results containing 4 KiB each. On the machine used for diagnosis, both the initial and cached passes must complete in less than 25 ms. This allows wide measurement variance while remaining far below the 0.4.0 baseline of roughly 1.8 seconds.

## Files expected to change

- `src/utils/tokens.ts`
- `tests/tokens.test.ts`
- `tests/tool-cache.test.ts`
- `package.json`
- `pnpm-lock.yaml`
- `CHANGELOG.md`

## Acceptance criteria

- `@anthropic-ai/tokenizer` is absent from runtime dependencies and the lockfile.
- `countTokens` uses the character-based estimator and has no tokenizer initialization path.
- Token and tool-cache tests assert the estimator's deterministic values.
- The 50-result reproduction completes each pass in less than 25 ms on the machine used for diagnosis.
- `pnpm check` passes.
- The generated schema remains unchanged after `pnpm check`.
- No context-pipeline, cache, configuration, or public API behavior changes are included.

## Risks

Per-message savings figures will be approximate, as they were in 0.3.0. They may differ from the active model's tokenizer. This does not affect threshold decisions because Pi supplies total context usage. The trade-off is intentional: approximate accounting avoids blocking the UI and works consistently across model providers.
