# Phase 7: Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **IMPORTANT:** Read `plans/ERRATA.md` before implementing. It contains corrections to API signatures, type shapes, and import paths verified against Pi source.

**Goal:** Add state persistence, cross-session statistics, config validation, status bar integration, a `dcp:lifetime` command, and a full integration test.

**Prerequisite:** Phase 6 (Commands) completed and passing. All commands already use `dcp:subcommand` format.

**Architecture:** Persistence writes session state to `{sessionDir}/dcp/state.json` on shutdown/compression events. Config validation returns warnings that are logged after the Logger is created. Status bar shows real-time token savings via `ctx.ui.setStatus()`. Integration test exercises the full extension lifecycle with a mock Pi API.

**Tech Stack:** TypeScript, Vitest, Node.js `fs` module, Pi Extension API (`ExtensionContext`)

---

## File Structure (additions to Phase 6)

```
src/
  state/
    persistence.ts              # Save/load state to disk
  commands/
    lifetime.ts                 # Aggregate stats across all sessions
    register.ts                 # (modify) Add dcp:lifetime command
  config.ts                     # (modify) Return warnings array from loadConfig
  index.ts                      # (modify) Status bar, persistence wiring, log config warnings
tests/
  persistence.test.ts           # Persistence unit tests
  commands-lifetime.test.ts     # Lifetime command tests
  config.test.ts                # (modify) Add validation warning tests
  integration.test.ts           # End-to-end test
```

---

### Task 1: State Persistence

**Files:**

- Create: `src/state/persistence.ts`
- Test: `tests/persistence.test.ts`

Save session state to `{sessionDir}/dcp/state.json` on significant events. Load on session_start if state exists. The `sessionDir` is resolved via `ctx.sessionManager.getSessionDir()` and passed to the save/load functions.

- [ ] **Step 1: Write tests**

