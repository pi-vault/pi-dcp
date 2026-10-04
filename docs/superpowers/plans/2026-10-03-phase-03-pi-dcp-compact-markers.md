# Phase 3 — Pi DCP Compact Message Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace verbose model-visible XML message IDs with compact markers while preserving canonical persisted references and every supported legacy tool input.

**Architecture:** Keep padded message references as the sole state and snapshot representation, and treat compact markers as a model-facing display protocol. The boundary codec accepts compact or legacy tool input, lookup explicitly normalizes it back to a padded reference, and injection plus sanitization own the compact syntax without changing Pi's lifecycle integration.

**Tech Stack:** Node.js, TypeScript 7, Pi `AgentMessage` and extension APIs, Vitest 5, the existing deterministic benchmark harness, pnpm

**Spec:** `docs/superpowers/specs/2026-10-03-pi-dcp-improvement-roadmap-design.md`

## Global Constraints

- Execute this phase after `2026-10-03-phase-02-pi-dcp-correctness-config-safety.md` and start from `v0.7.0`.
- Keep state and version-1 snapshot references canonical and padded (`m0001`); do not migrate stored maps or change the snapshot version.
- Keep `parseMessageRef(ref)` canonical-only. Compact aliases belong only in `parseBoundaryId(id)`.
- Continue accepting padded tool inputs and `bN` block references, and continue sanitizing legacy XML markers.
- Emit exactly `@mN@` without priority and `@mN:P@` with priority, where `P` is an integer from 1 through 5.
- Compact input grammar is exact, case-sensitive, and whitespace-free. Reject partial padding such as `m01`, wrapped padded forms such as `@m0001@`, and malformed numeric forms.
- Compact marker sanitization must be line-bounded and must not strip ordinary prose, email addresses, mentions, or unrelated identifiers.
- Do not change dependencies, configuration, the generated schema, or Pi lifecycle hooks in this phase.

## Review Focus

- A copied `@m12:3@` must resolve to the stored canonical `m0012`, not merely parse successfully; Task 1 tests `resolveBoundaryIndex` directly.
- Zero, partial padding, negatives, decimals, malformed priorities, and unsafe message or block integers must be rejected; Task 1 owns the invalid-input table.
- Standalone complete and truncated markers must be stripped while `person@m1@example.com`, inline `@m1@`, `@mention`, and CRLF text survive; Task 2 covers these boundaries.
- A version-1 snapshot containing `m0001` must display `@m1@` after restore and reserialize as `m0001`; Task 3 covers both directions.
- IDs beyond four digits must remain unique and compact (`m10000` displays as `@m10000@`), and retained benchmark ratios must not regress by more than five percentage points; Tasks 1 and 4 pin these cases.

---

### Task 1: Add the compact marker codec and canonical lookup

**Files:**

- Modify: `src/utils/message-ids.ts`
- Modify: `src/compress/search.ts`
- Test: `tests/message-ids.test.ts`
- Test: `tests/compress-search.test.ts`

**Interfaces:**

- Consumes: canonical padded refs, bare compact refs, wrapped compact markers, priority-wrapped markers, and block refs.
- Produces: `formatMessageMarker(ref: string, priority?: number): string`, `isCanonicalMessageRef(ref: string): boolean`, and the existing `parseBoundaryId(id: string): ParsedBoundaryId | undefined` return shape extended to compact inputs.
- Invariant: `resolveBoundaryIndex` compares `formatMessageRef(parsed.index)` with `SessionState.messageIds.byIndex`; it never compares the raw tool argument with stored state.

- [ ] **Step 1: Add failing compact formatter and canonical-ref tests**

In `tests/message-ids.test.ts`, assert:

```ts
expect(formatMessageMarker("m0001")).toBe("@m1@");
expect(formatMessageMarker("m0012", 3)).toBe("@m12:3@");
expect(formatMessageMarker("m10000")).toBe("@m10000@");
expect(isCanonicalMessageRef("m0001")).toBe(true);
expect(isCanonicalMessageRef("m10000")).toBe(true);
expect(isCanonicalMessageRef("m1")).toBe(false);
expect(isCanonicalMessageRef("@m1@")).toBe(false);
```

Assert `formatMessageMarker` throws `RangeError` for noncanonical refs and priorities `0`, `6`, and `1.5`.

- [ ] **Step 2: Add failing boundary grammar tests**

