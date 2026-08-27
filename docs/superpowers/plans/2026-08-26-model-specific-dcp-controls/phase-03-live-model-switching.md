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
- Do not commit unless the user explicitly requests a commit.

---

### Task 1: Add live-switch regression tests

**Files:**

- Test: `tests/index.test.ts`

**Interfaces:**

- Consumes the Phase 2 `reconcileCompressTool` behavior through the `model_select` handler.
- Characterizes both prior-active and prior-inactive `compress` states.

- [ ] **Step 1: Add the prior-active switch test**

```ts
it("removes and restores compress across model_select", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const { api, handlers, activeTools } = createMockApi({ activeTools: ["read"] });
  createExtension(api);
  await registeredHandler(handlers, "session_start")(
    { reason: "new" },
    sessionContext(enabledModel),
  );
  expect(activeTools()).toEqual(["read", "compress"]);

  await registeredHandler(handlers, "model_select")(
    { model: disabledModel, previousModel: enabledModel, source: "set" },
    sessionContext(disabledModel),
  );
  expect(activeTools()).toEqual(["read"]);

  await registeredHandler(handlers, "model_select")(
    { model: enabledModel, previousModel: disabledModel, source: "set" },
    sessionContext(enabledModel),
  );
  expect(activeTools()).toEqual(["read", "compress"]);
});
```

- [ ] **Step 2: Add the prior-inactive switch test**

After `session_start`, call `api.setActiveTools(["read"])` to model the user's explicit choice, switch to the disabled model, then return to the enabled model:

```ts
it("does not restore compress when it was inactive before disablement", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const { api, handlers, activeTools } = createMockApi({ activeTools: ["read"] });
  createExtension(api);
  await registeredHandler(handlers, "session_start")(
    { reason: "new" },
    sessionContext(enabledModel),
  );
  api.setActiveTools(["read"]);

  await registeredHandler(handlers, "model_select")(
    { model: disabledModel, previousModel: enabledModel, source: "set" },
    sessionContext(disabledModel),
  );
  await registeredHandler(handlers, "model_select")(
    { model: enabledModel, previousModel: disabledModel, source: "set" },
    sessionContext(enabledModel),
  );

  expect(activeTools()).toEqual(["read"]);
});
```

- [ ] **Step 3: Run the index tests and confirm the expected failures**

Run: `pnpm vitest run tests/index.test.ts`

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

State in `README.md` that changing models immediately removes or restores `compress`, while existing DCP state remains available if the user returns to an enabled model.

- [ ] **Step 3: Run the focused live-switch tests**

Run: `pnpm vitest run tests/index.test.ts`

Expected: PASS.

- [ ] **Step 4: Run the accumulated feature tests**

Run: `pnpm vitest run tests/config.test.ts tests/context-limits.test.ts tests/commands-register.test.ts tests/commands-context.test.ts tests/index.test.ts`

Expected: PASS.
