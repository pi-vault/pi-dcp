# Phase 3: Native Glob Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the limited hand-written glob compiler with Node's native POSIX glob matcher so every protected tool and file pattern supports character classes while preserving the existing slash-based contract.

**Architecture:** Keep the public `matchesGlob()` wrapper and delegate it to `node:path.posix.matchesGlob`. The wrapper converts matcher errors into a non-match so malformed configuration cannot abort a context pass. Route all protected-tool consumers through `isToolNameProtected()`, and keep protected-file checks in the shared matcher path. Update the schema and README to state the native POSIX contract.

**Tech Stack:** TypeScript ESM, Node.js >=24.15.0 `path.posix.matchesGlob`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-dcp-troubleshooting-design.md`

## Global Constraints

- Add no dependency.
- Require Node.js >=24.15.0 for implementation and verification; do not treat the current Node 23 runtime as supported evidence.
- Preserve existing exact, `*`, `**`, `?`, and `/` separator behavior. Use `path.posix.matchesGlob` so behavior does not change with the host OS; backslashes remain literal path text.
- Malformed string patterns must return a non-match rather than crash the context pipeline.
- Evaluate every configured pattern, including exact strings and patterns without `*` or `?`.
- Apply the contract consistently to deduplication, failed-input purging, compression-summary preservation, `dcp:sweep`, and protected file paths.
- Treat broader native syntax as an intentional configuration contract change.

---

### Task 1: Lock down native behavior with failing tests

**Files:**

- Modify: `tests/protected-content.test.ts`
- Modify: `tests/protected-patterns.test.ts`
- Modify: `tests/strategy-runner.test.ts`

**Interfaces:**

- Consumes: `matchesGlob()`, `isToolNameProtected()`, `isFilePathProtected()`, `appendProtectedToolOutputs()`, and `sweepAll()`.
- Produces: regression coverage for native character classes, literal regex punctuation, malformed patterns, POSIX separator behavior, compression protected-tool patterns, sweep protected-tool patterns, and sweep protected-file patterns.

- [ ] **Step 1: Verify the supported runtime before running red tests**

Run:

```bash
node --version
```

Continue only when the version is `>=24.15.0`. The repository's `package.json` already declares this engine requirement.

- [ ] **Step 2: Add matcher and consumer tests**

Add inside `describe("matchesGlob")`:

```typescript
it("matches character classes using Node glob semantics", () => {
  expect(matchesGlob("testa.ts", "test[abc].ts")).toBe(true);
  expect(matchesGlob("testz.ts", "test[abc].ts")).toBe(false);
  expect(matchesGlob("file7.ts", "file[0-9].ts")).toBe(true);
});

it("preserves slash separators independently of the host OS", () => {
  expect(matchesGlob("src/config.ts", "src/**/*.ts")).toBe(true);
  expect(matchesGlob("src\\config.ts", "src/**/*.ts")).toBe(false);
});

it("preserves regex punctuation as literal path text", () => {
  expect(matchesGlob("src/a+b.ts", "src/a+b.ts")).toBe(true);
  expect(matchesGlob("src/ab.ts", "src/a+b.ts")).toBe(false);
});

