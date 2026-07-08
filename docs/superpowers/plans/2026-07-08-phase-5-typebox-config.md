# Phase 5: Config Validation + JSON Schema via TypeBox

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-written config interfaces and validation with TypeBox schemas. Derive TypeScript types, runtime validation, and a JSON Schema file from a single source of truth.

**Architecture:** Create `src/config-schema.ts` with TypeBox schema definitions. Refactor `src/config.ts` to use TypeBox's `Value.*` utilities for validation. Add `scripts/generate-schema.ts` to emit `dcp.schema.json`. TypeBox is already a runtime dependency (moved in commit `89885d8`).

**Tech Stack:** TypeScript, Vitest, TypeBox (1.3.6)

**Prerequisites:** Phases 1-4 completed. This phase absorbs the config fields added there (`showCompression`, `turnProtection`).

**Corrections from original plan (review 2026-07-08):**

1. `showCompression` default fixed: `true` → `false` (matches current code, Phase 1 plan, spec, and opencode reference)
2. `turnProtection` default fixed: `3` → `0` (matches current code; Phase 3 implementation intentionally deviated from spec's `3` to keep protection disabled by default)
3. Added type mismatch handling: `deepMerge` can overwrite a default with a wrong-typed user value (e.g. `"yes"` for a boolean). After `Value.Check`, invalid paths are now reset to their default values.
4. Task 1 marked as already completed (commit `89885d8`)

---

### Task 1: Move TypeBox to runtime dependency — ALREADY COMPLETED

Completed in commit `89885d8`. TypeBox is already in `dependencies` in `package.json`.

---

### Task 2: Create config schema

**Files:**
- Create: `src/config-schema.ts`

- [ ] **Step 1: Write the schema file**

Create `src/config-schema.ts`:

```ts
import { Type, type Static } from "typebox";

export const DeduplicationConfigSchema = Type.Object({
  enabled: Type.Boolean({
    default: true,
    description: "Enable deduplication strategy",
  }),
  protectedTools: Type.Array(Type.String(), {
    default: [],
    description: "Tool names excluded from deduplication (glob patterns)",
  }),
  turnProtection: Type.Number({
    default: 0,
    minimum: 0,
    description:
      "Protect duplicate tool outputs from pruning for N turns after invocation. 0 disables.",
  }),
});

export const PurgeErrorsConfigSchema = Type.Object({
  enabled: Type.Boolean({
    default: true,
    description: "Enable error purging strategy",
  }),
  turns: Type.Number({
    default: 4,
    minimum: 1,
    description: "Prune failed tool results after this many turns",
  }),
  protectedTools: Type.Array(Type.String(), {
    default: [],
    description: "Tool names excluded from error purging (glob patterns)",
  }),
});

export const CompressConfigSchema = Type.Object({
  mode: Type.Union([Type.Literal("range"), Type.Literal("message")], {
    default: "range",
    description:
      "Compression mode: range (compress spans) or message (compress individual messages)",
  }),
  permission: Type.Union([Type.Literal("allow"), Type.Literal("deny")], {
    default: "allow",
    description: "Whether the compress tool is allowed to run",
  }),
  showCompression: Type.Boolean({
    default: false,
    description:
      "Include compression summary text in user notifications (does not affect model context)",
  }),
  maxContextPercent: Type.Number({
    default: 80,
    description: "Legacy: max context percentage threshold",
  }),
  minContextPercent: Type.Number({
    default: 50,
    description: "Legacy: min context percentage threshold",
  }),
  maxContextLimit: Type.Optional(
    Type.Union([Type.Number(), Type.String()], {
      description:
        "Max context limit (absolute token count or percentage string like '80%'). Default: 200000",
    }),
  ),
  minContextLimit: Type.Optional(
    Type.Union([Type.Number(), Type.String()], {
      description:
        "Min context limit (absolute token count or percentage string like '50%'). Default: 100000",
    }),
  ),
  modelMaxLimits: Type.Optional(
    Type.Record(Type.String(), Type.Union([Type.Number(), Type.String()]), {
      description: "Per-model max context limits keyed by 'provider/modelId'",
    }),
  ),
  modelMinLimits: Type.Optional(
    Type.Record(Type.String(), Type.Union([Type.Number(), Type.String()]), {
      description: "Per-model min context limits keyed by 'provider/modelId'",
    }),
  ),
  nudgeFrequency: Type.Number({
    default: 5,
    minimum: 1,
    description: "Minimum turns between non-urgent nudges",
  }),
  iterationNudgeThreshold: Type.Number({
    default: 15,
    minimum: 1,
    description:
      "Number of assistant iterations without user input before nudging",
  }),
  nudgeForce: Type.Union([Type.Literal("strong"), Type.Literal("soft")], {
    default: "soft",
    description: "Nudge urgency: strong (imperative) or soft (suggestion)",
  }),
  protectedTools: Type.Array(Type.String(), {
    default: [],
    description: "Tool outputs to preserve during compression (glob patterns)",
  }),
  protectUserMessages: Type.Boolean({
    default: false,
    description: "Append user message text to compression summaries",
  }),
  protectTags: Type.Boolean({
    default: false,
    description:
      "Preserve <protect>...</protect> tag content in summaries",
  }),
  summaryBuffer: Type.Boolean({
    default: true,
    description:
      "Exclude active summary tokens from threshold comparison to prevent cascading",
  }),
});

export const ManualModeConfigSchema = Type.Object({
  default: Type.Union([Type.Literal(false), Type.Literal("active")], {
    default: false,
    description: "Initial manual mode state",
  }),
  automaticStrategies: Type.Boolean({
    default: true,
    description: "Run automatic strategies even in manual mode",
  }),
});

export const ExperimentalConfigSchema = Type.Object({
  allowSubAgents: Type.Boolean({
    default: false,
    description: "Enable DCP in sub-agent child sessions",
  }),
  customPrompts: Type.Boolean({
    default: false,
    description: "Enable filesystem-based prompt overrides",
  }),
});

export const StrategiesConfigSchema = Type.Object({
  deduplication: DeduplicationConfigSchema,
  purgeErrors: PurgeErrorsConfigSchema,
});

export const DcpConfigSchema = Type.Object({
  enabled: Type.Boolean({
    default: true,
    description: "Enable the DCP extension",
  }),
  debug: Type.Boolean({
    default: false,
    description: "Enable debug logging to session directory",
  }),
  nudgeNotification: Type.Union(
    [Type.Literal("off"), Type.Literal("minimal"), Type.Literal("detailed")],
    {
      default: "minimal",
      description: "Notification verbosity for pruning events",
    },
  ),
  nudgeNotificationType: Type.Union(
    [Type.Literal("toast"), Type.Literal("status")],
    {
      default: "status",
      description:
        "Notification delivery: toast (ephemeral) or status (persistent)",
    },
  ),
  protectedFilePatterns: Type.Array(Type.String(), {
    default: [],
    description: "Glob patterns for file paths to protect from pruning",
  }),
  compress: CompressConfigSchema,
  manualMode: ManualModeConfigSchema,
  strategies: StrategiesConfigSchema,
  experimental: ExperimentalConfigSchema,
});

export type DcpConfig = Static<typeof DcpConfigSchema>;
export type CompressConfig = Static<typeof CompressConfigSchema>;
export type DeduplicationConfig = Static<typeof DeduplicationConfigSchema>;
export type PurgeErrorsConfig = Static<typeof PurgeErrorsConfigSchema>;
export type ManualModeConfig = Static<typeof ManualModeConfigSchema>;
export type ExperimentalConfig = Static<typeof ExperimentalConfigSchema>;
export type StrategiesConfig = Static<typeof StrategiesConfigSchema>;
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — the new file compiles. Existing code still imports types from `src/config.ts` which is unchanged so far.

- [ ] **Step 3: Commit**

```bash
git add src/config-schema.ts
git commit -m "feat: add TypeBox config schema definitions"
```

---

### Task 3: Write tests for TypeBox-based config loading

**Files:**
- Modify: `tests/config.test.ts`

This task rewrites the existing config tests to validate the new TypeBox-based loader. The tests are written first; they will fail until Task 4 refactors the loader.

- [ ] **Step 1: Rewrite config tests**

Replace the entire content of `tests/config.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, BASE_PROTECTED_TOOLS } from "../src/config.ts";

