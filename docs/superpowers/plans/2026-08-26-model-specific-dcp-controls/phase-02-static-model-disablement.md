# Phase 2: Static Model Disablement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `disabledModels` fully usable for sessions that start and remain on one model, including runtime processing, active tools, commands, status, and documentation.

**Architecture:** Use `isDcpEnabledForModel` at every current-model boundary. A single `reconcileCompressTool()` function removes `compress` for a disabled model and records its prior activation in a `boolean | undefined` sentinel. Command tests call `registerDcpCommands` directly so state and side effects are observable.

**Tech Stack:** TypeScript, Node.js `>=24.15.0`, TypeBox, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-26-model-specific-dcp-controls-design.md`

## Global Constraints

- This phase supports the initial/current model; live `model_select` handling is Phase 3.
- A disabled model bypasses every DCP transform and mutating command.
- Keep read-only commands available.
- Preserve all DCP state and lifecycle handlers.
- Add no dependencies or Pi host changes.
- Do not commit unless the user explicitly requests a commit.

---

### Task 1: Add concrete extension test fixtures

**Files:**

- Modify: `tests/index.test.ts`

**Interfaces:**

- Produces `writeDisabledModelConfig(...modelKeys: string[]): void`.
- Produces `sessionContext(model?: { provider: string; id: string }): object` with the context fields used by `session_start`.
- Makes `registeredHandler` callable as `(...args: unknown[]) => unknown` so event tests do not repeat casts.
- Extends `createMockApi({ activeTools? })` with Pi-compatible active-tool behavior.

- [ ] **Step 1: Add the config and model fixtures**

Add near the existing `agentDir` fixture:

```ts
const disabledModel = { provider: "openai-codex", id: "gpt-5.6-sol" };
const enabledModel = { provider: "openai-codex", id: "gpt-5.6-terra" };

function writeDisabledModelConfig(...modelKeys: string[]): void {
  const configDir = path.join(agentDir, "extensions");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "dcp.json"),
    JSON.stringify({ disabledModels: modelKeys }),
  );
}

function sessionContext(model = enabledModel) {
  return {
    cwd: agentDir,
    model,
    isProjectTrusted: () => false,
    sessionManager: {
      getSessionDir: () => "/tmp/test-session-dir",
      getSessionId: () => "session",
      getBranch: () => [] as unknown[],
    },
    getContextUsage: () => ({
      tokens: 1_000,
      contextWindow: 200_000,
      percent: 0.5,
    }),
    hasUI: false,
    ui: { notify: vi.fn(), setStatus: vi.fn() },
  };
}
```

- [ ] **Step 2: Extend `createMockApi` with active tools and messages**

Change `registeredHandler` to cast its validated result to `(...args: unknown[]) => unknown`. Change `createMockApi` to accept `{ activeTools?: string[] } = {}`. Store a mutable copy and add these API methods:

```ts
let activeToolNames = [...(options.activeTools ?? ["read"])];
const sendMessage = vi.fn();

registerTool(tool: { name: string }) {
  tools.set(tool.name, tool);
  if (!activeToolNames.includes(tool.name)) activeToolNames.push(tool.name);
},
getActiveTools() {
  return [...activeToolNames];
},
setActiveTools(names: string[]) {
  activeToolNames = [...names];
},
sendMessage,
```

Return `sendMessage` and `activeTools: () => [...activeToolNames]` with the existing maps.

- [ ] **Step 3: Run the unchanged index tests**

Run: `pnpm vitest run tests/index.test.ts`

Expected: PASS; the mock now characterizes Pi's dynamic-tool activation without changing production behavior.

### Task 2: Gate static runtime behavior and initial tools

**Files:**

- Modify: `src/index.ts`
- Test: `tests/index.test.ts`

**Interfaces:**

- Consumes `isDcpEnabledForModel`.
- Produces internal `reconcileCompressTool(provider?: string, modelId?: string): void`.
- Stores `compressWasActiveBeforeModelDisable: boolean | undefined` without serializing it.

- [ ] **Step 1: Add failing static-model tests**

Add these cases:

```ts
it("passes messages through and omits the prompt for a disabled model", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const { api, handlers } = createMockApi();
  createExtension(api);
  await registeredHandler(handlers, "session_start")(
    { reason: "new" },
    sessionContext(disabledModel),
  );

  const before = await registeredHandler(handlers, "before_agent_start")(
    { systemPrompt: "base", prompt: "hello" },
    sessionContext(disabledModel),
  );
  const messages = [
    { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 },
  ];
  const context = await registeredHandler(handlers, "context")(
    { messages },
    sessionContext(disabledModel),
  );

  expect(before).toBeUndefined();
  expect(context).toBeUndefined();
  expect(messages[0].content[0].text).toBe("hello");
});

