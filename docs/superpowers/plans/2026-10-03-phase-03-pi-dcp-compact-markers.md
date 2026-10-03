# Phase 3 — Pi DCP Compact Message Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace verbose model-visible XML message IDs with compact markers while preserving canonical persisted references and every legacy input format.

**Architecture:** Separate canonical IDs from their display protocol. State and snapshots continue storing padded references, a codec normalizes compact or legacy tool input, and injection/sanitization own the compact marker syntax. Deterministic benchmark thresholds prevent trading correctness for negligible token savings.

**Tech Stack:** Node.js, TypeScript 7, Pi AgentMessage APIs, Vitest 5, existing deterministic benchmark harness, pnpm

**Spec:** `docs/superpowers/specs/2026-10-03-pi-dcp-improvement-roadmap-design.md`

## Global Constraints

- Execute this phase after `2026-10-03-phase-02-pi-dcp-correctness-config-safety.md` and start from v0.7.0.
- Keep state and snapshot references canonical and padded (`m0001`); do not migrate stored maps.
- Continue accepting legacy XML markers, padded tool inputs, and `bN` block references.
- Emit exactly `@mN@` in range mode and `@mN:P@` in message mode, where `P` is 1-5.
- Compact marker sanitization must be line-bounded and must not strip ordinary prose or email addresses.

## Review Focus

- A model copying `@m12:3@` as a tool argument must resolve to canonical `m0012`; Task 1 tests wrapped priority input.
- `m0`, `m0000`, negative, decimal, malformed priority, and unsafe-integer IDs must be rejected; Task 1 adds the invalid table.
- `person@m1@example.com` and prose containing `@m1@` inline must survive sanitization; Task 2 tests both false-positive classes.
- A version-1 snapshot containing `m0001` must restore and reserialize with the same canonical value after compact display; Task 3 covers the round trip.
- IDs beyond four digits must remain unique and compact (`m10000` displayed as `@m10000@`); Task 1 pins the high-index case.

---

### Task 1: Introduce the canonical/display marker codec

**Files:**

- Modify: `src/utils/message-ids.ts`
- Test: `tests/message-ids.test.ts`

**Interfaces:**

- Consumes: canonical refs, bare compact refs, wrapped compact markers, padded legacy refs, and block refs.
- Produces: `formatMessageMarker(ref: string, priority?: number): string`, `isCanonicalMessageRef(ref: string): boolean`, and the existing `parseBoundaryId(id: string): ParsedBoundaryId | undefined` extended to compact inputs.

- [ ] **Step 1: Add failing compact formatting tests**

Assert:

```ts
expect(formatMessageMarker("m0001")).toBe("@m1@");
expect(formatMessageMarker("m0012", 3)).toBe("@m12:3@");
expect(formatMessageMarker("m10000")).toBe("@m10000@");
```

Assert invalid priorities `0`, `6`, and fractional values are rejected rather than emitted.

- [ ] **Step 2: Add failing boundary normalization tests**

Use a table asserting `m1`, `m0001`, `@m1@`, and `@m1:3@` all produce
`{ type: "message", index: 1 }`; `b3` remains `{ type: "block", blockId: 3 }`. Assert malformed,
zero, negative, decimal, unsafe-integer, and priority-out-of-range inputs return `undefined`.
Assert `isCanonicalMessageRef("m0001")` is true while compact and wrapped forms are false.

- [ ] **Step 3: Run the codec tests and verify compact forms fail**

Run: `pnpm vitest run tests/message-ids.test.ts`

Expected: FAIL because only padded bare message refs are currently parsed and only XML is formatted.

- [ ] **Step 4: Implement canonical parsing and compact normalization**

Keep `formatMessageRef(index)` unchanged. Parse the wrapper and optional priority first, validate a
positive safe integer, then return the existing `ParsedBoundaryId`. `formatMessageMarker` must
derive the numeric index from a canonical ref and throw for invalid canonical refs or priorities so
internal misuse fails during tests.

- [ ] **Step 5: Run codec tests**

Run: `pnpm vitest run tests/message-ids.test.ts`

