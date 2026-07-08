# Phase 4: Accurate Token Counting

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `Math.round(text.length / 4)` heuristic in `countTokens()` with the Anthropic tokenizer for accurate per-message token counts. Keep a fallback to the heuristic if the tokenizer throws.

**Architecture:** Add `@anthropic-ai/tokenizer` as a runtime dependency. Apply a surgical edit to `src/utils/tokens.ts`: add the import and replace the `countTokens` function body. The rest of the file (`countTokensBatch`, `extractMessageText`, `countMessageTokens`) is unchanged. The public API stays the same — all callers continue working.

**ESM/CJS compatibility:** `@anthropic-ai/tokenizer@0.0.4` is CJS-only (`"type": "commonjs"`). Pi-dcp is ESM (`"type": "module"`, `"module": "node16"`). Use the `import * as` + nullish coalescing pattern (proven in opencode-dynamic-context-pruning) to handle both named-export and default-export CJS interop.

**Tech Stack:** TypeScript, Vitest, @anthropic-ai/tokenizer

---

### Task 1: Add dependency

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install @anthropic-ai/tokenizer**

Run:

```bash
pnpm add @anthropic-ai/tokenizer
```

Expected: `package.json` now has `@anthropic-ai/tokenizer` in `dependencies`.

- [ ] **Step 2: Verify it installed**

Run: `pnpm ls @anthropic-ai/tokenizer`
Expected: Shows the installed version (0.0.4).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "deps: add @anthropic-ai/tokenizer for accurate token counting"
```

---

### Task 2: Implement accurate token counting

**Files:**

- Modify: `src/utils/tokens.ts` (surgical edit — only the import and `countTokens` function change)

- [ ] **Step 1: Add the import with ESM/CJS compatibility shim**

Add at the top of `src/utils/tokens.ts`, before the existing JSDoc comment:

```ts
import * as _anthropicTokenizer from "@anthropic-ai/tokenizer";
const anthropicCountTokens = (_anthropicTokenizer.countTokens ??
  (_anthropicTokenizer as any).default
    ?.countTokens) as typeof _anthropicTokenizer.countTokens;
```

This handles both CJS interop paths: Node may expose named exports directly, or bundle everything under `.default`.

- [ ] **Step 2: Replace the `countTokens` function**

Replace the existing JSDoc + `countTokens` function (lines 1–12 of the current file):

```ts
/**
 * Token counting using character-based estimation.
 *
 * Uses length/4 as a rough approximation. Pi's built-in ctx.getContextUsage()
 * provides accurate context-level token counts for threshold decisions. These
 * per-message estimates are for relative comparisons (compression savings,
 * priority ranking).
 */
export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.round(text.length / 4));
}
```

With:

```ts
/**
 * Count tokens using the Anthropic tokenizer (Claude's vocabulary).
 * Falls back to character-based estimation (length/4) if the tokenizer
 * throws (e.g., invalid input or WASM initialization failure).
 */
export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  try {
    return anthropicCountTokens(text);
  } catch {
    return Math.max(1, Math.round(text.length / 4));
  }
}
```

Everything below (`countTokensBatch`, `extractMessageText`, `countMessageTokens`) stays exactly as-is.

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: No type errors. The import shim uses `as any` for the `.default` path, and the rest of the types are preserved.

---

### Task 3: Update tests

**Files:**

- Modify: `tests/tokens.test.ts` (file already exists — add new assertions, keep existing ones)

The existing test file has 5 describe blocks covering basic behavior. Add one new test to the existing `countTokens` describe block to verify the tokenizer produces different results than the heuristic.

- [ ] **Step 1: Add tokenizer-vs-heuristic assertion**

Inside the existing `describe("countTokens", ...)` block (inside `describe("tokens", ...)`), add a new `it` after the existing tests:

```ts
it("uses tokenizer (not heuristic) for non-trivial text", () => {
  const text = "The quick brown fox jumps over the lazy dog. ".repeat(10);
  const result = countTokens(text);
  const heuristic = Math.round(text.length / 4);
  // 450 chars → heuristic = 113. The Anthropic tokenizer will differ.
  expect(result).not.toBe(heuristic);
  expect(result).toBeGreaterThan(0);
});
```

This test fails before the implementation change (since `countTokens` IS the heuristic) and passes after. Short strings are avoided because the tokenizer and heuristic can coincidentally agree.

- [ ] **Step 2: Run tests to verify the new assertion passes**

Run: `pnpm vitest run tests/tokens.test.ts`
Expected: All tests pass — existing tests are behavior-compatible (they assert `> 0` and scaling, which the tokenizer satisfies), and the new test confirms tokenizer divergence from heuristic.

---

### Task 4: Full verification and commit

- [ ] **Step 1: Run full check**

Run: `pnpm check`
Expected: Lint, typecheck, and all tests pass (including all existing test files — no regressions).

- [ ] **Step 2: Commit**

```bash
git add src/utils/tokens.ts tests/tokens.test.ts
git commit -m "feat: use Anthropic tokenizer for accurate token counting"
```

---

### Design notes

**Why no fallback test?** The previous plan proposed a `vi.doMock` + dynamic re-import test to verify the `catch` branch. This is unreliable in ESM (module caching means re-importing may return the already-evaluated module) and the pattern isn't used anywhere else in this codebase. The fallback is a 1-line `Math.max(1, Math.round(text.length / 4))` inside a `catch` — if the tokenizer works (verified by the tokenizer-vs-heuristic test), the happy path is covered. The catch branch is simple enough that testing it provides marginal value vs. the complexity of making ESM mocking work reliably.

**Why `import * as` instead of `import { countTokens }`?** `@anthropic-ai/tokenizer@0.0.4` ships CJS-only. With Node's ESM/CJS interop, named exports from CJS packages aren't guaranteed. The `import * as` + `??` default fallback pattern is proven in the opencode-dynamic-context-pruning codebase (same tokenizer, same interop challenge).

**What pi (the host) does differently:** Pi itself uses only `chars / 4` estimation with no tokenizer library — it relies on provider-reported `Usage.totalTokens` for accurate counts. Pi-dcp needs per-message estimates for pruning decisions where provider-reported totals aren't available, so the tokenizer adds genuine value here.
