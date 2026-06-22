# Phase 4: Absolute Token Limits + Per-Model Overrides

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace percentage-only thresholds with absolute token limits (defaulting to 200K/100K). Support per-model overrides and percentage strings as alternatives.

**Architecture:** Add `maxContextLimit` and `minContextLimit` fields to config (numbers or percentage strings). Add a `resolveContextTokenLimit` utility that resolves the effective absolute limit given config, model info, and legacy fallbacks. Refactor `injectCompressNudges` to use absolute token comparison instead of percentage comparison.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File                           | Responsibility                                         |
| ------------------------------ | ------------------------------------------------------ |
| `src/config.ts`                | Add new config fields, validation, known keys          |
| `src/state/types.ts`           | Add `modelId`, `modelProvider` to `SessionState`       |
| `src/state/state.ts`           | Initialize model fields                                |
| `src/utils/context-limits.ts`  | New: `resolveContextTokenLimit`, `isContextOverLimits` |
| `src/messages/inject.ts`       | Refactor nudge logic to use absolute limit resolver    |
| `src/index.ts`                 | Track model info on `context` event                    |
| `tests/context-limits.test.ts` | Unit tests for limit resolution                        |

---

### Task 1: Add model tracking fields to state

**Files:**

- Modify: `src/state/types.ts`
- Modify: `src/state/state.ts`

- [ ] **Step 1: Add fields to `SessionState` in types**

In `src/state/types.ts`, add after `modelContextWindow`:

```typescript
/** Active model identifier (e.g. "claude-sonnet-4-20250514"). */
modelId: string | undefined;
/** Active model provider (e.g. "anthropic"). */
modelProvider: string | undefined;
```

- [ ] **Step 2: Initialize in `createSessionState` and `resetSessionState`**

In `src/state/state.ts`, in `createSessionState()` add after `modelContextWindow: undefined`:

```typescript
    modelId: undefined,
    modelProvider: undefined,
```

In `resetSessionState()` add after `state.modelContextWindow = undefined`:

```typescript
state.modelId = undefined;
state.modelProvider = undefined;
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/state/types.ts src/state/state.ts
git commit -m "feat(limits): add modelId and modelProvider to SessionState"
```

---

### Task 2: Add config fields for absolute limits

**Files:**

- Modify: `src/config.ts`
- Modify: `tests/helpers.ts`

- [ ] **Step 1: Add types and defaults**

In `src/config.ts`, add to `CompressConfig` interface:

```typescript
maxContextLimit: number | string | undefined;
minContextLimit: number | string | undefined;
modelMaxLimits: Record<string, number | string> | undefined;
modelMinLimits: Record<string, number | string> | undefined;
```

Add to `DEFAULT_CONFIG.compress`:

```typescript
    maxContextLimit: 200000,
    minContextLimit: 100000,
    modelMaxLimits: undefined,
    modelMinLimits: undefined,
```

Add to `KNOWN_COMPRESS_KEYS`:

```typescript
  "maxContextLimit", "minContextLimit", "modelMaxLimits", "modelMinLimits",
```

- [ ] **Step 2: Add config parsing in `mergeConfig`**

In the `if (source.compress ...)` block of `mergeConfig`, add:

```typescript
if (
  typeof c.maxContextLimit === "number" ||
  typeof c.maxContextLimit === "string"
)
  target.compress.maxContextLimit = c.maxContextLimit;
if (
  typeof c.minContextLimit === "number" ||
  typeof c.minContextLimit === "string"
)
  target.compress.minContextLimit = c.minContextLimit;
if (
  c.modelMaxLimits &&
  typeof c.modelMaxLimits === "object" &&
  !Array.isArray(c.modelMaxLimits)
)
  target.compress.modelMaxLimits = c.modelMaxLimits as Record<
    string,
    number | string
  >;
if (
  c.modelMinLimits &&
  typeof c.modelMinLimits === "object" &&
  !Array.isArray(c.modelMinLimits)
)
  target.compress.modelMinLimits = c.modelMinLimits as Record<
    string,
    number | string
  >;
```

- [ ] **Step 3: Update `tests/helpers.ts` `makeDefaultConfig`**

Add the new fields to the `compress` object in `makeDefaultConfig()`. Use `undefined` defaults so existing tests continue to hit the legacy percentage fallback path:

```typescript
      protectTags: false,
      summaryBuffer: true,
      maxContextLimit: undefined,
      minContextLimit: undefined,
      modelMaxLimits: undefined,
      modelMinLimits: undefined,
      ...overrides,
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/config.ts tests/helpers.ts
git commit -m "feat(limits): add absolute token limit config fields"
```

---

### Task 3: Implement `resolveContextTokenLimit` and `isContextOverLimits`

**Files:**