Expected: PASS for legacy, compact, wrapped, priority, block, and invalid cases.

- [ ] **Step 6: Commit the marker codec**

```bash
git add src/utils/message-ids.ts tests/message-ids.test.ts
git commit -m "feat: add compact DCP message marker codec"
```

### Task 2: Emit and sanitize compact markers

**Files:**

- Modify: `src/messages/inject.ts`
- Modify: `src/messages/strip.ts`
- Modify: `src/prompts/system.ts`
- Modify: `src/prompts/compress-message.ts`
- Modify: `src/index.ts`
- Test: `tests/inject.test.ts`
- Test: `tests/message-end.test.ts`
- Test: `tests/index.test.ts`

**Interfaces:**

- Consumes: canonical refs from `SessionState.messageIds` and optional priority entries.
- Produces: one trailing standalone compact marker per injectable message and removal of standalone injected/hallucinated marker lines.

- [ ] **Step 1: Change injection expectations to compact markers**

Update injection tests to expect `@m1@`, `@m2@`, and priority forms matching
`/@m1:[1-5]@/`. Preserve tests for string content conversion, idempotent reinjection, stale-marker
replacement, and custom prompts. Add an assertion that the state maps still contain `m0001` and
`m0002`.

- [ ] **Step 2: Add failing compact sanitization tests**

In `tests/message-end.test.ts`, cover a standalone `@m1@` line, standalone `@m2:4@`, truncated
line-ending `@m3`, and the legacy XML cases. Assert these false positives survive unchanged:

```text
email person@m1@example.com
The literal marker @m1@ appears inline here.
@mention
```

- [ ] **Step 3: Run injection and sanitizer tests and verify XML is still emitted**

Run: `pnpm vitest run tests/inject.test.ts tests/message-end.test.ts tests/index.test.ts`

Expected: FAIL on compact expectations and compact sanitizer cases.

- [ ] **Step 4: Emit compact markers from message injection**

Replace `formatMessageIdTag` use with `formatMessageMarker`. Continue appending the marker after two
newlines, exactly once, to user and assistant messages only. Do not change canonical ref assignment.

- [ ] **Step 5: Add line-bounded compact stripping**

Extend `stripHallucinationsFromString` with compact patterns that match only a complete standalone
marker line or a bounded truncated marker at line/string end. Run compact stripping before the
broad legacy tag fallbacks. Do not use a pattern that matches compact-looking text embedded in a
larger line.

- [ ] **Step 6: Update model-facing prompt and tool descriptions**

Teach the system prompt that `@mN@`, `@mN:P@`, and `<dcp-system-reminder>` are injected metadata.
Describe bare `mN` tool inputs, use compact examples in both compress modes, and retain block-ID
examples as `bN`.

- [ ] **Step 7: Run focused and integration tests**

Run: `pnpm vitest run tests/inject.test.ts tests/message-end.test.ts tests/index.test.ts tests/integration.test.ts tests/pipeline.test.ts`

Expected: PASS with compact output, legacy cleanup, and no false-positive stripping.

- [ ] **Step 8: Commit compact injection and prompts**

```bash
git add src/messages/inject.ts src/messages/strip.ts src/prompts/system.ts src/prompts/compress-message.ts src/index.ts tests/inject.test.ts tests/message-end.test.ts tests/index.test.ts tests/integration.test.ts tests/pipeline.test.ts
git commit -m "feat: emit compact DCP message markers"
```

### Task 3: Prove compression and persistence compatibility

**Files:**

- Modify: `src/state/persistence.ts`
- Test: `tests/compress-search.test.ts`
- Test: `tests/compress-range.test.ts`
- Test: `tests/compress-message.test.ts`
- Test: `tests/persistence.test.ts`
- Test: `tests/stable-ids.test.ts`

**Interfaces:**

- Consumes: the extended `parseBoundaryId` codec and version-1 persisted canonical refs.
- Produces: identical compression targets for compact, wrapped, priority-wrapped, and legacy padded message inputs.

- [ ] **Step 1: Add compression input compatibility tests**

