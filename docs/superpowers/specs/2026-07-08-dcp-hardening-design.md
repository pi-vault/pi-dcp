# DCP Hardening: 5-Phase Design Spec

Close remaining feature gaps identified by comparing `pi-dcp` with `opencode-dynamic-context-pruning`. Each phase is atomic and independently deployable. Phases are ordered from simplest to most complex.

**Dependency chain:** Phase 5 (TypeBox config refactor) absorbs config fields added in Phases 1-3. All other phases are independent.

---

## Resolved Design Decisions

| Decision                               | Resolution                                                                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1: what showCompression controls | When `false`, compressed ranges are silently removed from context — no summary injected. Model gets cleaner context but loses awareness of compressed content.                   |
| Phase 2: permission scope              | Enforce existing `allow/deny` at the framework level via `tool_call` event. Add runtime toggling via `dcp:permission` command. No "ask" mode — manual mode covers that use case. |
| Phase 3: turn protection scope         | Dedup strategy only. Error purge already has its own turn threshold. A global turn window would conflict with it.                                                                |
| Phase 4: tokenizer choice              | `@anthropic-ai/tokenizer` (same as opencode). Adds a runtime dependency but provides accurate counts for compression sizing.                                                     |
| Phase 4: fallback behavior             | Try tokenizer first, fall back to `Math.round(text.length / 4)` if tokenizer throws.                                                                                             |
| Phase 5: schema strategy               | TypeBox as single source of truth — derive TypeScript types, runtime validation, and JSON Schema from one definition.                                                            |

---

## Phase 1: showCompression Config

**Problem:** Compression summaries (`[Compressed Block bN]...`) are always injected into context. Some users prefer compressed ranges to vanish silently, keeping context cleaner for the model.

**Changes:**

1. **Add `showCompression: boolean` to `CompressConfig`** (default: `true`).

2. **Modify `filterCompressedRanges` in `src/messages/prune.ts`** — Accept the config value (or pass it through the pipeline). When `showCompression === false`, skip the summary injection at anchor points. The compressed range is still removed (the `continue` path for covered messages stays the same), but no synthetic user message replaces it:

   ```ts
   // Current behavior (showCompression: true):
   if (blockId !== undefined) {
     const block = state.prune.messages.blocksById.get(blockId);
     if (block?.active && block.summary) {
       result.push({
         role: "user",
         content: [{ type: "text", text: block.summary }],
         timestamp: Date.now(),
       } as AgentMessage);
     }
   }

   // New behavior (showCompression: false):
   // Skip the push — compressed messages are removed, nothing replaces them.
   ```

3. **Thread config to `filterCompressedRanges`** — Currently `filterCompressedRanges(state, messages)` only takes state and messages. Add `showCompression: boolean` as a third parameter. Update the call site in `applyPruning` to pass it through.

4. **Update `applyPruning` signature** — Add `showCompression: boolean` parameter, pass from `runPipeline` where config is available.

**Files touched:** `src/config.ts`, `src/messages/prune.ts`, `src/pipeline.ts`

**Tests:**

- With `showCompression: true` (default): compressed ranges replaced with summary messages (existing behavior, no regression).
- With `showCompression: false`: compressed ranges removed, no summary messages in output, orphan cleanup still runs.

---

## Phase 2: Permission Gating via `tool_call`

**Problem:** `config.compress.permission = "deny"` only suppresses the system prompt instruction in `before_agent_start`. The compress tool itself is still registered and callable — a model could invoke it. The `state.compressPermission` field exists but is initialized to `undefined` and never set.

**Changes:**

1. **Register a `tool_call` handler** in `src/index.ts`:

   ```ts
   pi.on("tool_call", async (event, _ctx) => {
     if (event.toolName !== "compress") return undefined;

     const permission = state.compressPermission ?? config.compress.permission;
     if (permission === "deny") {
       return { block: true, reason: "Compression denied by configuration" };
     }
     return undefined;
   });
   ```

   This enforces the deny at the framework level. The compress tool call is blocked before execution begins.

2. **Initialize `state.compressPermission` from config** in `createSessionState` and `session_start`:

   ```ts
   // In session_start handler, after config reload:
   state.compressPermission = config.compress.permission;
   ```

   This makes the state field reflect the config value at session start rather than being `undefined`.