Use a table to assert `m1`, `m0001`, `@m1@`, and `@m1:3@` each produce
`{ type: "message", index: 1 }`, while `b3` remains `{ type: "block", blockId: 3 }`.

Use an invalid table covering `m0`, `m0000`, `m01`, `m001`, `m00001`, `@m01@`, `@m0001@`,
negative and decimal forms, `@m1:0@`, `@m1:6@`, `@m1:1.5@`, incomplete wrappers, surrounding
whitespace, uppercase variants, and message/block values above `Number.MAX_SAFE_INTEGER`.

- [ ] **Step 3: Add failing normalized lookup tests**

In `tests/compress-search.test.ts`, store `m0001` at an index and assert all four accepted message
forms resolve to that index. Retain the existing block lookup and unknown-ref cases.

- [ ] **Step 4: Run the focused tests and verify the compact cases fail**

Run: `pnpm vitest run tests/message-ids.test.ts tests/compress-search.test.ts`

Expected: FAIL because compact formatting/parsing does not exist and lookup still compares the raw input.

- [ ] **Step 5: Implement the compact codec**

Keep `formatMessageRef(index)` and `parseMessageRef(ref)` unchanged in purpose. Add a private compact
message parser for exact `m[1-9]\d*` and `@m[1-9]\d*(?::[1-5])?@` forms, validate positive safe
integers, and let `parseBoundaryId` try canonical, compact, then block parsing. Harden block parsing
to reject unsafe integers.

Implement `formatMessageMarker` by parsing its canonical input with `parseMessageRef`; emit the
unpadded numeric index and optional validated priority. Implement `isCanonicalMessageRef` as the
strict canonical predicate.

- [ ] **Step 6: Normalize lookup before state comparison**

In `resolveBoundaryIndex`, convert a parsed message index back through `formatMessageRef` and scan
`byIndex` for that canonical value. Leave block anchor lookup unchanged.

- [ ] **Step 7: Run the focused tests**

Run: `pnpm vitest run tests/message-ids.test.ts tests/compress-search.test.ts`

Expected: PASS for canonical, compact, wrapped, priority-wrapped, block, high-index, and invalid inputs.

- [ ] **Step 8: Commit the codec and lookup**

```bash
git add src/utils/message-ids.ts src/compress/search.ts tests/message-ids.test.ts tests/compress-search.test.ts
git commit -m "feat: add compact DCP message marker codec"
```

### Task 2: Emit, sanitize, and describe compact markers

**Files:**

- Modify: `src/messages/inject.ts`
- Modify: `src/messages/strip.ts`
- Modify: `src/prompts/system.ts`
- Modify: `src/prompts/compress-message.ts`
- Modify: `src/index.ts`
- Modify: `src/compress/handler.ts`
- Test: `tests/inject.test.ts`
- Test: `tests/strip.test.ts`
- Test: `tests/message-end.test.ts`
- Test: `tests/index.test.ts`
- Test: `tests/integration.test.ts`
- Test: `tests/pipeline.test.ts`
- Test: `tests/compress-cycle.test.ts`

**Interfaces:**

- Consumes: canonical refs from `SessionState.messageIds`, optional `PriorityMap` entries, and `formatMessageMarker` from Task 1.
- Produces: one standalone compact marker in each currently injectable user/assistant text message, plus line-bounded removal of complete or truncated compact marker lines.
- Compatibility: legacy XML cleanup stays active; `formatMessageIdTag` is removed after its only production consumer migrates.

- [ ] **Step 1: Change injection expectations to compact markers**

In `tests/inject.test.ts`, expect exact `@m1@` and `@m2@` markers without priorities and
`@mN:P@` with priorities. Preserve string-content conversion, stale-marker replacement, repeated
injection, missing-text behavior, and custom-prompt tests. Assert `byIndex`, `byRawId`, and `byRef`
still contain padded `m0001` and `m0002` values.

- [ ] **Step 2: Add line-bounded sanitizer tests**

Put the core cases in `tests/strip.test.ts` and retain `tests/message-end.test.ts` as handler-level
coverage. Test standalone `@m1@`, `@m2:4@`, `@m3`, `@m3:`, and `@m3:2` lines at string end and
between surrounding lines. Cover LF, CRLF, optional horizontal whitespace, multiple marker lines,
and existing XML cases.

Assert these remain unchanged:

```text
email person@m1@example.com
The literal marker @m1@ appears inline here.
@mention
prefix @m2:4@
```

- [ ] **Step 3: Update integration expectations to compact output**

