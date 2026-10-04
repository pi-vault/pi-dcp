# Phase 2 — Pi DCP Correctness and Configuration Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make protected-file handling match current Pi tool data, reject unsafe context-limit values without losing valid configuration layers, and make `nudgeForce` select the configured message role.

**Architecture:** Align development types with Pi 1.0.1, normalize direct and nested file paths once in the tool cache, and let every pruning strategy consume that cache. Sanitize global and trusted-project configuration independently before merging so invalid higher-precedence values inherit the previous valid layer. Preserve the existing anchored-nudge and version-1 snapshot models while recording both sides of each eligible user/assistant pair.

**Tech Stack:** Node.js >=24.15.0, TypeScript 7, TypeBox 1.3, Pi 1.0.1 extension APIs, Vitest 5, Biome 2, pnpm

**Spec:** `docs/superpowers/specs/2026-10-03-pi-dcp-improvement-roadmap-design.md`

## Global Constraints

- Execute this phase after `2026-10-03-phase-01-pi-dcp-maintenance-cache-evidence.md` and start from the clean v0.6.1 baseline.
- Use Pi revision `83692682f` as the API authority and OpenCode DCP revision `f8232fd` as behavioral reference only; do not copy AGPL source.
- Keep `@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`, and `typebox` as exact `"*"` peer dependencies; add no runtime dependencies.
- Preserve existing JSON configuration and legacy `filePath` inputs; do not add JSONC.
- Use current Pi exported message types for valid new fixtures; do not hide host-shape mismatches behind `as unknown as`.
- Invalid configuration warns and falls back field-by-field; it never aborts startup.
- Automatic pruning timing, canonical IDs, compression behavior, and the version-1 persisted snapshot shape remain unchanged.
- Existing version-1 snapshots with legacy user-only turn anchors must regain their preceding assistant anchor when the current messages make that pair identifiable.
- Use test-driven development for each behavioral task and commit only after its focused checks pass.

## Review Focus

- The checked-in Pi 1.0.0 types do not expose `nestedCalls`; dependency alignment must happen before typed nested-call fixtures are added.
- A generic `path` property on a non-file tool must not accidentally protect that tool result from pruning.
- An omitted oversized nested-call argument beside valid nested calls must not erase the valid paths.
- An invalid project override must inherit a valid global value instead of resetting directly to the built-in default.
- Soft nudging must inject into an assistant message containing only tool calls by creating a synthetic text part before the first tool call.

---

