# DCP UI Phase 2: Compression Tool Calls and Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for these sequential changes) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give both compression modes compact, active-theme call and result rendering while preserving model-facing output, native approval, and readable historical/error results.

**Architecture:** Add one safe adapter around Pi's active theme and one compression presentation module. Registered range/message tools close over their configured mode, successful executions attach summary-free display metadata, and every error, partial, legacy, or malformed result falls back to its original text instead of manufacturing success metrics.

**Tech Stack:** Existing TypeScript/ESM, Node `>=24.15.0`, installed `@earendil-works/pi-*` `1.1.0`, Vitest 5, TypeBox, Biome, and Pi TUI `Text`/`TruncatedText`; no new dependencies.

**Spec:** [Approved design in the parent plan](2026-10-12-dcp-ui-refactor-plan.md#approved-design). The parent remains the source of truth for the overall UI design and phase boundaries.

## Global Constraints

- Use `/Users/lanh/Developer/pi-vault/pi-status` and `/Users/lanh/Developer/pi-packages/pi` as read-only references; add no runtime imports or dependencies on either checkout.
- Use the active Pi theme and semantic roles. `NO_COLOR` presence disables styling; one throwing theme operation falls back to plain text without disabling its siblings.
- Preserve command names/arguments, TypeBox schemas, prompts, pruning/compression algorithms, policy/tool selection, statistics, notifications, model-visible `content`, and compression result text.
- Preserve native per-call approval through `ui.confirm`, including RPC support, cancellation, abort handling, and the policy recheck after approval.
- Preserve snapshot version `2`, version `1`/`2` reads, persistence order, live state/config identities, and unexpected exception propagation.
- Successful normal execution may add `details.dcpCompression`; policy rejection, approval rejection/cancellation/abort, and thrown failures must not claim success metadata.
- Display metadata contains no submitted summaries or combined summary text. Copy `blockIds` so later state mutation cannot change a completed tool result.
- Add no configuration, dependency, sidebar integration, search, block drilldown, domain action, package version bump, or future-phase panel code.
- Complete production integration, focused tests, README/CHANGELOG updates, full verification, and one atomic phase commit. Intermediate tasks remain uncommitted so the phase can be reverted as one usable result.

## Review Focus

| Input or condition | Required behavior | Owning task/check |
| --- | --- | --- |
| Missing or malformed historical `details` | Render original text; never infer metrics by parsing it or consulting live state. | Task 2 legacy/malformed cases |
| `isError` with otherwise valid metadata | Error precedence wins and original text remains visible. | Task 2 error cases; Task 3 rejection cases |
| Partial result with otherwise valid metadata | Show `Compression in progress`; do not render completed metrics. | Task 2 partial cases |
| Missing/partial arguments, multiline/Unicode topic, narrow width | Render safely, omit unavailable fields, flatten the topic, and bound every rendered line. | Task 2 call/width cases |
| `NO_COLOR`, one throwing theme method, or non-string theme return | Keep readable plain text and allow the other theme methods to operate. | Task 1 adapter cases |

## Reconnaissance and Readiness Basis

- DCP baseline: branch `20261013-dcp-ui-refactor-phase-02-compression-rendering` at `3c1ff6e`; clean worktree; `pnpm check` passes with 63 files / 1,005 tests.
- Phase 1 is merged. `src/tui/formatters.ts` exports `formatDcpTokens(tokens, estimated?)` and `flattenDcpLabel(value)` with the required estimate and whitespace behavior.
- DCP registers `compress` once during extension creation and again after trusted session configuration loads. Both definitions must receive renderers, and `renderCompressCall` must close over the mode used for that exact registration.
- DCP's normal successful execution currently returns one text content item and `details: {}`. Capability/approval rejections also return `details: {}` with `isError: true`; unexpected compression failures throw.
- Installed Pi `1.1.0` defines `ToolDefinition.renderCall(args, theme, context)` and `renderResult(result, { expanded, isPartial }, theme, context)`. Runtime error state is authoritative in `context.isError`; Pi does not pass `isError` on the result object supplied to a custom renderer.
- Pi's `Text` wraps ANSI/Unicode-aware expanded content to the render width. `TruncatedText` keeps collapsed content to one ANSI/Unicode-aware line. Use these components instead of implementing width algorithms.
- Pi's tool shell already supplies pending/success/error backgrounds and horizontal padding. Keep the default shell; DCP renders only the inner call/result content.
- pi-status commit `18d8354` supplies the reference behavior for `NO_COLOR` presence and per-method safe theme calls. Pi commit `7bd01fb92` supplies the renderer contracts and TUI component behavior; the installed package declarations remain authoritative where the checkout differs.

## Visible Rendering Contract

Assert visible text after stripping ANSI and trimming component-added right padding; exact colors are asserted separately by role calls.

### Calls

| Input | Visible collapsed text |
| --- | --- |
| Range, topic `" Auth\n system "`, two entries | `compress range · Auth system · 2 ranges` |
| Message, topic `"Auth"`, one target | `compress message · Auth · 1 message` |
| Range with missing topic and missing `content` | `compress range` |
| Message with whitespace-only topic and empty `targets` | `compress message · 0 messages` |

- Count the registered mode's array (`content` for range, `targets` for message); ignore the other property.
- Include a count only when the selected property is an array. Do not validate or display selection contents in the renderer.
- Never display submitted `summary` values or stringify the full arguments object.
- Style `compress` with `toolTitle` + bold, mode/topic with `accent`/`text`, and separators/count with `muted`.
- Return `TruncatedText` so a collapsed call is exactly one bounded line at any positive render width.

### Results

For metadata `{ mode: "range", topic: " Auth\n system ", messagesCompressed: 5, compressedTokens: 12_400, summaryTokens: 2_100, blockIds: [1, 2] }`:

- Collapsed visible text: `Range compression · Auth system · 5 messages · ~12.4k input · ~2.1k summary`.
- Expanded visible text: the same header, then the unchanged original text content, then `Blocks: b1, b2`.
- Use singular `message` only for exactly `1`. Token counts are estimates and use `formatDcpTokens(value, true)`.
- Omit the topic segment when its flattened value is empty. Omit the blocks line when `blockIds` is empty.
- Join every text content item in source order with `\n`; do not assume `content[0]`. Leave the result object and non-text content untouched so Pi can keep handling supported non-text items.
- Metadata-backed success uses `toolTitle`, `accent`, `text`, `muted`, and `toolOutput` roles. Expanded block IDs use `accent`.
- If `options.isPartial` is true, return one warning-styled `Compression in progress` line before inspecting metadata.
- If `context.isError` is true, render original text with the `error` role even when metadata exists. Use `Compression failed` only when the error has no text.
- If metadata is absent or fails the runtime shape guard, render original text with `toolOutput`. Use `Compression result unavailable` only when no text exists.
- Error/legacy collapsed output uses `TruncatedText`; expanded output uses `Text` and preserves all original lines.
- Metadata is valid only when mode is `range`/`message`, topic is a string, all three counts are finite non-negative numbers, and `blockIds` is an array of finite non-negative integers. Invalid metadata takes the legacy path without throwing.

## File Responsibilities

| File | Responsibility |
| --- | --- |
| `src/tui/theme.ts` (new) | `DcpTheme` and safe active-theme adaptation, including `NO_COLOR`. |
| `src/tui/compress-render.ts` (new) | Display metadata creation/guarding, text fallback extraction, and pure call/result component factories. |
| `src/index.ts` | Attach both render callbacks and successful display details at the existing registration/execution boundary. |
| `tests/theme.test.ts` (new) | Adapter delegation, `NO_COLOR`, per-method failure, and non-string return coverage. |
| `tests/compress-render.test.ts` (new) | Exact call/result copy, role use, metadata privacy/copying, fallback precedence, and rendered-width coverage. |
| `tests/index.test.ts` | Existing mocked registration/execution characterization: both modes expose renderers and rejection paths keep empty details. |
| `tests/sdk-contract.test.ts` | Real Pi `1.1.0` registration plus end-to-end successful/denied result details through the existing fake-provider lifecycle. |
| `README.md`, `CHANGELOG.md` | User-visible compact tool rendering and expansion behavior under Unreleased. |

## Execution Rules

- [x] Confirm the worktree is clean or understood and phase 1 is present before editing.
- [x] Run `pnpm check` as a fresh baseline; do not rely on this plan's recorded result.
- [x] Execute Tasks 1–3 in order because each consumes the preceding task's interface.
- [x] For each task, add the named failing assertions, run the focused command and observe the expected failure, implement the minimum behavior, then rerun the focused command.
- [x] Do not mark implementation checkboxes or add an implementation record until the corresponding work and verification actually occur.

---

### Task 1: Safe Active-Theme Adapter

**Files:**
- Create: `src/tui/theme.ts`
- Create: `tests/theme.test.ts`

**Interfaces:**
- Produces: `DcpTheme = Pick<Theme, "fg" | "bg" | "bold" | "inverse">`.
- Produces: `createDcpTheme(theme: Theme, env?: NodeJS.ProcessEnv): DcpTheme`.
- Contract: `NO_COLOR` is enabled by property presence, including `NO_COLOR=""` and `NO_COLOR="0"`; every method delegates at call time and independently falls back to its input text on throw or non-string return.

- [x] **Step 1: Write failing adapter tests.** Cover normal delegation for all four methods, live delegation after the underlying implementation changes, `NO_COLOR` presence/truthiness cases, one throwing method with working siblings, and a non-string method return.

- [x] **Step 2: Run the adapter test and verify the intended failure.**

  Run: `pnpm exec vitest run tests/theme.test.ts`

  Expected: FAIL because `src/tui/theme.ts` does not exist.

- [x] **Step 3: Implement the adapter.** Keep `safeThemeCall` private, call `Object.hasOwn(env, "NO_COLOR")`, return identity functions when color is disabled, and do not add palettes or hard-coded ANSI.

- [x] **Step 4: Rerun the adapter test.**

  Run: `pnpm exec vitest run tests/theme.test.ts`

  Expected: PASS.

---

### Task 2: Pure Compression Metadata and Renderers

**Files:**
- Create: `src/tui/compress-render.ts`
- Create: `tests/compress-render.test.ts`

**Interfaces:**
- Consumes: `formatDcpTokens`, `flattenDcpLabel`, `createDcpTheme`, Pi `Theme`/tool renderer types, and TUI `Text`/`TruncatedText`.
- Produces: `CompressionDisplayMetadata` with `mode`, `topic`, `messagesCompressed`, `compressedTokens`, `summaryTokens`, and copied `blockIds`.
- Produces: `CompressionDisplayDetails` with optional `dcpCompression?: CompressionDisplayMetadata`.
- Produces: `createCompressionDisplayDetails(mode: CompressArgs["mode"], result: CompressResult): CompressionDisplayDetails`.
- Produces: `renderCompressCall(mode: CompressArgs["mode"], args: unknown, theme: Theme): Component`.
- Produces: `renderCompressResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: Pick<ToolRenderContext, "isError">): Component`. Treat `details` as an untrusted runtime boundary and narrow it with the private guard.

- [x] **Step 1: Write failing metadata tests.** Assert all exact result fields, a copied `blockIds` array, and absence of submitted/combined summary text from serialized details.

  ```ts
  expect(createCompressionDisplayDetails("range", result).dcpCompression).toEqual({
    mode: "range",
    topic: "Auth",
    messagesCompressed: 5,
    compressedTokens: 12_400,
    summaryTokens: 2_100,
    blockIds: [1, 2],
  });
  expect(JSON.stringify(details)).not.toContain("private summary text");
  ```

- [x] **Step 2: Write failing call-renderer tests.** Pin the four call-table strings, both singular/plural forms, wrong-mode-array exclusion, Unicode topics, no submitted summaries, expected semantic role calls, and `visibleWidth(line) <= width` at widths `1`, `12`, and `60`.

- [x] **Step 3: Write failing result-renderer tests.** Pin the collapsed/expanded strings and ordering, multiple text items, empty blocks/topic, zero/one/many messages, partial-before-metadata precedence, error-before-metadata precedence, empty error text, empty legacy text, absent details, malformed details, multiline Unicode content, `NO_COLOR`, and one throwing theme method.

- [x] **Step 4: Run the renderer tests and verify the intended failure.**

  Run: `pnpm exec vitest run tests/theme.test.ts tests/compress-render.test.ts`

  Expected: FAIL because the compression presentation module does not exist.

- [x] **Step 5: Implement metadata creation and runtime guarding.** Keep the guard and text extraction private; never parse human-readable result text or read live DCP state.

- [x] **Step 6: Implement the two component factories.** Apply the visible rendering contract and use `TruncatedText` for every collapsed path and `Text` for expanded paths.

- [x] **Step 7: Rerun the renderer tests.**

  Run: `pnpm exec vitest run tests/theme.test.ts tests/compress-render.test.ts`

  Expected: PASS, including every width assertion.

---

### Task 3: Register Renderers and Attach Success Metadata

**Files:**
- Modify: `src/index.ts` inside `executeCompressTool` and both branches of `registerCompressTool`
- Modify: `tests/index.test.ts`
- Modify: `tests/sdk-contract.test.ts`

**Interfaces:**
- Consumes: Task 2's three exports.
- Produces: both registered definitions expose `renderCall` and `renderResult`; `renderCall` closes over the definition's `mode`.
- Produces: only normally completed `handleCompress` calls return `createCompressionDisplayDetails(mode, result)`; every existing rejection still returns `{}` and unexpected exceptions still throw.
- Preserves: `content`, `isError`, parameters, description, activation, execution mode, approval order, notification timing, and policy checks.

- [x] **Step 1: Add failing mocked registration tests.** For initial range and trusted-project message registration, assert both callbacks exist; invoke the registered callbacks with partial arguments/results and prove the closure uses the registered mode without throwing.

- [x] **Step 2: Add failing execution-boundary tests.** Assert successful range/message results carry exact metadata and no summaries. Assert capability denial, approval false/cancel/abort, and post-approval policy rejection retain `details: {}` and `isError: true`; retain existing assertions that unexpected `handleCompress` failures reject.

- [x] **Step 3: Extend the real SDK lifecycle test.** Capture `tool_execution_end.result.details` in the existing approved/denied fake-provider test: approved execution has exact `dcpCompression` values/IDs, denied execution has `{}`. Also assert `session.getToolDefinition("compress")` exposes both renderer callbacks before invoking the renderer once with the installed SDK types.

- [x] **Step 4: Run integration tests and verify the intended failure.**

  Run: `pnpm exec vitest run tests/compress-render.test.ts tests/index.test.ts tests/sdk-contract.test.ts`

  Expected: FAIL because registered tools have no custom renderers and successful results still return empty details.

- [x] **Step 5: Wire the registered callbacks.** Add `renderCall: (args, theme) => renderCompressCall(mode, args, theme)` and `renderResult: renderCompressResult` to both schema branches without changing the schemas or merging the branches.

- [x] **Step 6: Attach metadata after normal compression.** Build details from the same `mode` and `CompressResult` used for content/notification; leave every earlier return and thrown path unchanged.

- [x] **Step 7: Rerun integration and regression tests.**

  Run: `pnpm exec vitest run tests/theme.test.ts tests/compress-render.test.ts tests/index.test.ts tests/sdk-contract.test.ts tests/compress-permission.test.ts tests/notification-delivery.test.ts tests/compression-timing.test.ts`

  Expected: PASS.

---

### Task 4: Documentation, Full Verification, and Atomic Commit

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: this plan only to record completed checks/evidence after implementation

**Interfaces:**
- README describes the compact range/message call line, compact estimated metrics, host expansion, and historical/error text fallback.
- CHANGELOG adds one Phase 2 item under the existing `## [Unreleased]` section without editing released entries or changing the package version.

- [x] **Step 1: Update user documentation.** Describe behavior that is actually implemented; do not advertise the Phase 3 frame or Phase 4 tabs.

- [x] **Step 2: Run the complete focused suite.**

  Run: `pnpm exec vitest run tests/theme.test.ts tests/compress-render.test.ts tests/index.test.ts tests/sdk-contract.test.ts tests/compress-permission.test.ts tests/notification-delivery.test.ts tests/compression-timing.test.ts`

  Expected: PASS.

- [x] **Step 3: Run the repository gate.**

  Run: `pnpm check`

  Expected: formatting, lint, type checking, and all tests exit `0`.

- [x] **Step 4: Inspect the complete diff.**

  Run: `git diff --check`

  Expected: exit `0`. Confirm no schema, prompt, model-facing content, approval/policy, notification, metric calculation, persistence, or dependency changes.

- [x] **Step 5: Perform real-Pi inspection when interactive Pi is available.** Exercise range and message modes; inspect collapsed and expanded success, native approval, denial, and a resumed historical result. Record terminal width/theme and observed visible strings. If interactive Pi is unavailable, record that limitation and rely on the real SDK lifecycle plus component width tests; do not claim visual inspection occurred.

- [x] **Step 6: Record implementation evidence in this plan.** Include baseline/final test counts, focused command results, real-Pi status, and the final commit hash only after those facts exist.

- [x] **Step 7: Commit the usable phase atomically.** Stage only Phase 2 files and commit with `feat: render DCP compression calls and results`.

## Phase Completion and Rollback

- [x] Both modes expose the exact compact call/result behavior without depending on later phases.
- [x] Historical, malformed, partial, and error results remain readable and never display fabricated success metrics.
- [x] Successful details are summary-free and preserve exact result values with copied block IDs; rejected/thrown paths do not claim them.
- [x] Focused tests, `pnpm check`, and `git diff --check` pass; any unavailable real-Pi inspection is explicit.
- [x] README/CHANGELOG match delivered behavior and the complete diff is one atomic commit.

Revert dependent later phases before reverting this phase. No snapshot migration is introduced. Removing this phase restores Pi's default tool rendering; persisted results with `details.dcpCompression` remain harmless structured tool-result details.

## Implementation Record — 2026-10-13

**Environment:** Node `v24.21.0`, pnpm `12.9.1`, coding-agent/TUI SDK `1.1.0`, branch `20261013-dcp-ui-refactor-phase-02-compression-rendering`.

**Baseline:** `pnpm check` exited `0` with 63 test files / 1,005 tests passed at `acb9de1` before implementation.

**Verification:** Task 1 failed because `src/tui/theme.ts` did not exist, then passed 8 tests. Task 2 failed because `src/tui/compress-render.ts` did not exist, then passed 51 tests. Task 3 initially failed with registered tools lacking `renderCall`/`renderResult` and successful executions returning `details: {}`; after wiring, the focused suite passed 7 files / 191 tests. Final `pnpm check` exited `0` with **65 files / 1,067 tests passed**, and `git diff --check` is clean.

**Ruling:** The plan's `Pick<ToolRenderContext, "isError">` interface is unusable because Pi `1.1.0` does not publicly export `ToolRenderContext`. The renderer takes an inline `{ isError: boolean }`, which is structurally identical.

**Real-Pi inspection:** unavailable in this environment, so no interactive terminal width/theme run was performed. The renderers were verified through the real SDK lifecycle test (approved and denied execution details plus a `getToolDefinition("compress")` renderer invocation) and through component-level exact-copy, role, `NO_COLOR`, throwing-theme, and narrow-width (`1`, `12`, `60`) assertions.

**Commit:** `feat: render DCP compression calls and results` (one atomic commit for this phase).