describe("config loading", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const configPath = path.join(tempDir, "dcp.json");
    const { config } = loadConfig(configPath);
    expect(config.enabled).toBe(true);
    expect(config.debug).toBe(false);
    expect(config.compress.mode).toBe("range");
    expect(config.compress.permission).toBe("allow");
    expect(config.compress.showCompression).toBe(false);
    expect(config.strategies.deduplication.enabled).toBe(true);
    expect(config.strategies.deduplication.turnProtection).toBe(0);
    expect(config.strategies.purgeErrors.enabled).toBe(true);
    expect(config.nudgeNotification).toBe("minimal");
    expect(config.nudgeNotificationType).toBe("status");
    expect(config.experimental.allowSubAgents).toBe(false);
  });

  it("loads partial config and fills defaults", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        debug: true,
        compress: { mode: "message" },
      }),
    );

    const { config } = loadConfig(configPath);
    expect(config.debug).toBe(true);
    expect(config.compress.mode).toBe("message");
    // Other compress fields should have defaults
    expect(config.compress.permission).toBe("allow");
    expect(config.compress.showCompression).toBe(false);
    expect(config.compress.nudgeFrequency).toBe(5);
    expect(config.enabled).toBe(true);
  });

  it("handles invalid JSON gracefully", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, "not valid json {{{");

    const { config } = loadConfig(configPath);
    expect(config.enabled).toBe(true);
  });

  it("deep merges nested config without losing sibling defaults", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        compress: { mode: "message" },
        strategies: { deduplication: { turnProtection: 5 } },
      }),
    );

    const { config } = loadConfig(configPath);
    expect(config.compress.mode).toBe("message");
    expect(config.compress.permission).toBe("allow"); // sibling default preserved
    expect(config.strategies.deduplication.turnProtection).toBe(5);
    expect(config.strategies.deduplication.enabled).toBe(true); // sibling default preserved
    expect(config.strategies.purgeErrors.enabled).toBe(true); // sibling default preserved
  });

  it("enforces maxContextPercent > minContextPercent", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        compress: { maxContextPercent: 40, minContextPercent: 60 },
      }),
    );

    const { config } = loadConfig(configPath);
    expect(config.compress.maxContextPercent).toBeGreaterThan(
      config.compress.minContextPercent,
    );
  });

  it("parses nudgeNotificationType toast", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, JSON.stringify({ nudgeNotificationType: "toast" }));
    const { config } = loadConfig(configPath);
    expect(config.nudgeNotificationType).toBe("toast");
  });

  it("parses experimental.allowSubAgents", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ experimental: { allowSubAgents: true } }),
    );
    const { config } = loadConfig(configPath);
    expect(config.experimental.allowSubAgents).toBe(true);
  });

  it("parses showCompression true", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ compress: { showCompression: true } }),
    );
    const { config } = loadConfig(configPath);
    expect(config.compress.showCompression).toBe(true);
  });

  it("parses turnProtection", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        strategies: { deduplication: { turnProtection: 5 } },
      }),
    );
    const { config } = loadConfig(configPath);
    expect(config.strategies.deduplication.turnProtection).toBe(5);
  });

  it("resets wrong-typed values to defaults", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        debug: "yes",
        compress: { showCompression: "yes", mode: "range" },
      }),
    );
    const { config, warnings } = loadConfig(configPath);
    expect(config.debug).toBe(false); // reset to default
    expect(config.compress.showCompression).toBe(false); // reset to default
    expect(config.compress.mode).toBe("range"); // valid value preserved
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("config validation warnings", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-config-warn-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns no warnings for valid config", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ enabled: true, debug: false }),
    );
    const { warnings } = loadConfig(configPath);
    expect(warnings).toHaveLength(0);
  });

  it("warns when maxContextPercent exceeds 100", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ compress: { maxContextPercent: 150 } }),
    );
    const { config, warnings } = loadConfig(configPath);
    expect(warnings.some((w) => w.includes("maxContextPercent"))).toBe(true);
    expect(config.compress.maxContextPercent).toBe(80); // reset to default
  });

  it("warns about invalid enum values", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ nudgeNotificationType: "popup" }),
    );
    const { config, warnings } = loadConfig(configPath);
    expect(warnings.length).toBeGreaterThan(0);
    expect(config.nudgeNotificationType).toBe("status"); // reset to default
  });
});