### Task 1: Align Pi types and cache direct and nested protected paths

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/strategies/protected-patterns.ts`
- Modify: `src/state/tool-cache.ts`
- Modify: `src/state/types.ts`
- Modify: `src/strategies/runner.ts`
- Test: `tests/protected-patterns.test.ts`
- Test: `tests/tool-cache.test.ts`
- Test: `tests/strategy-runner.test.ts`

**Interfaces:**

- Consumes: Pi 1.0.1 `AgentMessage` values, including optional `toolResult.nestedCalls`, and tool arguments shaped as `Record<string, unknown>`.
- Produces: `getFilePathsFromParameters(toolName: string, parameters: Record<string, unknown>): string[]`, `getFilePathsFromNestedCalls(nestedCalls: unknown): string[]`, and required `ToolParameterEntry.filePaths: string[]` values containing unique normalized paths.

- [ ] **Step 1: Align development dependencies with the authoritative Pi checkout**

Set both Pi development dependency ranges to `^1.0.1`, leave peer ranges at `"*"`, update the lockfile, and verify the resolved packages.

Run: `pnpm install && pnpm list @earendil-works/pi-agent-core @earendil-works/pi-coding-agent --depth 0`

Expected: both packages resolve to 1.0.1 and `package.json` contains no new runtime dependency.

- [ ] **Step 2: Add failing direct-path extraction tests**

Add assertions in `tests/protected-patterns.test.ts` for the exact behavior:

```ts
expect(getFilePathsFromParameters("read", { path: "src/secret.ts" })).toEqual([
  "src/secret.ts",
]);
expect(getFilePathsFromParameters("edit", { path: "src\\secret.ts" })).toEqual([
  "src/secret.ts",
]);
expect(
  getFilePathsFromParameters("legacy-tool", { filePath: "legacy/file.ts" }),
).toEqual(["legacy/file.ts"]);
expect(
  getFilePathsFromParameters("custom-tool", { path: "not-a-file-selector" }),
).toEqual([]);
```

Keep `matchesGlob("src\\config.ts", "src/**/*.ts")` false. Add an `isFilePathProtected(["src\\config.ts"], ["src/**/*.ts"])` assertion that is true, proving normalization occurs at the protection boundary rather than changing glob semantics.

- [ ] **Step 3: Run the direct-path tests and confirm the intended failures**

Run: `pnpm vitest run tests/protected-patterns.test.ts`

Expected: FAIL because Pi-native `path` is ignored and candidate backslashes are not normalized.

- [ ] **Step 4: Implement direct extraction and normalization**

In `src/strategies/protected-patterns.ts`, add a private `normalizeFilePath(path: string): string` using `path.replaceAll("\\", "/")`. `getFilePathsFromParameters` must accept `parameters.path` only for `read`, `write`, and `edit`; accept `parameters.filePath` for every tool; process `path` before `filePath`; and remove empty or duplicate normalized strings while preserving first-seen order.

Normalize candidate paths again inside `isFilePathProtected`; do not normalize or otherwise change configured glob patterns.

- [ ] **Step 5: Add failing typed nested-call cache tests**

In `tests/tool-cache.test.ts`, create a valid Pi 1.0.1 `AgentMessage` fixture with `satisfies AgentMessage`, not a double cast. Its parent `codemode` result must contain nested `read` arguments `{ path: "secrets/token.txt" }`, nested `edit` arguments `{ path: "src\\config.ts" }`, a duplicate `read` path, a `write` record with `argumentsBytes` but no `arguments`, and `complete: false`.

Assert the parent cache entry has exactly `["secrets/token.txt", "src/config.ts"]`. Add direct helper assertions showing `undefined`, arrays, non-objects, missing `calls`, and malformed call elements return only paths from well-formed sibling records and never throw.

- [ ] **Step 6: Run the cache tests and confirm `filePaths` is missing**

Run: `pnpm vitest run tests/tool-cache.test.ts`

Expected: FAIL because nested calls are not inspected and `ToolParameterEntry` has no `filePaths` field.

- [ ] **Step 7: Implement nested extraction and cache aggregation**

Implement `getFilePathsFromNestedCalls(nestedCalls: unknown): string[]`. Accept only a non-array record with a `calls` array; for each non-array record with string `name` and non-array object `arguments`, delegate to `getFilePathsFromParameters`. Ignore `complete`, status, omitted arguments, and malformed records.

Extend the first pass of `syncToolCache` to cache nested paths with result metadata. In the second pass, populate every `ToolParameterEntry.filePaths` with the stable union of direct parent paths followed by nested result paths. Update existing manually constructed `ToolParameterEntry` fixtures with `filePaths` so type checking remains explicit.

- [ ] **Step 8: Make every pruning strategy consume cached paths**

Replace the three calls to `getFilePathsFromParameters` in `src/strategies/runner.ts` with `entry.filePaths`. Remove the now-unused runner import.

In `tests/strategy-runner.test.ts`, add protected nested-path and nonmatching control cases for deduplication of repeated parent calls, stale failed-input purging, and `sweepAll` of completed parent calls. Each protected case must keep the parent call out of `state.prune.tools`; each control must remain eligible under the same strategy conditions.

- [ ] **Step 9: Run focused path, cache, strategy, and type checks**

Run: `pnpm vitest run tests/protected-patterns.test.ts tests/tool-cache.test.ts tests/strategy-runner.test.ts && pnpm typecheck`

Expected: PASS, including Pi-native paths, Windows separators, unrelated generic paths, omitted nested arguments, malformed records, duplicates, and all three pruning entry points.

- [ ] **Step 10: Commit the protected-path work**

```bash
git add package.json pnpm-lock.yaml src/strategies/protected-patterns.ts src/state/tool-cache.ts src/state/types.ts src/strategies/runner.ts tests/protected-patterns.test.ts tests/tool-cache.test.ts tests/strategy-runner.test.ts
git commit -m "fix: protect Pi file tool paths from pruning"
```

### Task 2: Sanitize configuration layers and surface actionable warnings

**Files:**

- Create: `src/config-validation.ts`
- Modify: `src/config-schema.ts`
- Modify: `src/config.ts`
- Modify: `src/index.ts`
- Test: `tests/config.test.ts`
- Test: `tests/context-limits.test.ts`
- Test: `tests/index.test.ts`

**Interfaces:**

- Consumes: parsed global and optional trusted-project configuration records plus `DcpConfigSchema`.
- Produces: exported `ContextLimitSchema`; `sanitizeConfigLayer(value: Record<string, unknown>, sourcePath: string): { value: Record<string, unknown>; warnings: string[] }`; and the unchanged `loadConfig(...): { config: DcpConfig; warnings: string[] }` API.

- [ ] **Step 1: Add failing global context-limit validation tests**

In `tests/config.test.ts`, add table tests showing that `1`, `200000`, `"0.5%"`, and `"100%"` survive loading. Add table tests showing that `0`, `-1`, `1.5`, `"bogus"`, `"0%"`, and `"100.1%"` are omitted and therefore use `DEFAULT_CONFIG.compress.maxContextLimit`. Every rejected value must produce exactly one warning containing the source path and `#/compress/maxContextLimit`.

