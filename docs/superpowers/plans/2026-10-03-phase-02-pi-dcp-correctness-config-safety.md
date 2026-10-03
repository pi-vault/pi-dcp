# Phase 2 — Pi DCP Correctness and Configuration Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make protected-file handling match current Pi tool data, reject unsafe context-limit values visibly, and make `nudgeForce` behave as configured.

**Architecture:** Normalize direct and nested file paths once in the tool cache, then let every pruning strategy consume the cached paths. Keep configuration loading tolerant but validate each field before use and surface one UI warning per reload. Preserve the existing anchored-nudge model while recording both sides of a user/assistant turn pair.

**Tech Stack:** Node.js >=24.15.0, TypeScript 7, TypeBox 1.3, Pi 1.0 extension APIs, Vitest 5, Biome 2, pnpm

**Spec:** `docs/superpowers/specs/2026-10-03-pi-dcp-improvement-roadmap-design.md`

## Global Constraints

- Execute this phase after `2026-10-03-phase-01-pi-dcp-maintenance-cache-evidence.md` and start from v0.6.1.
- Preserve existing JSON configuration and legacy `filePath` inputs; do not add JSONC.
- Use current Pi exported message types for new fixtures; do not hide host-shape mismatches behind `as unknown as`.
- Invalid configuration warns and falls back field-by-field; it never aborts startup.
- Automatic pruning timing, persisted snapshot shape, canonical IDs, and compression behavior remain unchanged.
- Do not copy OpenCode source; implement against Pi's public API and message types.

## Review Focus

- A Pi built-in call with `path: "src/secret.ts"` or `path: "src\\secret.ts"` must match `src/**/*.ts`; Task 1 adds both cases.
- A malformed nested-call record next to a valid protected nested call must not erase the valid path; Task 1 adds this mixed-record case.
- An invalid per-model limit must be removed so the global limit wins, not remain as an unresolved value; Task 2 pins this fallback.
- Unknown keys in either the global or project layer must identify the source file and JSON path while valid siblings still apply; Task 2 covers both layers.
- Soft nudging with no preceding assistant message must not move the reminder onto the user message; Task 3 covers the missing-pair case.

---

### Task 1: Cache Pi-native direct and nested protected paths

**Files:**

- Modify: `src/strategies/protected-patterns.ts`
- Modify: `src/state/tool-cache.ts`
- Modify: `src/state/types.ts`
- Modify: `src/strategies/runner.ts`
- Test: `tests/protected-patterns.test.ts`
- Test: `tests/tool-cache.test.ts`
- Test: `tests/strategy-runner.test.ts`

**Interfaces:**

- Consumes: Pi tool arguments shaped as `Record<string, unknown>` and optional `toolResult.nestedCalls` records.
- Produces: `getFilePathsFromParameters(toolName: string, parameters: Record<string, unknown>): string[]`, `getFilePathsFromNestedCalls(nestedCalls: unknown): string[]`, and `ToolParameterEntry.filePaths: string[]` containing unique normalized `/`-separated paths.

- [ ] **Step 1: Add failing direct-path normalization tests**

In `tests/protected-patterns.test.ts`, assert that `getFilePathsFromParameters` returns:

```ts
expect(getFilePathsFromParameters("read", { path: "src/secret.ts" })).toEqual(["src/secret.ts"]);
expect(getFilePathsFromParameters("edit", { path: "src\\secret.ts" })).toEqual(["src/secret.ts"]);
expect(getFilePathsFromParameters("read", { filePath: "legacy/file.ts" })).toEqual([
  "legacy/file.ts",
]);
```

Keep the low-level `matchesGlob("src\\config.ts", ...)` assertion false because glob matching is
POSIX-oriented. Add an `isFilePathProtected(["src\\config.ts"], ["src/**/*.ts"])` assertion that
is true, proving normalization occurs at the file-protection boundary.

- [ ] **Step 2: Run the focused tests and verify the Pi-native cases fail**

Run: `pnpm vitest run tests/protected-patterns.test.ts`

Expected: FAIL because `path` is ignored and backslashes are not normalized.

- [ ] **Step 3: Implement direct path extraction and normalization**

In `src/strategies/protected-patterns.ts`, keep the existing exported signature and collect string
values from `parameters.path` followed by `parameters.filePath`. Normalize every `\\` to `/`,
discard empty strings, and deduplicate while preserving first-seen order. Normalize paths again at
the `isFilePathProtected` boundary so callers cannot bypass normalization.

- [ ] **Step 4: Add failing nested-call aggregation tests**

In `tests/tool-cache.test.ts`, construct a Pi `toolResult` with a parent `codemode` call and:

- nested `read` arguments `{ path: "secrets/token.txt" }`;
- nested `edit` arguments `{ path: "src\\config.ts" }`;
- a malformed call with omitted arguments;
- a duplicate of the first path.

Assert the parent cache entry has exactly
`["secrets/token.txt", "src/config.ts"]` in `filePaths`. Add a second case where truncated or
non-object `nestedCalls` yields only the direct parent path and does not throw.

- [ ] **Step 5: Run the tool-cache tests and verify `filePaths` is missing**

Run: `pnpm vitest run tests/tool-cache.test.ts`

Expected: FAIL because `ToolParameterEntry` has no aggregated path field.

- [ ] **Step 6: Implement nested extraction and cache aggregation**

Add `getFilePathsFromNestedCalls(nestedCalls: unknown): string[]` in
`src/strategies/protected-patterns.ts`. Accept only a record with a `calls` array; for every record
with string `name` and object `arguments`, reuse `getFilePathsFromParameters`. Extend the first pass
of `syncToolCache` to retain nested paths with result metadata, then set each entry's `filePaths` to
the unique direct-plus-nested list.

- [ ] **Step 7: Make all strategies consume the cached paths**

In `src/strategies/runner.ts`, replace the three repeated calls to
`getFilePathsFromParameters(...)` with `entry.filePaths`. Add strategy tests proving a matching
nested path preserves the parent during deduplication, stale-error purging, and `sweepAll`, while a
nonmatching nested path remains eligible.

- [ ] **Step 8: Run the focused path and strategy tests**

Run: `pnpm vitest run tests/protected-patterns.test.ts tests/tool-cache.test.ts tests/strategy-runner.test.ts`

Expected: PASS, including Windows, duplicate, malformed, and nested-call cases.

- [ ] **Step 9: Commit the protected-path fix**

```bash
git add src/strategies/protected-patterns.ts src/state/tool-cache.ts src/state/types.ts src/strategies/runner.ts tests/protected-patterns.test.ts tests/tool-cache.test.ts tests/strategy-runner.test.ts
git commit -m "fix: protect Pi file tool paths from pruning"
```

### Task 2: Validate limits and report configuration problems

**Files:**

- Create: `src/config-validation.ts`
- Modify: `src/config-schema.ts`
- Modify: `src/config.ts`
- Modify: `src/index.ts`
- Test: `tests/config.test.ts`
- Test: `tests/context-limits.test.ts`
- Test: `tests/index.test.ts`

**Interfaces:**

- Consumes: parsed global and optional trusted-project configuration objects.
- Produces: `ContextLimitSchema`, `collectUnknownConfigPaths(value: Record<string, unknown>): string[]`, and the existing `loadConfig(...): { config: DcpConfig; warnings: string[] }` with actionable source-qualified warnings.

- [ ] **Step 1: Add failing context-limit schema tests**

In `tests/config.test.ts`, add table cases showing that `1`, `200000`, `"0.5%"`, and `"100%"`
are retained, while `0`, `-1`, `1.5`, `"bogus"`, `"0%"`, and `"100.1%"` fall back to the
global defaults with warnings. Repeat the invalid-value assertion for one entry in
`modelMaxLimits`, alongside a valid sibling, and assert the invalid entry is deleted; exercise
`isContextOverLimits` with that model key and assert it falls back to the global max.

- [ ] **Step 2: Add failing unknown-key diagnostics tests**

Write a global config with `unknownTop` and `compress.unknownNested`, plus a project config with
`strategies.deduplication.unknownStrategy`. Assert all three warnings include the originating file
and JSON-pointer path, unknown keys are absent from the result, and valid sibling values from both
layers still merge.

- [ ] **Step 3: Run configuration tests and verify the unsafe inputs are accepted silently**

Run: `pnpm vitest run tests/config.test.ts tests/context-limits.test.ts`

Expected: FAIL for invalid limit acceptance, retained invalid map entries, and missing unknown-key
warnings.

- [ ] **Step 4: Define and apply the shared context-limit schema**

Export `ContextLimitSchema` from `src/config-schema.ts` as a union of `Type.Integer({ minimum: 1 })`
and a percentage-shaped string. Reuse it for global and per-model limits. In
`src/config-validation.ts`, add the semantic percentage range check `(0, 100]` and recursive
unknown-key traversal driven by `DcpConfigSchema`; record keys are open, while declared objects are
closed.

- [ ] **Step 5: Normalize invalid fields without losing valid siblings**

Call unknown-key collection on each parsed layer before merging. After merge, reset invalid
required fields from `DEFAULT_CONFIG`; delete invalid optional per-model entries; and retain valid
entries in the same map. Prefix warnings with the relevant config path when the source is known.

- [ ] **Step 6: Add a failing visible-warning integration test**

