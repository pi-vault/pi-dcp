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

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/config.ts
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
    const state = createSessionState();
    state.modelContextWindow = 200000;
    expect(resolveContextTokenLimit(200000, state)).toBe(200000);
  });

  it("resolves percentage string against model context window", () => {
    const state = createSessionState();
    state.modelContextWindow = 200000;
    expect(resolveContextTokenLimit("80%", state)).toBe(160000);
  });

  it("returns undefined when percentage string but no context window", () => {
    const state = createSessionState();
    state.modelContextWindow = undefined;
    expect(resolveContextTokenLimit("80%", state)).toBeUndefined();
  });

  it("returns number even without context window", () => {
    const state = createSessionState();
    state.modelContextWindow = undefined;
    expect(resolveContextTokenLimit(150000, state)).toBe(150000);
  });

  it("returns undefined for undefined input", () => {
    const state = createSessionState();
    expect(resolveContextTokenLimit(undefined, state)).toBeUndefined();
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
 */
export function resolveContextTokenLimit(
  value: number | string | undefined,
  state: SessionState,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;

  // Parse percentage string like "80%"
  const match = value.match(/^(\d+(?:\.\d+)?)%$/);
  if (!match) return undefined;

  const percent = Number.parseFloat(match[1]);
  if (state.modelContextWindow === undefined) return undefined;

  return Math.round((percent / 100) * state.modelContextWindow);
}

/**
 * Determine if context usage exceeds the configured limits.
 * Resolution order for each threshold:
 *   1. Per-model override (modelMaxLimits/modelMinLimits[provider/modelId])
 *   2. Global absolute limit (maxContextLimit/minContextLimit)
 *   3. Legacy percentage fallback (maxContextPercent/minContextPercent * contextWindow)
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

  const maxLimit = resolveMaxLimit(config.compress, state, modelKey);
  const minLimit = resolveMinLimit(config.compress, state, modelKey);

  return {
    overMaxLimit: maxLimit !== undefined ? tokens >= maxLimit : false,
    overMinLimit: minLimit !== undefined ? tokens >= minLimit : false,
  };
}

function resolveMaxLimit(
  compress: CompressConfig,
  state: SessionState,
  modelKey: string | undefined,
): number | undefined {
  // 1. Per-model override
  if (modelKey && compress.modelMaxLimits?.[modelKey] !== undefined) {
    return resolveContextTokenLimit(compress.modelMaxLimits[modelKey], state);
  }

  // 2. Global absolute limit
  if (compress.maxContextLimit !== undefined) {
    return resolveContextTokenLimit(compress.maxContextLimit, state);
  }

  // 3. Legacy percentage fallback
  if (state.modelContextWindow !== undefined) {
    return Math.round(
      (compress.maxContextPercent / 100) * state.modelContextWindow,
    );
  }

  return undefined;
}

function resolveMinLimit(
  compress: CompressConfig,
  state: SessionState,
  modelKey: string | undefined,
): number | undefined {
  // 1. Per-model override
  if (modelKey && compress.modelMinLimits?.[modelKey] !== undefined) {
    return resolveContextTokenLimit(compress.modelMinLimits[modelKey], state);
  }

  // 2. Global absolute limit
  if (compress.minContextLimit !== undefined) {
    return resolveContextTokenLimit(compress.minContextLimit, state);
  }

  // 3. Legacy percentage fallback
  if (state.modelContextWindow !== undefined) {
    return Math.round(
      (compress.minContextPercent / 100) * state.modelContextWindow,
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

Replace the threshold section of `injectCompressNudges` (the section after `if (contextUsage.percent == null) return messages;` up to `if (!overMin) return messages;`) with:

```typescript
// Resolve absolute limits (with summary buffer adjustment)
const { overMaxLimit, overMinLimit } = isContextOverLimits(
  config,
  state,
  contextUsage,
);

// Summary buffer: extend effective max limit by active summary tokens
let overMax = overMaxLimit;
if (
  overMax &&
  config.compress.summaryBuffer &&
  contextUsage.tokens != null &&
  contextUsage.contextWindow > 0
) {
  const summaryTokens = getActiveSummaryTokenUsage(state);
  if (summaryTokens > 0) {
    // Re-check: is tokens still over max after adding summary buffer to the limit?
    const { overMaxLimit: stillOverMax } = isContextOverLimitsWithBuffer(
      config,
      state,
      contextUsage,
      summaryTokens,
    );
    overMax = stillOverMax;
  }
}

if (!overMinLimit) return messages;
```

Actually, let's keep it simpler. Replace the entire threshold block in `injectCompressNudges`. The current code is:

```typescript
// E5: percent can be null when unknown
if (contextUsage.percent == null) return messages;

const percent = contextUsage.percent;
const overMax = percent >= config.compress.maxContextPercent;
const overMin = percent >= config.compress.minContextPercent;
```

Replace with:

```typescript
// Use absolute token limits (Phase 4) with summary buffer adjustment (Phase 3)
const limits = isContextOverLimits(config, state, contextUsage);

// Summary buffer: extend the effective max limit by active summary tokens
let overMax = limits.overMaxLimit;
if (
  overMax &&
  config.compress.summaryBuffer &&
  contextUsage.contextWindow > 0 &&
  contextUsage.tokens != null
) {
  const summaryTokens = getActiveSummaryTokenUsage(state);
  if (summaryTokens > 0 && state.modelContextWindow) {
    const bufferPercent = (summaryTokens / state.modelContextWindow) * 100;
    // Re-derive: if using percentage fallback, add buffer to effective percent threshold
    // If using absolute limits, add summaryTokens directly to the resolved limit
    // Simplest: check if tokens < resolvedMax + summaryTokens
    const resolvedMax = resolveEffectiveMaxTokens(config, state);
    if (
      resolvedMax !== undefined &&
      contextUsage.tokens < resolvedMax + summaryTokens
    ) {
      overMax = false;
    }
  }
}

const overMin = limits.overMinLimit;
```

Hmm, this is getting complex. Let me simplify the integration. Replace the entire threshold section with a clean approach:

```typescript
// Resolve context limits (absolute tokens, per-model overrides, legacy percentage fallback)
let { overMaxLimit: overMax, overMinLimit: overMin } = isContextOverLimits(
  config,
  state,
  contextUsage,
);

// Summary buffer: if over max, check whether summary tokens account for the overshoot
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
```

Remove the old `if (contextUsage.percent == null) return messages;` check — `isContextOverLimits` already handles null tokens by returning `{ false, false }`.

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

Expected: All pass. If existing tests fail because they rely on the old percentage logic path, update them to also set `contextUsage.tokens` and `contextUsage.contextWindow` so `isContextOverLimits` can resolve correctly. Most existing tests pass `percent` which will hit the legacy fallback path (percentage \* contextWindow) when no absolute limits are set.

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

- [ ] `npm run check` passes
- [ ] Default config has `maxContextLimit: 200000`, `minContextLimit: 100000`
- [ ] Per-model overrides resolve correctly (provider/modelId key format)
- [ ] Percentage strings ("80%") resolve against modelContextWindow
- [ ] Legacy percentage fallback works when no absolute limits set
- [ ] Summary buffer integrates cleanly with absolute limit logic
- [ ] Model info (id, provider) tracked from ctx.model on context event
- [ ] Existing nudge tests pass (they use percent which hits legacy fallback)
