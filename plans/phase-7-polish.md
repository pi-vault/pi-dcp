# Phase 7: Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **IMPORTANT:** Read `plans/ERRATA.md` before implementing. It contains corrections to API signatures, type shapes, and import paths verified against Pi source.

**Prerequisite:** Phase 6 (Commands) completed and passing.

**Goal:** Add state persistence, cross-session statistics, config validation, status bar integration, and a full integration test. After this phase, pi-dcp survives session restarts, shows compression savings in Pi's footer, and has end-to-end test coverage.

**Usable result after this phase:** DCP state persists across Pi restarts (blocks survive, statistics accumulate). The `/dcp stats` command can show lifetime statistics. Pi's status bar shows real-time compression savings. The extension is fully polished and production-ready.

**Architecture:**

- `src/state/persistence.ts` — Save/load session state to JSON files
- `src/config.ts` — Enhanced validation with warnings for unknown keys
- `src/index.ts` — Status bar integration via `ctx.ui.setStatus()`
- `tests/integration.test.ts` — End-to-end test loading extension with mock Pi API

---

## File Structure (additions to Phase 6)

```
src/
  state/
    persistence.ts              # Save/load state to disk
tests/
  integration.test.ts           # End-to-end test
```

---

### Task 1: State Persistence

**Files:**

- Create: `src/state/persistence.ts`
- Test: `tests/persistence.test.ts`

Save session state to `{sessionDir}/dcp/state.json` (resolved via `ctx.sessionManager.getSessionDir()`) on significant events (compression, session_shutdown). Fallback path when no session dir is available: `~/.pi/agent/sessions/{encodedCwd}/dcp/state.json`. Load on session_start if state exists.

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
    state.prune.tools.set("c1", 100);

    saveSessionState(state, tempDir);

    const loaded = loadSessionState("test-session", tempDir);
    expect(loaded).toBeDefined();
    expect(loaded!.currentTurn).toBe(5);
    expect(loaded!.stats.toolsPruned).toBe(3);
    expect(loaded!.stats.totalPruneTokens).toBe(500);
  });

  it("returns undefined for non-existent session", () => {
    const loaded = loadSessionState("nonexistent", tempDir);
    expect(loaded).toBeUndefined();
  });

  it("handles corrupt JSON gracefully", () => {
    const sessionDir = path.join(tempDir, "corrupt-session");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "state.json"), "not json");

    const loaded = loadSessionState("corrupt-session", tempDir);
    expect(loaded).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/persistence.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement persistence**

Create `src/state/persistence.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionState } from "./types.ts";

/**
 * Serializable subset of session state for persistence.
 * Maps and Sets are converted to arrays/objects for JSON.
 */
interface SerializedState {
  sessionId: string | null;
  currentTurn: number;
  stats: SessionState["stats"];
  pruneTools: Array<[string, number]>;
  blocks: Array<[number, unknown]>;
  lastCompaction: number;
}

function defaultDataDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return path.join(home, ".pi", "agent", "sessions");
}

export function saveSessionState(state: SessionState, dataDir?: string): void {
  if (!state.sessionId) return;

  const dir = path.join(dataDir ?? defaultDataDir(), state.sessionId);
  fs.mkdirSync(dir, { recursive: true });

  const serialized: SerializedState = {
    sessionId: state.sessionId,
    currentTurn: state.currentTurn,
    stats: { ...state.stats },
    pruneTools: Array.from(state.prune.tools.entries()),
    blocks: Array.from(state.prune.messages.blocksById.entries()),
    lastCompaction: state.lastCompaction,
  };

  fs.writeFileSync(
    path.join(dir, "state.json"),
    JSON.stringify(serialized, null, 2),
  );
}

export function loadSessionState(
  sessionId: string,
  dataDir?: string,
): Pick<SessionState, "currentTurn" | "stats" | "lastCompaction"> | undefined {
  const filePath = path.join(
    dataDir ?? defaultDataDir(),
    sessionId,
    "state.json",
  );

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
 * Load aggregate stats from all saved sessions.
 * Used by /dcp stats for lifetime statistics.
 */
export function loadAllSessionStats(dataDir?: string): {
  totalTokensSaved: number;
  totalToolsPruned: number;
  totalMessagesCompressed: number;
  sessionCount: number;
} {
  const dir = dataDir ?? defaultDataDir();
  const result = {
    totalTokensSaved: 0,
    totalToolsPruned: 0,
    totalMessagesCompressed: 0,
    sessionCount: 0,
  };

  try {
    if (!fs.existsSync(dir)) return result;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const stateFile = path.join(dir, entry.name, "state.json");
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

### Task 2: Wire Persistence into Extension

**Files:**

- Modify: `src/index.ts`

Save state on session_shutdown, after compression, and periodically. Load state on session_start if continuing a session.

- [ ] **Step 1: Update index.ts**

```typescript
import { saveSessionState } from "./state/persistence.ts";