- [ ] **Step 2: Add failing per-model and layer-precedence tests**

Add cases proving that one invalid `modelMaxLimits` entry is removed while a valid sibling remains; `isContextOverLimits` for the removed key uses the global maximum; an invalid global maximum uses the built-in default; an invalid project maximum inherits a valid global maximum; and an invalid project per-model entry inherits the same valid global per-model entry.

Use distinct token thresholds so each assertion proves which layer won rather than merely comparing object values.

- [ ] **Step 3: Add failing unknown-key diagnostics tests**

Write a global config with `unknownTop` and `compress.unknownNested`, and a project config with `strategies.deduplication.unknownStrategy`. Assert that all warnings contain the originating absolute path and the correct JSON pointer; unknown properties are absent; and valid siblings from both layers still apply. Add one key containing `~` or `/` and assert RFC 6901 escaping uses `~0` or `~1`.

- [ ] **Step 4: Run configuration tests and confirm unsafe values are accepted or misattributed**

Run: `pnpm vitest run tests/config.test.ts tests/context-limits.test.ts`

Expected: FAIL for permissive limit schemas, whole-merge fallback, and missing source-qualified unknown-key warnings.

- [ ] **Step 5: Define the shared context-limit schema**

Export `ContextLimitSchema` from `src/config-schema.ts` as a union of `Type.Integer({ minimum: 1 })` and `Type.String({ pattern: "^\\d+(?:\\.\\d+)?%$" })`. Reuse it for global limits and values in both per-model records. Keep concrete defaults in `DEFAULT_CONFIG`; do not add defaults to optional schema fields. Set `additionalProperties: false` on declared configuration objects so the shipped schema matches runtime unknown-key handling; keep `Type.Record` maps open.

- [ ] **Step 6: Implement schema-driven layer sanitization**

In `src/config-validation.ts`, implement `sanitizeConfigLayer` with these rules:

- declared object schemas recurse through only supplied properties without enforcing absent required siblings;
- `Type.Record` keys are open, but each map value is validated independently;
- arrays, unions, and scalar leaves use `Value.Check` against their field schema;
- context-limit strings additionally parse to a finite percentage greater than zero and no greater than 100;
- unknown or invalid fields are omitted, valid siblings are retained, and union errors collapse to one warning per JSON pointer;
- warnings use `${sourcePath}#${pointer}: ${message}` with RFC 6901-escaped segments.