Change marker-sensitive assertions in `tests/index.test.ts`, `tests/integration.test.ts`,
`tests/pipeline.test.ts`, and `tests/compress-cycle.test.ts`. Add index-level assertions for the
registered range/message tool descriptions and unavailable-ID guidance so no text claims padded
IDs are visible in the current context.

- [ ] **Step 4: Run the focused tests and verify XML output still fails expectations**

Run: `pnpm vitest run tests/inject.test.ts tests/strip.test.ts tests/message-end.test.ts tests/index.test.ts tests/integration.test.ts tests/pipeline.test.ts tests/compress-cycle.test.ts`

Expected: FAIL on compact injection, compact stripping, and model-facing copy.

- [ ] **Step 5: Emit compact markers**

Replace `formatMessageIdTag` with `formatMessageMarker` in injection. Preserve current eligible
roles, first-text-part placement, and the two-newline separator. Do not broaden injection to
tool-result or textless messages. Remove the obsolete XML formatter and its formatter-only tests.

- [ ] **Step 6: Add tolerant, line-bounded compact stripping**

Strip a compact marker only when the whole line consists of optional horizontal whitespace and a
marker-like `@m<digits>` form with an optional numeric priority and optional closing `@`. This
sanitizer may remove structurally marker-like but invalid numeric values because it protects stored
assistant output; the tool-input parser remains strict. Preserve the remaining line boundary so
surrounding prose is not concatenated. Run compact stripping before the legacy XML fallbacks.

- [ ] **Step 7: Update model-facing instructions and errors**

Teach the system prompt that `@mN@`, `@mN:P@`, and `<dcp-system-reminder>` are injected metadata and
must not be output. Explain priority values in `COMPRESS_MESSAGE_PROMPT`. In `src/index.ts`, use
`m1`/`@m1@` range examples, `m1`/`@m1:P@` message examples, and retain `bN` examples. In
`src/compress/handler.ts`, replace claims that `m0001` is visible with compact examples while
retaining the unavailable/pruned explanation.

- [ ] **Step 8: Run focused and integration tests**

Run: `pnpm vitest run tests/inject.test.ts tests/strip.test.ts tests/message-end.test.ts tests/index.test.ts tests/integration.test.ts tests/pipeline.test.ts tests/compress-cycle.test.ts`

Expected: PASS with compact output, legacy cleanup, bounded malformed cleanup, and no listed false positives.

- [ ] **Step 9: Commit compact injection, sanitization, and copy**

```bash
git add src/messages/inject.ts src/messages/strip.ts src/prompts/system.ts src/prompts/compress-message.ts src/index.ts src/compress/handler.ts tests/inject.test.ts tests/strip.test.ts tests/message-end.test.ts tests/index.test.ts tests/integration.test.ts tests/pipeline.test.ts tests/compress-cycle.test.ts
git commit -m "feat: emit compact DCP message markers"
```

### Task 3: Prove compression and persistence compatibility

**Files:**

- Modify: `src/state/persistence.ts`
- Test: `tests/compress-range.test.ts`
- Test: `tests/compress-message.test.ts`
- Test: `tests/persistence.test.ts`

**Interfaces:**

- Consumes: the boundary codec from Task 1, compact injection from Task 2, and version-1 snapshots containing canonical padded refs.
- Produces: identical compression selections for every accepted tool-input form and an explicit canonical-only persistence boundary.

- [ ] **Step 1: Add end-to-end range compatibility coverage**

For each input pair, create a fresh prepared state before calling `handleCompress` so one case cannot
mutate another. Assert `m1`/`m3`, `m0001`/`m0003`, `@m1@`/`@m3@`, and
`@m1:3@`/`@m3:2@` produce identical selected boundaries and block membership.

- [ ] **Step 2: Add end-to-end message compatibility coverage**

For fresh prepared states, target the same message with `m2`, `m0002`, `@m2@`, and `@m2:1@`.
Assert every case records the same canonical start/end key and rejects the existing invalid cases.

- [ ] **Step 3: Add the version-1 snapshot round-trip test**

Restore a literal snapshot containing `messageIds.byRawId: [["user:1:0", "m0001"]]`, rebuild
runtime indices with the matching timestamped message, inject IDs, and assert the model-visible text
ends in `@m1@`. Serialize again and assert the pair remains exactly `m0001`.

Add a malformed snapshot containing compact persisted `m1`; assert that pair is discarded rather
than normalized or migrated. Its declared `nextRefIndex` remains authoritative, consistent with the
existing version-1 recovery behavior.