it("returns false for malformed patterns", () => {
  expect(matchesGlob("testa.ts", "test[abc.ts")).toBe(false);
  expect(matchesGlob("foo", "[")).toBe(false);
});
```

Add inside `describe("isToolNameProtected")`:

```typescript
it("evaluates character-class patterns without star or question mark", () => {
  expect(isToolNameProtected("read", ["r[ea]ad"])).toBe(true);
  expect(isToolNameProtected("write", ["r[ea]ad"])).toBe(false);
});
```

Add a character-class case to `describe("isFilePathProtected")`, such as `src/[ab].ts` matching `src/a.ts`.

Add to `tests/protected-content.test.ts`:

- a protected tool output matched by a class or wildcard pattern, proving compression summaries no longer use literal-only membership;
- the existing exact-match and error-result behavior unchanged.

Add to `tests/strategy-runner.test.ts` under `describe("sweepAll")`:

- a `config.compress.protectedTools` class/wildcard pattern that protects the matching tool while an unrelated completed tool is pruned;
- a `config.protectedFilePatterns` pattern that protects a completed tool whose parameters contain a matching `filePath`.

- [ ] **Step 3: Run the focused tests and verify they fail for the intended current reasons**

Run:

```bash
pnpm vitest run tests/protected-patterns.test.ts tests/protected-content.test.ts tests/strategy-runner.test.ts
```

Expected red failures:

- character-class matching and class-based tool/file protection;
- compression protected-tool patterns;
- `sweepAll` protected-tool patterns;
- `sweepAll` protected-file patterns.

The malformed-pattern tests may already pass against the current compiler; they remain required to lock down the safety contract.

### Task 2: Replace the compiler and route every consumer through it

**Files:**

- Modify: `src/compress/protected-content.ts`
- Modify: `src/strategies/protected-patterns.ts`
- Modify: `src/strategies/runner.ts`

**Interfaces:**

- Consumes: Node's `posix.matchesGlob(path: string, pattern: string): boolean`.
- Produces: the existing exported `matchesGlob(input, pattern)` wrapper and consistent protected-pattern behavior across all pruning/preservation paths.

- [ ] **Step 1: Replace the custom compiler with the POSIX native matcher**

In `src/strategies/protected-patterns.ts`:

```typescript
import { posix } from "node:path";
```

Delete `globToRegex()`, keep the exported wrapper, and make native errors safe:

```typescript
export function matchesGlob(input: string, pattern: string): boolean {
  try {
    return posix.matchesGlob(input, pattern);
  } catch {
    return false;
  }
}
```

- Replace `isToolNameProtected()` with a `.some()` over every configured pattern.
- Leave `isFilePathProtected()` on the shared `matchesGlob()` wrapper.

Do not use host-dependent `path.matchesGlob` or add path normalization in this helper. Pi's reference implementation uses `path.posix.matchesGlob` for stable slash semantics; its extra relative-path fallback is specific to Pi's guest `find` implementation and does not belong here.

- [ ] **Step 2: Route compression-summary preservation through the shared matcher**

In `src/compress/protected-content.ts`, import `isToolNameProtected()` and replace `protectedTools.includes(msg.toolName)` with the shared predicate. Keep the existing error-result exclusion and output formatting unchanged.

- [ ] **Step 3: Route `dcp:sweep` through the shared tool and file predicates**

In `src/strategies/runner.ts`:

- replace the `Set` membership check in `sweepAll()` with `isToolNameProtected(entry.tool, protectedTools)`;
- retain `BASE_PROTECTED_TOOLS` and `config.compress.protectedTools` as the inputs to that predicate;
- use `getFilePathsFromParameters()` and `isFilePathProtected()` before pruning so `protectedFilePatterns` keeps its documented “never pruned” contract during sweep;
- preserve status, turn-protection, statistics, and token-counter behavior.

- [ ] **Step 4: Run the focused tests green**

Run:

```bash
pnpm vitest run tests/protected-patterns.test.ts tests/protected-content.test.ts tests/strategy-runner.test.ts
```

Expected: all focused tests pass, including the new class, malformed-pattern, compression, sweep-tool, and sweep-file cases.

### Task 3: Publish the explicit configuration contract

**Files:**

- Regenerate: `dcp.schema.json`
- Modify: `src/config-schema.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: protected tool and file pattern descriptions.
- Produces: a consistent public contract that identifies Node POSIX glob semantics.

- [ ] **Step 1: Update schema descriptions**

Use these exact descriptions in `src/config-schema.ts`:

```typescript
"Tool names excluded from deduplication (Node path.posix.matchesGlob patterns)";
"Tool names excluded from failed-input purging (Node path.posix.matchesGlob patterns)";
"Tool outputs to preserve during compression (Node path.posix.matchesGlob patterns)";
"Node path.posix.matchesGlob patterns for file paths to protect from pruning";
```

- [ ] **Step 2: Update README configuration text**

After the `protectedFilePatterns` bullet, add:

```markdown
Protected tool and file patterns use Node's `path.posix.matchesGlob` semantics: `/` is the path separator, and supported patterns include `*`, `**`, `?`, and character classes such as `[abc]` and `[0-9]`.
```

Describe all three protected-tool settings consistently:

- `compress.protectedTools` — Node glob patterns for tool outputs preserved during compression.
- `deduplication.protectedTools` — Node glob patterns for tool names excluded from deduplication.
- `purgeErrors.protectedTools` — Node glob patterns for tool names excluded from failed-input purging.

Do not duplicate the syntax list in each bullet.

- [ ] **Step 3: Regenerate and inspect the tracked schema**

Run:

```bash
pnpm run generate:schema
git diff -- dcp.schema.json
```

The schema diff must contain only the four protected-pattern description changes. Keep `dcp.schema.json` in the feature change; its tracked history already updates it with `src/config-schema.ts` changes.

### Task 4: Verify the complete change

- [ ] **Step 1: Run repository checks on the supported Node runtime**

Run:

```bash
pnpm check
pnpm run pack:verify
git diff --check
```

Expected: all checks pass, package verification succeeds, and no generated or whitespace-only changes remain outside the intended files.

- [ ] **Step 2: Review the final diff**

Confirm the diff is limited to:

```text
src/strategies/protected-patterns.ts
src/compress/protected-content.ts
src/strategies/runner.ts
tests/protected-patterns.test.ts
tests/protected-content.test.ts
tests/strategy-runner.test.ts
src/config-schema.ts
README.md
dcp.schema.json
```

Confirm no dependency, fallback glob compiler, host-dependent matcher, or unrelated sweep behavior was added.

- [ ] **Step 3: Commit Phase 3**

```bash
git add src/strategies/protected-patterns.ts src/compress/protected-content.ts src/strategies/runner.ts tests/protected-patterns.test.ts tests/protected-content.test.ts tests/strategy-runner.test.ts src/config-schema.ts README.md dcp.schema.json
git commit -m "feat: use native glob matching for protected patterns"
```