Do not use `Value.Clean` before diagnostics because it would erase the evidence required for unknown-key warnings.

- [ ] **Step 7: Sanitize before merging and preserve lower-precedence values**

In `loadConfig`, parse and sanitize each layer independently, append its warnings, and deep-merge only its sanitized value over the accumulated config. Invalid global fields leave built-in defaults intact; invalid project fields leave global values intact; invalid map entries do not delete valid siblings or lower-layer values.

Validate the individual legacy `maxContextPercent` and `minContextPercent` upper bounds in each layer so an invalid project value inherits a valid global value. Track the effective source of both fields and include both source paths and JSON pointers when the merged `maxContextPercent > minContextPercent` relationship fails.

- [ ] **Step 8: Add failing visible-warning lifecycle tests**

In `tests/index.test.ts`, spy on the logger's always-persist warning path, start a session with multiple invalid fields, and assert:

```ts
expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
expect(ctx.ui.notify).toHaveBeenCalledWith(
  expect.stringContaining("configuration problems"),
  "warning",
);
expect(loggerWarnSpy).toHaveBeenCalledTimes(problemCount);
```

The notification must include the problem count and at least one affected config path. Add a `hasUI: false`, `debug: false` case that reads the actual session log and proves detailed warnings persist while `notify` remains untouched. Add an unusable log-path case proving best-effort logging cannot abort startup. Keep the initial module-level load silent; `session_start` owns the visible reload.

- [ ] **Step 9: Surface one summary per reload**

Update `reloadConfig` in `src/index.ts` to use an explicit always-persist logger path for each configuration detail, independent of the debug flag. If `ctx.hasUI` and warnings are nonempty, call `ctx.ui.notify` exactly once with a concise count and the participating global/project paths. Do not expose raw config values in the UI summary.

- [ ] **Step 10: Run focused configuration, lifecycle, and type checks**

Run: `pnpm vitest run tests/config.test.ts tests/context-limits.test.ts tests/index.test.ts && pnpm typecheck`

Expected: PASS; invalid files cannot abort startup, valid siblings survive, lower layers win after invalid overrides, and every reload emits at most one visible warning.

- [ ] **Step 11: Commit configuration safety**

```bash
git add src/config-validation.ts src/config-schema.ts src/config.ts src/index.ts tests/config.test.ts tests/context-limits.test.ts tests/index.test.ts
git commit -m "fix: validate and surface DCP configuration errors"
```

### Task 3: Implement strong and soft paired turn nudges

**Files:**

- Modify: `src/messages/inject.ts`
- Test: `tests/anchored-nudges.test.ts`
- Test: `tests/inject.test.ts`
- Test: `tests/pipeline.test.ts`
- Test: `tests/persistence.test.ts`

**Interfaces:**

- Consumes: `config.compress.nudgeForce`, stable message keys, the existing `turnAnchors: Set<string>`, and Pi user/assistant message content.
- Produces: paired user/assistant anchor keys whose rendered role is user for `strong` and assistant for `soft`, without changing snapshot version or field names.

- [ ] **Step 1: Add failing paired-role selection tests**

For a conversation ending in assistant then user with usage between the configured minimum and maximum, assert that `strong` injects `TURN_NUDGE` only into the user; `soft` injects it only into the assistant; and both stable keys are stored in either mode.

- [ ] **Step 2: Add failing missing-pair and tool-only assistant tests**

Add a user-only conversation and assert soft mode creates no turn anchor and injects nothing. Add a preceding assistant whose content contains only a tool call; soft mode must prepend a synthetic text part containing `TURN_NUDGE` before that tool call without changing the call object.

- [ ] **Step 3: Add failing frequency, restoration, and force-switch tests**