Create `tests/persistence.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  saveSessionState,
  loadSessionState,
  loadAllSessionStats,
} from "../src/state/persistence.ts";
import { createSessionState } from "../src/state/state.ts";

describe("persistence", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-persist-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("saves and loads session state", () => {
    const state = createSessionState();
    state.sessionId = "test-session";
    state.currentTurn = 5;
    state.stats.toolsPruned = 3;
    state.stats.totalPruneTokens = 500;
    state.stats.messagesCompressed = 2;
    state.prune.tools.set("c1", 100);

    const stateDir = path.join(tempDir, "test-session-dir");
    fs.mkdirSync(stateDir, { recursive: true });
    saveSessionState(state, stateDir);

    const loaded = loadSessionState(stateDir);
    expect(loaded).toBeDefined();
    expect(loaded!.currentTurn).toBe(5);
    expect(loaded!.stats.toolsPruned).toBe(3);
    expect(loaded!.stats.totalPruneTokens).toBe(500);
    expect(loaded!.stats.messagesCompressed).toBe(2);
    expect(loaded!.lastCompaction).toBe(0);
  });

  it("returns undefined when no state file exists", () => {
    const loaded = loadSessionState(tempDir);
    expect(loaded).toBeUndefined();
  });

  it("handles corrupt JSON gracefully", () => {
    const dcpDir = path.join(tempDir, "dcp");
    fs.mkdirSync(dcpDir, { recursive: true });
    fs.writeFileSync(path.join(dcpDir, "state.json"), "not json");

    const loaded = loadSessionState(tempDir);
    expect(loaded).toBeUndefined();
  });

  it("does not write when sessionId is null", () => {
    const state = createSessionState();
    state.sessionId = null;

    saveSessionState(state, tempDir);

    const dcpDir = path.join(tempDir, "dcp");
    expect(fs.existsSync(path.join(dcpDir, "state.json"))).toBe(false);
  });

  describe("loadAllSessionStats", () => {
    it("aggregates stats from multiple session dirs", () => {
      // Create two session dirs with state files
      const dir1 = path.join(tempDir, "session-1", "dcp");
      const dir2 = path.join(tempDir, "session-2", "dcp");
      fs.mkdirSync(dir1, { recursive: true });
      fs.mkdirSync(dir2, { recursive: true });

      fs.writeFileSync(
        path.join(dir1, "state.json"),
        JSON.stringify({
          stats: {
            totalPruneTokens: 300,
            toolsPruned: 2,
            messagesCompressed: 1,
            pruneTokenCounter: 0,
          },
        }),
      );
      fs.writeFileSync(
        path.join(dir2, "state.json"),
        JSON.stringify({
          stats: {
            totalPruneTokens: 700,
            toolsPruned: 5,
            messagesCompressed: 3,
            pruneTokenCounter: 0,
          },
        }),
      );

      const result = loadAllSessionStats(tempDir);
      expect(result.totalTokensSaved).toBe(1000);
      expect(result.totalToolsPruned).toBe(7);
      expect(result.totalMessagesCompressed).toBe(4);
      expect(result.sessionCount).toBe(2);
    });

    it("returns zeros when directory does not exist", () => {
      const result = loadAllSessionStats("/tmp/nonexistent-dcp-dir-xyz");
      expect(result.totalTokensSaved).toBe(0);
      expect(result.sessionCount).toBe(0);
    });

    it("skips corrupt state files", () => {
      const dir1 = path.join(tempDir, "good-session", "dcp");
      const dir2 = path.join(tempDir, "bad-session", "dcp");
      fs.mkdirSync(dir1, { recursive: true });
      fs.mkdirSync(dir2, { recursive: true });

      fs.writeFileSync(
        path.join(dir1, "state.json"),
        JSON.stringify({
          stats: {
            totalPruneTokens: 100,
            toolsPruned: 1,
            messagesCompressed: 0,
            pruneTokenCounter: 0,
          },
        }),
      );
      fs.writeFileSync(path.join(dir2, "state.json"), "{{{invalid");

      const result = loadAllSessionStats(tempDir);
      expect(result.totalTokensSaved).toBe(100);
      expect(result.sessionCount).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/persistence.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement persistence**

Create `src/state/persistence.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionState, SessionStats } from "./types.ts";

/**
 * Serializable subset of session state for persistence.
 */
interface SerializedState {
  sessionId: string | null;
  currentTurn: number;
  stats: SessionStats;
  lastCompaction: number;
}

/**
 * Save session state to {sessionDir}/dcp/state.json.
 * No-op if state.sessionId is null.
 */
export function saveSessionState(
  state: SessionState,
  sessionDir: string,
): void {
  if (!state.sessionId) return;

  const dcpDir = path.join(sessionDir, "dcp");
  fs.mkdirSync(dcpDir, { recursive: true });

  const serialized: SerializedState = {
    sessionId: state.sessionId,
    currentTurn: state.currentTurn,
    stats: { ...state.stats },
    lastCompaction: state.lastCompaction,
  };

  fs.writeFileSync(
    path.join(dcpDir, "state.json"),
    JSON.stringify(serialized, null, 2),
  );
}

/**
 * Load session state from {sessionDir}/dcp/state.json.
 * Returns undefined if the file doesn't exist or is corrupt.
 */
export function loadSessionState(
  sessionDir: string,
): Pick<SessionState, "currentTurn" | "stats" | "lastCompaction"> | undefined {
  const filePath = path.join(sessionDir, "dcp", "state.json");

  try {
    if (!fs.existsSync(filePath)) return undefined;
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as SerializedState;

    return {
      currentTurn: parsed.currentTurn ?? 0,
      stats: parsed.stats ?? {
        pruneTokenCounter: 0,
        totalPruneTokens: 0,
        toolsPruned: 0,
        messagesCompressed: 0,
      },
      lastCompaction: parsed.lastCompaction ?? 0,
    };
  } catch {
    return undefined;
  }
}

/**
 * Load aggregate stats from all saved sessions under a parent directory.
 * Expects structure: {parentDir}/{sessionName}/dcp/state.json
 * Used by dcp:lifetime command.
 */