- Create: `src/utils/context-limits.ts`
- Test: `tests/context-limits.test.ts` (create)

- [ ] **Step 1: Write tests for limit resolution**

Create `tests/context-limits.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  resolveContextTokenLimit,
  isContextOverLimits,
} from "../src/utils/context-limits.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";

describe("resolveContextTokenLimit", () => {
  it("returns absolute number directly", () => {
    expect(resolveContextTokenLimit(200000, 200000)).toBe(200000);
  });

  it("resolves percentage string against context window", () => {
    expect(resolveContextTokenLimit("80%", 200000)).toBe(160000);
  });

  it("returns undefined when percentage string but no context window", () => {
    expect(resolveContextTokenLimit("80%", undefined)).toBeUndefined();
  });

  it("returns number even without context window", () => {
    expect(resolveContextTokenLimit(150000, undefined)).toBe(150000);
  });

  it("returns undefined for undefined input", () => {
    expect(resolveContextTokenLimit(undefined, 200000)).toBeUndefined();
  });
});

describe("isContextOverLimits", () => {
  it("uses maxContextLimit and minContextLimit when set", () => {
    const state = createSessionState();
    state.modelContextWindow = 1000000;
    const config = makeDefaultConfig({
      maxContextLimit: 200000,
      minContextLimit: 100000,
    });

    // tokens = 150000, between min (100K) and max (200K)
    const result = isContextOverLimits(config, state, {
      tokens: 150000,
      contextWindow: 1000000,
      percent: 15,
    });
    expect(result.overMaxLimit).toBe(false);
    expect(result.overMinLimit).toBe(true);
  });

  it("uses per-model overrides when provider/model matches", () => {
    const state = createSessionState();
    state.modelContextWindow = 1000000;
    state.modelId = "gemini-2.5-pro";
    state.modelProvider = "google";
    const config = makeDefaultConfig({
      maxContextLimit: 200000,
      minContextLimit: 100000,
      modelMaxLimits: { "google/gemini-2.5-pro": 400000 },
      modelMinLimits: { "google/gemini-2.5-pro": 200000 },
    });

    // tokens = 250000, between model-specific min (200K) and max (400K)
    const result = isContextOverLimits(config, state, {
      tokens: 250000,
      contextWindow: 1000000,
      percent: 25,
    });
    expect(result.overMaxLimit).toBe(false);
    expect(result.overMinLimit).toBe(true);
  });

  it("falls back to percentage when no absolute limits configured", () => {
    const state = createSessionState();
    state.modelContextWindow = 200000;
    const config = makeDefaultConfig({
      maxContextLimit: undefined,
      minContextLimit: undefined,
      maxContextPercent: 80,
      minContextPercent: 50,
    });

    // tokens = 170000 = 85% of 200K window
    const result = isContextOverLimits(config, state, {
      tokens: 170000,
      contextWindow: 200000,
      percent: 85,
    });
    expect(result.overMaxLimit).toBe(true);
    expect(result.overMinLimit).toBe(true);
  });

  it("uses contextUsage.contextWindow as fallback when state.modelContextWindow is undefined", () => {
    const state = createSessionState();
    // state.modelContextWindow intentionally left undefined
    const config = makeDefaultConfig({
      maxContextLimit: undefined,
      minContextLimit: undefined,
      maxContextPercent: 80,
      minContextPercent: 50,
    });

    // tokens = 170000 = 85% of 200K contextWindow from usage
    const result = isContextOverLimits(config, state, {
      tokens: 170000,
      contextWindow: 200000,
      percent: 85,
    });
    expect(result.overMaxLimit).toBe(true);
    expect(result.overMinLimit).toBe(true);
  });

  it("returns both false when tokens is null", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      maxContextLimit: 200000,
      minContextLimit: 100000,
    });

    const result = isContextOverLimits(config, state, {
      tokens: null,
      contextWindow: 200000,
      percent: null,
    });
    expect(result.overMaxLimit).toBe(false);
    expect(result.overMinLimit).toBe(false);
  });

  it("percentage string limits resolve correctly", () => {
    const state = createSessionState();
    state.modelContextWindow = 200000;
    const config = makeDefaultConfig({
      maxContextLimit: "80%",
      minContextLimit: "50%",
    });

    // tokens = 170000 = 85% → over 80% of 200K (160K)
    const result = isContextOverLimits(config, state, {
      tokens: 170000,
      contextWindow: 200000,
      percent: 85,
    });
    expect(result.overMaxLimit).toBe(true);
    expect(result.overMinLimit).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/context-limits.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/utils/context-limits.ts`**

Create `src/utils/context-limits.ts`:

```typescript
import type { CompressConfig } from "../config.ts";
import type { ContextUsage, SessionState } from "../state/types.ts";

/**
 * Resolve a context limit value (number or percentage string) to an absolute token count.
 * Returns undefined if the value cannot be resolved (e.g., percentage with no context window).
 *
 * @param value - The limit value: absolute number, percentage string ("80%"), or undefined.
 * @param contextWindow - The context window size to resolve percentages against.
 */
export function resolveContextTokenLimit(
  value: number | string | undefined,
  contextWindow: number | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;

  // Parse percentage string like "80%"
  const match = value.match(/^(\d+(?:\.\d+)?)%$/);
  if (!match) return undefined;

  const percent = Number.parseFloat(match[1]);
  if (contextWindow === undefined) return undefined;

  return Math.round((percent / 100) * contextWindow);
}

/**
 * Determine if context usage exceeds the configured limits.
 * Resolution order for each threshold:
 *   1. Per-model override (modelMaxLimits/modelMinLimits[provider/modelId])
 *   2. Global absolute limit (maxContextLimit/minContextLimit)
 *   3. Legacy percentage fallback (maxContextPercent/minContextPercent * contextWindow)
 *
 * The effective context window is state.modelContextWindow if set, otherwise
 * contextUsage.contextWindow. This ensures the legacy fallback works even
 * when state hasn't captured the window yet (e.g., in tests or first context pass).
 */
export function isContextOverLimits(
  config: { compress: CompressConfig },
  state: SessionState,
  contextUsage: ContextUsage,
): { overMaxLimit: boolean; overMinLimit: boolean } {
  if (contextUsage.tokens == null) {
    return { overMaxLimit: false, overMinLimit: false };
  }

  const tokens = contextUsage.tokens;
  const modelKey =
    state.modelProvider && state.modelId
      ? `${state.modelProvider}/${state.modelId}`
      : undefined;

  // Effective window: prefer state (persisted), fall back to contextUsage (current)
  const effectiveWindow =
    state.modelContextWindow ??
    (contextUsage.contextWindow > 0 ? contextUsage.contextWindow : undefined);

  const maxLimit = resolveMaxLimit(config.compress, effectiveWindow, modelKey);
  const minLimit = resolveMinLimit(config.compress, effectiveWindow, modelKey);

  return {
    overMaxLimit: maxLimit !== undefined ? tokens >= maxLimit : false,
    overMinLimit: minLimit !== undefined ? tokens >= minLimit : false,
  };
}

function resolveMaxLimit(
  compress: CompressConfig,
  contextWindow: number | undefined,
  modelKey: string | undefined,
): number | undefined {
  // 1. Per-model override
  if (modelKey && compress.modelMaxLimits?.[modelKey] !== undefined) {
    return resolveContextTokenLimit(compress.modelMaxLimits[modelKey], contextWindow);
  }

  // 2. Global absolute limit
  if (compress.maxContextLimit !== undefined) {
    return resolveContextTokenLimit(compress.maxContextLimit, contextWindow);
  }

  // 3. Legacy percentage fallback
  if (contextWindow !== undefined) {
    return Math.round(
      (compress.maxContextPercent / 100) * contextWindow,
    );
  }

  return undefined;
}

function resolveMinLimit(
  compress: CompressConfig,
  contextWindow: number | undefined,
  modelKey: string | undefined,
): number | undefined {
  // 1. Per-model override
  if (modelKey && compress.modelMinLimits?.[modelKey] !== undefined) {
    return resolveContextTokenLimit(compress.modelMinLimits[modelKey], contextWindow);
  }

  // 2. Global absolute limit
  if (compress.minContextLimit !== undefined) {
    return resolveContextTokenLimit(compress.minContextLimit, contextWindow);
  }

  // 3. Legacy percentage fallback
  if (contextWindow !== undefined) {
    return Math.round(
      (compress.minContextPercent / 100) * contextWindow,
    );
  }

  return undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/context-limits.test.ts`

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/utils/context-limits.ts tests/context-limits.test.ts
git commit -m "feat(limits): implement resolveContextTokenLimit and isContextOverLimits"
```

---

### Task 4: Refactor `injectCompressNudges` to use absolute limits

**Files:**

- Modify: `src/messages/inject.ts`
- Modify: `src/index.ts`
- Test: `tests/context-limits.test.ts`

- [ ] **Step 1: Write test for nudge with absolute limits**

Add to `tests/context-limits.test.ts`:

```typescript
import {
  injectCompressNudges,
  assignMessageRefs,
} from "../src/messages/inject.ts";
import { makeUserMessage, makeAssistantMessage } from "./helpers.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("injectCompressNudges with absolute limits", () => {
  it("uses absolute token limits instead of percentage for CONTEXT_LIMIT_NUDGE", () => {
    const state = createSessionState();
    state.modelContextWindow = 1000000;
    const config = makeDefaultConfig({
      maxContextLimit: 200000,
      minContextLimit: 100000,
    });

    const messages: AgentMessage[] = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);

    // 250K tokens, which is only 25% of 1M window but > 200K absolute limit
    const result = injectCompressNudges(state, config, messages, {
      tokens: 250000,
      contextWindow: 1000000,
      percent: 25,
    });

    const text = (result[0] as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    expect(text).toContain("CRITICAL WARNING");
  });

  it("does not trigger when tokens below absolute limit even if percent seems high", () => {
    const state = createSessionState();
    state.modelContextWindow = 200000;
    const config = makeDefaultConfig({
      maxContextLimit: 200000,
      minContextLimit: 100000,
    });

    const messages: AgentMessage[] = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);

    // 90K tokens = 45% of 200K. Below both limits.
    const result = injectCompressNudges(state, config, messages, {
      tokens: 90000,
      contextWindow: 200000,
      percent: 45,
    });

    const text = (result[0] as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    expect(text).not.toContain("dcp-system-reminder");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/context-limits.test.ts`

Expected: FAIL — nudge logic still uses percentage comparison.

- [ ] **Step 3: Refactor `injectCompressNudges` to use `isContextOverLimits`**

In `src/messages/inject.ts`, add the import:

```typescript
import { isContextOverLimits } from "../utils/context-limits.ts";
```

Replace the entire threshold block in `injectCompressNudges`. Delete from `// E5: percent can be null when unknown` through `if (!overMin) return messages;` (including the summary buffer logic). Replace with:

```typescript
// Resolve context limits (absolute tokens, per-model overrides, legacy percentage fallback)
let { overMaxLimit: overMax, overMinLimit: overMin } = isContextOverLimits(
  config,
  state,
  contextUsage,
);

// Summary buffer: if over max, check whether summary tokens account for the overshoot.
// Subtract active summary tokens from effective usage and re-check.
if (overMax && config.compress.summaryBuffer && contextUsage.tokens != null) {
  const summaryTokens = getActiveSummaryTokenUsage(state);
  if (summaryTokens > 0) {
    const effectiveTokens = contextUsage.tokens - summaryTokens;
    const adjusted = isContextOverLimits(config, state, {
      ...contextUsage,
      tokens: effectiveTokens,
      percent:
        contextUsage.contextWindow > 0
          ? (effectiveTokens / contextUsage.contextWindow) * 100
          : contextUsage.percent,
    });
    overMax = adjusted.overMaxLimit;
  }
}

if (!overMin) return messages;
```

This removes the old `if (contextUsage.percent == null) return messages;` early exit — `isContextOverLimits` already handles null tokens by returning `{ false, false }`, which causes `if (!overMin) return messages` to bail out.

Also remove the now-unused `percent` variable and the old summary buffer block (`let effectiveMaxPercent = ...`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/context-limits.test.ts`

Expected: All PASS.

- [ ] **Step 5: Update model info tracking in `index.ts`**

In the `context` event handler in `src/index.ts`, after `if (usage) state.modelContextWindow = usage.contextWindow;`, add:

```typescript
if (ctx.model) {
  state.modelId = ctx.model.id;
  state.modelProvider = ctx.model.provider;
}
```

- [ ] **Step 6: Run full check**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npm run check`

Expected: All pass. Existing tests use `makeDefaultConfig()` which sets `maxContextLimit: undefined` / `minContextLimit: undefined`, causing `isContextOverLimits` to fall through to the legacy percentage path. The legacy path uses `contextUsage.contextWindow` (via the `effectiveWindow` fallback) so no test updates should be needed.

- [ ] **Step 7: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/messages/inject.ts src/index.ts tests/context-limits.test.ts
git commit -m "feat(limits): refactor nudge thresholds to use absolute token limits

Replaces percentage-only comparison with resolveContextTokenLimit.
Integrates summary buffer as token subtraction from effective usage.
Tracks modelId/modelProvider for per-model override resolution."
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `npm run check` passes (all 247+ tests green, typecheck clean)
- [ ] Default config has `maxContextLimit: 200000`, `minContextLimit: 100000`
- [ ] Per-model overrides resolve correctly (provider/modelId key format)
- [ ] Percentage strings ("80%") resolve against effective context window
- [ ] Legacy percentage fallback works when no absolute limits set (uses `contextUsage.contextWindow`)
- [ ] Summary buffer integrates cleanly with absolute limit logic (token subtraction approach)
- [ ] Model info (id, provider) tracked from ctx.model on context event
- [ ] Existing nudge tests pass unchanged (test helper uses `undefined` limits → legacy path)
- [ ] `tests/helpers.ts` has new config fields set to `undefined` (not production defaults)