In `tests/index.test.ts`, start a session with multiple invalid config fields and a UI spy. Assert
`ctx.ui.notify` is called exactly once with severity `"warning"`, a count of problems, and the
config filename. Assert individual warnings are still sent to the logger spy. Add a no-UI case
that logs without attempting notification.

- [ ] **Step 7: Surface one warning per reload**

Update `reloadConfig` in `src/index.ts` to log every warning, then emit one summarized notification
when `ctx.hasUI` and the warning list is nonempty. Do not notify from the initial module-level load;
`session_start` performs the user-visible reload with context.

- [ ] **Step 8: Run focused configuration and lifecycle tests**

Run: `pnpm vitest run tests/config.test.ts tests/context-limits.test.ts tests/index.test.ts`

Expected: PASS; invalid files start with safe defaults and one visible warning.

- [ ] **Step 9: Commit configuration safety**

```bash
git add src/config-validation.ts src/config-schema.ts src/config.ts src/index.ts tests/config.test.ts tests/context-limits.test.ts tests/index.test.ts
git commit -m "fix: validate and surface DCP configuration errors"
```

### Task 3: Implement strong and soft anchored nudges

**Files:**

- Modify: `src/messages/inject.ts`
- Test: `tests/anchored-nudges.test.ts`
- Test: `tests/inject.test.ts`

**Interfaces:**

- Consumes: `config.compress.nudgeForce`, stable message keys, and the existing `turnAnchors` set.
- Produces: paired turn anchors whose injected role is user for `strong` and assistant for `soft`.

- [ ] **Step 1: Add failing role-selection tests**

Add tests for a conversation ending in assistant then user while over the minimum limit. With
`nudgeForce: "strong"`, assert only the user text contains `TURN_NUDGE`; with `"soft"`, assert only
the preceding assistant text contains it. Assert both stable keys are stored in `turnAnchors`.

- [ ] **Step 2: Add the missing-pair and restoration tests**

Assert soft mode injects nothing when the conversation has no preceding assistant. Seed both
anchors in state, rerun with fresh message objects, and assert role filtering remains stable after
restoration. Switch from soft to strong and assert the already-paired anchor moves injection to the
user role without creating new anchors.

- [ ] **Step 3: Run nudge tests and verify `nudgeForce` has no effect**

Run: `pnpm vitest run tests/anchored-nudges.test.ts tests/inject.test.ts`

Expected: FAIL because current logic anchors and injects only the last user message.

- [ ] **Step 4: Store turn-anchor pairs and filter them by configured role**

When a user turn qualifies, evaluate frequency against earlier user-role turn anchors, locate the
closest earlier assistant message, and add both stable keys as one logical pair. During
application, filter `turnAnchors` by the target role selected from `nudgeForce`. Leave
context-limit and iteration anchor handling unchanged.

- [ ] **Step 5: Run focused and pipeline tests**

Run: `pnpm vitest run tests/anchored-nudges.test.ts tests/inject.test.ts tests/pipeline.test.ts`

Expected: PASS with existing frequency, summary-buffer, and custom-prompt behavior unchanged.

- [ ] **Step 6: Commit nudge-force behavior**

```bash
git add src/messages/inject.ts tests/anchored-nudges.test.ts tests/inject.test.ts tests/pipeline.test.ts
git commit -m "fix: honor configured compression nudge force"
```

### Task 4: Finalize and verify the v0.7.0 release

**Files:**

- Modify: `README.md`
- Modify: `dcp.schema.json`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

**Interfaces:**

- Consumes: the completed protected-path, validation, and nudge behavior from Tasks 1-3.
- Produces: documented v0.7.0 package metadata and a generated schema matching the TypeBox source.

- [ ] **Step 1: Update user documentation and release notes**

Document Pi-native `path` protection, nested-call protection, strict limit formats, visible fallback
warnings, and strong/soft nudge roles. Add a v0.7.0 changelog entry and change only the package
version to `0.7.0`.

- [ ] **Step 2: Regenerate and verify the schema**

Run: `pnpm generate:schema && git diff --check`

Expected: `dcp.schema.json` reflects positive integers and percentage strings; no formatting errors.

- [ ] **Step 3: Run the complete repository checks**

Run: `pnpm check`

Expected: exit 0 with the warning-free lint gate established in Phase 1 still passing.

- [ ] **Step 4: Run package and benchmark smoke checks**

Run: `pnpm run pack:dry-run && pnpm benchmark`

Expected: both exit 0; package contents are unchanged except documentation/schema metadata, and
all three benchmark workloads complete.

- [ ] **Step 5: Review the release diff and commit**

Run: `git diff --check && git status --short`

```bash
git add README.md dcp.schema.json CHANGELOG.md package.json
git commit -m "chore: prepare pi-dcp 0.7.0"
```
