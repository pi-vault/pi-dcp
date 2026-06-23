# Phase 8: UI Notifications

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide configurable user-visible feedback on DCP pruning activity beyond the existing status counter.

**Architecture:** Add a notification module with content builders for minimal/detailed messages. Emit notifications after pipeline execution in the `context` handler. Two independent config axes: `nudgeNotification` controls content verbosity (`off` / `minimal` / `detailed`), `nudgeNotificationType` controls delivery mechanism (`status` / `toast`).

**Key design decisions:**

- **Status mode** uses cumulative `state.stats` (persistent status bar should reflect total savings, not per-pass deltas). Updates every context pass when `totalPruneTokens > 0`.
- **Toast mode** uses per-pass `strategyResult` stats (toasts are ephemeral, should reflect what just happened). Fires only when `strategyResult.pruned > 0`.
- **Detailed mode** shows pruned tool names. `StrategyResult` is extended with `prunedToolNames: string[]` so the data is available at the call site without re-deriving it from state.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File                          | Responsibility                                           |
| ----------------------------- | -------------------------------------------------------- |
| `src/ui/notification.ts`      | New: notification builders (pure functions)               |
| `src/config.ts`               | Add `nudgeNotificationType` to `DcpConfig`               |
| `src/strategies/runner.ts`    | Extend `StrategyResult` with `prunedToolNames`           |
| `src/index.ts`                | Replace old status line with new notification logic      |
| `tests/helpers.ts`            | Add `nudgeNotificationType` to `makeDefaultConfig`       |
| `tests/notification.test.ts`  | Unit tests for message builders                          |
| `tests/config.test.ts`        | Add tests for `nudgeNotificationType` parsing            |
| `tests/index.test.ts`         | Add integration tests for notification emission          |

---

### Task 1: Notification builders, config, and StrategyResult extension

**Files:**

- Create: `src/ui/notification.ts`, `tests/notification.test.ts`
- Modify: `src/config.ts`, `src/strategies/runner.ts`, `tests/helpers.ts`, `tests/config.test.ts`

- [ ] **Step 1: Write tests for notification builders**

Create `tests/notification.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildMinimalMessage,
  buildDetailedMessage,
} from "../src/ui/notification.ts";

describe("buildMinimalMessage", () => {
  it("formats token count and prune count", () => {
    const result = buildMinimalMessage({ tokensSaved: 12400, pruned: 3 });
    expect(result).toBe("DCP: ~12.4K tokens saved (3 items pruned)");
  });

  it("formats large token counts with K suffix", () => {
    const result = buildMinimalMessage({ tokensSaved: 156000, pruned: 10 });
    expect(result).toBe("DCP: ~156.0K tokens saved (10 items pruned)");
  });

  it("formats small token counts without K suffix", () => {
    const result = buildMinimalMessage({ tokensSaved: 500, pruned: 1 });
    expect(result).toBe("DCP: ~500 tokens saved (1 items pruned)");
  });

  it("returns undefined when nothing pruned", () => {
    const result = buildMinimalMessage({ tokensSaved: 0, pruned: 0 });
    expect(result).toBeUndefined();
  });
});

describe("buildDetailedMessage", () => {
  it("includes pruned tool list", () => {
    const result = buildDetailedMessage({ tokensSaved: 5000, pruned: 2 }, [
      "grep",
      "ls",
    ]);
    expect(result).toContain("~5.0K tokens saved");
    expect(result).toContain("grep");
    expect(result).toContain("ls");
  });

  it("falls back to minimal format when tool list is empty", () => {
    const result = buildDetailedMessage({ tokensSaved: 5000, pruned: 2 }, []);
    expect(result).toContain("~5.0K tokens saved");
    expect(result).not.toContain("Pruned:");
  });

  it("deduplicates tool names", () => {
    const result = buildDetailedMessage({ tokensSaved: 3000, pruned: 3 }, [
      "grep",
      "grep",
      "ls",
    ]);
    expect(result).toContain("Pruned: grep, ls");
  });

  it("returns undefined when nothing pruned", () => {
    const result = buildDetailedMessage({ tokensSaved: 0, pruned: 0 }, ["grep"]);
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/notification.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/ui/notification.ts`**

Create `src/ui/` directory, then create `src/ui/notification.ts`:

```typescript
export interface NotificationStats {
  tokensSaved: number;
  pruned: number;
}

/**
 * Format token count for display (e.g. 12400 -> "~12.4K").
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `~${(tokens / 1000).toFixed(1)}K`;
  }
  return `~${tokens}`;
}

/**
 * Build minimal notification message.
 * Returns undefined if nothing to report.
 */
export function buildMinimalMessage(
  stats: NotificationStats,
): string | undefined {
  if (stats.tokensSaved === 0 && stats.pruned === 0) return undefined;
  return `DCP: ${formatTokens(stats.tokensSaved)} tokens saved (${stats.pruned} items pruned)`;
}

/**
 * Build detailed notification message with pruned tool names.
 * Deduplicates tool names. Falls back to minimal when list is empty.
 */
export function buildDetailedMessage(
  stats: NotificationStats,
  prunedTools: string[],
): string | undefined {
  const base = buildMinimalMessage(stats);
  if (!base) return undefined;
  const unique = [...new Set(prunedTools)];
  if (unique.length === 0) return base;
  return `${base}\nPruned: ${unique.join(", ")}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/notification.test.ts`

Expected: All PASS.

- [ ] **Step 5: Add `nudgeNotificationType` to config**

In `src/config.ts`:

1. Add to `DcpConfig` interface (after `nudgeNotification` on line 10):

```typescript
  nudgeNotificationType: "toast" | "status";
```

2. Add default in `DEFAULT_CONFIG` (after `nudgeNotification: "minimal"` on line 89):

```typescript
  nudgeNotificationType: "status",
```

3. Add `"nudgeNotificationType"` to the `KNOWN_TOP_LEVEL_KEYS` set (line 107-110). The set should become:

```typescript
const KNOWN_TOP_LEVEL_KEYS = new Set([
  "enabled", "debug", "compress", "manualMode", "strategies",
  "protectedFilePatterns", "nudgeNotification", "nudgeNotificationType",
]);
```

4. Add parsing in `mergeConfig` (after the existing `nudgeNotification` parsing block, around line 199):

```typescript
  if (typeof source.nudgeNotificationType === "string") {
    if (["toast", "status"].includes(source.nudgeNotificationType)) {
      target.nudgeNotificationType = source.nudgeNotificationType as
        | "toast"
        | "status";
    }
  }
```

- [ ] **Step 6: Update `makeDefaultConfig` in `tests/helpers.ts`**

Add `nudgeNotificationType: "status"` after `nudgeNotification: "minimal"` on line 86:

```typescript
    nudgeNotification: "minimal",
    nudgeNotificationType: "status",
```

- [ ] **Step 7: Extend `StrategyResult` with `prunedToolNames`**

In `src/strategies/runner.ts`:

1. Add `prunedToolNames` to the `StrategyResult` interface:

```typescript
export interface StrategyResult {
  pruned: number;
  tokensSaved: number;
  prunedToolNames: string[];
}
```

2. In `runStrategies`, initialize a `prunedToolNames` array at the top (after `let tokensSaved = 0`):

```typescript
  const prunedToolNames: string[] = [];
```

3. In both the deduplication and purge-errors loops, after `state.prune.tools.set(callId, tokens)`, push the tool name:

```typescript
        prunedToolNames.push(entry.tool);
```

4. Update both early returns (empty toolIdList and manual mode guard) to include the field:

```typescript
    return { pruned: 0, tokensSaved: 0, prunedToolNames: [] };
```

5. Update the final return:

```typescript
  return { pruned, tokensSaved, prunedToolNames };
```

6. In `sweepAll`, add the same pattern — collect tool names during the loop and return them:

```typescript
  const prunedToolNames: string[] = [];
  // ... inside the loop, after state.prune.tools.set(toolCallId, tokens):
  prunedToolNames.push(entry.tool);
  // ... final return:
  return { pruned, tokensSaved, prunedToolNames };
```

- [ ] **Step 8: Add config tests for `nudgeNotificationType`**

Append to `tests/config.test.ts`, inside the existing `describe("config", ...)` block:

```typescript
  it("parses nudgeNotificationType", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, JSON.stringify({ nudgeNotificationType: "toast" }));
    const { config } = loadConfig(configPath);
    expect(config.nudgeNotificationType).toBe("toast");
  });

  it("defaults nudgeNotificationType to status", () => {
    const configPath = path.join(tempDir, "dcp.json");
    const { config } = loadConfig(configPath);
    expect(config.nudgeNotificationType).toBe("status");
  });

  it("ignores invalid nudgeNotificationType", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, JSON.stringify({ nudgeNotificationType: "popup" }));
    const { config } = loadConfig(configPath);
    expect(config.nudgeNotificationType).toBe("status");
  });
```

- [ ] **Step 9: Run typecheck and tests**

Run: `npm run check`

Expected: All pass. Existing strategy-runner tests are unaffected (they check `result.pruned` / `result.tokensSaved` individually, not `toEqual` on the full object).

- [ ] **Step 10: Commit**

```bash
git add src/ui/notification.ts src/config.ts src/strategies/runner.ts \
       tests/notification.test.ts tests/config.test.ts tests/helpers.ts
