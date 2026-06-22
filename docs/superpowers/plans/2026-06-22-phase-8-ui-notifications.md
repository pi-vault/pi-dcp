# Phase 8: UI Notifications

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide configurable user-visible feedback on DCP pruning and compression activity beyond the existing status counter.

**Architecture:** Add a notification module with content builders for minimal/detailed messages. Emit notifications after pipeline execution in the `context` handler, controlled by `nudgeNotification` config.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File                         | Responsibility                               |
| ---------------------------- | -------------------------------------------- |
| `src/ui/notification.ts`     | New: notification builders and emit function |
| `src/config.ts`              | Add `nudgeNotificationType` to config        |
| `src/index.ts`               | Call notification emit after pipeline        |
| `tests/notification.test.ts` | Unit tests for message builders              |

---

### Task 1: Add config and implement notification builders

**Files:**

- Create: `src/ui/notification.ts`
- Modify: `src/config.ts`
- Test: `tests/notification.test.ts` (create)

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

  it("returns empty when nothing pruned", () => {
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

  it("returns minimal format when no tool list provided", () => {
    const result = buildDetailedMessage({ tokensSaved: 5000, pruned: 2 }, []);
    expect(result).toContain("~5.0K tokens saved");
    expect(result).not.toContain("Pruned:");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/notification.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/ui/notification.ts`**

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
 */
export function buildDetailedMessage(
  stats: NotificationStats,
  prunedTools: string[],
): string | undefined {
  const base = buildMinimalMessage(stats);
  if (!base) return undefined;
  if (prunedTools.length === 0) return base;
  return `${base}\nPruned: ${prunedTools.join(", ")}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/notification.test.ts`

Expected: All PASS.

- [ ] **Step 5: Add `nudgeNotificationType` to config**

In `src/config.ts`, add to `DcpConfig`:

```typescript
nudgeNotificationType: "toast" | "status";
```

Add default:

```typescript
  nudgeNotificationType: "status",
```

Add to `KNOWN_TOP_LEVEL_KEYS`: `"nudgeNotificationType"`.

Add parsing in `mergeConfig`:

```typescript
if (typeof source.nudgeNotificationType === "string") {
  if (["toast", "status"].includes(source.nudgeNotificationType)) {
    target.nudgeNotificationType = source.nudgeNotificationType as
      | "toast"
      | "status";
  }
}
```

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/ui/notification.ts src/config.ts tests/notification.test.ts
git commit -m "feat(ui): add notification builders and nudgeNotificationType config"
```

---

### Task 2: Emit notifications from context handler

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Import notification module**

In `src/index.ts`:

```typescript
import {
  buildMinimalMessage,
  buildDetailedMessage,
} from "./ui/notification.ts";
```

- [ ] **Step 2: Add notification emission after pipeline returns**

In the `context` handler, after the strategy logging and before `return { messages: result.messages }`, add:

```typescript
// Emit notification based on config
if (
  ctx.hasUI &&
  result.strategyResult.pruned > 0 &&
  config.nudgeNotification !== "off"
) {
  const stats = {
    tokensSaved: result.strategyResult.tokensSaved,
    pruned: result.strategyResult.pruned,
  };
  const message =
    config.nudgeNotification === "detailed"
      ? buildDetailedMessage(stats, [])
      : buildMinimalMessage(stats);

  if (message) {
    if (config.nudgeNotificationType === "toast") {
      ctx.ui.notify(message);
    } else {
      ctx.ui.setStatus("dcp", message);
    }
  }
}
```

Also update the existing `ctx.ui.setStatus` line — replace it with the new notification logic (remove the old one to avoid duplicate status updates):

Remove:

```typescript
if (ctx.hasUI && state.stats.totalPruneTokens > 0) {
  ctx.ui.setStatus("dcp", `DCP: ${state.stats.totalPruneTokens} tokens saved`);
}
```

- [ ] **Step 3: Run full check**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npm run check`

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/index.ts
git commit -m "feat(ui): emit notifications after pipeline execution"
```

---

## Verification Checklist

- [ ] `npm run check` passes
- [ ] `buildMinimalMessage` formats correctly for various token counts
- [ ] `buildDetailedMessage` includes tool list
- [ ] `nudgeNotification: "off"` suppresses all notifications
- [ ] `nudgeNotificationType: "toast"` uses `ctx.ui.notify`
- [ ] `nudgeNotificationType: "status"` uses `ctx.ui.setStatus`
- [ ] Old hardcoded status message removed
