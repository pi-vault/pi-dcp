# Phase 6: Commands

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **IMPORTANT:** Read `plans/ERRATA.md` before implementing. It contains corrections to API signatures, type shapes, and import paths verified against Pi source.

**Prerequisite:** Phase 5 (Message Compression) completed and passing.

**Goal:** Register `dcp:*` slash commands for manual inspection and control. After this phase, users can inspect context usage, view compression statistics, toggle manual mode, sweep tool outputs, decompress blocks, and recompress.

**Usable result after this phase:** The following commands are available: `dcp:help`, `dcp:context`, `dcp:stats`, `dcp:sweep`, `dcp:manual`, `dcp:decompress`, `dcp:recompress`. Users can interact with the DCP system directly.

**Architecture:**
- `src/commands/register.ts` — Registers all `dcp:*` commands with Pi
- `src/commands/help.ts` — Help text
- `src/commands/context.ts` — Context usage breakdown
- `src/commands/stats.ts` — Session statistics
- `src/commands/sweep.ts` — Bulk tool output pruning
- `src/commands/manual.ts` — Manual mode toggle
- `src/commands/decompress.ts` — Deactivate compression blocks
- `src/commands/recompress.ts` — Reactivate deactivated blocks

**Conventions:**
- Each command is registered independently via `pi.registerCommand("dcp:name", { ... })`
- Each command handler is a separate module exporting a pure function that takes state (+ args where needed) and returns a string
- The registration module wires handlers to Pi's command API with `ctx.ui.notify()` for output
- Commands that accept arguments (`manual`, `decompress`, `recompress`) receive them via the handler's `args` string parameter

**ERRATA notes:**
- E5: `ContextUsage.tokens` and `ContextUsage.percent` can be `null`. Guard with `!= null` before displaying.
- E7: `ctx.ui.notify` levels are `"info" | "warning" | "error"` (no `"success"`).

---

## File Structure (additions to Phase 5)

```
src/
  commands/
    register.ts                 # Registers all dcp:* commands with Pi
    help.ts
    context.ts
    stats.ts
    sweep.ts
    manual.ts
    decompress.ts
    recompress.ts
```

---

### Task 1: Help Command

**Files:**
- Create: `src/commands/help.ts`
- Test: `tests/commands-help.test.ts`

- [ ] **Step 1: Write test**

Create `tests/commands-help.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { helpCommand } from "../src/commands/help.ts";

describe("help command", () => {
  it("returns help text listing all commands", () => {
    const result = helpCommand();
    expect(result).toContain("dcp:context");
    expect(result).toContain("dcp:stats");
    expect(result).toContain("dcp:sweep");
    expect(result).toContain("dcp:manual");
    expect(result).toContain("dcp:decompress");
    expect(result).toContain("dcp:recompress");
  });
});
```

- [ ] **Step 2: Implement**

Create `src/commands/help.ts`:

```typescript
export function helpCommand(): string {
  return [
    "DCP Commands:",
    "",
    "  dcp:help                    - Show this help",
    "  dcp:context                 - Show context usage breakdown",
    "  dcp:stats                   - Show compression statistics",
    "  dcp:sweep                   - Force-prune all eligible tool outputs",
    "  dcp:manual [on|off]         - Toggle manual compression mode",
    "  dcp:decompress <blockId>    - Deactivate a compression block",
    "  dcp:recompress <blockId>    - Reactivate a deactivated block",
  ].join("\n");
}
```

- [ ] **Step 3: Run test**

```bash
pnpm test -- tests/commands-help.test.ts
```

Expected: Pass.

- [ ] **Step 4: Commit**

```bash
git add src/commands/help.ts tests/commands-help.test.ts
git commit -m "feat: add dcp:help command"
```

---

### Task 2: Context Command

**Files:**
- Create: `src/commands/context.ts`
- Test: `tests/commands-context.test.ts`

Shows context usage breakdown: total tokens, pruned tool outputs, active compression blocks, estimated token savings.

- [ ] **Step 1: Write test**

