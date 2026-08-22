# Phase 4: Message-ID Sanitization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove bounded orphan DCP message IDs without deleting legitimate prose and eliminate one redundant context-wide strip pass.

**Architecture:** Extend the ordered sanitizer with a narrow orphan-message-ID rule before lone-tag removal. Keep `message_end` as the persistence boundary and `injectMessageIds` as the model-context boundary; remove only the earlier pipeline-wide assistant cleanup.

**Tech Stack:** TypeScript regular expressions, Pi `message_end` and `context` extension semantics, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-dcp-troubleshooting-design.md`

## Global Constraints

- Preserve ambiguous prose instead of consuming the remainder of a line or string.
- Consume only IDs matching `m\d{4,}` after an orphan `<dcp-message-id...>` opening tag.
- Keep complete-pair, truncated-pair, lone-tag, and partial-tag behavior.
- Keep stripping idempotent.
- Keep `message_end` and `injectMessageIds` sanitization boundaries.

---

### Task 1: Specify orphan-ID behavior

**Files:**
- Modify: `tests/strip.test.ts`
- Modify: `tests/message-end.test.ts`

**Interfaces:**
- Consumes: `stripHallucinationsFromString()` and `mapText()`.
- Produces: bounded orphan-ID behavior shared by persistence and context sanitization.

- [ ] **Step 1: Add focused string cases**

Add inside `describe("stripHallucinationsFromString")` in `tests/strip.test.ts`:

```typescript
it("removes an orphan message-id tag and its bounded reference", () => {
  expect(stripHallucinationsFromString("hello <dcp-message-id>m0001")).toBe("hello ");
});

it("preserves prose after an orphan message reference", () => {
  expect(
    stripHallucinationsFromString("hello <dcp-message-id>m0001 continued prose"),
  ).toBe("hello  continued prose");
});

it("preserves non-reference payload after an orphan opening tag", () => {
  expect(stripHallucinationsFromString("hello <dcp-message-id>discussion"))
    .toBe("hello discussion");
});

it("removes adjacent orphan message references", () => {
  expect(
    stripHallucinationsFromString(
      "<dcp-message-id>m0001<dcp-message-id priority=\"2\">m0002",
    ),
  ).toBe("");
});

it("is idempotent for orphan message references", () => {
  const once = stripHallucinationsFromString("hello <dcp-message-id>m0001 prose");
  expect(stripHallucinationsFromString(once)).toBe(once);
});
```

- [ ] **Step 2: Add a `message_end` persistence-boundary case**

Add to `tests/message-end.test.ts`:

```typescript
it("removes an orphan message reference before persistence", () => {
  const msg = makeAssistantMessage("Result <dcp-message-id>m0093 followed by prose");

  const stripped = mapText(msg, stripHallucinationsFromString);
  const textPart = (stripped as unknown as { content: Array<{ text: string }> }).content[0];

  expect(textPart.text).toBe("Result  followed by prose");
});
```

- [ ] **Step 3: Run the focused tests and verify failure**

Run:

```bash
pnpm vitest run tests/strip.test.ts tests/message-end.test.ts
```

Expected: FAIL because `m0001`/`m0093` survive after the opening tag is removed.

### Task 2: Add the bounded orphan rule

**Files:**
- Modify: `src/messages/strip.ts`

**Interfaces:**
- Consumes: text containing DCP markup.
- Produces: the existing `stripHallucinationsFromString(text: string): string` contract with bounded orphan-ID removal.

- [ ] **Step 1: Add the ordered expression**

After `DCP_TRUNCATED_PAIR`, add:

```typescript
// 3. Orphan message-ID opening tag followed by a valid bounded reference.
const DCP_ORPHANED_MESSAGE_ID = /<dcp-message-id(?:\s[^>]*)?>m\d{4,}/gi;
```

Renumber the comments for `DCP_UNPAIRED_TAG` and `DCP_PARTIAL_TAG`.

- [ ] **Step 2: Apply it before lone-tag removal**

Update the replacement chain:

```typescript
return text
  .replace(DCP_COMPLETE_PAIR, "")
  .replace(DCP_TRUNCATED_PAIR, "")
  .replace(DCP_ORPHANED_MESSAGE_ID, "")
  .replace(DCP_UNPAIRED_TAG, "")
  .replace(DCP_PARTIAL_TAG, "");
```

Update the function comment to name orphan message references in the order description.

- [ ] **Step 3: Run sanitizer tests**

Run:

```bash
pnpm vitest run tests/strip.test.ts tests/message-end.test.ts tests/inject.test.ts
```

Expected: PASS.

### Task 3: Remove only the redundant pipeline pass

**Files:**
- Modify: `src/pipeline.ts`
- Modify: `tests/pipeline.test.ts`
- Verify: `tests/inject.test.ts`

**Interfaces:**
- Consumes: `injectMessageIds()`, which still cleans existing tags before canonical injection.
- Produces: `runPipeline()` without a separate pre-injection assistant strip.

- [ ] **Step 1: Add a pipeline boundary regression**

Replace the current pipeline hallucination test input with an orphan reference and strengthen the assertion:

```typescript
it("sanitizes orphan DCP refs at the injection boundary", () => {
  const state = createSessionState();
  const config = makeDefaultConfig();
  const messages = [
    makeUserMessage("Hello"),
    makeAssistantMessage("Response <dcp-message-id>m0099 followed by prose"),
  ];

  const result = runPipeline(state, config, messages, undefined);
  const text = extractMessageText(result.messages[1]);

  expect(text).toContain("Response  followed by prose");
  expect(text).not.toContain("m0099");
  expect(text.match(/<dcp-message-id/g)).toHaveLength(1);
  expect(text).toContain("m0002");
});
```

Use the existing `extractMessageText` import already present in `tests/pipeline.test.ts`.

- [ ] **Step 2: Run the boundary regression before refactoring**

Run:

```bash
pnpm vitest run tests/pipeline.test.ts -t "sanitizes orphan DCP refs"
```

Expected: PASS after Task 2, establishing the behavior before removing the pass.

- [ ] **Step 3: Remove pipeline-wide stripping**

Delete this import from `src/pipeline.ts`:

```typescript
import { stripHallucinations } from "./messages/strip.ts";
```

Replace:

```typescript
let result = stripHallucinations(messages);
```

with:

```typescript
let result = messages;
```

Update the Step 0 comment to:

```typescript
// Step 0: Rebuild stable refs before state rehydration.
```

Do not remove `stripHallucinationsFromString` from `src/messages/inject.ts` or `src/index.ts`.

- [ ] **Step 4: Run all sanitization and pipeline tests**

Run:

```bash
pnpm vitest run tests/strip.test.ts tests/message-end.test.ts tests/inject.test.ts tests/pipeline.test.ts
pnpm typecheck
git diff --check
```

Expected: all PASS.

- [ ] **Step 5: Commit Phase 4**

```bash
git add src/messages/strip.ts src/pipeline.ts tests/strip.test.ts tests/message-end.test.ts tests/pipeline.test.ts
git commit -m "fix: strip orphan dcp message references safely"
```

`tests/inject.test.ts` is verification-only unless implementation requires a justified assertion update.