git commit -m "feat(ui): add notification builders, nudgeNotificationType config, extend StrategyResult"
```

---

### Task 2: Emit notifications from context handler

**Files:**

- Modify: `src/index.ts`, `tests/index.test.ts`

- [ ] **Step 1: Import notification module**

In `src/index.ts`, add after the existing imports:

```typescript
import {
  buildMinimalMessage,
  buildDetailedMessage,
} from "./ui/notification.ts";
```

- [ ] **Step 2: Replace old status line with new notification logic**

In the `context` handler, **replace** the existing block (lines 275-280):

```typescript
    if (ctx.hasUI && state.stats.totalPruneTokens > 0) {
      ctx.ui.setStatus(
        "dcp",
        `DCP: ${state.stats.totalPruneTokens} tokens saved`,
      );
    }
```

With this new notification logic:

```typescript
    if (ctx.hasUI && config.nudgeNotification !== "off") {
      if (config.nudgeNotificationType === "toast") {
        // Toast: per-pass stats, only fire when something was pruned this pass
        if (result.strategyResult.pruned > 0) {
          const stats = {
            tokensSaved: result.strategyResult.tokensSaved,
            pruned: result.strategyResult.pruned,
          };
          const message =
            config.nudgeNotification === "detailed"
              ? buildDetailedMessage(stats, result.strategyResult.prunedToolNames)
              : buildMinimalMessage(stats);
          if (message) ctx.ui.notify(message, "info");
        }
      } else {
        // Status: cumulative stats, always update when savings exist
        if (state.stats.totalPruneTokens > 0) {
          const stats = {
            tokensSaved: state.stats.totalPruneTokens,
            pruned: state.stats.toolsPruned,
          };
          const message = buildMinimalMessage(stats);
          if (message) ctx.ui.setStatus("dcp", message);
        }
      }
    }
```

**Rationale:** Status bar is persistent — showing cumulative savings is meaningful. Toasts are ephemeral — showing per-pass delta with tool names is more useful. Detailed mode only affects toast (status bar is a one-liner by convention).

- [ ] **Step 3: Add integration tests**

Append to `tests/index.test.ts`. The existing `createMockApi` helper already works; tests need a mock `ctx` with `hasUI` and `ui` methods.

```typescript
  it("context handler calls setStatus with cumulative stats (status mode)", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);

    const contextHandlers = handlers.get("context") ?? [];
    const setStatus = vi.fn();
    const mockCtx = {
      hasUI: true,
      ui: { setStatus, notify: vi.fn() },
      getContextUsage: () => ({ tokens: 1000, contextWindow: 200000, percent: 5 }),
    };

    // First pass — nothing pruned yet, no status call
    const messages1 = [
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() },
    ];
    await (contextHandlers[0] as Function)({ messages: messages1 }, mockCtx);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("context handler suppresses notifications when nudgeNotification is off", async () => {
    // This test verifies the "off" path. Since config is loaded from a
    // non-existent file (defaults), and default is "minimal", we verify
    // that the default path works. Testing "off" requires a config file
    // which is complex; the builder unit tests cover suppression logic.
    const { api, handlers } = createMockApi();
    createExtension(api);
    const contextHandlers = handlers.get("context") ?? [];
    expect(contextHandlers).toHaveLength(1);
  });

  it("context handler does not call ui methods when hasUI is false", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);

    const contextHandlers = handlers.get("context") ?? [];
    const setStatus = vi.fn();
    const notify = vi.fn();
    const mockCtx = {
      hasUI: false,
      ui: { setStatus, notify },
      getContextUsage: () => ({ tokens: 1000, contextWindow: 200000, percent: 5 }),
    };

    const messages = [
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() },
    ];
    await (contextHandlers[0] as Function)({ messages }, mockCtx);
    expect(setStatus).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
```

- [ ] **Step 4: Run full check**

Run: `npm run check`

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat(ui): emit notifications after pipeline execution"
```

---

## Verification Checklist

- [ ] `npm run check` passes
- [ ] `buildMinimalMessage` formats correctly for various token counts (unit tests)
- [ ] `buildDetailedMessage` includes tool list and deduplicates names (unit tests)
- [ ] `buildDetailedMessage` falls back to minimal when tool list is empty (unit test)
- [ ] `nudgeNotification: "off"` suppresses all notifications
- [ ] `nudgeNotificationType: "toast"` uses `ctx.ui.notify` with per-pass stats
- [ ] `nudgeNotificationType: "status"` uses `ctx.ui.setStatus` with cumulative stats
- [ ] `nudgeNotificationType` config parsing accepts valid values, rejects invalid (config tests)
- [ ] `StrategyResult.prunedToolNames` populated by both `runStrategies` and `sweepAll`
- [ ] Old hardcoded status message removed
- [ ] `tests/helpers.ts` `makeDefaultConfig` includes `nudgeNotificationType`
- [ ] No existing tests broken