Create `tests/commands-context.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { contextCommand } from "../src/commands/context.ts";
import { createSessionState } from "../src/state/state.ts";

describe("context command", () => {
  it("returns context summary with usage", () => {
    const state = createSessionState();
    state.prune.tools.set("c1", 100);
    state.prune.messages.activeBlockIds.add(1);

    const result = contextCommand(state, { tokens: 5000, contextWindow: 200000, percent: 2.5 });
    expect(result).toContain("5000");
    expect(result).toContain("200000");
    expect(result).toContain("2.5");
  });

  it("handles null token values in context usage (E5)", () => {
    const state = createSessionState();
    const result = contextCommand(state, { tokens: null, contextWindow: 200000, percent: null });
    expect(result).toContain("unavailable");
    expect(result).toContain("200000");
  });

  it("handles missing context usage entirely", () => {
    const state = createSessionState();
    const result = contextCommand(state, undefined);
    expect(result).toContain("unavailable");
  });
});
```

- [ ] **Step 2: Implement**

Create `src/commands/context.ts`:

```typescript
import type { SessionState } from "../state/types.ts";

export interface ContextUsageInfo {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export function contextCommand(
  state: SessionState,
  contextUsage: ContextUsageInfo | undefined,
): string {
  const lines: string[] = ["DCP Context Usage:"];

  if (contextUsage && contextUsage.tokens != null && contextUsage.percent != null) {
    lines.push(`  Tokens: ${contextUsage.tokens} / ${contextUsage.contextWindow} (${contextUsage.percent.toFixed(1)}%)`);
  } else if (contextUsage) {
    lines.push(`  Tokens: unavailable (context window: ${contextUsage.contextWindow})`);
  } else {
    lines.push("  Tokens: unavailable");
  }

  lines.push(`  Pruned tool outputs: ${state.prune.tools.size}`);
  lines.push(`  Active compression blocks: ${state.prune.messages.activeBlockIds.size}`);
  lines.push(`  Total blocks: ${state.prune.messages.blocksById.size}`);
  lines.push(`  Tool cache entries: ${state.toolParameters.size}`);
  lines.push(`  Current turn: ${state.currentTurn}`);
  lines.push(`  Manual mode: ${state.manualMode || "off"}`);

  return lines.join("\n");
}
```

- [ ] **Step 3: Run test, commit**

```bash
pnpm test -- tests/commands-context.test.ts
git add src/commands/context.ts tests/commands-context.test.ts
git commit -m "feat: add dcp:context command"
```

---

### Task 3: Stats Command

**Files:**
- Create: `src/commands/stats.ts`
- Test: `tests/commands-stats.test.ts`

- [ ] **Step 1: Write test**

Create `tests/commands-stats.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { statsCommand } from "../src/commands/stats.ts";
import { createSessionState } from "../src/state/state.ts";

describe("stats command", () => {
  it("returns statistics", () => {
    const state = createSessionState();
    state.stats.toolsPruned = 5;
    state.stats.totalPruneTokens = 1234;
    state.stats.messagesCompressed = 3;

    const result = statsCommand(state);
    expect(result).toContain("5");
    expect(result).toContain("1234");
    expect(result).toContain("3");
  });
});
```

- [ ] **Step 2: Implement**

Create `src/commands/stats.ts`:

```typescript
import type { SessionState } from "../state/types.ts";

export function statsCommand(state: SessionState): string {
  return [
    "DCP Session Statistics:",
    `  Tools pruned: ${state.stats.toolsPruned}`,
    `  Total tokens saved (pruning): ${state.stats.totalPruneTokens}`,
    `  Messages compressed: ${state.stats.messagesCompressed}`,
    `  Prune token counter: ${state.stats.pruneTokenCounter}`,
  ].join("\n");
}
```

- [ ] **Step 3: Run test, commit**

```bash
pnpm test -- tests/commands-stats.test.ts
git add src/commands/stats.ts tests/commands-stats.test.ts
git commit -m "feat: add dcp:stats command"
```

---

### Task 4: Sweep Command

**Files:**
- Create: `src/commands/sweep.ts`
- Test: `tests/commands-sweep.test.ts`

Force-prune all eligible tool outputs immediately (ignoring turn thresholds). Iterates all tool cache entries and marks non-protected, completed ones for pruning.

- [ ] **Step 1: Write test**