3. **Add `dcp:permission` command** — Toggles `state.compressPermission` between `"allow"` and `"deny"` at runtime. Registered in `src/commands/register.ts`. The command handler toggles the value and reports the new state:

   ```ts
   // In src/commands/permission.ts:
   export async function handlePermission(
     state: SessionState,
     _args: string,
     ctx: ExtensionCommandContext,
   ): Promise<void> {
     const current = state.compressPermission ?? "allow";
     state.compressPermission = current === "allow" ? "deny" : "allow";
     ctx.reply(`Compress permission: ${state.compressPermission}`);
   }
   ```

4. **Update nudge injection** — `src/messages/inject.ts` already checks `state.compressPermission === "deny"` to skip nudges. This continues working as-is, now that the field is properly initialized.

**Files touched:** `src/index.ts`, `src/state/state.ts`, `src/commands/permission.ts` (new), `src/commands/register.ts`

**Tests:**

- `tool_call` handler blocks compress when permission is `"deny"`.
- `tool_call` handler allows compress when permission is `"allow"`.
- State initialized from config value on session start.
- `dcp:permission` command toggles between allow and deny.
- Nudge injection skipped when permission is deny (existing test, verify no regression).

---

## Phase 3: Turn Protection for Deduplication

**Problem:** The deduplication strategy prunes all but the last duplicate tool output regardless of recency. A tool called 1 turn ago gets pruned the same as one called 20 turns ago, even though the recent output may still be relevant.

**Changes:**

1. **Add `turnProtection: number` to `DeduplicationConfig`** (default: `3`, `0` disables):

   ```ts
   interface DeduplicationConfig {
     enabled: boolean;
     protectedTools: string[];
     turnProtection: number; // new
   }
   ```

2. **Modify deduplication loop in `src/strategies/runner.ts`** — Before marking a duplicate for pruning, check if it's within the turn protection window:

   ```ts
   // In the "Prune all but last in each group" loop:
   for (let i = 0; i < callIds.length - 1; i++) {
     const callId = callIds[i];
     const entry = state.toolParameters.get(callId);
     if (!entry) continue;

     // Turn protection: skip if this entry is too recent
     const turnProtection = config.strategies.deduplication.turnProtection;
     if (
       turnProtection > 0 &&
       state.currentTurn - entry.turn < turnProtection
     ) {
       continue;
     }

     const tokens = entry?.tokenCount ?? 0;
     state.prune.tools.set(callId, tokens);
     pruned++;
     tokensSaved += tokens;
     if (entry) prunedToolNames.push(entry.tool);
   }
   ```

   The last entry in each group is already protected (the loop runs `i < length - 1`). Turn protection adds a second guard: even non-last entries are kept if they're recent enough.

3. **Update `mergeConfig`** — Add parsing for the new `turnProtection` field under `strategies.deduplication`.

**Files touched:** `src/config.ts`, `src/strategies/runner.ts`

**Tests:**

- Duplicate within turn window: not pruned.
- Duplicate outside turn window: pruned as before.
- `turnProtection: 0`: all duplicates pruned (disabled, existing behavior).
- Turn protection does not affect the last entry in a duplicate group (already protected by the loop bound).
- Turn protection does not affect purge-errors strategy (independent).

---

## Phase 4: Accurate Token Counting

**Problem:** `countTokens()` uses `Math.round(text.length / 4)` — a rough heuristic. This affects compression block size estimates and tool cache entry sizing. While Pi's `ctx.getContextUsage()` provides accurate totals from the provider, per-message estimates drive relative comparisons (priority ranking, summary buffer calculations).

**Changes:**

1. **Add `@anthropic-ai/tokenizer` as a runtime dependency:**

   ```bash
   pnpm add @anthropic-ai/tokenizer
   ```