Assert frequency is measured against existing user-role turn anchors, not the assistant half of a pair. Serialize and restore a version-1 snapshot containing both keys, rerun with fresh message objects, and assert soft role filtering remains stable. Restore a legacy version-1 snapshot containing only the user key and assert the preceding assistant key is recovered before soft rendering. Change the same config to `strong` and assert injection moves to the user without adding keys.

- [ ] **Step 4: Run focused nudge tests and confirm `nudgeForce` is ignored**

Run: `pnpm vitest run tests/anchored-nudges.test.ts tests/inject.test.ts tests/persistence.test.ts`

Expected: FAIL because the current implementation stores and injects only the last user key and cannot append to a tool-only assistant.

- [ ] **Step 5: Store eligible turn pairs atomically**

In `injectCompressNudges`, reconcile legacy user-only anchors against current messages before applying them. When a user turn qualifies, find the nearest earlier assistant by scanning backward; skip turn-anchor creation if none exists; calculate frequency using only existing keys whose current message role is `user`; and when allowed add the assistant and user stable keys in the same branch. Leave context-limit and iteration anchor creation unchanged.

- [ ] **Step 6: Filter turn anchors by configured role during application**

Pass `config` into the internal anchored-nudge application function. For `turnAnchors`, inject only when the current message role equals `user` for `strong` or `assistant` for `soft`. Continue applying context-limit and iteration anchors without role-filtering changes.

When a targeted assistant has array content but no text part, insert `{ type: "text", text: nudgeText }` immediately before its first tool call. Keep the shared `appendText` behavior unchanged so message-ID injection is not broadened accidentally.

- [ ] **Step 7: Run focused and pipeline checks**

Run: `pnpm vitest run tests/anchored-nudges.test.ts tests/inject.test.ts tests/pipeline.test.ts tests/persistence.test.ts`

Expected: PASS with context-limit, iteration, frequency, summary-buffer, custom-prompt, and version-1 snapshot behavior unchanged.

- [ ] **Step 8: Commit nudge-force behavior**

```bash
git add src/messages/inject.ts tests/anchored-nudges.test.ts tests/inject.test.ts tests/pipeline.test.ts tests/persistence.test.ts
git commit -m "fix: honor configured compression nudge force"
```

### Task 4: Document and verify the v0.7.0 release

**Files:**

- Modify: `README.md`
- Modify: `dcp.schema.json`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

**Interfaces:**

- Consumes: the completed path, validation, and nudge behavior from Tasks 1-3.
- Produces: documented v0.7.0 package metadata and a generated JSON schema matching the TypeBox source.

- [ ] **Step 1: Update user documentation and release notes**

Document Pi `read`/`write`/`edit` path support and nested-call protection; positive integer and `(0, 100]` percentage limits; invalid project fields inheriting global values; one UI summary per reload with individual log warnings; and strong user-role versus soft assistant-role nudges. Add a v0.7.0 changelog entry and change the package version to `0.7.0`; leave peer ranges unchanged.

- [ ] **Step 2: Regenerate and inspect the schema**

Run: `pnpm run generate:schema && git diff --check`

Expected: `dcp.schema.json` shows integer minimum `1` and the percentage pattern for all global and per-model limit values; no whitespace errors are reported.

- [ ] **Step 3: Run complete repository verification**

Run: `pnpm check`

Expected: formatting, warning-free lint, TypeScript, and all Vitest tests pass.

- [ ] **Step 4: Run package and benchmark smoke checks**

Run: `pnpm run pack:dry-run && pnpm benchmark`

Expected: the package payload contains only intended shipped files and all benchmark workloads complete without correctness failures.

- [ ] **Step 5: Review the complete release diff**

Run: `git diff --check && git status --short`

Confirm every changed line belongs to dependency alignment, one of the three Phase 2 behaviors, generated schema, or release documentation.

- [ ] **Step 6: Commit the release preparation**

```bash
git add README.md dcp.schema.json CHANGELOG.md package.json
git commit -m "chore: prepare pi-dcp 0.7.0"
```