describe("BASE_PROTECTED_TOOLS", () => {
  it('includes "subagent"', () => {
    expect(BASE_PROTECTED_TOOLS).toContain("subagent");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/config.test.ts`
Expected: Most tests pass (behavior is the same), some may fail because the test structure changed. The "resets wrong-typed values to defaults" test will fail until Task 4 adds type mismatch handling.

- [ ] **Step 3: Commit**

```bash
git add tests/config.test.ts
git commit -m "test: rewrite config tests for TypeBox validation"
```

---

### Task 4: Refactor config.ts to use TypeBox

**Files:**
- Modify: `src/config.ts`

This is the largest task. It replaces hand-written interfaces, `mergeConfig`, and known-key validation with TypeBox.

- [ ] **Step 1: Replace config.ts**

Replace the entire content of `src/config.ts` with:

```ts
import * as fs from "node:fs";
import { Value } from "typebox/value";
import {
  DcpConfigSchema,
  type DcpConfig,
  type CompressConfig,
  type DeduplicationConfig,
  type PurgeErrorsConfig,
  type ManualModeConfig,
  type ExperimentalConfig,
  type StrategiesConfig,
} from "./config-schema.ts";

// Re-export types so existing imports from config.ts continue to work
export type {
  DcpConfig,
  CompressConfig,
  DeduplicationConfig,
  PurgeErrorsConfig,
  ManualModeConfig,
  ExperimentalConfig,
  StrategiesConfig,
};

/**
 * Tool names always protected from pruning strategies.
 * Pi's core tools that should never have their outputs removed.
 */
export const BASE_PROTECTED_TOOLS = [
  "compress",
  "bash",
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
  "subagent",
];

// Value.Create fills all schema defaults, but Optional fields without
// defaults resolve to undefined. Override the context limits that need
// concrete defaults for threshold calculations.
export const DEFAULT_CONFIG: DcpConfig = (() => {
  const config = Value.Create(DcpConfigSchema) as DcpConfig;
  config.compress.protectedTools = ["compress"];
  config.compress.maxContextLimit = 200000;
  config.compress.minContextLimit = 100000;
  return config;
})();

export interface LoadConfigResult {
  config: DcpConfig;
  warnings: string[];
}

/**
 * Load DCP configuration from a single JSON file.
 * Falls back to defaults on missing file, parse error, or invalid content.
 * Returns warnings for validation errors and out-of-range values.
 * Invalid-typed values are reset to their defaults.
 *
 * @param configFilePath - Absolute path to dcp.json (typically resolved via getAgentDir())
 */
export function loadConfig(configFilePath: string): LoadConfigResult {
  const warnings: string[] = [];
  const defaults = structuredClone(DEFAULT_CONFIG);

  const parsed = parseConfigFile(configFilePath);
  if (!parsed) return { config: defaults, warnings };

  // Deep merge raw user config over defaults so partial nested objects
  // (e.g. { compress: { mode: "message" } }) don't wipe sibling defaults.
  const merged = deepMerge(
    structuredClone(defaults) as Record<string, unknown>,
    parsed,
  );

  // Clean unknown properties first
  Value.Clean(DcpConfigSchema, merged);

  // Validate and reset invalid values to defaults
  if (!Value.Check(DcpConfigSchema, merged)) {
    for (const error of Value.Errors(DcpConfigSchema, merged)) {
      warnings.push(`Config error at ${error.path}: ${error.message}`);
      // Reset invalid path to default value
      const defaultValue = getByPath(
        defaults as unknown as Record<string, unknown>,
        error.path,
      );
      if (defaultValue !== undefined) {
        setByPath(merged, error.path, structuredClone(defaultValue));
      }
    }
  }

  const config = merged as unknown as DcpConfig;

  // Post-validation range fixes (semantic constraints TypeBox can't express)
  if (config.compress.maxContextPercent > 100) {
    warnings.push(
      `maxContextPercent (${config.compress.maxContextPercent}) exceeds 100, reset to default`,
    );
    config.compress.maxContextPercent = DEFAULT_CONFIG.compress.maxContextPercent;
  }
  if (config.compress.minContextPercent > 100) {
    warnings.push(
      `minContextPercent (${config.compress.minContextPercent}) exceeds 100, reset to default`,
    );
    config.compress.minContextPercent = DEFAULT_CONFIG.compress.minContextPercent;
  }
  if (config.compress.maxContextPercent <= config.compress.minContextPercent) {
    config.compress.maxContextPercent = DEFAULT_CONFIG.compress.maxContextPercent;
    config.compress.minContextPercent = DEFAULT_CONFIG.compress.minContextPercent;
  }

  return { config, warnings };
}

function parseConfigFile(
  filePath: string,
): Record<string, unknown> | undefined {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Recursively merge source into target.
 * Objects merge recursively. Primitives and arrays in source overwrite target.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      target[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else {
      target[key] = srcVal;
    }
  }
  return target;
}

/**
 * Get a value from a nested object using a JSON Pointer path (e.g. "/compress/mode").
 */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split("/").filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Set a value in a nested object using a JSON Pointer path (e.g. "/compress/mode").
 */
function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return;
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = current[parts[i]];
    if (next === null || typeof next !== "object") return;
    current = next as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}
```

- [ ] **Step 2: Fix any import mismatches**

Check if any file imports types that were renamed or moved. The key types (`DcpConfig`, `CompressConfig`, etc.) are re-exported from `config.ts`, so existing imports should continue to work. The `StrategiesConfig` interface was previously not explicitly exported — it's now exported. Verify:

Run: `pnpm typecheck`

If there are errors about `StrategiesConfig` not being found in import paths, they just need to add the import. But since `config.ts` re-exports it, existing `import type { DcpConfig } from "../config.ts"` patterns should work.

Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `pnpm check`
Expected: All tests pass. The refactored `loadConfig` produces the same behavior for valid configs and now correctly resets wrong-typed values to defaults.

- [ ] **Step 4: Commit**

```bash
git add src/config.ts
git commit -m "refactor: replace hand-written config validation with TypeBox"
```

---

### Task 5: Update test helpers

**Files:**
- Modify: `tests/helpers.ts`

- [ ] **Step 1: Verify makeDefaultConfig matches TypeBox-derived type**

The import `import type { DcpConfig } from "../src/config.ts"` should still work since types are re-exported. Verify the `makeDefaultConfig` function matches the TypeBox-derived type. The defaults should match the current implemented values:

Ensure `tests/helpers.ts` `makeDefaultConfig` has this structure:

```ts
export function makeDefaultConfig(overrides?: Partial<DcpConfig["compress"]>): DcpConfig {
  return {
    enabled: true,
    debug: false,
    compress: {
      mode: "range",
      permission: "allow",
      maxContextPercent: 80,
      minContextPercent: 50,
      nudgeFrequency: 5,
      iterationNudgeThreshold: 15,
      nudgeForce: "soft",
      protectedTools: [],
      protectUserMessages: false,
      protectTags: false,
      showCompression: false,
      summaryBuffer: true,
      maxContextLimit: undefined,
      minContextLimit: undefined,
      modelMaxLimits: undefined,
      modelMinLimits: undefined,
      ...overrides,
    },
    manualMode: { default: false, automaticStrategies: true },
    strategies: {
      deduplication: { enabled: true, protectedTools: [], turnProtection: 0 },
      purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
    },
    protectedFilePatterns: [],
    nudgeNotification: "minimal",
    nudgeNotificationType: "status",
    experimental: { allowSubAgents: false, customPrompts: false },
  };
}
```

This should already match the current `tests/helpers.ts`. If it does, no changes are needed.

- [ ] **Step 2: Run all tests**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 3: Commit (if changes were needed)**

```bash
git add tests/helpers.ts
git commit -m "test: align makeDefaultConfig with TypeBox schema"
```

---

### Task 6: Add JSON Schema generation script

**Files:**
- Create: `scripts/generate-schema.ts`
- Generate: `dcp.schema.json`
- Modify: `package.json`

- [ ] **Step 1: Create the generation script**

Create `scripts/generate-schema.ts`:

```ts
import { DcpConfigSchema } from "../src/config-schema.ts";

const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "DCP Configuration",
  description: "Configuration schema for the pi-dcp extension",
  ...DcpConfigSchema,
};

console.log(JSON.stringify(schema, null, 2));
```

- [ ] **Step 2: Add script to package.json**

In `package.json`, add `generate:schema` to the `scripts` section and update `check` to include it:

```json
{
  "scripts": {
    "format": "biome format --write .",
    "lint": "biome lint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "generate:schema": "tsx scripts/generate-schema.ts > dcp.schema.json",
    "check": "biome lint . && tsc --noEmit && vitest run && pnpm run generate:schema",
    "pack:dry-run": "pnpm pack --dry-run",
    "release:check": "pnpm check && pnpm run pack:dry-run"
  }
}
```

- [ ] **Step 3: Check if tsx is available**

Run: `pnpm exec tsx --version`

If tsx is not installed:

```bash
pnpm add -D tsx
```

- [ ] **Step 4: Generate the schema**

Run:

```bash
pnpm run generate:schema
```

Expected: `dcp.schema.json` is created at the repo root with valid JSON Schema content.

- [ ] **Step 5: Verify the generated schema**

Run: `cat dcp.schema.json | head -20`

Expected output should include:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "DCP Configuration",
  "description": "Configuration schema for the pi-dcp extension",
  "type": "object",
  "properties": {
```

- [ ] **Step 6: Run full check**

Run: `pnpm check`
Expected: All lint, typecheck, tests, and schema generation pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-schema.ts dcp.schema.json package.json
git commit -m "feat: add JSON Schema generation from TypeBox definitions"
```
