# DCP UI Phase 2: Compression Tool Calls and Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for these sequential changes) or superpowers:subagent-driven-development to implement this plan step-by-step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship themed compression calls/results for both modes, including historical and error results.

**Architecture:** Add a small active-theme adapter and a dedicated tool presentation module. Both registered compression definitions use the same renderer functions and successful executions supply optional display metadata; model-facing output and native approval stay with their current owners.

**Tech Stack:** Existing TypeScript/ESM, Node `>=24.15.0`, installed Pi coding-agent/TUI SDK, Vitest, TypeBox, and Biome; no new dependencies.

**Spec:** [Approved design in the parent plan](2026-10-12-dcp-ui-refactor-plan.md#approved-design). The parent remains the source of truth for the overall design; this file extracts its phase 2 implementation content.

## Global Constraints

- Use `/Users/lanh/Developer/pi-vault/pi-status` as a visual/code reference only; no runtime imports, dependency on pi-status, or edits to that repository.
- Match its frame, spacing, tabs, semantic theme roles, selection marker, compact metrics, and persistent keyboard footer. Use the active Pi theme; no palette presets or editor.
- Adapt reference primitives to DCP's installed SDK. The inspected pi-status checkout uses Pi `0.84.4`; DCP uses Pi `1.1.0`.
- Preserve command names and arguments, pruning/compression algorithms, policy, tool selection, model-visible content, statistics calculations, and compression result text.
- Preserve snapshot serialization version `2`, reading versions `1` and `2`, persistence ordering, live state/config identities, and unexpected exception propagation.
- Operator actions continue through `executeDcpAction`: fresh policy check, one callback after a normally completed permitted attempt, no callback after rejection or an implementation throw. Permission denial alone does not disable operator controls.
- Keep per-call compression approval through Pi's native `ui.confirm`, including RPC support, cancellation, abort handling, and policy recheck after approval.
- No new configuration, dependencies, sidebar integration, search, block drilldown, domain actions, package version bump, or speculative abstractions.
- Earlier architecture documents' UI/message compatibility constraints are intentionally superseded for presentation only. Their domain and persistence contracts still apply.
- Each phase includes its production integration, relevant tests, README/CHANGELOG updates, `pnpm check`, and one atomic commit. No phase ships unused helpers or depends on future code.

## Review Focus

| Input or condition | Required behavior | Owning check |
| --- | --- | --- |
| Historical result details are empty | Preserve readable original text, with no fabricated metrics. | Step 1 legacy cases |
| Error result also carries display metadata | Error presentation wins; do not imply successful compression. | Step 1 error cases |
| Partial/missing arguments or partial results | Render safely and do not label incomplete results completed. | Step 1 partial cases |
| Unicode, narrow width, expanded multiline content | Truncate collapsed rows and wrap expanded text within render width. | Step 1 width/content cases |
| NO_COLOR or throwing theme methods | Use readable plain styling without disrupting tool execution or approval. | Step 1 theme cases |

---

## Complexity and Atomic Result

Moderate complexity: SDK callbacks, width-aware components, and optional metadata must agree. Historical results, partial arguments, and errors make this more involved than text formatting, but it does not change panel navigation.

**Usable result:** Both compression modes show compact calls and results, support expanded detail, and safely display older results without metadata. Phase 1 reports and the existing panel continue working.

**Prerequisites:** [Previous phase](2026-10-12-dcp-ui-refactor-phase-01-text-notifications.md). Phase 1 must be integrated and verified. Import formatDcpTokens(tokens: number, estimated?: boolean): string and flattenDcpLabel(value: string): string from src/tui/formatters.ts.

**Boundary:** Include production integration, tests, documentation, and verification in one phase commit. Do not ship unused helpers, break existing callers, or require unimplemented later code. After this complete commit, continue with [phase 3](2026-10-12-dcp-ui-refactor-phase-03-framed-overlay.md).

## Execution Rules

- [ ] Confirm a clean or understood worktree and the prerequisite implementation/checks before editing product code; follow the execution workflow's isolation rules.
- [ ] Run `pnpm check` as a fresh baseline. The parent's observation of 83 passing focused tests is historical evidence, not this phase's verification.
- [ ] Execute this phase sequentially. Demonstrate its expected test failures, integrate the complete behavior, and verify before committing.
- [ ] Record completed checkboxes and the phase commit only when implementation happens. All implementation steps are initially unchecked.

## Implementation Steps (Extracted from Parent Phase 2)

**Files:** Create `src/tui/theme.ts`, `src/tui/compress-render.ts`, `tests/theme.test.ts`, and `tests/compress-render.test.ts`. Modify `src/index.ts`; extend tool-registration/execution coverage in `tests/index.test.ts`, `tests/sdk-contract.test.ts`, and the existing harness only as required. Update README and CHANGELOG.

**Interfaces:**

- Consume phase 1's token and label formatters.
- Produce `DcpTheme = Pick<Theme, "fg" | "bg" | "bold" | "inverse">` and `createDcpTheme(theme: Theme, env?: NodeJS.ProcessEnv): DcpTheme`. `NO_COLOR` presence returns identity styling. Theme methods that throw fall back to their plain input; no fixed colors/configuration are introduced.
- Produce `CompressionDisplayDetails` with optional `dcpCompression: Pick<CompressResult, "topic" | "messagesCompressed" | "compressedTokens" | "summaryTokens" | "blockIds"> & { mode: CompressArgs["mode"] }`.
- Produce `createCompressionDisplayDetails(mode: CompressArgs["mode"], result: CompressResult): CompressionDisplayDetails` using a copied block-ID array.
- Produce `renderCompressCall(mode: CompressArgs["mode"], args: unknown, theme: Theme): Component` and `renderCompressResult(result: AgentToolResult<CompressionDisplayDetails>, options: ToolRenderResultOptions, theme: Theme, context: Pick<ToolRenderContext, "isError">): Component`, using the installed SDK's types. Both tool definitions wire these callbacks; call rendering closes over the registered mode.

- [ ] **Step 1: Add failing renderer/metadata tests.** Assert call output contains the flattened topic, registered mode, and range/target count without the submitted summaries. Assert collapsed metadata-backed results include message count and estimated compressed/summary tokens; expanded results additionally include original result text and `bN` identifiers. Assert metadata uses the exact execution result counts/IDs and does not contain summaries.

  Pin representative data assertions:

  ```ts
  expect(createCompressionDisplayDetails("range", result).dcpCompression)
    .toMatchObject({ mode: "range", messagesCompressed: 5, blockIds: [1, 2] });
  expect(JSON.stringify(details)).not.toContain("private summary text");
  expect(renderedLines.every(line => visibleWidth(line) <= 60)).toBe(true);
  ```

  Cover both modes, partial/missing arguments, zero-message results, metadata-free historical results, error results even if metadata is present, expanded multiline output, Unicode, `NO_COLOR`, and a throwing theme. Legacy/error results display their original text rather than fabricated counts; partial results are not labeled completed. Use actual SDK callback invocation through registered tools for integration coverage.
- [ ] **Step 2: Demonstrate failure.** Run `pnpm exec vitest run tests/theme.test.ts tests/compress-render.test.ts tests/index.test.ts tests/sdk-contract.test.ts`; expect missing-renderer/metadata failures.
- [ ] **Step 3: Implement and register both-mode rendering.** Use Pi components that honor the render width: truncate collapsed rows and wrap expanded text. Add optional metadata only to normally completed compression results. Leave rejected approval/policy results with empty details. Keep result `content`, schemas, activation, execution mode, prompts, timing, and approval unchanged. Do not parse metric counts from human-readable legacy text or read live state to reconstruct historical results. Do not strip supported content types from fallback results.
- [ ] **Step 4: Verify the phase.** Run the step-2 command and `pnpm check`; expect exit `0`. Verify real Pi collapsed/expanded rendering in both configured modes, plus native approval. No model or network call is required for unit tests.
- [ ] **Step 5: Document and commit the usable result.** Document the compact tool presentation and host expansion behavior. Run `git diff --check`, stage phase files, and commit with `feat: render DCP compression calls and results`.

## Phase Completion and Rollback

- [ ] The usable result above works in production without future-phase scaffolding.
- [ ] The focused commands and `pnpm check` pass; document concrete visual checks or explain any real-Pi check that could not be performed.
- [ ] README/CHANGELOG describe this phase's actual delivered behavior, and the complete diff forms one atomic commit.
- [ ] Confirm unchanged domain algorithms, policy/callback semantics, metric calculations, and snapshot compatibility for the affected paths.

Revert dependent later phases before reverting this phase. No snapshot migration is introduced. Optional compression display metadata is backward-compatible with the legacy-result fallback from phase 2.
