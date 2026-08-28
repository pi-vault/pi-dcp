# Phase 4: Disabled-Model Transition Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the model-disable state machine remains correct across repeated reconciliation, consecutive disabled models, runtime event boundaries, and disabled-model lifecycle operations.

**Architecture:** Exercise public event handlers and registered commands rather than exporting internal runtime state. Observe active-tool calls, persisted entries, and command notifications. Keep changes in `tests/index.test.ts`; modify `src/index.ts` only if a new regression exposes a spec mismatch.

**Tech Stack:** TypeScript, Node.js `>=24.15.0`, Vitest, pnpm, mise.

**Spec:** `docs/superpowers/specs/2026-08-26-model-specific-dcp-controls-design.md`

## Global Constraints

- Repeated disabled reconciliation must not overwrite the activation sentinel.
- Disabled-to-disabled transitions preserve the state captured on first entry.
- Disabled runtime events must not leave state that becomes observable after re-enablement.
- Compaction and tree handlers remain authoritative while the selected model is disabled.
- Keep test additions in `tests/index.test.ts`; add no production abstraction solely for testing.
- Run Node and pnpm commands through `mise exec node@24.15.0 --`.
- Add no dependencies or reference-repository changes.
- Do not commit unless the user explicitly requests a commit.

## Read-only Reference Findings

- Pi's `registerTool()` refreshes the tool registry, `setActiveTools()` applies the supplied registered-tool order, and `model_select` is awaited after the current model changes. The existing mock remains the smallest valid test boundary.
- OpenCode DCP confirms exact `provider/model` limit maps and durable session state, but has no model-disable transition behavior to reuse.

---

### Task 1: Harden active-tool transitions

**Files:**

- Test: `tests/index.test.ts`
- Modify if required by a failing regression: `src/index.ts`

**Interfaces:**

- Consumes the Phase 2 `compressWasActiveBeforeModelDisable` sentinel and Phase 3 `model_select` handler.
- Extends `createMockApi()` with the existing `setActiveTools` operation exposed as a Vitest mock.
- Observes final active-tool state and exact reconciliation calls.

- [ ] **Step 1: Verify the required runtime**

Run:

```bash
mise exec node@24.15.0 -- node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) throw new Error(`Node >=24.15.0 required, got ${process.versions.node}`)'
```

Expected: exit code `0` and no output.

- [ ] **Step 2: Add the second disabled model fixture**

Add beside `disabledModel` and `enabledModel`:

```ts
const secondDisabledModel = {
  provider: "openai-codex",
  id: "gpt-5.6-luna",
};
```

- [ ] **Step 3: Expose active-tool reconciliation calls**

In `createMockApi()`, define the setter before `api`:

```ts
const setActiveTools = vi.fn((names: string[]) => {
  activeToolNames = [...names];
});
```

Replace the inline API method with `setActiveTools,`, then return `setActiveTools` beside `activeTools` from the mock.

- [ ] **Step 4: Add repeated-reconciliation coverage**

Add under `describe("static model disablement", ...)`:

```ts
it("preserves compress activation across repeated disabled reconciliation", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const { api, handlers, activeTools, setActiveTools } = createMockApi({
    activeTools: ["read"],
  });
  createExtension(api);
  await registeredHandler(handlers, "session_start")(
    { reason: "new" },
    sessionContext(enabledModel),
  );
  setActiveTools.mockClear();

  await registeredHandler(handlers, "model_select")(
    {
      type: "model_select",
      model: disabledModel,
      previousModel: enabledModel,
      source: "set",
    },
    sessionContext(disabledModel),
  );
  expect(activeTools()).toEqual(["read"]);

  for (let index = 0; index < 2; index++) {
    await registeredHandler(handlers, "context")(
      { messages: [] },
      sessionContext(disabledModel),
    );
    expect(activeTools()).toEqual(["read"]);
  }

  await registeredHandler(handlers, "model_select")(
    {
      type: "model_select",
      model: enabledModel,
      previousModel: disabledModel,
      source: "set",
    },
    sessionContext(enabledModel),
  );

  expect(activeTools()).toEqual(["read", "compress"]);
  expect(setActiveTools.mock.calls).toEqual([
    [["read"]],
    [["read", "compress"]],
  ]);
});
```

Format the final assertion with Biome; the nested arrays represent the single argument passed to each setter call.

- [ ] **Step 5: Add disabled-to-disabled coverage for both prior states**

Add:

```ts
it.each([
  {
    name: "restores an initially active compress tool",
    activeBeforeDisable: ["read", "compress"],
    expectedActiveTools: ["read", "compress"],
    expectedCalls: [[["read"]], [["read", "compress"]]],
  },
  {
    name: "keeps an initially inactive compress tool inactive",
    activeBeforeDisable: ["read"],
    expectedActiveTools: ["read"],
    expectedCalls: [],
  },
])(
  "$name across consecutive disabled models",
  async ({ activeBeforeDisable, expectedActiveTools, expectedCalls }) => {
    writeDisabledModelConfig(
      "openai-codex/gpt-5.6-sol",
      "openai-codex/gpt-5.6-luna",
    );
    const { api, handlers, activeTools, setActiveTools } = createMockApi({
      activeTools: ["read"],
    });
    createExtension(api);
    await registeredHandler(handlers, "session_start")(
      { reason: "new" },
      sessionContext(enabledModel),
    );
    api.setActiveTools(activeBeforeDisable);
    setActiveTools.mockClear();

    await registeredHandler(handlers, "model_select")(
      {
        type: "model_select",
        model: disabledModel,
        previousModel: enabledModel,
        source: "set",
      },
      sessionContext(disabledModel),
    );
    await registeredHandler(handlers, "model_select")(
      {
        type: "model_select",
        model: secondDisabledModel,
        previousModel: disabledModel,
        source: "set",
      },
      sessionContext(secondDisabledModel),
    );
    await registeredHandler(handlers, "model_select")(
      {
        type: "model_select",
        model: enabledModel,
        previousModel: secondDisabledModel,
        source: "set",
      },
      sessionContext(enabledModel),
    );

    expect(activeTools()).toEqual(expectedActiveTools);
    expect(setActiveTools.mock.calls).toEqual(expectedCalls);
  },
);
```

- [ ] **Step 6: Run the active-tool transition tests**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts -t "repeated disabled reconciliation|consecutive disabled models"
```

Expected: all three cases PASS. If a regression fails, change only the sentinel branch in `reconcileCompressTool()` and rerun this command.

- [ ] **Step 7: Run the complete index suite**

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts`

Expected: PASS.

### Task 2: Prevent disabled runtime state from crossing re-enablement

**Files:**

- Test: `tests/index.test.ts`
- Modify if required by a failing regression: `src/index.ts`

**Interfaces:**

- Reuses `persistedCompressionSnapshot` to make compression duration observable through `entries`.
- Proves a disabled `tool_execution_start` cannot be consumed by an enabled `tool_execution_end` with the same call ID.
- Reuses the Phase 2 sanitization, stale compression, direct execution, and subagent-cache boundary tests without duplicating them.

- [ ] **Step 1: Add the cross-transition timing regression**

Add under `describe("static model disablement", ...)`:

```ts
it("does not carry disabled compression timing into an enabled model", async () => {
  vi.useFakeTimers();
  try {
    writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
    const { api, handlers, entries } = createMockApi();
    createExtension(api);
    const disabledCtx = sessionContext(disabledModel, [
      {
        type: "custom",
        customType: "pi-dcp-state",
        data: persistedCompressionSnapshot,
      },
    ]);
    await registeredHandler(handlers, "session_start")(
      { reason: "resume" },
      disabledCtx,
    );
    entries.length = 0;

    vi.setSystemTime(1_000);
    await registeredHandler(handlers, "tool_execution_start")(
      { toolName: "compress", toolCallId: "compress-1" },
      disabledCtx,
    );
    await registeredHandler(handlers, "model_select")(
      {
        type: "model_select",
        model: enabledModel,
        previousModel: disabledModel,
        source: "set",
      },
      sessionContext(enabledModel),
    );
    vi.setSystemTime(2_500);
    await registeredHandler(handlers, "tool_execution_end")(
      { toolName: "compress", toolCallId: "compress-1", isError: false },
      sessionContext(enabledModel),
    );

    expect(entries).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});
```

This assertion fails if the disabled start event leaves a timestamp that later changes the persisted block duration.

- [ ] **Step 2: Run the cross-transition timing regression**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts -t "does not carry disabled compression timing"
```

Expected: PASS. If it fails, keep the eligibility guard before `startTimes.set()`; do not add cleanup to unrelated handlers.

- [ ] **Step 3: Re-run all disabled runtime boundary tests**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts -t "does not sanitize|does not record compression timing|does not carry disabled compression timing|does not cache subagent|blocks a stale compress call|rejects direct compress execution"
```

Expected: six tests PASS.