Create `tests/commands-sweep.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { sweepCommand } from "../src/commands/sweep.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";

describe("sweep command", () => {
  it("marks eligible completed tool outputs for pruning", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    state.toolParameters.set("call-1", {
      tool: "grep",
      parameters: {},
      status: "completed",
      error: undefined,
      turn: 1,
      tokenCount: 200,
    });
    state.toolParameters.set("call-2", {
      tool: "compress",
      parameters: {},
      status: "completed",
      error: undefined,
      turn: 1,
      tokenCount: 100,
    });

    const result = sweepCommand(state, config);
    expect(result).toContain("1"); // only call-1 swept (compress is protected)
    expect(state.prune.tools.has("call-1")).toBe(true);
    expect(state.prune.tools.has("call-2")).toBe(false);
  });

  it("skips already-pruned tool outputs", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    state.toolParameters.set("call-1", {
      tool: "grep",
      parameters: {},
      status: "completed",
      error: undefined,
      turn: 1,
      tokenCount: 200,
    });
    state.prune.tools.set("call-1", 200);

    const result = sweepCommand(state, config);
    expect(result).toContain("0");
  });
});
```

- [ ] **Step 2: Implement**

Create `src/commands/sweep.ts`:

```typescript
import type { SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { BASE_PROTECTED_TOOLS } from "../config.ts";

export function sweepCommand(state: SessionState, config: DcpConfig): string {
  const protectedTools = new Set([
    ...BASE_PROTECTED_TOOLS,
    ...config.compress.protectedTools,
  ]);

  let swept = 0;
  let tokensSaved = 0;

  for (const [toolCallId, entry] of state.toolParameters) {
    if (state.prune.tools.has(toolCallId)) continue;
    if (protectedTools.has(entry.tool)) continue;
    if (entry.status !== "completed") continue;

    const tokens = entry.tokenCount ?? 0;
    state.prune.tools.set(toolCallId, tokens);
    state.stats.toolsPruned++;
    state.stats.totalPruneTokens += tokens;
    state.stats.pruneTokenCounter += tokens;
    swept++;
    tokensSaved += tokens;
  }

  return `Sweep complete: ${swept} tool outputs pruned, ~${tokensSaved} tokens saved.`;
}
```

- [ ] **Step 3: Run test, commit**

```bash
pnpm test -- tests/commands-sweep.test.ts
git add src/commands/sweep.ts tests/commands-sweep.test.ts
git commit -m "feat: add dcp:sweep command"
```

---

### Task 5: Manual Mode Command

**Files:**
- Create: `src/commands/manual.ts`
- Test: `tests/commands-manual.test.ts`

Toggle manual mode: `on` blocks automatic compression, `off` re-enables it. With no argument, reports current state.

- [ ] **Step 1: Write test**

Create `tests/commands-manual.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { manualCommand } from "../src/commands/manual.ts";
import { createSessionState } from "../src/state/state.ts";

describe("manual command", () => {
  it("enables manual mode with 'on'", () => {
    const state = createSessionState();
    const result = manualCommand(state, "on");
    expect(state.manualMode).toBe("active");
    expect(result).toContain("on");
  });

  it("disables manual mode with 'off'", () => {
    const state = createSessionState();
    state.manualMode = "active";
    const result = manualCommand(state, "off");
    expect(state.manualMode).toBe(false);
    expect(result).toContain("off");
  });

  it("reports current state with no argument", () => {
    const state = createSessionState();
    state.manualMode = "active";
    const result = manualCommand(state, "");
    expect(result).toContain("active");
  });

  it("returns error for invalid argument", () => {
    const state = createSessionState();
    const result = manualCommand(state, "maybe");
    expect(result).toContain("Usage");
  });
});
```

- [ ] **Step 2: Implement**

Create `src/commands/manual.ts`:

```typescript
import type { SessionState } from "../state/types.ts";

export function manualCommand(state: SessionState, args: string): string {
  const arg = args.trim().toLowerCase();

  if (!arg) {
    return `Manual mode: ${state.manualMode || "off"}`;
  }

  if (arg === "on") {
    state.manualMode = "active";
    return "Manual mode: on. Automatic compression is paused.";
  }

  if (arg === "off") {
    state.manualMode = false;
    return "Manual mode: off. Automatic compression resumed.";
  }

  return "Usage: dcp:manual [on|off]";
}
```

- [ ] **Step 3: Run test, commit**

```bash
pnpm test -- tests/commands-manual.test.ts
git add src/commands/manual.ts tests/commands-manual.test.ts
git commit -m "feat: add dcp:manual command"
```

---

### Task 6: Decompress and Recompress Commands

**Files:**
- Create: `src/commands/decompress.ts`
- Create: `src/commands/recompress.ts`
- Test: `tests/commands-decompress.test.ts`

Decompress deactivates a block (sets `deactivatedByUser = true`, removes from `activeBlockIds`). Recompress reactivates it.

- [ ] **Step 1: Write tests**

