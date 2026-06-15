# Phase 1: Consolidate ContextUsage Type

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the `ContextUsage` interface to `src/state/types.ts` as the single canonical definition, delete duplicates, and remove the ad-hoc object construction in `src/index.ts`.

**Architecture:** Pure type-only refactor. Two identical interfaces (`ContextUsage` in `inject.ts`, `ContextUsageInfo` in `context.ts`) get replaced by one in `src/state/types.ts`. Pi's `ctx.getContextUsage()` return type is a structural superset, so `index.ts` can pass it directly without manual mapping.

**Tech Stack:** TypeScript (strict mode), vitest, biome (lint)

**Behavior change:** None. Verified by `pnpm check` (typecheck + lint + tests).

---

## File Map

| Action | File                      | Responsibility                                                    |
| ------ | ------------------------- | ----------------------------------------------------------------- |
| Modify | `src/state/types.ts`      | Add canonical `ContextUsage` interface                            |
| Modify | `src/messages/inject.ts`  | Delete local `ContextUsage`, import from types                    |
| Modify | `src/commands/context.ts` | Delete local `ContextUsageInfo`, import `ContextUsage` from types |
| Modify | `src/index.ts`            | Remove ad-hoc object literal, pass `usage` directly               |

---

### Task 1: Add ContextUsage to state/types.ts

**Files:**

- Modify: `src/state/types.ts` (after line 128, at end of file)

- [x] **Step 1: Add the ContextUsage interface**

Add at the end of `src/state/types.ts`:

```typescript
export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}
```

- [x] **Step 2: Run typecheck to confirm no conflicts**

Run: `pnpm check`
Expected: PASS (adding a new export doesn't break anything)

---

### Task 2: Update inject.ts to use canonical type

**Files:**

- Modify: `src/messages/inject.ts:89-97` (delete JSDoc comment + local interface)
- Modify: `src/messages/inject.ts:2` (add ContextUsage to import)
- Modify: `tests/inject.test.ts:2-7` (update ContextUsage import source)

- [x] **Step 1: Replace local ContextUsage with import**

In `src/messages/inject.ts`, delete the JSDoc comment AND the local interface definition (lines 89-97):

```typescript
// DELETE these lines:
/**
 * Context usage info from Pi's ctx.getContextUsage().
 * E5: tokens and percent can be null when unknown.
 */
export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}
```

Add `ContextUsage` to the existing import from `../state/types.ts`. Currently line 2 reads:

```typescript
import type { SessionState } from "../state/types.ts";
```

Change to:

```typescript
import type { ContextUsage, SessionState } from "../state/types.ts";
```

- [x] **Step 2: Verify RED — pnpm check fails on test import**

Run: `pnpm check`
Expected: FAIL — `tests/inject.test.ts` still imports `type ContextUsage` from
`../src/messages/inject.ts`, which no longer exports it. Confirm the error is
about the missing export (not a typo or unrelated issue).

- [x] **Step 3: Fix tests/inject.test.ts import (GREEN)**

In `tests/inject.test.ts`, the current import block (lines 1-7):

```typescript
import { describe, expect, it } from "vitest";
import {
  assignMessageRefs,
  injectMessageIds,
  injectCompressNudges,
  type ContextUsage,
} from "../src/messages/inject.ts";
```

Split into two imports:

```typescript
import { describe, expect, it } from "vitest";
import {
  assignMessageRefs,
  injectMessageIds,
  injectCompressNudges,
} from "../src/messages/inject.ts";
import type { ContextUsage } from "../src/state/types.ts";
```

- [x] **Step 4: Run typecheck**

Run: `pnpm check`
Expected: PASS (same shape, same name, callers unaffected)

---

### Task 3: Update context.ts to use canonical type

**Files:**

- Modify: `src/commands/context.ts:1-7` (delete local interface, update import)

- [x] **Step 1: Replace local ContextUsageInfo with import**

In `src/commands/context.ts`, the current imports and type definition (lines 1-7):

```typescript
import type { SessionState } from "../state/types.ts";

export interface ContextUsageInfo {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}
```

Replace with:

```typescript
import type { ContextUsage, SessionState } from "../state/types.ts";
```

- [x] **Step 2: Replace all ContextUsageInfo references with ContextUsage**

In `src/commands/context.ts`, the function signature on line 11:

```typescript
  contextUsage: ContextUsageInfo | undefined,
```

Change to:

```typescript
  contextUsage: ContextUsage | undefined,
```

This is the only reference to `ContextUsageInfo` in the file.

- [x] **Step 3: Check for external consumers of ContextUsageInfo**

Run: `grep -r "ContextUsageInfo" src/ tests/`

Expected: No remaining references. The type was only used locally in `context.ts` and in `src/commands/register.ts` (which imports from `context.ts`).

If `register.ts` imports `ContextUsageInfo`, update that import to `ContextUsage`.

- [x] **Step 4: Run typecheck**

Run: `pnpm check`
Expected: PASS

---

### Task 4: Simplify index.ts usage pass-through

**Files:**

- Modify: `src/index.ts:241-245` (remove ad-hoc object construction)

- [x] **Step 1: Remove the ad-hoc ContextUsage object literal**

In `src/index.ts`, lines 241-245 currently read:

```typescript
// Step 7: Inject nudges based on context usage (reuse initial usage snapshot)
messages = injectCompressNudges(
  state,
  config,
  messages,
  usage
    ? {
        tokens: usage.tokens,
        contextWindow: usage.contextWindow,
        percent: usage.percent,
      }
    : undefined,
);
```

Replace with:

```typescript
// Step 7: Inject nudges based on context usage (reuse initial usage snapshot)
messages = injectCompressNudges(state, config, messages, usage ?? undefined);
```

Pi's `ctx.getContextUsage()` returns `{ tokens, contextWindow, percent, ... }` which is a structural superset of `ContextUsage`. TypeScript's structural typing accepts this without explicit mapping. The `?? undefined` converts the `null` case (if `getContextUsage()` returns null) to `undefined`.

- [x] **Step 2: Run full check**

Run: `pnpm check`
Expected: PASS (typecheck, lint, all tests green)

- [x] **Step 3: Commit**

```bash
git add src/state/types.ts src/messages/inject.ts src/commands/context.ts src/index.ts tests/inject.test.ts
git commit -m "refactor: consolidate ContextUsage type into state/types.ts

Move the ContextUsage interface to src/state/types.ts as the single
canonical definition. Delete duplicate definitions from inject.ts
(ContextUsage) and context.ts (ContextUsageInfo). Remove the ad-hoc
object construction in index.ts — Pi's usage object is a structural
superset so it can be passed directly.

No behavior change.

Generated with [Devin](https://cli.devin.ai/docs)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```
