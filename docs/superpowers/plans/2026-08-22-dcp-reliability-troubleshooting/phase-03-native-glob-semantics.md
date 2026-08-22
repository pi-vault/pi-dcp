# Phase 3: Native Glob Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the limited hand-written glob compiler with Node 24 native matching so protected patterns support character classes and retain existing wildcard behavior.

**Architecture:** Delegate matching to `node:path.matchesGlob` and route every tool pattern through it. Keep the public `matchesGlob()` wrapper so callers and tests remain stable; update schema and README to state the native contract.

**Tech Stack:** TypeScript ESM, Node.js >=24.15.0 `path.matchesGlob`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-dcp-troubleshooting-design.md`

## Global Constraints

- Add no dependency.
- Preserve existing exact, `*`, `**`, `?`, and slash behavior.
- Malformed string patterns must return a non-match rather than crash the context pipeline.
- Treat broader native syntax as an intentional configuration contract change.

---

### Task 1: Lock down native behavior with failing tests

**Files:**
- Modify: `tests/protected-patterns.test.ts`

**Interfaces:**
- Consumes: `matchesGlob()`, `isToolNameProtected()`, and `isFilePathProtected()`.
- Produces: tests for character classes, literal regex characters, malformed patterns, and tool patterns without `*` or `?`.

- [ ] **Step 1: Add character-class and safety tests**

Add inside `describe("matchesGlob")`:

```typescript
it("matches character classes using Node glob semantics", () => {
  expect(matchesGlob("testa.ts", "test[abc].ts")).toBe(true);
  expect(matchesGlob("testz.ts", "test[abc].ts")).toBe(false);
  expect(matchesGlob("file7.ts", "file[0-9].ts")).toBe(true);
});

it("preserves regex punctuation as literal path text", () => {
  expect(matchesGlob("src/a+b.ts", "src/a+b.ts")).toBe(true);
  expect(matchesGlob("src/ab.ts", "src/a+b.ts")).toBe(false);
});

it("returns false for malformed character classes", () => {
  expect(matchesGlob("testa.ts", "test[abc.ts")).toBe(false);
  expect(matchesGlob("foo", "[")).toBe(false);
});
```

Add inside `describe("isToolNameProtected")`:

```typescript
it("evaluates character-class patterns without star or question mark", () => {
  expect(isToolNameProtected("read", ["r[ea]ad", "r[ea][ad]"])).toBe(true);
  expect(isToolNameProtected("write", ["r[ea][ad]"])).toBe(false);
});
```

- [ ] **Step 2: Run the tests and verify current limitations**

Run:

```bash
pnpm vitest run tests/protected-patterns.test.ts
```

Expected: FAIL on character-class matching and `isToolNameProtected` class evaluation.

### Task 2: Replace the custom compiler with the standard library

**Files:**
- Modify: `src/strategies/protected-patterns.ts`

**Interfaces:**
- Consumes: Node's `matchesGlob(path: string, pattern: string): boolean`.
- Produces: existing exported `matchesGlob(input, pattern)` wrapper.

- [ ] **Step 1: Replace `globToRegex`**

At the top of `src/strategies/protected-patterns.ts`, add:

```typescript
import { matchesGlob as matchesPathGlob } from "node:path";
```

Replace the current `matchesGlob()` and delete `globToRegex()`:

```typescript
export function matchesGlob(input: string, pattern: string): boolean {
  return matchesPathGlob(input, pattern);
}
```

- [ ] **Step 2: Route every tool pattern through the matcher**

Replace `isToolNameProtected()` with:

```typescript
export function isToolNameProtected(toolName: string, protectedPatterns: string[]): boolean {
  return protectedPatterns.some((pattern) => matchesGlob(toolName, pattern));
}
```

Exact strings continue to work under native matching; no special branch is needed.

- [ ] **Step 3: Run focused tests**

Run:

```bash
pnpm vitest run tests/protected-patterns.test.ts
```

Expected: PASS.

### Task 3: Publish the explicit configuration contract

**Files:**
- Modify: `src/config-schema.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: protected tool and file pattern descriptions.
- Produces: documentation that patterns follow Node native glob semantics.

- [ ] **Step 1: Update schema descriptions**

Use these exact descriptions in `src/config-schema.ts`:

```typescript
"Tool names excluded from deduplication (Node path.matchesGlob patterns)"
"Tool names excluded from failed-input purging (Node path.matchesGlob patterns)"
"Tool outputs to preserve during compression (Node path.matchesGlob patterns)"
"Node path.matchesGlob patterns for file paths to protect from pruning"
```

- [ ] **Step 2: Update README configuration text**

After the `protectedFilePatterns` bullet, add:

```markdown
Protected tool and file patterns use Node's `path.matchesGlob` semantics, including `*`, `**`, `?`, and character classes such as `[abc]` and `[0-9]`.
```

Change each protected-tool bullet that says only “tool names” to say “Node glob patterns for tool names” without duplicating the syntax list.

- [ ] **Step 3: Run focused and schema checks**

Run:

```bash
pnpm vitest run tests/protected-patterns.test.ts
pnpm typecheck
pnpm exec tsx scripts/generate-schema.ts > /tmp/pi-dcp-schema.json
diff -u dcp.schema.json /tmp/pi-dcp-schema.json || true
```

Review the schema diff. If repository policy expects generated schema changes in feature commits, regenerate with:

```bash
pnpm run generate:schema
```

Then run:

```bash
pnpm format:check
pnpm lint
git diff --check
```

Expected: all checks PASS. Any generated schema diff must contain only the four description changes.

- [ ] **Step 4: Commit Phase 3**

```bash
git add src/strategies/protected-patterns.ts tests/protected-patterns.test.ts src/config-schema.ts README.md dcp.schema.json
git commit -m "feat: use native glob matching for protected patterns"
```

If `dcp.schema.json` is unchanged, omit it from `git add`.