// In session_shutdown handler:
pi.on("session_shutdown", async (_event, _ctx) => {
  saveSessionState(state);
  logger.info("dcp", "session shutdown, state saved");
});

// After successful compression in tool execute handlers:
// saveSessionState(state);
```

- [ ] **Step 2: Verify typecheck and tests**

```bash
pnpm run typecheck
pnpm test
```

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire state persistence into session lifecycle"
```

---

### Task 3: Config Validation

**Files:**

- Modify: `src/config.ts`
- Test: Update `tests/config.test.ts`

Add warnings for unknown config keys (logged but not errors). Validate numeric ranges.

- [ ] **Step 1: Add validation to mergeConfig**

After merging, log warnings for any keys in the source that aren't recognized. Add bounds checking for percentages (0-100).

- [ ] **Step 2: Add test for validation warnings**

- [ ] **Step 3: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config validation with unknown key warnings"
```

---

### Task 4: Status Bar Integration

**Files:**

- Modify: `src/index.ts`

Show compression savings in Pi's footer bar using `ctx.ui.setStatus()` after context events.

- [ ] **Step 1: Add status update after context pipeline**

```typescript
// At end of context handler:
if (ctx.hasUI) {
  const saved = state.stats.totalPruneTokens;
  if (saved > 0) {
    ctx.ui.setStatus("dcp", `DCP: ${saved} tokens saved`);
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: show DCP token savings in status bar"
```

---

### Task 5: Integration Test

**Files:**

- Create: `tests/integration.test.ts`

End-to-end test: load the extension with a mock Pi API, simulate a session lifecycle, send messages through the context pipeline, verify pruning and compression work.

- [ ] **Step 1: Write integration test**

Create `tests/integration.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import createExtension from "../src/index.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("integration", () => {
  it("runs full pipeline: load, context, prune, compress", async () => {
    const handlers = new Map<string, Function[]>();
    const tools = new Map<string, any>();
    const commands = new Map<string, any>();

    const mockApi = {
      on(event: string, handler: Function) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
      registerTool(def: any) {
        tools.set(def.name, def);
      },
      registerCommand(name: string, def: any) {
        commands.set(name, def);
      },
      getSessionName: () => "test",
      getActiveTools: () => [],
    } as any;

    createExtension(mockApi);

    expect(handlers.has("session_start")).toBe(true);
    expect(handlers.has("context")).toBe(true);
    expect(tools.has("compress")).toBe(true);

    // Simulate session start
    const mockCtx = {
      cwd: process.cwd(),
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

    // Simulate context event with tool calls
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Read a file" }],
        timestamp: Date.now(),
      } as AgentMessage,
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "c1",
            name: "grep",
            arguments: { pattern: "foo" },
          },
        ],
        stopReason: "toolUse",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
        timestamp: Date.now(),
      } as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "grep",
        content: [{ type: "text", text: "match found in foo.ts" }],
        isError: false,
        timestamp: Date.now(),
      } as AgentMessage,
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "c2",
            name: "grep",
            arguments: { pattern: "foo" },
          },
        ],
        stopReason: "toolUse",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 0,
        },
        timestamp: Date.now(),
      } as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "c2",
        toolName: "grep",
        content: [{ type: "text", text: "match found in foo.ts (newer)" }],
        isError: false,
        timestamp: Date.now(),
      } as AgentMessage,
    ];

    const contextHandlers = handlers.get("context")!;
    let result: any;
    for (const h of contextHandlers) {
      result = await h({ messages: structuredClone(messages) }, mockCtx);
    }

    expect(result).toBeDefined();
    expect(result.messages).toBeDefined();

    // The duplicate grep call (c1) should have its output pruned
    const toolResult1 = result.messages.find(
      (m: any) => m.role === "toolResult" && m.toolCallId === "c1",
    );
    if (toolResult1) {
      expect((toolResult1 as any).content[0].text).toContain("[Output removed");
    }

    // The newer grep call (c2) should be untouched
    const toolResult2 = result.messages.find(
      (m: any) => m.role === "toolResult" && m.toolCallId === "c2",
    );
    if (toolResult2) {
      expect((toolResult2 as any).content[0].text).toContain("match found");
    }
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

### Task 6: Final Verification

- [ ] **Step 1: Run full verification**

```bash
pnpm run typecheck
pnpm test
pnpm run build
```

Expected: No errors, all tests pass, build succeeds.

- [ ] **Step 2: Review all files for dead imports/code**

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: final polish and cleanup"
```
