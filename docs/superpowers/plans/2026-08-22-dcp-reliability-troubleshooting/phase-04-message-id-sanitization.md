# Phase 4: Message-ID Sanitization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove bounded orphan, suffix-only, and transposed DCP message-ID fragments without deleting legitimate prose.

**Architecture:** Extend the ordered string sanitizer with two narrow message-ID rules before lone-tag removal. Keep all existing cleanup boundaries: `message_end` protects persistence, the early pipeline pass cleans restored assistant content before priority calculation, and `injectMessageIds` cleans injectable user/assistant content before adding one canonical tag.

**Tech Stack:** TypeScript regular expressions, Pi 0.84.2 `message_end` and `context` extension semantics, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-dcp-troubleshooting-design.md`. This plan supersedes only the spec's instruction to remove the pipeline-wide assistant pass; the verified current pipeline reads that cleaned content in `buildPriorityMap()` before injection cleanup runs.

## Global Constraints

- Use Node.js 24.15.0 or newer, as required by `package.json`.
- Add no dependency or new sanitizer abstraction.
- Remove only message references matching `m\d{4,}` when followed by a recognized closing tag or by a character outside a Unicode identifier.
- For suffix-only matches, require the `m` token not to be preceded by a Unicode identifier character so payloads such as `claim0001` and `文m0001` remain intact.
- Recognize only `dcp-message-id` and the observed `dpc-message-id` transposition; do not broaden every DCP tag rule to arbitrary `dpc-*` markup.
- Preserve ambiguous prose and identifier-like payloads such as `m0001abc`.
- Keep complete-pair, truncated-pair, lone-tag, and partial-tag behavior.
- Keep stripping idempotent.
- Keep `message_end`, the early pipeline assistant pass, and `injectMessageIds` sanitization boundaries.

---

## Verified Root Cause and Pi Lifecycle

In session `2026-08-23T01-28-17-585Z_01a02c3b-95b1-7c96-8d29-33bcf0999465.jsonl`, DCP persisted `nextRefIndex: 112` immediately before MiniMax-M3 produced:

```text
**Creating the GitHub PR**m0112</dpc-message-id>
```

The model predicted DCP's next sequential reference and transposed `dcp` to `dpc`. The current sanitizer recognizes only `dcp-*`, so the `message_end` handler returned no replacement and Pi persisted the malformed text unchanged.

Pi 0.84.2 establishes the boundary ordering:

- `packages/agent/src/agent-loop.ts` applies `transformContext` only to the messages sent to the model.
- `packages/coding-agent/src/core/extensions/runner.ts` chains `message_end` replacements.
- `packages/coding-agent/src/core/agent-session.ts` installs the replacement into agent state before appending the authoritative message to session history.

Within DCP, the early `stripHallucinations(messages)` pass is not redundant: it runs before `buildPriorityMap(state, messages)`, while `injectMessageIds()` performs its cleanup afterward. Removing the early pass can change message-mode token counts and priority assignments, so this phase leaves it intact.

---

### Task 1: Sanitize bounded malformed message-ID fragments

**Files:**

- Modify: `tests/strip.test.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/pipeline.test.ts`
- Modify: `src/messages/strip.ts`
- Verify unchanged: `src/index.ts`
- Verify unchanged: `src/messages/inject.ts`
- Verify unchanged: `src/pipeline.ts`
- Verify unchanged: `tests/message-end.test.ts`
- Verify unchanged: `tests/inject.test.ts`

**Interfaces:**

- Consumes: `stripHallucinationsFromString(text: string): string`, the registered `message_end` handler, and `runPipeline()`.
- Produces: bounded cleanup shared by persistence and model-context sanitization without changing handler or pipeline interfaces.

- [ ] **Step 1: Add focused string regressions**

Add inside `describe("stripHallucinationsFromString")` in `tests/strip.test.ts`:

```typescript
it("removes the observed transposed message-id suffix", () => {
  expect(
    stripHallucinationsFromString(
      "**Creating the GitHub PR**m0112</dpc-message-id>",
    ),
  ).toBe("**Creating the GitHub PR**");
});

it("removes bounded message-id suffixes and transposed pairs", () => {
  expect(stripHallucinationsFromString("hello m0001</dcp-message-id>")).toBe(
    "hello ",
  );
  expect(
    stripHallucinationsFromString(
      "hello <dpc-message-id>m0002</dpc-message-id>",
    ),
  ).toBe("hello ");
});

it("removes an orphan message-id opening tag and its bounded reference", () => {
  expect(stripHallucinationsFromString("hello <dcp-message-id>m0001")).toBe(
    "hello ",
  );
  expect(stripHallucinationsFromString("hello <dpc-message-id>m0002")).toBe(
    "hello ",
  );
});

it("preserves prose after an orphan message reference", () => {
  expect(
    stripHallucinationsFromString(
      "hello <dcp-message-id>m0001 continued prose",
    ),
  ).toBe("hello  continued prose");
});

it("preserves ambiguous message-like payloads", () => {
  expect(
    stripHallucinationsFromString("hello <dcp-message-id>discussion"),
  ).toBe("hello discussion");
  expect(stripHallucinationsFromString("hello <dcp-message-id>m0001abc")).toBe(
    "hello m0001abc",
  );
});