Create `tests/commands-decompress.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { decompressCommand } from "../src/commands/decompress.ts";
import { recompressCommand } from "../src/commands/recompress.ts";
import { createSessionState } from "../src/state/state.ts";
import type { CompressionBlock } from "../src/state/types.ts";

function makeBlock(id: number, active: boolean): CompressionBlock {
  return {
    blockId: id,
    runId: 1,
    active,
    deactivatedByUser: false,
    compressedTokens: 100,
    summaryTokens: 20,
    durationMs: 50,
    mode: "range",
    topic: "test",
    batchTopic: undefined,
    startIndex: 0,
    endIndex: 5,
    anchorIndex: 0,
    compressMessageIndex: 0,
    includedBlockIds: [],
    consumedBlockIds: [],
    parentBlockIds: [],
    directMessageIndices: [0, 1, 2, 3, 4, 5],
    directToolIds: [],
    effectiveMessageIndices: [0, 1, 2, 3, 4, 5],
    effectiveToolIds: [],
    createdAt: Date.now(),
    deactivatedAt: undefined,
    deactivatedByBlockId: undefined,
    summary: "test summary",
  };
}

describe("decompress command", () => {
  it("deactivates an active block", () => {
    const state = createSessionState();
    const block = makeBlock(1, true);
    state.prune.messages.blocksById.set(1, block);
    state.prune.messages.activeBlockIds.add(1);

    const result = decompressCommand(state, "1");
    expect(result).toContain("deactivated");
    expect(block.active).toBe(false);
    expect(block.deactivatedByUser).toBe(true);
    expect(state.prune.messages.activeBlockIds.has(1)).toBe(false);
  });

  it("returns error for unknown block", () => {
    const state = createSessionState();
    const result = decompressCommand(state, "99");
    expect(result).toContain("not found");
  });

  it("returns error for missing argument", () => {
    const state = createSessionState();
    const result = decompressCommand(state, "");
    expect(result).toContain("Usage");
  });
});

describe("recompress command", () => {
  it("reactivates a user-deactivated block", () => {
    const state = createSessionState();
    const block = makeBlock(1, false);
    block.deactivatedByUser = true;
    state.prune.messages.blocksById.set(1, block);

    const result = recompressCommand(state, "1");
    expect(result).toContain("reactivated");
    expect(block.active).toBe(true);
    expect(block.deactivatedByUser).toBe(false);
    expect(state.prune.messages.activeBlockIds.has(1)).toBe(true);
  });

  it("returns error for block not deactivated by user", () => {
    const state = createSessionState();
    const block = makeBlock(1, false);
    block.deactivatedByUser = false;
    state.prune.messages.blocksById.set(1, block);

    const result = recompressCommand(state, "1");
    expect(result).toContain("not deactivated by user");
  });
});
```

- [ ] **Step 2: Implement decompress**

Create `src/commands/decompress.ts`:

```typescript
import type { SessionState } from "../state/types.ts";

export function decompressCommand(state: SessionState, args: string): string {
  const blockIdStr = args.trim();
  if (!blockIdStr) return "Usage: dcp:decompress <blockId>";

  const blockId = Number.parseInt(blockIdStr, 10);
  if (Number.isNaN(blockId)) return `Invalid block ID: ${blockIdStr}`;

  const block = state.prune.messages.blocksById.get(blockId);
  if (!block) return `Block ${blockId} not found.`;
  if (!block.active) return `Block ${blockId} is already inactive.`;

  block.active = false;
  block.deactivatedByUser = true;
  block.deactivatedAt = Date.now();
  state.prune.messages.activeBlockIds.delete(blockId);
  state.prune.messages.activeByAnchorIndex.delete(block.anchorIndex);

  return `Block ${blockId} deactivated. Original messages will be restored on next context pass.`;
}
```

- [ ] **Step 3: Implement recompress**

Create `src/commands/recompress.ts`:

```typescript
import type { SessionState } from "../state/types.ts";

export function recompressCommand(state: SessionState, args: string): string {
  const blockIdStr = args.trim();
  if (!blockIdStr) return "Usage: dcp:recompress <blockId>";

  const blockId = Number.parseInt(blockIdStr, 10);
  if (Number.isNaN(blockId)) return `Invalid block ID: ${blockIdStr}`;

  const block = state.prune.messages.blocksById.get(blockId);
  if (!block) return `Block ${blockId} not found.`;
  if (block.active) return `Block ${blockId} is already active.`;
  if (!block.deactivatedByUser) return `Block ${blockId} was not deactivated by user. Cannot reactivate.`;

  block.active = true;
  block.deactivatedByUser = false;
  block.deactivatedAt = undefined;
  state.prune.messages.activeBlockIds.add(blockId);
  state.prune.messages.activeByAnchorIndex.set(block.anchorIndex, blockId);

  return `Block ${blockId} reactivated. Compression will apply on next context pass.`;
}
```

