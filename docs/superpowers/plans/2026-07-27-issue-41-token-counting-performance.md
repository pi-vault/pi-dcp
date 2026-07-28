# Issue 41 token-counting performance implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the long-session CPU spike and TUI stalls caused by repeated Anthropic tokenizer initialization.

**Architecture:** Restore the provider-neutral `text.length / 4` estimator used in pi-dcp 0.3.0 while preserving the existing token utility API and context pipeline. Remove the tokenizer dependency, update deterministic tests, and verify the original 50-result reproduction outside CI.

**Tech Stack:** TypeScript, Node.js 24, pnpm, Vitest, Biome

**Design spec:** `docs/superpowers/specs/2026-07-27-issue-41-token-counting-performance-design.md`

---

## File map

- Modify `src/utils/tokens.ts`: provide lightweight per-message token estimates.
- Modify `tests/tokens.test.ts`: lock the estimator behavior with deterministic assertions.
- Modify `tests/tool-cache.test.ts`: update the cached tool-result estimate.
- Modify `package.json`: remove the unused Anthropic tokenizer dependency.
- Modify `pnpm-lock.yaml`: remove the tokenizer and its transitive packages.
- Modify `CHANGELOG.md`: document the user-visible performance fix.

Do not change `src/pipeline.ts`, `src/state/tool-cache.ts`, configuration files, or public APIs.

### Task 1: Restore lightweight token estimation

**Files:**
- Modify: `tests/tokens.test.ts:27-34`
- Modify: `tests/tool-cache.test.ts:96-98`
- Modify: `src/utils/tokens.ts:1-15`

- [ ] **Step 1: Change the token tests to require the heuristic**

Replace the tokenizer-specific test in `tests/tokens.test.ts` with:

```ts
it("uses character-based estimation for non-trivial text", () => {
  const text = "The quick brown fox jumps over the lazy dog. ".repeat(10);
  expect(countTokens(text)).toBe(Math.round(text.length / 4));
});
```

Replace the assertion and comment in the `populates tokenCount from toolResult message content` test in `tests/tool-cache.test.ts` with:

```ts
const entry = state.toolParameters.get("call1")!;
// "a".repeat(400) uses the length/4 estimate.
expect(entry.tokenCount).toBe(100);
```

- [ ] **Step 2: Run the focused tests and confirm the regression tests fail**

Run:

```bash
pnpm exec vitest run tests/tokens.test.ts tests/tool-cache.test.ts
```

Expected: two failures. The current tokenizer returns `101` instead of `113` for the 450-character text and `25` instead of `100` for 400 repeated `a` characters.

- [ ] **Step 3: Replace the tokenizer implementation with the estimator**

Replace the import, comment, and `countTokens` function at the top of `src/utils/tokens.ts` with:

```ts
/**
 * Estimate per-message tokens from text length.
 *
 * Pi's ctx.getContextUsage() supplies accurate context-level counts for
 * threshold decisions. These estimates support pruning and compression stats.
 */
export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.round(text.length / 4));
}
```

Leave `countTokensBatch`, `extractMessageText`, and `countMessageTokens` unchanged.

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run:

```bash
pnpm exec vitest run tests/tokens.test.ts tests/tool-cache.test.ts
```

Expected: both test files pass with no failures.

- [ ] **Step 5: Commit the estimator and regression tests**

```bash
git add src/utils/tokens.ts tests/tokens.test.ts tests/tool-cache.test.ts
git commit -m "fix: restore lightweight token estimation"
```

### Task 2: Remove the tokenizer dependency and document the fix

**Files:**
- Modify: `package.json:50-53`
- Modify: `pnpm-lock.yaml`
- Modify: `CHANGELOG.md:7`

- [ ] **Step 1: Remove the runtime dependency**

Run:

```bash
pnpm remove @anthropic-ai/tokenizer
```

Expected: `package.json` retains `typebox` as its only runtime dependency, and pnpm removes the tokenizer plus its now-unused transitive lockfile entries.