For the same prepared state, invoke range lookup with `m1`/`m3`, `@m1@`/`@m3@`, and
`m0001`/`m0003`; assert identical indices. In message mode, pass `m2`, `@m2:1@`, and `m0002` and
assert each selects the same canonical message. Keep invalid boundary tests unchanged.

- [ ] **Step 2: Add the version-1 snapshot round-trip test**

Load a literal v1 fixture with `messageIds.byRawId: [["user:1:0", "m0001"]]`, restore it, run
message injection, and assert model output uses `@m1@` while `serializeDcpSnapshot` still writes
`m0001`. Add a malformed fixture with compact persisted `m1` and assert it is discarded from the
canonical pair list rather than silently changing the durable format.

- [ ] **Step 3: Run compatibility tests and verify wrapped inputs are unsupported**

Run: `pnpm vitest run tests/compress-search.test.ts tests/compress-range.test.ts tests/compress-message.test.ts tests/persistence.test.ts tests/stable-ids.test.ts`

Expected: wrapped compact compression cases fail before codec integration; v1 canonical round trip
must remain green.

- [ ] **Step 4: Keep persistence validation canonical-only**

Use `isCanonicalMessageRef` when parsing snapshot `byRawId` pairs instead of the permissive boundary
parser. Let compression search continue using `parseBoundaryId`, which accepts all user/model-facing
forms.

- [ ] **Step 5: Run the full compatibility group**

Run: `pnpm vitest run tests/compress-search.test.ts tests/compress-range.test.ts tests/compress-message.test.ts tests/persistence.test.ts tests/stable-ids.test.ts tests/compress-cycle.test.ts`

Expected: PASS; no snapshot migration and no range/message targeting difference across accepted
formats.

- [ ] **Step 6: Commit compatibility coverage**

```bash
git add src/state/persistence.ts tests/compress-search.test.ts tests/compress-range.test.ts tests/compress-message.test.ts tests/persistence.test.ts tests/stable-ids.test.ts
git commit -m "test: preserve legacy DCP ID compatibility"
```

### Task 4: Enforce marker benchmarks and prepare v0.8.0

**Files:**

- Modify: `tests/benchmark.test.ts`
- Modify: `benchmarks/result.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

**Interfaces:**

- Consumes: deterministic workloads from `scripts/benchmark.ts`.
- Produces: a retained benchmark proving compact marker overhead and documented v0.8.0 protocol compatibility.

- [ ] **Step 1: Add deterministic benchmark gates**

In `tests/benchmark.test.ts`, locate workloads by name and assert:

- `clean-2000-messages` output minus input is at most 6,000 estimated tokens, a 70 percent
  reduction from the retained 20,000-token marker overhead;
- `repeated-tool-pairs-2000` reduces at least 89 percent of input tokens;
- `restored-nested-blocks-100` reduces at least 85 percent of input tokens.

- [ ] **Step 2: Run benchmark tests and the retained benchmark**

Run: `pnpm vitest run tests/benchmark.test.ts && pnpm benchmark`

Expected: PASS and a newly generated `benchmarks/result.json` meeting all three gates.

- [ ] **Step 3: Document the compact protocol and compatibility**

Replace XML marker examples with compact markers, document accepted legacy input, and state that
persisted IDs remain padded. Add v0.8.0 release notes and set the package version to `0.8.0`.

- [ ] **Step 4: Run complete verification**

Run: `pnpm check && pnpm run pack:dry-run && git diff --check`

Expected: exit 0; no generated-schema change and no package dependency change.

- [ ] **Step 5: Smoke-test model-visible markers in Pi**

Run one range-mode and one message-mode session. Confirm context contains compact markers, copied
wrapped IDs are accepted by `compress`, resume retains block ownership, and assistant output does
not accumulate marker lines.

- [ ] **Step 6: Commit the release metadata and benchmark**

```bash
git add tests/benchmark.test.ts benchmarks/result.json README.md CHANGELOG.md package.json
git commit -m "chore: prepare pi-dcp 0.8.0"
```
