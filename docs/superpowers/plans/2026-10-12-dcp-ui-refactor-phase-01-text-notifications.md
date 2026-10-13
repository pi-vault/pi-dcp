# DCP UI Phase 1: Consistent Text and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for these sequential changes) or superpowers:subagent-driven-development to implement this plan step-by-step. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ship compact, consistent DCP text reports and single-line status notifications without changing command or panel interaction.

**Architecture:** Introduce two local formatting functions and integrate them into the existing informational reports and notification builders. Keep delivery selection in `src/index.ts`; compression status delivery must choose the minimal builder even when verbosity is detailed. The current panel, command routing, and domain owners remain in place.

**Tech Stack:** Existing TypeScript/ESM, Node `>=24.15.0`, installed Pi coding-agent/TUI SDK, Vitest, TypeBox, and Biome; no new dependencies.

**Spec:** [Approved design in the parent plan](2026-10-12-dcp-ui-refactor-plan.md#approved-design). The parent remains the source of truth for the overall design. This review adds phase-1 implementation details within that scope; it does not approve or implement later phases.

## Readiness Review — 2026-10-12

**Verdict:** The base is ready; the original phase plan needed more precise formatting, report, and delivery-test contracts. This revision resolves those gaps and is ready to implement against the reviewed base. No product code has been changed, and implementation checkboxes remain unchecked.

- Reviewed DCP at `0d23e0586115837d8fbc5a41edfd2271b1f1e883`, on branch `20261012-dcp-ui-refactor-phase-01-text-notifications`, with an initially clean worktree. The earlier architecture work and current single-list panel are present; neither needs another prerequisite phase.
- Fresh baseline: `pnpm check` exited `0`; formatting, lint, and type checking passed, followed by **61 test files / 952 tests passed**. Runtime: Node `v24.21.0`, pnpm `12.9.1`; installed coding-agent/TUI SDK `1.1.0`.
- Current compression delivery selects detailed output before choosing toast/status, so detailed status receives multiline topic/summary text. Pruning status already selects minimal output and cumulative metrics. The revision changes only compression's builder selection and shared presentation.
- Original gaps: unspecified rounding boundaries and estimate provenance; unspecified aligned report values; no concrete both-mode extension delivery fixture; no distinction between unavailable context and lifetime's existing zero-result semantics.

### Reference evidence

| Reference checkout                                                                                                 | Relevant source                                                                                                                                                                                                                          | Decision for this phase                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/Users/lanh/Developer/pi-packages/pi` at `7bd01fb92485c06f92ecfff7ccf3197148bc16af`, coding-agent `1.1.0`         | `packages/coding-agent/src/core/extensions/types.ts`; `src/modes/interactive/interactive-mode.ts`; `src/modes/interactive/components/footer.ts`; `src/modes/rpc/rpc-mode.ts` (the latter paths are relative to `packages/coding-agent/`) | `notify(message, "info")` and `setStatus("dcp", message)` are public transports. RPC forwards status text directly; produce one-line text before calling the host. `ContextUsage.tokens` is documented as estimated. Confirm signatures against DCP's installed declarations. |
| `/Users/lanh/Developer/pi-vault/pi-status` at `18d8354888ae38a7580e10e073b68cdd40e7b872`, SDK dependency `^0.84.4` | `src/tui/render-utils.ts:formatCompactNumber`; `src/tui/render.ts:formatExtensionStatuses/removeLeadingStatusKey`; `src/index.ts:refreshFooterProviderState`                                                                             | Adapt compact `k`/`M`, one decimal, and removal of `.0` locally. pi-status reads public extension statuses and may strip the leading `DCP` key prefix; retain the `dcp` key and the approved raw `DCP · ...` copy. Do not add another integration channel.                    |

These are read-only local references, not runtime imports. Pi's built-in footer has a different rounding policy; use pi-status's compact-number policy for the shared DCP formatter. Frame, tabs, theme adapters, geometry, and sidebar behavior belong to later phases.

## Global Constraints

- Use `/Users/lanh/Developer/pi-vault/pi-status` as a visual/code reference only; no runtime imports, dependency on pi-status, or edits to that repository.
- Apply pi-status's compact metrics and spacing to this phase's plain text. Frame, tabs, semantic theme roles, selection marker, and keyboard footer remain later-phase work. Add no ANSI styling, palette presets, or theme adapter here.
- Adapt reference primitives to DCP's installed SDK. The inspected pi-status checkout uses Pi `0.84.4`; DCP uses Pi `1.1.0`.
- Preserve command names and arguments, pruning/compression algorithms, policy, tool selection, model-visible content, statistics calculations, and compression result text.
- Preserve snapshot serialization version `2`, reading versions `1` and `2`, persistence ordering, live state/config identities, and unexpected exception propagation.
- Operator actions continue through `executeDcpAction`: fresh policy check, one callback after a normally completed permitted attempt, no callback after rejection or an implementation throw. Permission denial alone does not disable operator controls.
- Keep per-call compression approval through Pi's native `ui.confirm`, including RPC support, cancellation, abort handling, and policy recheck after approval.
- No new configuration, dependencies, sidebar integration, search, block drilldown, domain actions, package version bump, or speculative abstractions.
- Earlier architecture documents' UI/message compatibility constraints are intentionally superseded for presentation only. Their domain and persistence contracts still apply.
- Each phase includes its production integration, relevant tests, README/CHANGELOG updates, `pnpm check`, and one atomic commit. No phase ships unused helpers or depends on future code.

## Review Focus

| Input or condition                                                                 | Required behavior                                                                                                     | Owning check                         |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Detailed compression/status, either compression mode, either showCompression value | One-line minimal metrics; no topic or summary text. The numeric `summary ~...` metric remains.                        | Task 3 delivery matrix               |
| Detailed toast with multiline labels or several summaries                          | Flatten labels; deduplicate tool names; retain combined summary text only when configured.                            | Tasks 1 and 3 detailed cases         |
| Off, no UI, zero work, or a repeat context pass                                    | Preserve suppression and timing; pruning toast is per-pass and status is cumulative, including repeat status updates. | Task 3 suppression/provenance cases  |
| Unit boundaries, zero, and singular values                                         | Exact `k`/`M` policy, `~` only for estimates, integer counts, singular output/token/message/session grammar.          | Tasks 1 and 2 formatting cases       |
| Null/missing context, zero lifetime totals, or existing informational counters     | Preserve all current fields and commands; context is Unavailable and missing lifetime directory still reports zero.   | Task 2 report and registration cases |

---

## Complexity and Atomic Result

Lowest complexity: mostly pure formatting, with one compression-notification delivery decision. Review exact copy, metric provenance, and configuration gates rather than navigation or domain state.

**Usable result:** Informational reports and automatic notifications share compact formatting; detailed status output stays on one line. Existing commands and the current single-list panel remain usable.

**Prerequisites:** Current production code. No prerequisite UI phase.

**Boundary:** Include production integration, tests, documentation, and verification in one phase commit. Tasks below are sequential work inside that commit, not separate release points. Do not ship unused helpers, break existing callers, or require unimplemented later code. Phase 2 is separately described in [its plan](2026-10-12-dcp-ui-refactor-phase-02-compression-rendering.md).

## Execution Rules

- [x] Confirm a clean or understood worktree and the prerequisite implementation/checks before editing product code; follow the execution workflow's isolation rules.
- [x] Run `pnpm check` as a fresh implementation baseline. Both the parent's 83 focused tests and this review's 952 tests are historical evidence once implementation begins.
- [x] Execute this phase sequentially. Demonstrate its expected test failures, integrate the complete behavior, and verify before committing.
- [x] Record completed checkboxes and the phase commit only when implementation happens. All implementation steps are initially unchecked.

## File Responsibilities

| File                                                                                                                                       | Work in this phase                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Create `src/tui/formatters.ts`, `tests/formatters.test.ts`                                                                                 | Two pure formatting functions and their exact contracts.                                                            |
| Modify `src/tui/notification.ts`; update `tests/notification.test.ts`, `tests/compress-notification.test.ts`                               | Existing builders consume the formatters; pin minimal and detailed copy.                                            |
| Modify `src/commands/context.ts`, `src/commands/stats.ts`, `src/commands/lifetime.ts`; update their three `tests/commands-*.test.ts` files | Compact token values, aligned label/value reports, preserved data and loading semantics.                            |
| Modify `src/index.ts`, `tests/index.test.ts`; create `tests/notification-delivery.test.ts`                                                 | Compression builder selection and real extension-path delivery coverage. Update old text assertions in index tests. |
| Update `tests/commands-help.test.ts`, `tests/commands-register.test.ts`                                                                    | Characterize all existing commands and unchanged informational routing.                                             |
| Update `README.md`, `CHANGELOG.md`                                                                                                         | Document only this phase's visible changes.                                                                         |

`src/commands/help.ts` already provides an aligned command list; retain its existing output. `src/commands/register.ts`, action messages, configuration warnings, and the panel need no production edits. Reuse `tests/extension-harness.ts` without modifying it unless a demonstrated observation gap requires a small addition.

## Presentation Contracts

### Formatting and metric provenance

- Export `formatDcpTokens(tokens: number, estimated?: boolean): string`, with `estimated = false`. Valid inputs are existing finite nonnegative token values; callers own missing-value handling. Below `1_000`, truncate to an integer. Otherwise choose the unit from the original value (`k` below `1_000_000`, `M` from there), round to one decimal with `toFixed(1)`, and remove `.0`. Do not promote units after rounding: `999_999` is `1000k`, matching pi-status. Prefix `~` only when estimated is true.
- Export `flattenDcpLabel(value: string): string`: collapse whitespace (including CR/LF, tabs, and repeated spaces) to one space and trim. Preserve Unicode. Use it for topic/tool labels, not summary bodies or model-facing text.
- Estimates: pruning `tokensSaved`, compression `compressedTokens`/`summaryTokens`, context `tokens`, session `totalPruneTokens`/`pruneTokenCounter`, and lifetime `totalTokensSaved`. The installed SDK explicitly calls context tokens estimated; the DCP savings and summary values originate from text-length estimates.
- Exact values: context-window capacity, all tool/message/block/cache/turn/session counts. Keep counts as integers, never abbreviated and never prefixed with `~`. Keep the supplied context percentage at one decimal; do not recompute it from rounded display tokens.

| Call                                                              | Exact result      |
| ----------------------------------------------------------------- | ----------------- |
| `formatDcpTokens(0)` / `formatDcpTokens(0, true)`                 | `0` / `~0`        |
| `formatDcpTokens(999)` / `formatDcpTokens(1_000)`                 | `999` / `1k`      |
| `formatDcpTokens(1_050)` / `formatDcpTokens(12_400, true)`        | `1.1k` / `~12.4k` |
| `formatDcpTokens(156_000)` / `formatDcpTokens(999_999)`           | `156k` / `1000k`  |
| `formatDcpTokens(1_000_000)` / `formatDcpTokens(1_250_000, true)` | `1M` / `~1.3M`    |
| `flattenDcpLabel("  Auth\r\n\t system  ")`                        | `Auth system`     |
| `flattenDcpLabel("\t\n")`                                         | empty string      |

### Notification copy

Retain `NotificationStats`, `CompressNotificationParams`, all four exported builder signatures, and their return types. Choose singular nouns from the original numeric value equal to `1`, not from rounded display text.

| Builder input                                                   | Exact output                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| Pruning: saved `12_400`, pruned `8`                             | `DCP · saved ~12.4k tokens · pruned 8 outputs`                |
| Pruning: saved `1`, pruned `1`                                  | `DCP · saved ~1 token · pruned 1 output`                      |
| Pruning: saved `0`, pruned `1`                                  | `DCP · saved ~0 tokens · pruned 1 output`                     |
| Pruning: saved `100`, pruned `0`                                | `DCP · saved ~100 tokens · pruned 0 outputs`                  |
| Pruning: saved `0`, pruned `0`                                  | `undefined`, including the detailed builder                   |
| Compression: compressed `12_400`, summary `2_100`, messages `5` | `DCP · compressed ~12.4k tokens · summary ~2.1k · 5 messages` |
| Compression: compressed `1`, summary `1`, messages `1`          | `DCP · compressed ~1 token · summary ~1 · 1 message`          |

Detailed pruning appends `\nPruned: grep, ls` for tools `["grep", "grep", "ls"]`; normalize labels before deduplication, preserve first occurrence order, and omit empty labels. An empty normalized list falls back to minimal output. Detailed compression appends `\nTopic: Auth system` for the flattened topic. Append `\nSummary (~2.1k): <summary>` only when `showCompression` is true and summary is nonempty. Preserve the combined summary's content and line breaks; retain `buildCombinedSummary`'s block-order joining and wrapper removal.

Minimal builders contain no topics, tool names, CR, or LF. Detailed builders intentionally contain line breaks. Builders add no ANSI escapes.

### Informational reports

Retain `contextCommand(state, contextUsage, modelDisabled = false): string`, `statsCommand(state): string`, `lifetimeCommand(sessionsParentDir): Promise<string>`, and `helpCommand(): string`. Preserve titles, row order, and existing labels. Within each metric report, indent rows by two spaces and pad each `label:` to that report's longest rendered label, followed by one space; use local row formatting, not another exported abstraction. Help retains its current layout and all eleven entries, including argument syntax and descriptions.

| Report                          | Required fields and representative values                                                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context                         | `Tokens` value `~5k / 200k (2.5%)`; Currently pruned tool calls; Active compression blocks; Total blocks; Tool cache entries; Current user turn; Manual mode; conditional DCP status `disabled for the current model`. |
| Context, null tokens or percent | `Tokens` value `Unavailable (context window: 200k)`; still display every state row. Missing usage entirely gives `Unavailable`. Zero tokens/percent are available: `~0 / 200k (0.0%)`.                                 |
| Session statistics              | Tools pruned this session; Cumulative tokens saved by pruning (e.g. `~1.2k` for `1_234`); Messages compressed this session; Prune token counter (e.g. `~500`).                                                         |
| Lifetime statistics             | Sessions tracked (`0 sessions`, `1 session`, `2 sessions`); Total tokens saved (e.g. `~2k`); Total tools pruned; Total messages compressed.                                                                            |

Call `loadAllSessionStats` once as today; retain saved-session aggregation and thrown-error behavior. Empty/nonexistent directories remain zero totals, not Unavailable. Do not add the future dashboard's lifetime-error fallback here. No informational command starts custom UI in this phase, regardless of mode or `hasUI`.

## Implementation Tasks

### Task 1: Shared formatters and existing notification builders

**Files:** `src/tui/formatters.ts`, `src/tui/notification.ts`, `tests/formatters.test.ts`, `tests/notification.test.ts`, `tests/compress-notification.test.ts`.

**Interfaces:** Produce the two formatter exports above; consume them in the existing builders without changing builder interfaces.

- [x] **Step 1: Add failing tests.** Use table-driven `formats compact tokens with explicit estimate markers` cases from the formatting table; `flattens whitespace and preserves Unicode` also covers `" 認証\n system " → "認証 system"`. Pin every notification-table string with `toBe`, and test detailed tool deduplication/fallback, flattened topic, summary gates (`true`, `false`, omitted), and retained multiline summary. A zero-message compression builder still returns metrics text; adapter suppression belongs to Task 3.
- [x] **Step 2: Observe failure.** Run `pnpm exec vitest run tests/formatters.test.ts tests/notification.test.ts tests/compress-notification.test.ts`. New formatter imports and old-copy mismatches must fail before implementation; rerun after adding the formatter to establish builder assertion failures too.
- [x] **Step 3: Implement and integrate.** Add the formatter exports, replace notification.ts's private `formatTokens`, and apply the exact copy/label contracts. Do not format domain result text or introduce transport/configuration logic into builders.
- [x] **Step 4: Verify.** Rerun the step-2 command; expect exit `0` with all cases passing.

### Task 2: Informational reports without routing changes

**Files:** The three metric command builders and their tests; `tests/commands-help.test.ts`, `tests/commands-register.test.ts`.

**Interfaces:** Consume `formatDcpTokens`; preserve all current command signatures and asynchronous lifetime loading.

- [x] **Step 1: Add failing report tests.** `retains every context field with compact estimated usage` pins the seven normal context rows plus the optional disabled-model row; `keeps missing context unavailable and zero usage available` covers undefined usage, each nullable field, and zero. `retains all four session counters with estimate provenance` explicitly sets `pruneTokenCounter` nonzero. `formats saved-session totals without changing aggregation` retains the existing two-session v1 fixture (`~2k`, `10`, `5`, `2 sessions`), adds a single-session case, and pins zero totals for empty/missing directories. Assert titles, row order, aligned value columns, and no added ANSI. Extend help coverage to all eleven exact command entries, including `dcp:help` and argument syntax.
- [x] **Step 2: Observe failure.** Run `pnpm exec vitest run tests/commands-context.test.ts tests/commands-stats.test.ts tests/commands-lifetime.test.ts tests/commands-help.test.ts tests/commands-register.test.ts`. Expect compact-value/alignment assertions to fail; unchanged help/registration characterization may already pass.
- [x] **Step 3: Implement the three metric reports.** Format only values identified as token quantities, align local label/value rows, and apply the unavailable/session grammar rules. Leave help production text and registration handlers in place. In registration tests, exercise `dcp:help`, `dcp:context`, `dcp:stats`, and `dcp:lifetime` with a temporary session directory in TUI/RPC/print/JSON and with UI absent; each still invokes `notify(text, "info")` and never `ui.custom`.
- [x] **Step 4: Verify.** Rerun the step-2 command; expect exit `0`. Replace old raw-number assertions with exact expected fields, not looser substring checks that could hide a lost metric.

### Task 3: Delivery selection, production regression coverage, and phase acceptance

**Files:** `src/index.ts`, `tests/index.test.ts`, new `tests/notification-delivery.test.ts`, `README.md`, `CHANGELOG.md`.

**Interfaces:** Use the existing private `sendCompressNotification`, context-event handler, `createExtensionHarness`, `emit`, and `executeTool` paths. Do not export a private adapter solely for tests.

**Delivery fixture:** Follow `tests/pi-contract.test.ts`: use a temporary `PI_CODING_AGENT_DIR` and global `extensions/dcp.json`, restore the previous environment and remove temporary files after each test. Import the real SDK with the harness; do not import the harness into `tests/index.test.ts`, whose full SDK mock omits `createSyntheticSourceInfo`. Create the extension, emit `session_start`, emit a real `context` event with eligible old messages and `turnProtection: 0`, then call registered `compress` with range content or message targets referencing those messages. Set `hasUI` explicitly (the harness defaults to false). Clear UI spies after fixture setup so context pruning/configuration warnings cannot satisfy compression assertions. Keep config valid and avoid model/network calls.

| Verbosity / delivery | Pruning                                                | Compression, both modes                                                       |
| -------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| off / either         | No automatic UI call                                   | No automatic UI call                                                          |
| minimal / toast      | Minimal per-pass message via `notify(..., "info")`     | Minimal per-call message via `notify(..., "info")`                            |
| detailed / toast     | Detailed per-pass message and tool names               | Detailed per-call message, flattened topic; summary body only when configured |
| minimal / status     | Minimal cumulative message via `setStatus("dcp", ...)` | Minimal per-call message via `setStatus("dcp", ...)`                          |
| detailed / status    | Same as minimal/status                                 | Same as minimal/status, for both showCompression values                       |

- [x] **Step 1: Add failing delivery/regression tests.** `compression uses the configured transport in both modes` covers the matrix, asserting exactly one call on the chosen transport and none on the other. Detailed status contains compact compressed/summary/message metrics and no `\r`, `\n`, topic value, `Topic:`, or `Summary (` section; do not assert that the numeric `summary` metric is absent. Detailed toast toggles showCompression and retains the multiline combined summary for multiple blocks. `automatic delivery is suppressed without UI or completed work` covers hasUI false, empty compression selections, and zero pruning; zero-message compression produces no UI call. Existing approval rejection and policy tests remain unchanged.

  `pruning toast stays per-pass while status stays cumulative` uses two successive deduplication passes with 400-character tool results (100 estimated tokens each): toasts each report `DCP · saved ~100 tokens · pruned 1 output`, while statuses progress from `DCP · saved ~100 tokens · pruned 1 output` to `DCP · saved ~200 tokens · pruned 2 outputs`. Repeating the unchanged second context emits no toast but still refreshes cumulative status. Assert the zero-savings/nonzero-prune distinction: toast reports `~0` when a pass prunes an empty output; status remains suppressed while cumulative savings are zero. Update old `items pruned`/`tokens saved` and raw-stat assertions in `tests/index.test.ts` to the new exact presentation.

- [x] **Step 2: Observe the adapter failure.** Run `pnpm exec vitest run tests/notification-delivery.test.ts tests/index.test.ts`. With Task 1 complete, detailed compression/status must still fail the one-line assertions before changing delivery selection. Diagnose fixture/configuration failures separately; they are not evidence of the intended regression.
- [x] **Step 3: Implement the delivery decision.** In `sendCompressNotification`, use detailed output only when verbosity is detailed **and** delivery is toast; status always uses the minimal builder. Preserve the existing early returns, result-to-metric mapping, summary extraction, notification point inside registered `execute`, severity, and `dcp` key. Keep pruning's per-pass toast and cumulative status gates as they are. Do not add status clearing, alternate keys, mode-dependent transport changes, caching, or delayed delivery.
- [x] **Step 4: Verify the complete phase.** Run the focused command below and `pnpm check`; both must exit `0`. The full check includes existing native approval, action, SDK, persistence, and domain regression tests. Review the diff against the global constraints and confirm no model-facing compression text, metric calculations, or snapshot changes.

  ```sh
  pnpm exec vitest run tests/formatters.test.ts tests/notification.test.ts tests/compress-notification.test.ts tests/notification-delivery.test.ts tests/index.test.ts tests/commands-help.test.ts tests/commands-context.test.ts tests/commands-stats.test.ts tests/commands-lifetime.test.ts tests/commands-register.test.ts
  pnpm check
  ```

- [x] **Step 5: Document and inspect.** README describes compact units/estimate markers and gives the exact minimal examples; clarify that showCompression exposes summary text only in detailed toasts and status keeps numeric summary tokens. Add this phase's entry under a new `## [Unreleased]` / `### Changed` section in CHANGELOG (or append there if already present); do not edit released entries or bump the package version. In real Pi, inspect pruning status and both compression modes with detailed/status and detailed/toast, then read the four informational commands. If available, repeat status inspection with pi-status enabled and its `dcp` segment visible; host width clipping is allowed, multiline status payloads are not. Record the environment and observed strings, or explicitly record that real-Pi inspection was unavailable. No frame/tab/overlay checks are required for this phase.
- [x] **Step 6: Commit the atomic result.** Run `git diff --check`, inspect `git status --short`, stage only the phase's changed/new files, and commit with `feat: unify DCP text and notification presentation`. Update this plan's implementation checkboxes and record the commit only after actual implementation and verification.

## Phase Completion and Rollback

- [x] The usable result above works in production without future-phase scaffolding.
- [x] The focused commands and `pnpm check` pass; document concrete visual checks or explain any real-Pi check that could not be performed.
- [x] README/CHANGELOG describe this phase's actual delivered behavior, and the complete diff forms one atomic commit.
- [x] Confirm unchanged domain algorithms, policy/callback semantics, metric calculations, and snapshot compatibility for the affected paths.

Revert dependent later phases before reverting this phase. No snapshot migration or compression display metadata is introduced here.

## Implementation Record — 2026-10-12

**Environment:** Node `v24.21.0`, pnpm `12.9.1`, coding-agent/TUI SDK `1.1.0`, branch `20261012-dcp-ui-refactor-phase-01-text-notifications`.

**Baseline:** `pnpm check` exited `0` with 61 test files / 952 tests passed before implementation.

**Verification:** Task 1 and Task 2 failed for the expected copy/alignment reasons before implementation. Task 3's detailed/status cases failed the one-line assertions before the delivery decision; the zero-message guard was exercised with a scoped `handleCompress` spy because valid `handleCompress` results always report at least one compressed message. The focused command passed 10 files / 140 tests, and the final `pnpm check` exited `0` with 63 files / 995 tests. `git diff --check` is clean.

**Real-Pi inspection:** unavailable in this environment. The production notification strings were verified through the real SDK extension harness, including the pruning per-pass/cumulative provenance, both compression modes, both transports, both verbosity levels, both `showCompression` values, no-UI and off suppression, and the one-line detailed-status contract. Interactive footer/pi-status width clipping was not observed directly.

**Commit:** `feat: unify DCP text and notification presentation` (one atomic commit for this phase).