- [ ] **Step 2: Verify the dependency is gone**

Run:

```bash
if rg -n '@anthropic-ai/tokenizer' package.json pnpm-lock.yaml; then
  echo "tokenizer dependency still present" >&2
  exit 1
fi
```

Expected: no matches and exit status `0`.

- [ ] **Step 3: Add the changelog entry**

Insert this section before `## [0.4.0]` in `CHANGELOG.md`:

```md
## [Unreleased]

### Fixed

- Long sessions no longer repeatedly invoke the Anthropic tokenizer during context processing, preventing high CPU usage and TUI stalls.

```

- [ ] **Step 4: Run dependency-sensitive checks**

Run:

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run tests/tokens.test.ts tests/tool-cache.test.ts
```

Expected: TypeScript exits successfully and both test files pass.

- [ ] **Step 5: Commit dependency and changelog changes**

```bash
git add package.json pnpm-lock.yaml CHANGELOG.md
git commit -m "chore: remove Anthropic tokenizer dependency"
```

### Task 3: Verify the performance fix and full project

**Files:**
- Create temporarily: `/tmp/pi-dcp-issue-41-benchmark.ts`
- Verify unchanged: `dcp.schema.json`

- [ ] **Step 1: Create the issue reproduction benchmark outside the repository**

Run:

```bash
cat > /tmp/pi-dcp-issue-41-benchmark.ts <<'TS'
import { performance } from "node:perf_hooks";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const { syncToolCache } = await import(
  pathToFileURL(path.join(root, "src/state/tool-cache.ts")).href
);
const { createSessionState } = await import(
  pathToFileURL(path.join(root, "src/state/state.ts")).href
);

const resultSize = 4096;
const chunk = 'const value = "some realistic tool output";\n';
const text = chunk.repeat(Math.ceil(resultSize / chunk.length)).slice(0, resultSize);
const messages: any[] = [];

for (let i = 0; i < 50; i++) {
  messages.push({
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: `call-${i}`,
        name: "read",
        arguments: { path: `file-${i}.ts` },
      },
    ],
  });
  messages.push({
    role: "toolResult",
    toolCallId: `call-${i}`,
    toolName: "read",
    content: [{ type: "text", text }],
    isError: false,
  });
}

const state = createSessionState();

function measure(label: string): number {
  const start = performance.now();
  syncToolCache(state, messages);
  const duration = performance.now() - start;
  console.log(`${label}: ${duration.toFixed(2)} ms`);
  return duration;
}

const first = measure("first pass");
const cached = measure("cached pass");

if (first >= 25 || cached >= 25) {
  console.error("Expected both passes to complete in less than 25 ms");
  process.exitCode = 1;
}
TS
```

Expected: `/tmp/pi-dcp-issue-41-benchmark.ts` exists. No repository file is created.

- [ ] **Step 2: Run the reproduction benchmark**

Run:

```bash
node --import tsx /tmp/pi-dcp-issue-41-benchmark.ts
```

Expected: both `first pass` and `cached pass` report less than `25 ms`. Before the fix, each pass took roughly `1,800 ms` on the diagnosis machine.

- [ ] **Step 3: Remove the temporary benchmark**

Run:

```bash
rm /tmp/pi-dcp-issue-41-benchmark.ts
```

Expected: the temporary file is removed.

- [ ] **Step 4: Run the complete project check**

Run:

```bash
pnpm check
```

Expected: Biome lint, TypeScript, all Vitest tests, and schema generation pass.

- [ ] **Step 5: Confirm schema generation made no change**

Run:

```bash
git diff --exit-code -- dcp.schema.json
```

Expected: no diff and exit status `0`.

- [ ] **Step 6: Confirm the final scope and repository state**

Run:

```bash
git status --short
git diff HEAD~2..HEAD --stat
```

Expected: the working tree is clean. The implementation commits change only `src/utils/tokens.ts`, `tests/tokens.test.ts`, `tests/tool-cache.test.ts`, `package.json`, `pnpm-lock.yaml`, and `CHANGELOG.md`.