2. **Refactor `src/utils/tokens.ts`** — Replace the heuristic with the Anthropic tokenizer, keeping the same public API:

   ```ts
   import { countTokens as anthropicCountTokens } from "@anthropic-ai/tokenizer";

   /**
    * Count tokens using the Anthropic tokenizer.
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

   `countTokensBatch`, `extractMessageText`, and `countMessageTokens` remain unchanged — they delegate to `countTokens` and continue working.

3. **Update JSDoc** — Replace the comment about "character-based estimation for relative comparisons" with a note about using the Anthropic tokenizer with fallback.

**Files touched:** `src/utils/tokens.ts`, `package.json`

**Call sites unchanged:** `src/compress/handler.ts` and `src/state/tool-cache.ts` import `countTokens` — no changes needed since the function signature is the same.

**Tests:**

- Known string produces a different (more accurate) count than `Math.round(length / 4)`.
- Empty string returns `0`.
- Fallback: mock tokenizer to throw, verify `length/4` fallback is used.
- `countTokensBatch` and `countMessageTokens` still work with the new implementation.

---

## Phase 5: Config Validation + JSON Schema via TypeBox

**Problem:** Config validation in `config.ts` is hand-written with basic `typeof` checks and no descriptive error messages. There is no JSON Schema file for IDE autocomplete. TypeBox is already a dev dependency (used for tool parameter schemas) but not used for config validation.

**Changes:**

### 5a. New file: `src/config-schema.ts`

Define the full config schema using TypeBox. This becomes the single source of truth for types, validation, and JSON Schema generation.

```ts
import { Type, type Static } from "typebox";

const DeduplicationConfigSchema = Type.Object({
  enabled: Type.Boolean({
    default: true,
    description: "Enable deduplication strategy",
  }),
  protectedTools: Type.Array(Type.String(), {
    default: [],
    description: "Tool names excluded from deduplication (glob patterns)",
  }),
  turnProtection: Type.Number({
    default: 3,
    minimum: 0,
    description:
      "Protect duplicate tool outputs from pruning for N turns after invocation. 0 disables.",
  }),
});

const PurgeErrorsConfigSchema = Type.Object({
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

const CompressConfigSchema = Type.Object({
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
    default: true,
    description:
      "When false, compressed ranges are silently removed without injecting summary blocks",
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
    description: "Preserve <protect>...</protect> tag content in summaries",
  }),
  summaryBuffer: Type.Boolean({
    default: true,
    description:
      "Exclude active summary tokens from threshold comparison to prevent cascading",
  }),
});

const ManualModeConfigSchema = Type.Object({
  default: Type.Union([Type.Literal(false), Type.Literal("active")], {
    default: false,
    description: "Initial manual mode state",
  }),
  automaticStrategies: Type.Boolean({
    default: true,
    description: "Run automatic strategies even in manual mode",
  }),
});

const ExperimentalConfigSchema = Type.Object({
  allowSubAgents: Type.Boolean({
    default: false,
    description: "Enable DCP in sub-agent child sessions",
  }),
  customPrompts: Type.Boolean({
    default: false,
    description: "Enable filesystem-based prompt overrides",
  }),
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
  strategies: Type.Object({
    deduplication: DeduplicationConfigSchema,
    purgeErrors: PurgeErrorsConfigSchema,
  }),
  experimental: ExperimentalConfigSchema,
});

export type DcpConfig = Static<typeof DcpConfigSchema>;
export type CompressConfig = Static<typeof CompressConfigSchema>;
export type DeduplicationConfig = Static<typeof DeduplicationConfigSchema>;
export type PurgeErrorsConfig = Static<typeof PurgeErrorsConfigSchema>;
export type ManualModeConfig = Static<typeof ManualModeConfigSchema>;
export type ExperimentalConfig = Static<typeof ExperimentalConfigSchema>;
```

### 5b. Refactored `src/config.ts`

Replace hand-written interfaces and validation with TypeBox-based logic:

- **Remove**: `DcpConfig`, `CompressConfig`, `ManualModeConfig`, `DeduplicationConfig`, `PurgeErrorsConfig`, `ExperimentalConfig` interfaces (replaced by TypeBox-derived types from `config-schema.ts`).
- **Remove**: `validateConfig` function (replaced by TypeBox `Value.Check` / `Value.Errors`).
- **Remove**: `mergeConfig` function (replaced by TypeBox `Value.Default` + `Value.Clean` + `Value.Decode`).
- **Keep**: `loadConfig()` function signature and file-reading logic. Internals change to use TypeBox validation.
- **Keep**: `DEFAULT_CONFIG` as a constant — derive from TypeBox defaults using `Value.Create(DcpConfigSchema)`.
- **Keep**: `BASE_PROTECTED_TOOLS` constant (unchanged).
- **Keep**: `parseConfigFile` helper (unchanged).

New validation flow in `loadConfig`:

```ts
import { Value } from "typebox/value";
import { DcpConfigSchema, type DcpConfig } from "./config-schema.ts";