it("is idempotent for malformed message references", () => {
  const once = stripHallucinationsFromString(
    "hello <dcp-message-id>m0001 prose m0002</dpc-message-id>",
  );
  expect(stripHallucinationsFromString(once)).toBe(once);
});
```

- [ ] **Step 2: Add the registered `message_end` boundary regression**

Add this import to `tests/index.test.ts`:

```typescript
import { makeAssistantMessage } from "./helpers.ts";
```

Add inside `describe("dcp extension")`:

```typescript
it("message_end strips the observed transposed message-id suffix", async () => {
  const { api, handlers } = createMockApi();
  createExtension(api);

  const handler = handlers.get("message_end")?.[0];
  expect(handler).toBeDefined();

  const result = await (handler as (...args: unknown[]) => Promise<unknown>)(
    {
      type: "message_end",
      message: makeAssistantMessage(
        "**Creating the GitHub PR**m0112</dpc-message-id>",
      ),
    },
    {},
  );

  expect(result).toBeDefined();
  const message = (
    result as { message: { content: Array<{ type: string; text?: string }> } }
  ).message;
  expect(message.content[0]?.text).toBe("**Creating the GitHub PR**");
});
```

This exercises the actual handler registered in `src/index.ts`; do not add another manual `mapText()` case to `tests/message-end.test.ts`.

- [ ] **Step 3: Add the restored-context pipeline regression**

Replace the existing pipeline hallucination test in `tests/pipeline.test.ts` with:

```typescript
it("sanitizes a persisted transposed message-id suffix before canonical injection", () => {
  const state = createSessionState();
  const config = makeDefaultConfig();
  const messages: AgentMessage[] = [
    makeUserMessage("Hello"),
    makeAssistantMessage("**Creating the GitHub PR**m0112</dpc-message-id>"),
  ];

  const result = runPipeline(state, config, messages, undefined);
  const text = extractMessageText(result.messages[1]);

  expect(text).toContain("**Creating the GitHub PR**");
  expect(text).not.toContain("m0112");
  expect(text).not.toContain("dpc-message-id");
  expect(text.match(/<dcp-message-id/g)).toHaveLength(1);
  expect(text).toContain("m0002");
});
```

Keep the `extractMessageText` import already present in `tests/pipeline.test.ts`.

- [ ] **Step 4: Run the focused tests and verify failure**

Run:

```bash
pnpm vitest run tests/strip.test.ts tests/index.test.ts tests/pipeline.test.ts
```

Expected: FAIL on the new suffix, transposed-pair, orphan-reference, registered-handler, and pipeline assertions because the current sanitizer leaves IDs or `dpc-message-id` markup behind. The ambiguous-payload preservation assertions may already pass.

- [ ] **Step 5: Add the two ordered bounded rules**

In `src/messages/strip.ts`, add after `DCP_TRUNCATED_PAIR`:

```typescript
// 3. Bounded message-ID suffixes or pairs, including the observed dpc transposition.
const DCP_MESSAGE_ID_SUFFIX_OR_PAIR =
  /(?:<(?:dcp|dpc)-message-id(?:\s[^>]*)?>)?(?<!\p{ID_Continue})m\d{4,}<\/(?:dcp|dpc)-message-id>/giu;
// 4. Orphan message-ID opening tag followed by a valid bounded reference.
const DCP_ORPHANED_MESSAGE_ID =
  /<(?:dcp|dpc)-message-id(?:\s[^>]*)?>m\d{4,}(?!\p{ID_Continue})/giu;
```

Renumber the comments for `DCP_UNPAIRED_TAG` and `DCP_PARTIAL_TAG`, then update the replacement chain to:

```typescript
return text
  .replace(DCP_COMPLETE_PAIR, "")
  .replace(DCP_TRUNCATED_PAIR, "")
  .replace(DCP_MESSAGE_ID_SUFFIX_OR_PAIR, "")
  .replace(DCP_ORPHANED_MESSAGE_ID, "")
  .replace(DCP_UNPAIRED_TAG, "")
  .replace(DCP_PARTIAL_TAG, "");
```

Update the function comment to describe this exact order. Do not change the generic DCP expressions to match arbitrary `dpc-*` tags.

- [ ] **Step 6: Run the sanitizer and boundary tests**

Run:

```bash
pnpm vitest run tests/strip.test.ts tests/message-end.test.ts tests/index.test.ts tests/inject.test.ts tests/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 7: Verify the supported runtime and full repository**

Run:

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) { console.error(`Node >=24.15.0 required, found ${process.versions.node}`); process.exit(1); }'
pnpm check
git diff --check
```

Expected: the runtime guard exits successfully, formatting/lint/typecheck/full tests pass, and `git diff --check` reports no whitespace errors.

- [ ] **Step 8: Review the final scope**

Run:

```bash
git diff --stat
git diff -- src/messages/strip.ts tests/strip.test.ts tests/index.test.ts tests/pipeline.test.ts
```

Expected: production changes are limited to `src/messages/strip.ts`; `src/index.ts`, `src/messages/inject.ts`, and `src/pipeline.ts` remain unchanged.

- [ ] **Step 9: Commit Phase 4**

```bash
git add src/messages/strip.ts tests/strip.test.ts tests/index.test.ts tests/pipeline.test.ts
git commit -m "fix: sanitize malformed dcp message references"
```
