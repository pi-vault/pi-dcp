# Phase 3: Live Model Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply model-specific DCP eligibility immediately when Pi changes models during a live session.

**Architecture:** Subscribe to Pi's existing `model_select` event. Update the runtime model identity and call the Phase 2 reconciliation state machine; do not register another tool, reset DCP state, or alter lifecycle handlers.

**Tech Stack:** TypeScript, Node.js `>=24.15.0`, Vitest, pnpm, Pi extension APIs.

**Spec:** `docs/superpowers/specs/2026-08-26-model-specific-dcp-controls-design.md`

## Global Constraints

- Consume `disabledModel`, `enabledModel`, `writeDisabledModelConfig`, `sessionContext`, and the active-tool mock created in Phase 2.
- Use `event.model.provider` and `event.model.id` as the selected identity.
- Remove or restore only `compress`; preserve all other active tool names and their order.
- Do not reset or serialize the activation sentinel.
- Do not modify Pi or either DCP reference repository.
- Run every Node/pnpm command through `mise exec node@24.15.0 --`; the default shell selects unsupported Node `v23.11.0`.
- Do not commit unless the user explicitly requests a commit.

---

### Task 1: Add live-switch regression tests

**Files:**

- Test: `tests/index.test.ts`

**Interfaces:**

- Consumes the Phase 2 `reconcileCompressTool` behavior through the `model_select` handler.
- Characterizes both prior-active and prior-inactive `compress` states.
- Proves unrelated active tools retain their order across both transitions.

- [ ] **Step 1: Verify the required runtime**

Run:

```bash
mise exec node@24.15.0 -- node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) throw new Error(`Node >=24.15.0 required, got ${process.versions.node}`)'
```

Expected: exit code `0` and no output.

- [ ] **Step 2: Add the prior-active switch test**

```ts
it("removes and restores compress across model_select", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const { api, handlers, activeTools } = createMockApi({
    activeTools: ["read", "bash"],
  });
  createExtension(api);
  await registeredHandler(handlers, "session_start")(
    { reason: "new" },
    sessionContext(enabledModel),
  );
  expect(activeTools()).toEqual(["read", "bash", "compress"]);

  await registeredHandler(handlers, "model_select")(
    {
      type: "model_select",
      model: disabledModel,
      previousModel: enabledModel,
      source: "set",
    },
    sessionContext(disabledModel),
  );
  expect(activeTools()).toEqual(["read", "bash"]);

  await registeredHandler(handlers, "model_select")(
    {
      type: "model_select",
      model: enabledModel,
      previousModel: disabledModel,
      source: "set",
    },
    sessionContext(enabledModel),
  );
  expect(activeTools()).toEqual(["read", "bash", "compress"]);
});
```

- [ ] **Step 3: Add the prior-inactive switch test**

After `session_start`, call `api.setActiveTools(["read", "bash"])` to model the user's explicit choice, switch to the disabled model, then return to the enabled model:

```ts
it("does not restore compress when it was inactive before disablement", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const { api, handlers, activeTools } = createMockApi({
    activeTools: ["read", "bash"],
  });
  createExtension(api);
  await registeredHandler(handlers, "session_start")(
    { reason: "new" },
    sessionContext(enabledModel),
  );
  api.setActiveTools(["read", "bash"]);

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
      model: enabledModel,
      previousModel: disabledModel,
      source: "set",
    },
    sessionContext(enabledModel),
  );

  expect(activeTools()).toEqual(["read", "bash"]);
});
```

- [ ] **Step 4: Run the index tests and confirm the expected failures**

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts`

Expected: FAIL because `model_select` is not registered.

### Task 2: Implement `model_select` reconciliation

**Files:**

- Modify: `src/index.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes `reconcileCompressTool(provider, modelId)` from Phase 2.
- Updates `state.modelProvider` and `state.modelId` without clearing any other state.

- [ ] **Step 1: Register the handler**

Add beside the other runtime event subscriptions:

```ts
pi.on("model_select", async (event, _ctx) => {
  state.modelProvider = event.model.provider;
  state.modelId = event.model.id;
  if (!config.enabled) return;
  reconcileCompressTool(event.model.provider, event.model.id);
});
```

Do not call `resetSessionState`, `persistIfChanged`, or `registerCompressTool` from this handler.

- [ ] **Step 2: Document live switching**

In the model-specific configuration example, replace the final static-session sentence with:

```md
Changing models during a live session immediately removes or restores `compress` according to `disabledModels`. Existing DCP state remains intact while the selected model is disabled and is available again after switching to an enabled model.
```

- [ ] **Step 3: Run the focused live-switch tests**

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts`

Expected: PASS.

- [ ] **Step 4: Run the accumulated feature tests**

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/config.test.ts tests/context-limits.test.ts tests/commands-register.test.ts tests/commands-context.test.ts tests/index.test.ts`

Expected: PASS.