it("removes compress for an initially disabled model", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const { api, handlers, activeTools } = createMockApi({ activeTools: ["read"] });
  createExtension(api);
  await registeredHandler(handlers, "session_start")(
    { reason: "new" },
    sessionContext(disabledModel),
  );
  expect(activeTools()).toEqual(["read"]);
});

it("blocks a stale compress call for a disabled model", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const { api, handlers } = createMockApi();
  createExtension(api);
  const result = await registeredHandler(handlers, "tool_call")(
    { toolName: "compress", toolCallId: "compress-1", input: {} },
    sessionContext(disabledModel),
  );
  expect(result).toMatchObject({ block: true });
  expect((result as { reason?: string }).reason).toContain("disabled");
});
```

- [ ] **Step 2: Run the index tests and confirm the expected failures**

Run: `pnpm vitest run tests/index.test.ts`

Expected: FAIL because runtime handlers only inspect global `config.enabled`.

- [ ] **Step 3: Implement the reconciliation sentinel**

Import `isDcpEnabledForModel`, then add inside `createExtension`:

```ts
let compressWasActiveBeforeModelDisable: boolean | undefined;

function reconcileCompressTool(
  provider: string | undefined,
  modelId: string | undefined,
): void {
  const activeTools = pi.getActiveTools();
  const compressActive = activeTools.includes("compress");
  const dcpEnabled = isDcpEnabledForModel(config, provider, modelId);

  if (!dcpEnabled) {
    if (compressWasActiveBeforeModelDisable === undefined) {
      compressWasActiveBeforeModelDisable = compressActive;
    }
    if (compressActive) {
      pi.setActiveTools(activeTools.filter((name) => name !== "compress"));
    }
    return;
  }

  if (compressWasActiveBeforeModelDisable === true && !compressActive) {
    pi.setActiveTools([...activeTools, "compress"]);
  }
  compressWasActiveBeforeModelDisable = undefined;
}
```

- [ ] **Step 4: Apply model eligibility at runtime boundaries**

- In `session_start`, keep the existing global-disable return, register the tool, then call `reconcileCompressTool(ctx.model?.provider, ctx.model?.id)` before state restoration.
- In `before_agent_start`, return before prompt injection when the helper returns `false`.
- In `context`, update `state.modelProvider` and `state.modelId`, reconcile the tool, then return before usage lookup, `latestMessages`, prompt reload, and `runPipeline` when disabled.
- In `message_end`, return before hallucinated-ID cleanup when disabled.
- In `tool_call`, block `compress` with `Compression is disabled for the current model` when disabled.
- In `tool_execution_start`, return before timing state changes when disabled.
- In `tool_execution_end`, return before compression timing and subagent result caching when disabled.
- Leave `session_tree`, `session_compact`, `session_shutdown`, and persistence behavior unchanged.

- [ ] **Step 5: Run the runtime tests**

Run: `pnpm vitest run tests/index.test.ts`

Expected: PASS.

### Task 3: Gate commands and report model status

**Files:**

- Modify: `src/commands/register.ts`
- Modify: `src/commands/context.ts`
- Test: `tests/commands-register.test.ts`
- Test: `tests/commands-context.test.ts`

**Interfaces:**

- Produces `contextCommand(state, contextUsage, modelDisabled = false): string`.
- `modelDisabled` represents only model-level disablement; global disablement retains its existing command message.

- [ ] **Step 1: Add a direct command harness and failing tests**

In `tests/commands-register.test.ts`, add `vi` to the existing Vitest import, capture registered handlers in a map, and retain direct access to `state`, `config`, `onStateChange`, `sendMessage`, and `notify`. Use:

```ts
const disabledModel = { provider: "openai-codex", id: "gpt-5.6-sol" };
const config = {
  ...makeDefaultConfig(),
  disabledModels: ["openai-codex/gpt-5.6-sol"],
};
const state = createSessionState();
const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
const sendMessage = vi.fn();
const onStateChange = vi.fn();
const notify = vi.fn();
const pi = {
  registerCommand(name: string, command: { handler: (args: string, ctx: any) => Promise<void> }) {
    commands.set(name, command);
  },
  sendMessage,
};
registerDcpCommands(pi as any, state, config, onStateChange);
const ctx = { model: disabledModel, getContextUsage: () => undefined, ui: { notify } };
```

Invoke `dcp:compress`, `dcp:sweep`, `dcp:manual`, `dcp:decompress`, `dcp:recompress`, and `dcp:permission`. Assert `sendMessage` and `onStateChange` were not called and every invocation notified `DCP is disabled for the current model.`.

Add to `tests/commands-context.test.ts`:

```ts
it("reports model-level disablement", () => {
  expect(contextCommand(createSessionState(), undefined, true)).toContain(
    "disabled for the current model",
  );
});
```

- [ ] **Step 2: Run the command tests and confirm the expected failures**

Run: `pnpm vitest run tests/commands-register.test.ts tests/commands-context.test.ts`

Expected: FAIL because commands do not use model eligibility and `contextCommand` has two parameters.

- [ ] **Step 3: Implement command gating**

Update `rejectWhenDisabled` in this order:

```ts
if (!config.enabled) {
  ctx.ui.notify("DCP is disabled by configuration.", "info");
  return true;
}
if (!isDcpEnabledForModel(config, ctx.model?.provider, ctx.model?.id)) {
  ctx.ui.notify("DCP is disabled for the current model.", "info");
  return true;
}
return false;
```

Call it from every mutating command, including `dcp:compress`. Keep help, lifetime, and stats unchanged. For `dcp:context`, compute:

```ts
const modelDisabled =
  config.enabled &&
  !isDcpEnabledForModel(config, ctx.model?.provider, ctx.model?.id);
