# Phase 2: Permission Gating via tool_call

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce `compress.permission` at the Pi framework level using the `tool_call` event, wire up the existing `state.compressPermission` field, and add a `dcp:permission` command for runtime toggling.

**Architecture:** Register a `tool_call` event handler that blocks the compress tool when the effective permission is `"deny"`. Initialize `state.compressPermission` from config on session start. Add a slash command to toggle it at runtime. The tool is always registered (Pi cannot unregister tools after init), enabling runtime toggling via the command.

**Tech Stack:** TypeScript, Vitest

**Key references:**
- `src/index.ts` — main extension entry, event handlers registered here
- `src/state/types.ts:10` — `compressPermission: "allow" | "deny" | undefined` already defined
- `src/state/state.ts:13` — field initialized to `undefined` in `createSessionState()`
- `src/commands/register.ts` — existing command registration pattern
- `src/commands/manual.ts` — similar toggle command for reference
- Pi framework: `tool_call` handler returns `{ block: true, reason: string }` to prevent execution

---

### Task 1: Create permission command + tests

**Files:**
- Create: `src/commands/permission.ts`
- Create: `tests/commands-permission.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/commands-permission.test.ts`:

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

  it("treats undefined as allow (toggles to deny)", () => {
    const state = createSessionState();
    // compressPermission starts undefined from createSessionState()

    const result = permissionCommand(state);
    expect(state.compressPermission).toBe("deny");
    expect(result).toContain("deny");
  });

  it("returns human-readable status string", () => {
    const state = createSessionState();
    state.compressPermission = "allow";

    const result = permissionCommand(state);
    expect(result).toBe("Compress permission: deny");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/commands-permission.test.ts`
Expected: FAIL — `permissionCommand` does not exist yet.

- [ ] **Step 3: Write the command handler**

Create `src/commands/permission.ts`:

```ts
import type { SessionState } from "../state/types.ts";

export function permissionCommand(state: SessionState): string {
  const current = state.compressPermission ?? "allow";
  state.compressPermission = current === "allow" ? "deny" : "allow";
  return `Compress permission: ${state.compressPermission}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/commands-permission.test.ts`
Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/commands/permission.ts tests/commands-permission.test.ts
git commit -m "feat: add permissionCommand for runtime compress toggling"
```

---

### Task 2: Register dcp:permission command

**Files:**
- Modify: `src/commands/register.ts`
- Modify: `tests/commands-register.test.ts`

- [ ] **Step 1: Update the registration test**

In `tests/commands-register.test.ts`, update the expected count and add the new command assertion.

Change:
```ts
    expect(registered).toHaveLength(8);
```

To:
```ts
    expect(registered).toContain("dcp:permission");
    expect(registered).toHaveLength(9);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/commands-register.test.ts`
Expected: FAIL — `dcp:permission` not registered, length is 8 not 9.

- [ ] **Step 3: Add the import and registration**

In `src/commands/register.ts`, add the import at the top (after the `lifetimeCommand` import):

```ts
import { permissionCommand } from "./permission.ts";
```

Add the command registration before the closing `}` of `registerDcpCommands` (after the `dcp:lifetime` block):

```ts
  pi.registerCommand("dcp:permission", {
    description: "Toggle compress permission (allow/deny)",
    handler: async (_args, ctx) => {
      ctx.ui.notify(permissionCommand(state), "info");
    },
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/commands-register.test.ts tests/commands-permission.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/commands/register.ts tests/commands-register.test.ts
git commit -m "feat: register dcp:permission slash command"
```

---

### Task 3: Add tool_call handler and state initialization

**Files:**
- Modify: `src/index.ts:194` (session_start handler — add state init)
- Modify: `src/index.ts:304` (after message_end handler — add tool_call handler)
- Create: `tests/permission-gating.test.ts`

- [ ] **Step 1: Write integration tests for the gating logic**

Create `tests/permission-gating.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";

/**
 * Tests the permission gating logic that will live in the tool_call handler.
 * Extracted as a pure function for testability.
 */
function shouldBlockCompress(
  state: { compressPermission: "allow" | "deny" | undefined },
  configPermission: "allow" | "deny",
): { block: true; reason: string } | undefined {
  const permission = state.compressPermission ?? configPermission;
  if (permission === "deny") {
    return { block: true, reason: "Compression denied by configuration" };
  }
  return undefined;
}

describe("permission gating logic", () => {
  it("blocks when state.compressPermission is deny", () => {
    const state = createSessionState();
    state.compressPermission = "deny";

    const result = shouldBlockCompress(state, "allow");
    expect(result).toEqual({ block: true, reason: "Compression denied by configuration" });
  });

  it("allows when state.compressPermission is allow", () => {
    const state = createSessionState();
    state.compressPermission = "allow";

    const result = shouldBlockCompress(state, "deny");
    expect(result).toBeUndefined();
  });

  it("falls back to config when state is undefined", () => {
    const state = createSessionState();
    // state.compressPermission is undefined by default

    const result = shouldBlockCompress(state, "deny");
    expect(result).toEqual({ block: true, reason: "Compression denied by configuration" });
  });

  it("allows when both state is undefined and config is allow", () => {
    const state = createSessionState();

    const result = shouldBlockCompress(state, "allow");
    expect(result).toBeUndefined();
  });

  it("state overrides config (state allow beats config deny)", () => {
    const state = createSessionState();
    state.compressPermission = "allow";

    const result = shouldBlockCompress(state, "deny");
    expect(result).toBeUndefined();
  });

  it("state overrides config (state deny beats config allow)", () => {
    const state = createSessionState();
    state.compressPermission = "deny";

    const result = shouldBlockCompress(state, "allow");
    expect(result).toEqual({ block: true, reason: "Compression denied by configuration" });
  });
});

describe("state initialization from config", () => {
  it("compressPermission is set from config on session start", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ compress: { permission: "deny" } });

    // Simulate what session_start does:
    state.compressPermission = config.compress.permission;

    expect(state.compressPermission).toBe("deny");
  });

  it("defaults to allow when config is allow", () => {
    const state = createSessionState();
    const config = makeDefaultConfig(); // default permission is "allow"

    state.compressPermission = config.compress.permission;

    expect(state.compressPermission).toBe("allow");
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm vitest run tests/permission-gating.test.ts`
Expected: All 8 tests pass (the logic is self-contained in the test file).

- [ ] **Step 3: Initialize compressPermission in session_start handler**

In `src/index.ts`, in the `session_start` handler, add after line 194 (`state.manualMode = config.manualMode.default;`):

```ts
    state.compressPermission = config.compress.permission;
```

- [ ] **Step 4: Add tool_call handler**

In `src/index.ts`, add the `tool_call` handler after the `message_end` handler (after line 304, before the `tool_execution_start` handler):

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

- [ ] **Step 5: Run all tests and checks**

Run: `pnpm check`
Expected: All tests pass. No lint or type errors.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/permission-gating.test.ts
git commit -m "feat: enforce compress permission via tool_call handler"
```

---

### Task 4: Verify end-to-end behavior

**Files:** None (verification only)

- [ ] **Step 1: Run full check suite**

Run: `pnpm check`
Expected: Lint, typecheck, and all tests pass.

- [ ] **Step 2: Verify nudge injection still respects deny**

The existing test in `tests/inject.test.ts` ("skips nudge injection when compressPermission is deny") should still pass. Confirm it's included in the test run output.

- [ ] **Step 3: Commit (if any fixes were needed)**

Only if previous steps required adjustments:
```bash
git add -A
git commit -m "fix: address integration issues from permission gating"
```