- [ ] **Step 4: Run the complete index suite**

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts`

Expected: PASS.

### Task 3: Verify state retention and lifecycle authority while disabled

**Files:**

- Test: `tests/index.test.ts`
- Modify if required by a failing regression: `src/index.ts`

**Interfaces:**

- Uses registered `dcp:manual` and `dcp:context` commands as public state observers.
- Uses `serializeDcpSnapshot()` and `persistedCompressionSnapshot` through public `session_tree` and `session_compact` handlers.
- Proves model selection does not append a `pi-dcp-state` entry.

- [ ] **Step 1: Add model-switch state and status coverage**

Add:

```ts
it("retains state and reports status across disabled model switches", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const { api, handlers, entries, commands } = createMockApi({
    activeTools: ["read"],
  });
  createExtension(api);
  const enabledCtx = sessionContext(enabledModel);
  await registeredHandler(handlers, "session_start")(
    { reason: "new" },
    enabledCtx,
  );

  const manual = commands.get("dcp:manual") as {
    handler: (
      args: string,
      ctx: ReturnType<typeof sessionContext>,
    ) => Promise<void>;
  };
  const context = commands.get("dcp:context") as {
    handler: (
      args: string,
      ctx: ReturnType<typeof sessionContext>,
    ) => Promise<void>;
  };
  await manual.handler("on", enabledCtx);
  expect(enabledCtx.ui.notify).toHaveBeenLastCalledWith(
    "Manual mode: on. Automatic compression is paused.",
    "info",
  );
  entries.length = 0;

  const disabledCtx = sessionContext(disabledModel);
  await registeredHandler(handlers, "model_select")(
    {
      type: "model_select",
      model: disabledModel,
      previousModel: enabledModel,
      source: "set",
    },
    disabledCtx,
  );
  expect(entries).toHaveLength(0);
  await context.handler("", disabledCtx);
  const disabledStatus = disabledCtx.ui.notify.mock.calls[0]?.[0] as string;
  expect(disabledStatus).toContain("Manual mode: active");
  expect(disabledStatus).toContain(
    "DCP status: disabled for the current model",
  );

  const reenabledCtx = sessionContext(enabledModel);
  await registeredHandler(handlers, "model_select")(
    {
      type: "model_select",
      model: enabledModel,
      previousModel: disabledModel,
      source: "set",
    },
    reenabledCtx,
  );
  expect(entries).toHaveLength(0);
  await context.handler("", reenabledCtx);
  const enabledStatus = reenabledCtx.ui.notify.mock.calls[0]?.[0] as string;
  expect(enabledStatus).toContain("Manual mode: active");
  expect(enabledStatus).not.toContain("disabled for the current model");
});
```

- [ ] **Step 2: Add disabled-model tree restoration coverage**

Add:

```ts
it("restores branch state through session_tree while the model is disabled", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const saved = createSessionState();
  saved.sessionId = "session";
  saved.manualMode = "active";
  const snapshot = serializeDcpSnapshot(saved);
  if (!snapshot) throw new Error("expected checkpoint");

  let branch: unknown[] = [];
  const baseCtx = sessionContext(disabledModel);
  const ctx = {
    ...baseCtx,
    sessionManager: {
      ...baseCtx.sessionManager,
      getBranch: () => branch,
    },
  };
  const { api, handlers, entries, commands } = createMockApi();
  createExtension(api);
  await registeredHandler(handlers, "session_start")({ reason: "new" }, ctx);
  entries.length = 0;

  branch = [{ type: "custom", customType: "pi-dcp-state", data: snapshot }];
  await registeredHandler(handlers, "session_tree")({}, ctx);

  const context = commands.get("dcp:context") as {
    handler: (args: string, commandCtx: typeof ctx) => Promise<void>;
  };
  await context.handler("", ctx);
  const status = ctx.ui.notify.mock.calls[0]?.[0] as string;
  expect(status).toContain("Manual mode: active");
  expect(status).toContain("DCP status: disabled for the current model");
  expect(entries).toHaveLength(0);
});
```

- [ ] **Step 3: Add disabled-model compaction coverage**

Add:

```ts
it("clears active pruning through session_compact while the model is disabled", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const { api, handlers, entries } = createMockApi();
  createExtension(api);
  const ctx = sessionContext(disabledModel, [
    {
      type: "custom",
      customType: "pi-dcp-state",
      data: persistedCompressionSnapshot,
    },
  ]);
  await registeredHandler(handlers, "session_start")({ reason: "resume" }, ctx);
  entries.length = 0;

  await registeredHandler(handlers, "session_compact")({}, ctx);

  expect(entries).toHaveLength(1);
  expect(entries[0]?.data).toMatchObject({
    stats: {
      totalPruneTokens: 100,
      messagesCompressed: 2,
    },
    pruneTools: [],
    blocks: [],
  });
});
```

- [ ] **Step 4: Run the new retention and lifecycle tests**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts -t "retains state and reports status|session_tree while the model is disabled|session_compact while the model is disabled"
```

Expected: three tests PASS. If a lifecycle test fails, correct only an eligibility guard that bypasses the existing lifecycle handler; do not duplicate reset or restore logic.

- [ ] **Step 5: Re-run existing lifecycle regressions**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts -t "compaction|session_compact|session_tree|branch"
```

Expected: existing and new matching lifecycle tests PASS without changing lifecycle semantics.

- [ ] **Step 6: Run all feature tests**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/config.test.ts tests/context-limits.test.ts tests/commands-register.test.ts tests/commands-context.test.ts tests/index.test.ts
```

Expected: PASS.

- [ ] **Step 7: Verify formatting and types**

Run:

```bash
mise exec node@24.15.0 -- pnpm format:check
mise exec node@24.15.0 -- pnpm typecheck
```

Expected: both commands PASS with no changed production behavior unless a focused regression required a minimal fix.