```

Pass that value to `contextCommand`. Add `modelDisabled = false` as its third parameter and append `  DCP status: disabled for the current model` only when true.

- [ ] **Step 4: Run the command tests**

Run: `pnpm vitest run tests/commands-register.test.ts tests/commands-context.test.ts`

Expected: PASS.

### Task 4: Publish static-model behavior

**Files:**

- Modify: `README.md`

**Interfaces:**

- Documents exact model keys, disabled precedence, and independent max/min maps.

- [ ] **Step 1: Add `disabledModels` to the documented top-level defaults**

Add `"disabledModels": []` beside `"enabled": true` and describe it under `### Top-level`.

- [ ] **Step 2: Add the combined example and precedence statement**

```json
{
  "disabledModels": ["openai-codex/gpt-5.6-sol"],
  "compress": {
    "modelMaxLimits": {
      "openai-codex/gpt-5.6-sol": "80%",
      "openai-codex/gpt-5.6-terra": "60%"
    },
    "modelMinLimits": {
      "openai-codex/gpt-5.6-sol": "50%",
      "openai-codex/gpt-5.6-terra": "40%"
    }
  }
}
```

State that the `sol` thresholds are dormant while `sol` is disabled, while the `terra` thresholds remain active.

- [ ] **Step 3: Run all Phase 2 tests**

Run: `pnpm vitest run tests/config.test.ts tests/context-limits.test.ts tests/commands-register.test.ts tests/commands-context.test.ts tests/index.test.ts`

Expected: PASS.