export function loadConfig(filePath: string): {
  config: DcpConfig;
  warnings: string[];
} {
  const warnings: string[] = [];
  const defaults = Value.Create(DcpConfigSchema);

  const raw = parseConfigFile(filePath);
  if (!raw) return { config: defaults, warnings };

  // Deep merge raw user config over defaults so partial nested objects
  // (e.g. { compress: { mode: "message" } }) don't wipe sibling defaults.
  const merged = deepMerge(structuredClone(defaults), raw);

  // Apply schema defaults for any fields still missing after merge
  Value.Default(DcpConfigSchema, merged);

  // Validate and collect errors
  if (!Value.Check(DcpConfigSchema, merged)) {
    for (const error of Value.Errors(DcpConfigSchema, merged)) {
      warnings.push(`Config error at ${error.path}: ${error.message}`);
    }
  }

  // Clean unknown properties
  const cleaned = Value.Clean(DcpConfigSchema, merged);

  // Cast and return (errors are warnings, not fatal — fall back to defaults for invalid fields)
  return {
    config: Value.Decode(DcpConfigSchema, cleaned) as DcpConfig,
    warnings,
  };
}
```

`deepMerge` is a simple recursive merge (objects merge recursively, primitives/arrays overwrite). This ensures partial nested objects like `{ compress: { mode: "message" } }` merge correctly without wiping sibling defaults. Unknown keys are removed by `Value.Clean`. Invalid values produce descriptive warnings via `Value.Errors` with JSON Pointer paths (e.g., `/compress/nudgeFrequency`).

### 5c. JSON Schema file: `dcp.schema.json`

TypeBox schemas are valid JSON Schema. Add a build script to generate the file:

```ts
// scripts/generate-schema.ts
import { DcpConfigSchema } from "../src/config-schema.ts";

const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "DCP Configuration",
  description: "Configuration schema for the pi-dcp extension",
  ...DcpConfigSchema,
};

console.log(JSON.stringify(schema, null, 2));
```

Add to `package.json`:

```json
{
  "scripts": {
    "generate:schema": "tsx scripts/generate-schema.ts > dcp.schema.json",
    "check": "biome lint . && tsc --noEmit && vitest run && pnpm run generate:schema"
  }
}
```

The generated `dcp.schema.json` is committed to the repo root. Users reference it in their config file for IDE autocomplete:

```json
{
  "$schema": "https://raw.githubusercontent.com/pi-vault/pi-dcp/master/dcp.schema.json"
}
```

### 5d. Move TypeBox to runtime dependency

TypeBox is currently a dev dependency (used only for tool parameter schemas in `src/index.ts`). Since `config-schema.ts` imports TypeBox at runtime for validation via `Value.*`, move it to `dependencies`:

```bash
pnpm remove typebox
pnpm add typebox
```

Note: `src/index.ts` already imports `Type` from `typebox` for tool parameters, so this is already a de facto runtime dependency.

**Files touched:** `src/config-schema.ts` (new), `src/config.ts` (refactored), `scripts/generate-schema.ts` (new), `dcp.schema.json` (generated), `package.json`

**Tests:**

- Valid config passes validation, returns no warnings.
- Missing fields get defaults from schema.
- Wrong type produces descriptive error with JSON Pointer path.
- Unknown keys are removed (no crash, warning generated).
- Enum fields reject invalid values.
- Numeric fields with `minimum` constraints reject out-of-range values.
- Generated JSON Schema matches expected structure (snapshot test or key assertions).
- `DEFAULT_CONFIG` derived from TypeBox matches expected defaults.
- All existing config tests adapted to new validation flow.
