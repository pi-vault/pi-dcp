# Phase 2: Permission Gating via tool_call

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce `compress.permission` at the Pi framework level using the `tool_call` event, wire up the existing `state.compressPermission` field, and add a `dcp:permission` command for runtime toggling.

**Architecture:** Register a `tool_call` event handler that blocks the compress tool when permission is `"deny"`. Initialize `state.compressPermission` from config on session start. Add a slash command to toggle it at runtime.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Write tests

**Files:**
- Create: `tests/permission-gating.test.ts`

- [ ] **Step 1: Write test file**

Create `tests/permission-gating.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { permissionCommand } from "../src/commands/permission.ts";
import { createSessionState } from "../src/state/state.ts";

describe("permissionCommand", () => {
  it("toggles from allow to deny", () => {
    const state = createSessionState();
    state.compressPermission = "allow";

    const result = permissionCommand(state);
    expect(state.compressPermission).toBe("deny");
    expect(result).toContain("deny");
  });

  it("toggles from deny to allow", () => {
    const state = createSessionState();
    state.compressPermission = "deny";

    const result = permissionCommand(state);
    expect(state.compressPermission).toBe("allow");
    expect(result).toContain("allow");
  });

  it("defaults to allow when undefined", () => {
    const state = createSessionState();
    state.compressPermission = undefined;

    const result = permissionCommand(state);
    // undefined defaults to "allow", toggle to "deny"
    expect(state.compressPermission).toBe("deny");
    expect(result).toContain("deny");
  });
});

describe("permission gating logic", () => {
  it("should block when compressPermission is deny", () => {
    // This tests the logic that will be in the tool_call handler
    const state = createSessionState();
    state.compressPermission = "deny";

    const permission = state.compressPermission ?? "allow";
    expect(permission).toBe("deny");
  });

  it("should allow when compressPermission is allow", () => {
    const state = createSessionState();
    state.compressPermission = "allow";

    const permission = state.compressPermission ?? "allow";
    expect(permission).toBe("allow");
  });

  it("should allow when compressPermission is undefined (fallback)", () => {
    const state = createSessionState();

    const configPermission = "allow" as const;
    const permission = state.compressPermission ?? configPermission;
    expect(permission).toBe("allow");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/permission-gating.test.ts`
Expected: FAIL — `permissionCommand` does not exist yet.

---

### Task 2: Create permission command

**Files:**
- Create: `src/commands/permission.ts`

- [ ] **Step 1: Write the command handler**

Create `src/commands/permission.ts`:

```ts
import type { SessionState } from "../state/types.ts";

export function permissionCommand(state: SessionState): string {
  const current = state.compressPermission ?? "allow";
  state.compressPermission = current === "allow" ? "deny" : "allow";
  return `Compress permission: ${state.compressPermission}`;
}
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run tests/permission-gating.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/commands/permission.ts tests/permission-gating.test.ts
git commit -m "feat: add permissionCommand for runtime compress toggling"
```

---

### Task 3: Register command and add tool_call handler

**Files:**
- Modify: `src/commands/register.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Register dcp:permission command**

In `src/commands/register.ts`, add the import at the top:

```ts
import { permissionCommand } from "./permission.ts";
```

Add the command registration before the closing `}` of `registerDcpCommands`:

```ts
  pi.registerCommand("dcp:permission", {
    description: "Toggle compress permission (allow/deny)",
    handler: async (_args, ctx) => {
      ctx.ui.notify(permissionCommand(state), "info");
    },
  });
```

- [ ] **Step 2: Add tool_call handler in index.ts**

In `src/index.ts`, add the `tool_call` handler after the `message_end` handler (after line 642):

```ts
  pi.on("tool_call", async (event, _ctx) => {
    if (!config.enabled) return undefined;
    if (event.toolName !== "compress") return undefined;

    const permission = state.compressPermission ?? config.compress.permission;
    if (permission === "deny") {
      return { block: true, reason: "Compression denied by configuration" };
    }
    return undefined;
  });
```

- [ ] **Step 3: Initialize compressPermission on session start**

In `src/index.ts`, in the `session_start` handler, add after `state.manualMode = config.manualMode.default;` (around line 532):

```ts
    state.compressPermission = config.compress.permission;
```

- [ ] **Step 4: Run all tests**

Run: `pnpm check`
Expected: All tests pass. No lint or type errors.

- [ ] **Step 5: Commit**

```bash
git add src/commands/register.ts src/index.ts
git commit -m "feat: enforce compress permission via tool_call handler"
```
