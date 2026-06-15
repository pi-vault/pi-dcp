# Phase 6: Commands

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **IMPORTANT:** Read `plans/ERRATA.md` before implementing. It contains corrections to API signatures, type shapes, and import paths verified against Pi source.

**Prerequisite:** Phase 5 (Message Compression) completed and passing.

**Goal:** Register `/dcp` slash commands for manual inspection and control. After this phase, users can inspect context usage, view compression statistics, toggle manual mode, sweep tool outputs, decompress blocks, and recompress.

**Usable result after this phase:** The `/dcp` command is available with subcommands: `help`, `context`, `stats`, `sweep`, `manual`, `decompress`, `recompress`. Users can interact with the DCP system directly.

**Architecture:**
- `src/commands/index.ts` — Command router dispatching subcommands
- `src/commands/help.ts` — Help text
- `src/commands/context.ts` — Context usage breakdown
- `src/commands/stats.ts` — Session statistics
- `src/commands/sweep.ts` — Bulk tool output pruning
- `src/commands/manual.ts` — Manual mode toggle
- `src/commands/decompress.ts` — Deactivate compression blocks
- `src/commands/recompress.ts` — Reactivate deactivated blocks

**Conventions:**
- Commands are registered via `pi.registerCommand("dcp", { ... })`
- Each subcommand is a separate module returning a string response
- Commands use `ctx.ui.notify()` for user-facing output

---

## File Structure (additions to Phase 5)

```
src/
  commands/
    index.ts                    # Router
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
  it("returns help text listing all subcommands", () => {
    const result = helpCommand();
    expect(result).toContain("context");
    expect(result).toContain("stats");
    expect(result).toContain("sweep");
    expect(result).toContain("manual");
    expect(result).toContain("decompress");
    expect(result).toContain("recompress");
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
    "  /dcp help          - Show this help",
    "  /dcp context       - Show context usage breakdown",
    "  /dcp stats         - Show compression statistics",
    "  /dcp sweep         - Force-prune all eligible tool outputs",
    "  /dcp manual [on|off] - Toggle manual compression mode",
    "  /dcp decompress <blockId> - Deactivate a compression block",
    "  /dcp recompress <blockId> - Reactivate a deactivated block",
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
git commit -m "feat: add /dcp help command"
```

---

### Task 2: Context Command

**Files:**
- Create: `src/commands/context.ts`
- Test: `tests/commands-context.test.ts`

Shows context usage breakdown: total messages, pruned tool outputs, active compression blocks, estimated token savings.

- [ ] **Step 1: Write test**

Create `tests/commands-context.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { contextCommand } from "../src/commands/context.ts";
import { createSessionState } from "../src/state/state.ts";

describe("context command", () => {
  it("returns context summary", () => {
    const state = createSessionState();
    state.prune.tools.set("c1", 100);
    state.prune.messages.activeBlockIds.add(1);

    const result = contextCommand(state, { tokens: 5000, contextWindow: 200000, percent: 2.5 });
    expect(result).toContain("5000");
    expect(result).toContain("200000");
    expect(result).toContain("1"); // pruned tools
    expect(result).toContain("1"); // active blocks
  });

  it("handles missing context usage", () => {
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

export function contextCommand(
  state: SessionState,
  contextUsage: { tokens: number; contextWindow: number; percent: number } | undefined,
): string {
  const lines: string[] = ["DCP Context Usage:"];

  if (contextUsage) {
    lines.push(`  Tokens: ${contextUsage.tokens} / ${contextUsage.contextWindow} (${contextUsage.percent.toFixed(1)}%)`);
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
git commit -m "feat: add /dcp context command"
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
git commit -m "feat: add /dcp stats command"
```

---

### Task 4: Sweep Command

**Files:**
- Create: `src/commands/sweep.ts`
- Test: `tests/commands-sweep.test.ts`

Force-prune all eligible tool outputs immediately (ignoring turn thresholds).

- [ ] **Step 1: Write test and implement**

Create `tests/commands-sweep.test.ts` and `src/commands/sweep.ts` following the same pattern. The sweep function iterates all tool cache entries and marks non-protected, completed ones for pruning.

- [ ] **Step 2: Run test, commit**

```bash
git add src/commands/sweep.ts tests/commands-sweep.test.ts
git commit -m "feat: add /dcp sweep command"
```

---

### Task 5: Manual Mode Command

**Files:**
- Create: `src/commands/manual.ts`
- Test: `tests/commands-manual.test.ts`

Toggle manual mode: `on` blocks automatic compression, `off` re-enables it. When toggled to off from `compress-pending`, triggers a compression.

- [ ] **Step 1: Write test and implement**

Create `tests/commands-manual.test.ts` and `src/commands/manual.ts`.

- [ ] **Step 2: Run test, commit**

```bash
git add src/commands/manual.ts tests/commands-manual.test.ts
git commit -m "feat: add /dcp manual command"
```

---

### Task 6: Decompress and Recompress Commands

**Files:**
- Create: `src/commands/decompress.ts`
- Create: `src/commands/recompress.ts`
- Test: `tests/commands-decompress.test.ts`

Decompress deactivates a block (sets `deactivatedByUser = true`). Recompress reactivates it.

- [ ] **Step 1: Write tests and implement**

- [ ] **Step 2: Run tests, commit**

```bash
git add src/commands/decompress.ts src/commands/recompress.ts tests/commands-decompress.test.ts
git commit -m "feat: add /dcp decompress and recompress commands"
```

---

### Task 7: Command Router and Registration

**Files:**
- Create: `src/commands/index.ts`
- Modify: `src/index.ts`

Router dispatches `/dcp <subcommand>` to the appropriate handler. Register via `pi.registerCommand("dcp", ...)`.

- [ ] **Step 1: Implement router**

Create `src/commands/index.ts`:

```typescript
import type { SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { helpCommand } from "./help.ts";
import { contextCommand } from "./context.ts";
import { statsCommand } from "./stats.ts";
import { sweepCommand } from "./sweep.ts";
import { manualCommand } from "./manual.ts";
import { decompressCommand } from "./decompress.ts";
import { recompressCommand } from "./recompress.ts";

export function routeDcpCommand(
  args: string,
  state: SessionState,
  config: DcpConfig,
  contextUsage: { tokens: number; contextWindow: number; percent: number } | undefined,
): string {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? "help";
  const subArgs = parts.slice(1).join(" ");

  switch (subcommand) {
    case "help":
      return helpCommand();
    case "context":
      return contextCommand(state, contextUsage);
    case "stats":
      return statsCommand(state);
    case "sweep":
      return sweepCommand(state, config);
    case "manual":
      return manualCommand(state, subArgs);
    case "decompress":
      return decompressCommand(state, subArgs);
    case "recompress":
      return recompressCommand(state, subArgs);
    default:
      return `Unknown subcommand: ${subcommand}\n\n${helpCommand()}`;
  }
}
```

- [ ] **Step 2: Register command in index.ts**

```typescript
import { routeDcpCommand } from "./commands/index.ts";

pi.registerCommand("dcp", {
  description: "Dynamic Context Pruning controls",
  handler: async (args, ctx) => {
    const usage = ctx.getContextUsage();
    const result = routeDcpCommand(
      args,
      state,
      config,
      usage ? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent } : undefined,
    );
    ctx.ui.notify(result, "info");
  },
});
```

- [ ] **Step 3: Verify typecheck and tests**

```bash
pnpm run typecheck
pnpm test
```

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/commands/index.ts src/index.ts
git commit -m "feat: register /dcp command router"
```