- [ ] **Step 4: Run the compatibility group**

Run: `pnpm vitest run tests/compress-search.test.ts tests/compress-range.test.ts tests/compress-message.test.ts tests/persistence.test.ts tests/stable-ids.test.ts tests/compress-cycle.test.ts`

Expected: PASS once Tasks 1 and 2 are complete; all accepted aliases select identical canonical state.

- [ ] **Step 5: Make the persistence boundary explicit**

Use `isCanonicalMessageRef` in snapshot `byRawId` pair validation instead of any permissive boundary
parser. Keep compression search on `parseBoundaryId`, and do not change the version-1 wire shape.

- [ ] **Step 6: Run the full compatibility group again**

Run: `pnpm vitest run tests/compress-search.test.ts tests/compress-range.test.ts tests/compress-message.test.ts tests/persistence.test.ts tests/stable-ids.test.ts tests/compress-cycle.test.ts`

Expected: PASS with no snapshot migration and no targeting difference across accepted formats.

- [ ] **Step 7: Commit compatibility coverage**

```bash
git add src/state/persistence.ts tests/compress-range.test.ts tests/compress-message.test.ts tests/persistence.test.ts
git commit -m "test: preserve canonical DCP ID compatibility"
```

### Task 4: Enforce marker benchmarks and prepare v0.8.0

**Files:**

- Modify: `tests/benchmark.test.ts`
- Modify: `benchmarks/result.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

**Interfaces:**

- Consumes: deterministic workloads from `scripts/benchmark.ts` and the retained v0.7.0 token totals.
- Produces: release-blocking token gates, updated retained evidence, and v0.8.0 protocol documentation.

- [ ] **Step 1: Add deterministic benchmark gates**

Locate each workload by name and assert:

```ts
clean.outputEstimatedTokens - clean.inputEstimatedTokens <= 6_000;
repeated.reductionEstimatedTokens / repeated.inputEstimatedTokens >=
  962_873 / 1_017_575 - 0.05;
nested.reductionEstimatedTokens / nested.inputEstimatedTokens >=
  1_171 / 1_291 - 0.05;
```

The ratio formulas preserve the exact retained baselines and enforce the spec's five-percentage-point limit rather than rounded 89/85 percent approximations.

- [ ] **Step 2: Run the benchmark tests**

Run: `pnpm vitest run tests/benchmark.test.ts`

Expected: PASS with compact markers; any token regression beyond the three gates fails the test.

- [ ] **Step 3: Refresh retained benchmark evidence**

Run: `pnpm benchmark`

Expected: one JSON report on stdout. Use the captured JSON to update `benchmarks/result.json` with
normal file-editing tooling; the command does not write the file itself. Run the benchmark test once
more against the retained values.

- [ ] **Step 4: Document the compact protocol and release**

In `README.md`, add `What's new in 0.8.0`, document `@mN@`, `@mN:P@`, accepted tool-input aliases,
legacy XML cleanup, and padded snapshot refs. Update the benchmark section to distinguish enforced
token gates from informational timing and retain the documented stdout-redirection example.

In `CHANGELOG.md`, add `2026-10-04 - [0.8.0]` entries for compact display markers, accepted legacy
inputs, canonical persistence, safer sanitization, and benchmark gates. Set `package.json` to
`0.8.0`; do not change dependencies or the lockfile.

- [ ] **Step 5: Run complete automated verification**

Run: `pnpm check`

Expected: format, lint, typecheck, and all tests pass.

Run: `pnpm run pack:dry-run`

Expected: package dry run succeeds and includes the expected source, schema, README, changelog, and license files.

Run: `git diff --check`

Expected: exit 0 with no whitespace errors. Confirm `dcp.schema.json`, `pnpm-lock.yaml`, and dependency declarations are unchanged.

- [ ] **Step 6: Smoke-test both Pi compression modes**

Run separate range- and message-mode Pi sessions against the local extension. Confirm request context
contains `@mN@` or `@mN:P@`, copied wrapped markers are accepted by `compress`, a resumed session
retains canonical refs and block ownership, and assistant-emitted standalone marker lines do not
reappear after resume. Record any unavailable credential or interactive limitation rather than
claiming the smoke test passed.

- [ ] **Step 7: Commit the release metadata and benchmark**

```bash
git add tests/benchmark.test.ts benchmarks/result.json README.md CHANGELOG.md package.json
git commit -m "chore: prepare pi-dcp 0.8.0"
```
