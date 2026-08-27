# Phase 1: Model Eligibility Config Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a validated model-eligibility contract and lock in the existing independent per-model limit behavior without changing runtime DCP processing.

**Architecture:** Add one top-level schema field and one pure helper in the existing config module. Keep the current context-limit resolver unchanged, but add a two-model regression proving exact percentage overrides. Generate the shipped schema from TypeBox; defer README claims until Phase 2 delivers usable runtime behavior.

**Tech Stack:** TypeScript, Node.js `>=24.15.0`, TypeBox, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-26-model-specific-dcp-controls-design.md`

## Global Constraints

- Match `${provider}/${modelId}` exactly and case-sensitively.
- `disabledModels` defaults to `[]`.
- Preserve existing per-model limit resolution and config-layer merging.
- Add no dependencies and make no runtime event changes in this phase.
- Do not modify the reference repositories.
- Do not commit unless the user explicitly requests a commit.

---

### Task 1: Add the config field and shared test default

**Files:**

- Modify: `src/config-schema.ts`
- Modify: `tests/helpers.ts`
- Test: `tests/config.test.ts`

**Interfaces:**

- Produces required `DcpConfig.disabledModels: string[]`.
- `Value.Create(DcpConfigSchema)` produces a fresh empty list by default.
- `makeDefaultConfig()` continues returning a complete `DcpConfig`.

- [ ] **Step 1: Add failing config tests**

Add to `tests/config.test.ts`:

```ts
it("defaults disabledModels to an empty list", () => {
  expect(loadConfig(path.join(tempDir, "missing.json")).config.disabledModels).toEqual([]);
});

it("loads exact disabled model keys", () => {
  const file = path.join(tempDir, "dcp.json");
  fs.writeFileSync(file, JSON.stringify({
    disabledModels: ["openai-codex/gpt-5.6-sol"],
  }));

  expect(loadConfig(file).config.disabledModels).toEqual([
    "openai-codex/gpt-5.6-sol",
  ]);
});
```

- [ ] **Step 2: Run the config tests and confirm the expected failure**

Run: `pnpm vitest run tests/config.test.ts`

Expected: FAIL because `disabledModels` is not in `DcpConfigSchema`.

- [ ] **Step 3: Add the schema property and test-factory default**

Add before `compress` in `DcpConfigSchema`:

```ts
disabledModels: Type.Array(Type.String(), {
  default: [],
  description: "Exact provider/model keys for which DCP is disabled",
}),
```

Add beside `enabled` in `makeDefaultConfig()`:

```ts
disabledModels: [],
```

- [ ] **Step 4: Run the config tests and typecheck**

Run: `pnpm vitest run tests/config.test.ts`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS; test helpers still satisfy `DcpConfig`.

### Task 2: Add the pure eligibility helper

**Files:**

- Modify: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**

- Produces `isDcpEnabledForModel(config: Pick<DcpConfig, "enabled" | "disabledModels">, provider: string | undefined, modelId: string | undefined): boolean`.
- Global disablement returns `false`; missing identity returns the global enabled state.

- [ ] **Step 1: Add failing helper tests**

Import `isDcpEnabledForModel` and add:

```ts
it("matches disabled models exactly", () => {
  const config = {
    enabled: true,
    disabledModels: ["openai-codex/gpt-5.6-sol"],
  };

  expect(isDcpEnabledForModel(config, "openai-codex", "gpt-5.6-sol")).toBe(false);
  expect(isDcpEnabledForModel(config, "openai", "gpt-5.6-sol")).toBe(true);
  expect(isDcpEnabledForModel(config, "openai-codex", "gpt-5.6-terra")).toBe(true);
  expect(isDcpEnabledForModel(config, undefined, undefined)).toBe(true);
  expect(isDcpEnabledForModel({ ...config, enabled: false }, "openai", "other")).toBe(false);
});
```

- [ ] **Step 2: Run the helper test and confirm the expected failure**

Run: `pnpm vitest run tests/config.test.ts`

Expected: FAIL because `isDcpEnabledForModel` is not exported.

- [ ] **Step 3: Implement the helper**

Add to `src/config.ts`:

```ts
export function isDcpEnabledForModel(
  config: Pick<DcpConfig, "enabled" | "disabledModels">,
  provider: string | undefined,
  modelId: string | undefined,
): boolean {
  if (!config.enabled) return false;
  if (!provider || !modelId) return true;
  return !config.disabledModels.includes(`${provider}/${modelId}`);
}
```

- [ ] **Step 4: Run the focused config tests**

Run: `pnpm vitest run tests/config.test.ts`

Expected: PASS.

### Task 3: Prove independent model limits and generate the schema

**Files:**

- Test: `tests/context-limits.test.ts`
- Regenerate: `dcp.schema.json`

**Interfaces:**

- Preserves exact `compress.modelMaxLimits` and `compress.modelMinLimits` lookup.
- Percentage values resolve against the selected model's current context window.

- [ ] **Step 1: Add the two-model regression**

Add to `tests/context-limits.test.ts`:

```ts
it("uses independent percentage limits for different exact model keys", () => {
  const config = makeDefaultConfig({
    maxContextLimit: 200000,
    minContextLimit: 100000,
    modelMaxLimits: {
      "openai-codex/gpt-5.6-sol": "80%",
      "openai-codex/gpt-5.6-terra": "60%",
    },
    modelMinLimits: {
      "openai-codex/gpt-5.6-sol": "50%",
      "openai-codex/gpt-5.6-terra": "40%",
    },
  });
  const check = (modelId: string) => {
    const state = createSessionState();
    state.modelProvider = "openai-codex";
    state.modelId = modelId;
    state.modelContextWindow = 1_000_000;
    return isContextOverLimits(config, state, {
      tokens: 700_000,
      contextWindow: 1_000_000,
      percent: 70,
    });
  };

  expect(check("gpt-5.6-sol")).toEqual({ overMaxLimit: false, overMinLimit: true });
  expect(check("gpt-5.6-terra")).toEqual({ overMaxLimit: true, overMinLimit: true });
});
```

- [ ] **Step 2: Run the limit tests**

Run: `pnpm vitest run tests/context-limits.test.ts`

Expected: PASS against the existing resolver.

- [ ] **Step 3: Regenerate and inspect the schema**

Run: `pnpm generate:schema`

Expected: `dcp.schema.json` contains top-level `disabledModels` as an array of strings with default `[]`, while both model limit maps remain unchanged.

- [ ] **Step 4: Run the phase checks**

Run: `pnpm vitest run tests/config.test.ts tests/context-limits.test.ts`

Expected: PASS.