export function loadAllSessionStats(parentDir: string): {
  totalTokensSaved: number;
  totalToolsPruned: number;
  totalMessagesCompressed: number;
  sessionCount: number;
} {
  const result = {
    totalTokensSaved: 0,
    totalToolsPruned: 0,
    totalMessagesCompressed: 0,
    sessionCount: 0,
  };

  try {
    if (!fs.existsSync(parentDir)) return result;
    const entries = fs.readdirSync(parentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const stateFile = path.join(parentDir, entry.name, "dcp", "state.json");
      try {
        if (!fs.existsSync(stateFile)) continue;
        const content = fs.readFileSync(stateFile, "utf-8");
        const parsed = JSON.parse(content) as SerializedState;
        if (parsed.stats) {
          result.totalTokensSaved += parsed.stats.totalPruneTokens ?? 0;
          result.totalToolsPruned += parsed.stats.toolsPruned ?? 0;
          result.totalMessagesCompressed +=
            parsed.stats.messagesCompressed ?? 0;
          result.sessionCount++;
        }
      } catch {
        // Skip corrupt files
      }
    }
  } catch {
    // Dir not accessible
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm run typecheck
pnpm test -- tests/persistence.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/persistence.ts tests/persistence.test.ts
git commit -m "feat: add session state persistence"
```

---

### Task 2: Wire Persistence into Extension Lifecycle

**Files:**

- Modify: `src/index.ts`

Save state on `session_shutdown` and after compression. Load state on `session_start` if continuing a session (resume). The `sessionDir` comes from `ctx.sessionManager.getSessionDir()`, which is already used in the `session_start` handler.

- [ ] **Step 1: Add persistence import and sessionDir tracking**

Add to the top of `src/index.ts` (after existing imports):

```typescript
import { saveSessionState, loadSessionState } from "./state/persistence.ts";
```

Add a `sessionDir` variable after `let latestMessages`:

```typescript
let sessionDir: string = "";
```

- [ ] **Step 2: Update session_start handler to load persisted state**

In the `session_start` handler, after `resetSessionState(state)` and session ID assignment, add state loading for resume scenarios. The handler already sets `sessionDir` from `ctx.sessionManager.getSessionDir()` — store it in the module-level variable:

```typescript
pi.on("session_start", async (event, ctx) => {
  sessionDir = ctx.sessionManager.getSessionDir();
  const logDir = path.join(sessionDir, "dcp", "logs");
  reloadConfig(logDir);
  if (!config.enabled) return;

  resetSessionState(state);
  state.sessionId = `pi-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  state.manualMode = config.manualMode.default;

  // Load persisted state if resuming
  if (event.reason === "resume") {
    const persisted = loadSessionState(sessionDir);
    if (persisted) {
      state.currentTurn = persisted.currentTurn;
      state.stats = persisted.stats;
      state.lastCompaction = persisted.lastCompaction;
      logger.info("dcp", "resumed persisted state", {
        turn: state.currentTurn,
      });
    }
  }

  const usage = ctx.getContextUsage();
  if (usage) {
    state.modelContextWindow = usage.contextWindow;
  }

  logger.info("dcp", "session started", {
    sessionId: state.sessionId,
    reason: event.reason,
    mode: config.compress.mode,
  });
});
```

- [ ] **Step 3: Update session_shutdown handler to save state**

```typescript
pi.on("session_shutdown", async (_event, _ctx) => {
  if (sessionDir) {
    saveSessionState(state, sessionDir);
  }
  logger.info("dcp", "session shutdown, state saved");
});
```

- [ ] **Step 4: Verify typecheck and existing tests**

```bash
pnpm run typecheck
pnpm test
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire state persistence into session lifecycle"
```

---

### Task 3: Config Validation with Warnings

**Files:**

- Modify: `src/config.ts`
- Modify: `src/index.ts`
- Modify: `tests/config.test.ts`

Change `loadConfig` to return `{ config, warnings }` so callers can log warnings after the Logger is created. Add warnings for unknown top-level keys and out-of-range percentages.

- [ ] **Step 1: Add tests for validation warnings**

Append to `tests/config.test.ts`:

```typescript
describe("config validation warnings", () => {
  it("warns about unknown top-level keys", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ enabled: true, unknownKey: "value", anotherBad: 123 }),
    );
    const { warnings } = loadConfig(configPath);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes("unknownKey"))).toBe(true);
    expect(warnings.some((w) => w.includes("anotherBad"))).toBe(true);
  });

  it("warns about unknown compress keys", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ compress: { mode: "range", badOption: true } }),
    );
    const { warnings } = loadConfig(configPath);
    expect(warnings.some((w) => w.includes("badOption"))).toBe(true);
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/config.test.ts
```

Expected: FAIL (loadConfig doesn't return `{ config, warnings }` yet).

- [ ] **Step 3: Update loadConfig to return warnings**

Modify `src/config.ts`. Change the return type and add unknown-key detection:

```typescript
const KNOWN_TOP_LEVEL_KEYS = new Set([
  "enabled",
  "debug",
  "compress",
  "manualMode",
  "strategies",
  "protectedFilePatterns",
  "nudgeNotification",
]);

const KNOWN_COMPRESS_KEYS = new Set([
  "mode",
  "permission",
  "maxContextPercent",
  "minContextPercent",
  "nudgeFrequency",
  "iterationNudgeThreshold",
  "nudgeForce",
  "protectedTools",
  "protectUserMessages",
  "protectTags",
]);

export interface LoadConfigResult {
  config: DcpConfig;
  warnings: string[];
}

export function loadConfig(configFilePath: string): LoadConfigResult {
  const config = structuredClone(DEFAULT_CONFIG);
  const warnings: string[] = [];

  const parsed = parseConfigFile(configFilePath);
  if (parsed) {
    // Check for unknown top-level keys
    for (const key of Object.keys(parsed)) {
      if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
        warnings.push(`Unknown config key "${key}" — ignored`);
      }
    }

    // Check for unknown compress keys
    if (parsed.compress && typeof parsed.compress === "object") {
      for (const key of Object.keys(parsed.compress as object)) {
        if (!KNOWN_COMPRESS_KEYS.has(key)) {
          warnings.push(`Unknown compress key "${key}" — ignored`);
        }
      }
    }

    mergeConfig(config, parsed);
  }

  // Validate ranges
  if (config.compress.maxContextPercent > 100) {
    warnings.push(
      `maxContextPercent (${config.compress.maxContextPercent}) exceeds 100, reset to default`,
    );
    config.compress.maxContextPercent =
      DEFAULT_CONFIG.compress.maxContextPercent;
  }
  if (config.compress.minContextPercent > 100) {
    warnings.push(
      `minContextPercent (${config.compress.minContextPercent}) exceeds 100, reset to default`,
    );
    config.compress.minContextPercent =
      DEFAULT_CONFIG.compress.minContextPercent;
  }

  if (config.compress.maxContextPercent <= config.compress.minContextPercent) {
    config.compress.maxContextPercent =
      DEFAULT_CONFIG.compress.maxContextPercent;
    config.compress.minContextPercent =
      DEFAULT_CONFIG.compress.minContextPercent;
  }

  return { config, warnings };
}
```

- [ ] **Step 4: Update all callers of loadConfig**

In `src/index.ts`, update `loadConfig` call:

```typescript
let { config, warnings: configWarnings } = loadConfig(configFilePath);

// In reloadConfig:
function reloadConfig(logDir?: string): void {
  const result = loadConfig(configFilePath);
  config = result.config;
  configWarnings = result.warnings;
  logger = new Logger(config.debug, logDir);
  for (const w of configWarnings) {
    logger.info("config", w);
  }
}
```

For the initial load (before logger exists), log warnings in the `session_start` handler after the logger is ready:

```typescript
// After reloadConfig(logDir) in session_start:
for (const w of configWarnings) {
  logger.info("config", w);
}
```

Update `tests/helpers.ts` if `makeDefaultConfig` calls `loadConfig` — it doesn't, so no change needed there.

Update existing tests in `tests/config.test.ts` that call `loadConfig` to destructure the result:

```typescript
// Change: const config = loadConfig(configPath);
// To:     const { config } = loadConfig(configPath);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm run typecheck
pnpm test
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/index.ts tests/config.test.ts
git commit -m "feat: add config validation with unknown key warnings"
```

---

### Task 4: Status Bar Integration

**Files:**

- Modify: `src/index.ts`

Show compression savings in Pi's footer bar using `ctx.ui.setStatus("dcp", text)` after context events. Guard with `ctx.hasUI` since `setStatus` is only meaningful in TUI/RPC modes.

API (verified against Pi source):

- `ctx.hasUI: boolean` — true in TUI and RPC modes
- `ctx.ui.setStatus(key: string, text: string | undefined): void` — sets footer status

- [ ] **Step 1: Add status update at end of context handler**

In `src/index.ts`, at the end of the `context` event handler (before `return { messages }`):

```typescript
// Step 8: Update status bar with token savings
if (ctx.hasUI && state.stats.totalPruneTokens > 0) {
  ctx.ui.setStatus("dcp", `DCP: ${state.stats.totalPruneTokens} tokens saved`);
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm run typecheck
```

Expected: Pass. If the `ExtensionContext` type isn't fully available in the mock, cast `ctx` appropriately or add a type annotation.

- [ ] **Step 3: Run full tests**

```bash
pnpm test
```

Expected: All pass (existing test mocks don't have `hasUI` so the guard prevents errors — the `ctx.hasUI` check evaluates to `undefined`/falsy on mocks without the property).

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: show DCP token savings in status bar"
```

---

### Task 5: `dcp:lifetime` Command

**Files:**

- Create: `src/commands/lifetime.ts`
- Modify: `src/commands/register.ts`
- Modify: `src/commands/help.ts`
- Test: `tests/commands-lifetime.test.ts`
- Modify: `tests/commands-register.test.ts`

A separate command that shows aggregate stats across all sessions. Scans the session parent directory for `{sessionName}/dcp/state.json` files.

- [ ] **Step 1: Write tests**

Create `tests/commands-lifetime.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { lifetimeCommand } from "../src/commands/lifetime.ts";

describe("lifetime command", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-lifetime-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("shows aggregate stats from multiple sessions", () => {
    const dir1 = path.join(tempDir, "session-1", "dcp");
    const dir2 = path.join(tempDir, "session-2", "dcp");
    fs.mkdirSync(dir1, { recursive: true });
    fs.mkdirSync(dir2, { recursive: true });

    fs.writeFileSync(
      path.join(dir1, "state.json"),
      JSON.stringify({
        stats: {
          totalPruneTokens: 500,
          toolsPruned: 3,
          messagesCompressed: 1,
          pruneTokenCounter: 0,
        },
      }),
    );
    fs.writeFileSync(
      path.join(dir2, "state.json"),
      JSON.stringify({
        stats: {
          totalPruneTokens: 1500,
          toolsPruned: 7,
          messagesCompressed: 4,
          pruneTokenCounter: 0,
        },
      }),
    );

    const result = lifetimeCommand(tempDir);
    expect(result).toContain("2000");
    expect(result).toContain("10");
    expect(result).toContain("5");
    expect(result).toContain("2 sessions");
  });

  it("handles empty directory gracefully", () => {
    const result = lifetimeCommand(tempDir);
    expect(result).toContain("0 sessions");
  });

  it("handles non-existent directory", () => {
    const result = lifetimeCommand("/tmp/nonexistent-dcp-dir-xyz");
    expect(result).toContain("0 sessions");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/commands-lifetime.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement lifetime command**

Create `src/commands/lifetime.ts`:

```typescript
import { loadAllSessionStats } from "../state/persistence.ts";

export function lifetimeCommand(sessionsParentDir: string): string {
  const stats = loadAllSessionStats(sessionsParentDir);

  return [
    "DCP Lifetime Statistics:",
    `  Sessions tracked: ${stats.sessionCount} sessions`,
    `  Total tokens saved: ${stats.totalTokensSaved}`,
    `  Total tools pruned: ${stats.totalToolsPruned}`,
    `  Total messages compressed: ${stats.totalMessagesCompressed}`,
  ].join("\n");
}
```

- [ ] **Step 4: Register the command**

In `src/commands/register.ts`, add the import and registration:

```typescript
import { lifetimeCommand } from "./lifetime.ts";
```

Add at the end of `registerDcpCommands`, before the closing `}`:

```typescript
pi.registerCommand("dcp:lifetime", {
  description: "Show aggregate statistics across all sessions",
  handler: async (_args, ctx) => {
    const parentDir = path.resolve(ctx.sessionManager.getSessionDir(), "..");
    ctx.ui.notify(lifetimeCommand(parentDir), "info");
  },
});
```

Add `import * as path from "node:path"` at the top of `register.ts`.

- [ ] **Step 5: Update help command**

In `src/commands/help.ts`, add the new command to the help text:

```typescript
`  dcp:lifetime    — Show aggregate statistics across all sessions`,
```

- [ ] **Step 6: Update register test**

In `tests/commands-register.test.ts`, update the expected command count and add the assertion:

```typescript
expect(registered).toContain("dcp:lifetime");
expect(registered).toHaveLength(8);
```

- [ ] **Step 7: Run all tests**

```bash
pnpm run typecheck
pnpm test
```

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/commands/lifetime.ts src/commands/register.ts src/commands/help.ts tests/commands-lifetime.test.ts tests/commands-register.test.ts
git commit -m "feat: add dcp:lifetime command for cross-session statistics"
```

---

### Task 6: Integration Test

**Files:**

- Create: `tests/integration.test.ts`

End-to-end test: load the extension with a mock Pi API, simulate a session lifecycle, send messages through the context pipeline, verify pruning works. Follows the existing mock pattern from `tests/index.test.ts`.

- [ ] **Step 1: Write integration test**

Create `tests/integration.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => "/tmp/test-pi-agent",
}));

type Handler = (...args: any[]) => unknown;

function createMockApi() {
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, unknown>();
  const commands = new Map<string, unknown>();

  const api = {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerTool(def: any) {
      tools.set(def.name, def);
    },
    registerCommand(name: string, def: unknown) {
      commands.set(name, def);
    },
  } as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI;

  return { api, handlers, tools, commands };
}

describe("integration", () => {
  it("runs full pipeline: load, session_start, context, prune duplicates", async () => {
    const { api, handlers, tools, commands } = createMockApi();
    createExtension(api);

    // Verify registration
    expect(handlers.has("session_start")).toBe(true);
    expect(handlers.has("context")).toBe(true);
    expect(handlers.has("session_shutdown")).toBe(true);
    expect(tools.has("compress")).toBe(true);
    expect(commands.has("dcp:help")).toBe(true);
    expect(commands.has("dcp:stats")).toBe(true);
    expect(commands.has("dcp:lifetime")).toBe(true);

    // Simulate session start
    const mockCtx = {
      sessionManager: { getSessionDir: () => "/tmp/test-integration-session" },
      getContextUsage: () => ({
        tokens: 1000,
        contextWindow: 200000,
        percent: 0.5,
      }),
      hasUI: false,
      ui: { setStatus: () => {}, notify: () => {} },
    };

    const startHandlers = handlers.get("session_start")!;
    for (const h of startHandlers) {
      await h({ reason: "new" }, mockCtx);
    }

    // Simulate context event with duplicate tool calls
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "Find foo in the codebase" }],
        timestamp: Date.now(),
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "c1",
            name: "glob",
            arguments: { pattern: "**/*.ts" },
          },
        ],
        api: "messages",
        provider: "test",
        model: "test-model",
        stopReason: "toolUse",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
        timestamp: Date.now(),
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "glob",
        content: [
          { type: "text", text: "src/index.ts\nsrc/config.ts\nsrc/logger.ts" },
        ],
        isError: false,
        timestamp: Date.now(),
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "c2",
            name: "glob",
            arguments: { pattern: "**/*.ts" },
          },
        ],
        api: "messages",
        provider: "test",
        model: "test-model",
        stopReason: "toolUse",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
        timestamp: Date.now(),
      },
      {
        role: "toolResult",
        toolCallId: "c2",
        toolName: "glob",
        content: [
          {
            type: "text",
            text: "src/index.ts\nsrc/config.ts\nsrc/logger.ts (newer)",
          },
        ],
        isError: false,
        timestamp: Date.now(),
      },
    ];

    const contextHandlers = handlers.get("context")!;
    let result: any;
    for (const h of contextHandlers) {
      result = await h({ messages: structuredClone(messages) }, mockCtx);
    }

    expect(result).toBeDefined();
    expect(result.messages).toBeDefined();

    // The older duplicate glob call (c1) should have its output pruned
    const toolResult1 = result.messages.find(
      (m: any) => m.role === "toolResult" && m.toolCallId === "c1",
    );
    if (toolResult1) {
      expect(toolResult1.content[0].text).toContain("[Output removed");
    }

    // The newer glob call (c2) should be untouched
    const toolResult2 = result.messages.find(
      (m: any) => m.role === "toolResult" && m.toolCallId === "c2",
    );
    expect(toolResult2).toBeDefined();
    expect(toolResult2.content[0].text).toContain("src/index.ts");

    // Messages should have dcp-message-id tags
    const userMsg = result.messages.find((m: any) => m.role === "user");
    expect(userMsg.content[0].text).toContain("<dcp-message-id>");
  });

  it("injects nudge when context is high", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);

    const mockCtx = {
      sessionManager: { getSessionDir: () => "/tmp/test-integration-session" },
      getContextUsage: () => ({
        tokens: 170000,
        contextWindow: 200000,
        percent: 85,
      }),
      hasUI: false,
      ui: { setStatus: () => {}, notify: () => {} },
    };

    // Start session first
    const startHandlers = handlers.get("session_start")!;
    for (const h of startHandlers) {
      await h({ reason: "new" }, mockCtx);
    }

    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "Continue working" }],
        timestamp: Date.now(),
      },
    ];

    const contextHandlers = handlers.get("context")!;
    let result: any;
    for (const h of contextHandlers) {
      result = await h({ messages: structuredClone(messages) }, mockCtx);
    }

    // Should have injected a critical context warning nudge
    const lastMsg = result.messages[result.messages.length - 1];
    const text = lastMsg.content[0].text;
    expect(text).toContain("CRITICAL WARNING");
    expect(text).toContain("<dcp-system-reminder>");
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
pnpm test -- tests/integration.test.ts
```

Expected: Pass.

- [ ] **Step 3: Run full test suite**

```bash
pnpm run typecheck
pnpm test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration.test.ts
git commit -m "test: add end-to-end integration test"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run full verification**

```bash
pnpm run check
```

This runs `biome lint . && tsc --noEmit && vitest run`. Expected: No errors, all tests pass.

- [ ] **Step 2: Review all files for dead imports/code**

Check that no unused imports or dead code were introduced. Verify:

- `src/state/persistence.ts` exports are all used
- `src/commands/lifetime.ts` is imported in `register.ts`
- Config warnings are actually logged in `session_start`
- Status bar update is guarded by `ctx.hasUI`

- [ ] **Step 3: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: final polish and cleanup"
```

Only commit if there are actual changes. Skip if the verification step was clean.