- [ ] **Step 4: Run tests, commit**

```bash
pnpm test -- tests/commands-decompress.test.ts
git add src/commands/decompress.ts src/commands/recompress.ts tests/commands-decompress.test.ts
git commit -m "feat: add dcp:decompress and dcp:recompress commands"
```

---

### Task 7: Command Registration

**Files:**
- Create: `src/commands/register.ts`
- Modify: `src/index.ts`
- Test: `tests/commands-register.test.ts`

Register each `dcp:*` command individually with Pi. Each registration wires a handler that calls the pure command function and outputs via `ctx.ui.notify()`.

- [ ] **Step 1: Write test**

Create `tests/commands-register.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { registerDcpCommands } from "../src/commands/register.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";

describe("registerDcpCommands", () => {
  it("registers all expected commands", () => {
    const registered: string[] = [];
    const mockPi = {
      registerCommand(name: string, _opts: unknown) {
        registered.push(name);
      },
    };

    const state = createSessionState();
    const config = makeDefaultConfig();
    registerDcpCommands(mockPi as any, state, config);

    expect(registered).toContain("dcp:help");
    expect(registered).toContain("dcp:context");
    expect(registered).toContain("dcp:stats");
    expect(registered).toContain("dcp:sweep");
    expect(registered).toContain("dcp:manual");
    expect(registered).toContain("dcp:decompress");
    expect(registered).toContain("dcp:recompress");
    expect(registered).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Implement registration**

Create `src/commands/register.ts`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { helpCommand } from "./help.ts";
import { contextCommand } from "./context.ts";
import { statsCommand } from "./stats.ts";
import { sweepCommand } from "./sweep.ts";
import { manualCommand } from "./manual.ts";
import { decompressCommand } from "./decompress.ts";
import { recompressCommand } from "./recompress.ts";

export function registerDcpCommands(
  pi: ExtensionAPI,
  state: SessionState,
  config: DcpConfig,
): void {
  pi.registerCommand("dcp:help", {
    description: "Show DCP command help",
    handler: async (_args, ctx) => {
      ctx.ui.notify(helpCommand(), "info");
    },
  });

  pi.registerCommand("dcp:context", {
    description: "Show context usage breakdown",
    handler: async (_args, ctx) => {
      const usage = ctx.getContextUsage();
      ctx.ui.notify(
        contextCommand(state, usage ?? undefined),
        "info",
      );
    },
  });

  pi.registerCommand("dcp:stats", {
    description: "Show compression statistics",
    handler: async (_args, ctx) => {
      ctx.ui.notify(statsCommand(state), "info");
    },
  });

  pi.registerCommand("dcp:sweep", {
    description: "Force-prune all eligible tool outputs",
    handler: async (_args, ctx) => {
      ctx.ui.notify(sweepCommand(state, config), "info");
    },
  });

  pi.registerCommand("dcp:manual", {
    description: "Toggle manual compression mode",
    handler: async (args, ctx) => {
      ctx.ui.notify(manualCommand(state, args), "info");
    },
  });

  pi.registerCommand("dcp:decompress", {
    description: "Deactivate a compression block",
    handler: async (args, ctx) => {
      ctx.ui.notify(decompressCommand(state, args), "info");
    },
  });

  pi.registerCommand("dcp:recompress", {
    description: "Reactivate a deactivated compression block",
    handler: async (args, ctx) => {
      ctx.ui.notify(recompressCommand(state, args), "info");
    },
  });
}
```

- [ ] **Step 3: Wire into `src/index.ts`**

Add import and call `registerDcpCommands` after the tool registration block (before the event handlers):

```typescript
import { registerDcpCommands } from "./commands/register.ts";

// ... (after registerTool block, before pi.on("before_agent_start", ...))
registerDcpCommands(pi, state, config);
```

- [ ] **Step 4: Verify typecheck and tests**

```bash
pnpm run typecheck
pnpm test
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/commands/register.ts tests/commands-register.test.ts src/index.ts
git commit -m "feat: register dcp:* commands"
```
