# Phase 2: Static Model Disablement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `disabledModels` fully usable for sessions that start and remain on one model, including runtime processing, direct compression execution, active tools, commands, status, and documentation.

**Architecture:** Apply `isDcpEnabledForModel` at every current-model boundary, including the registered compression tool's execution function. A single `reconcileCompressTool()` function removes `compress` for a disabled model and records its prior activation in a `boolean | undefined` sentinel. Command tests call `registerDcpCommands` directly so state and side effects remain observable.

**Tech Stack:** TypeScript, Node.js `>=24.15.0`, TypeBox, Vitest, pnpm, mise.

**Spec:** `docs/superpowers/specs/2026-08-26-model-specific-dcp-controls-design.md`

## Global Constraints

- This phase supports the initial/current model; live `model_select` handling is Phase 3.
- A disabled model bypasses every DCP transform, direct compression execution, and mutating command.
- Keep read-only commands available.
- Preserve all DCP state and lifecycle handlers.
- Add no dependencies or Pi host changes.
- Run every Node/pnpm command through `mise exec node@24.15.0 --`; the default shell may select an unsupported Node version.
- Do not commit unless the user explicitly requests a commit.

---

### Task 1: Add concrete extension test fixtures

**Files:**

- Modify: `tests/index.test.ts`

**Interfaces:**

- Produces `writeDisabledModelConfig(...modelKeys: string[]): void`.
- Produces `sessionContext(model?, branch?): object` with the context fields used by `session_start` and static runtime events.
- Produces `persistedCompressionSnapshot(toolCallId?: string): object` for timing-boundary tests.
- Makes `registeredHandler` callable as `(...args: unknown[]) => unknown` so event tests do not repeat casts.
- Extends `createMockApi({ activeTools? })` with Pi-compatible active-tool and message behavior.

- [ ] **Step 1: Verify the required runtime**

Run:

```bash
mise exec node@24.15.0 -- node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) throw new Error(`Node >=24.15.0 required, got ${process.versions.node}`)'
```

Expected: exit code `0` and no output.

- [ ] **Step 2: Add config, model, and session fixtures**

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

function sessionContext(model = enabledModel, branch: unknown[] = []) {
  return {
    cwd: agentDir,
    model,
    isProjectTrusted: () => false,
    sessionManager: {
      getSessionDir: () => "/tmp/test-session-dir",
      getSessionId: () => "session",
      getBranch: () => branch,
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

- [ ] **Step 3: Add a persisted compression fixture**

Add beside `sessionContext`:

```ts
function persistedCompressionSnapshot(toolCallId = "compress-1") {
  return {
    version: 1,
    ownerSessionId: "session",
    manualMode: false,
    compressPermission: "allow",
    stats: {
      pruneTokenCounter: 0,
      totalPruneTokens: 100,
      toolsPruned: 0,
      messagesCompressed: 2,
    },
    lastCompaction: 0,
    pruneTools: [],
    blocks: [
      {
        blockId: 1,
        runId: 1,
        deactivatedByUser: false,
        compressedTokens: 100,
        summaryTokens: 10,
        durationMs: 0,
        mode: "range",
        topic: "existing block",
        compressToolCallId: toolCallId,
        startKey: "user:1:0",
        endKey: "assistant:2:0",
        anchorKey: "user:1:0",
        consumedBlockIds: [],
        createdAt: 1,
        summary: "existing summary",
      },
    ],
    nextBlockId: 2,
    nextRunId: 2,
    messageIds: {
      byRawId: [
        ["user:1:0", "m0001"],
        ["assistant:2:0", "m0002"],
      ],
      nextRefIndex: 3,
    },
    nudges: {
      contextLimitAnchors: [],
      turnAnchors: [],
      iterationAnchors: [],
    },
  };
}
```

- [ ] **Step 4: Extend `createMockApi` with active tools and messages**

Change `registeredHandler` to return the validated handler as `(...args: unknown[]) => unknown`. Change `createMockApi` to accept `{ activeTools?: string[] } = {}`. Store a mutable copy and add these API methods:

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

This matches Pi's post-bind behavior: registering a new extension tool refreshes the registry and adds that tool to the active set, while `setActiveTools` changes only the active names.

- [ ] **Step 5: Run the unchanged index tests**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts
```

Expected: PASS; the fixtures characterize Pi behavior without changing production code.

### Task 2: Gate static transforms, active tools, and compression execution

**Files:**

- Modify: `src/index.ts`
- Test: `tests/index.test.ts`

**Interfaces:**

- Consumes `isDcpEnabledForModel`.
- Produces internal `reconcileCompressTool(provider?: string, modelId?: string): void`.
- Stores `compressWasActiveBeforeModelDisable: boolean | undefined` without serializing it.
- Preserves the existing global-disable compression error and adds `Compression is disabled for the current model.` for direct execution on a disabled model.

- [ ] **Step 1: Add failing static transform and tool tests**

Add these cases to `tests/index.test.ts`:

```ts
it("passes messages through and omits the prompt for a disabled model", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const { api, handlers } = createMockApi();
  createExtension(api);
  const ctx = sessionContext(disabledModel);
  await registeredHandler(handlers, "session_start")({ reason: "new" }, ctx);

  const before = await registeredHandler(handlers, "before_agent_start")(
    { systemPrompt: "base", prompt: "hello" },
    ctx,
  );
  const messages = [
    { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 },
  ];
  const context = await registeredHandler(handlers, "context")(
    { messages },
    ctx,
  );

  expect(before).toBeUndefined();
  expect(context).toBeUndefined();
  expect(messages[0].content[0].text).toBe("hello");
});

it("removes compress for an initially disabled model", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const { api, handlers, activeTools } = createMockApi({
    activeTools: ["read"],
  });
  createExtension(api);

  await registeredHandler(handlers, "session_start")(
    { reason: "new" },
    sessionContext(disabledModel),
  );

  expect(activeTools()).toEqual(["read"]);
});

it("keeps compress active for an unlisted initial model", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const { api, handlers, activeTools } = createMockApi({
    activeTools: ["read"],
  });
  createExtension(api);

  await registeredHandler(handlers, "session_start")(
    { reason: "new" },
    sessionContext(enabledModel),
  );

  expect(activeTools()).toEqual(["read", "compress"]);
});

it("blocks a stale compress call for a disabled model", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const { api, handlers } = createMockApi();
  createExtension(api);

  const result = await registeredHandler(handlers, "tool_call")(
    { toolName: "compress", toolCallId: "compress-1", input: {} },
    sessionContext(disabledModel),
  );

  expect(result).toMatchObject({
    block: true,
    reason: "Compression is disabled for the current model",
  });
});

it("rejects direct compress execution for a disabled model", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const { api, handlers, tools } = createMockApi();
  createExtension(api);
  const ctx = sessionContext(disabledModel);
  await registeredHandler(handlers, "session_start")({ reason: "new" }, ctx);
  const compress = tools.get("compress") as {
    execute: (...args: unknown[]) => Promise<unknown>;
  };

  const result = await compress.execute(
    "compress-1",
    { topic: "stale call", content: [] },
    undefined,
    undefined,
    ctx,
  );

  expect(result).toMatchObject({
    isError: true,
    content: [{ text: "Compression is disabled for the current model." }],
  });
});
```

- [ ] **Step 2: Run the index tests and confirm the expected failures**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts
```

Expected: FAIL because model eligibility is not applied to runtime handlers, active tools, or `executeCompressTool`.

- [ ] **Step 3: Add direct compression execution gating**

Import `isDcpEnabledForModel` with `loadConfig`, then replace the global-only guard at the start of `executeCompressTool` with:

```ts
if (!isDcpEnabledForModel(config, ctx.model?.provider, ctx.model?.id)) {
  const text = config.enabled
    ? "Compression is disabled for the current model."
    : "Compression is disabled by configuration.";
  return {
    content: [{ type: "text" as const, text }],
    details: {},
    isError: true,
  };
}
```

Keep all compression handling after this return unchanged.

- [ ] **Step 4: Implement the active-tool reconciliation sentinel**

Add inside `createExtension`, beside the other unsaved runtime variables:

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

- [ ] **Step 5: Apply eligibility at the static transform boundaries**

Make these focused changes:

- In `session_start`, keep the existing `config.enabled` return, register the tool, then call `reconcileCompressTool(ctx.model?.provider, ctx.model?.id)` before state reset and restoration.
- In `before_agent_start`, rename `_ctx` to `ctx` and return before prompt injection when `isDcpEnabledForModel(config, ctx.model?.provider, ctx.model?.id)` is `false`.
- In `context`, keep the global-disable return, update `state.modelProvider` and `state.modelId`, call `reconcileCompressTool`, and return when the current model is disabled. Perform this before the subagent check, usage lookup, `latestMessages` update, prompt reload, and `runPipeline`.
- In `tool_call`, preserve the global-disable and non-`compress` returns, then block a disabled model with `{ block: true, reason: "Compression is disabled for the current model" }` before checking compression permission.

Do not change `session_tree`, `session_compact`, `session_shutdown`, persistence, or model-switch handling.

- [ ] **Step 6: Run the static transform and tool tests**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts
```

Expected: PASS.

### Task 3: Gate remaining static runtime event boundaries

**Files:**

- Modify: `src/index.ts`
- Test: `tests/index.test.ts`

**Interfaces:**

- Consumes `isDcpEnabledForModel` at `message_end`, `tool_execution_start`, and `tool_execution_end`.
- Disabled events produce no hallucinated-ID cleanup, compression timing, persistence caused by timing, or subagent result caching.

- [ ] **Step 1: Add failing message cleanup coverage**

Add:

```ts
it("does not sanitize assistant text for a disabled model", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const { api, handlers } = createMockApi();
  createExtension(api);
  const message = makeAssistantMessage(
    "**Creating the GitHub PR**m0112</dpc-message-id>",
  );

  const result = await registeredHandler(handlers, "message_end")(
    { type: "message_end", message },
    sessionContext(disabledModel),
  );

  expect(result).toBeUndefined();
  expect(
    (message as { content: Array<{ text?: string }> }).content[0]?.text,
  ).toBe("**Creating the GitHub PR**m0112</dpc-message-id>");
});
```

- [ ] **Step 2: Add failing compression-timing coverage**

Add:

```ts
it("does not record compression timing for a disabled model", async () => {
  vi.useFakeTimers();
  try {
    writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
    const snapshot = persistedCompressionSnapshot("compress-1");
    const { api, handlers, entries } = createMockApi();
    createExtension(api);
    const ctx = sessionContext(disabledModel, [
      { type: "custom", customType: "pi-dcp-state", data: snapshot },
    ]);
    await registeredHandler(handlers, "session_start")(
      { reason: "resume" },
      ctx,
    );
    entries.length = 0;

    vi.setSystemTime(1_000);
    await registeredHandler(handlers, "tool_execution_start")(
      { toolName: "compress", toolCallId: "compress-1" },
      ctx,
    );
    vi.setSystemTime(2_500);
    await registeredHandler(handlers, "tool_execution_end")(
      { toolName: "compress", toolCallId: "compress-1", isError: false },
      ctx,
    );

    expect(entries).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});
```

Before the production guard, the end event changes the restored block's `durationMs` and appends a new snapshot, so this test must fail with one captured entry.

- [ ] **Step 3: Add failing subagent-cache coverage**

Add:

```ts
it("does not cache subagent results for a disabled model", async () => {
  writeDisabledModelConfig("openai-codex/gpt-5.6-sol");
  const parser = vi
    .spyOn(subagentResults, "parseChildSessionResults")
    .mockResolvedValue("child result");
  try {
    const { api, handlers } = createMockApi();
    createExtension(api);

    await registeredHandler(handlers, "tool_execution_end")(
      {
        toolName: "subagent",
        toolCallId: "subagent-1",
        isError: false,
        result: { details: { childSessionPath: "/tmp/child.jsonl" } },
      },
      sessionContext(disabledModel),
    );

    expect(parser).not.toHaveBeenCalled();
  } finally {
    parser.mockRestore();
  }
});
```

- [ ] **Step 4: Run the tests and confirm the expected failures**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts
```

Expected: FAIL because the three handlers inspect only global `config.enabled`.

- [ ] **Step 5: Gate the remaining event handlers**

Rename each unused context parameter to `ctx`, then return at the top of `message_end`, `tool_execution_start`, and `tool_execution_end` when:

```ts
!isDcpEnabledForModel(config, ctx.model?.provider, ctx.model?.id);
```

Keep all existing role, tool-name, timing, parsing, and persistence logic after these guards unchanged.

- [ ] **Step 6: Run the runtime tests**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts
```

Expected: PASS.

### Task 4: Gate commands and report model status

**Files:**

- Modify: `src/commands/register.ts`
- Modify: `src/commands/context.ts`
- Test: `tests/commands-register.test.ts`
- Test: `tests/commands-context.test.ts`

**Interfaces:**

- Produces `contextCommand(state, contextUsage, modelDisabled = false): string`.
- `modelDisabled` represents only model-level disablement; global disablement retains its existing command message.
- All six mutating commands share `rejectWhenDisabled(ctx)`.

- [ ] **Step 1: Add a direct command harness and failing mutation test**

Add `vi` to the Vitest import in `tests/commands-register.test.ts`, then add:

```ts
it("rejects every mutating command for a disabled model", async () => {
  const disabledModel = { provider: "openai-codex", id: "gpt-5.6-sol" };
  const config = {
    ...makeDefaultConfig(),
    disabledModels: ["openai-codex/gpt-5.6-sol"],
  };
  const state = createSessionState();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: any) => Promise<void> }
  >();
  const sendMessage = vi.fn();
  const onStateChange = vi.fn();
  const notify = vi.fn();
  const pi = {
    registerCommand(
      name: string,
      command: { handler: (args: string, ctx: any) => Promise<void> },
    ) {
      commands.set(name, command);
    },
    sendMessage,
  };
  registerDcpCommands(pi as any, state, config, onStateChange);
  const ctx = {
    model: disabledModel,
    getContextUsage: () => undefined,
    ui: { notify },
  };

  for (const name of [
    "dcp:compress",
    "dcp:sweep",
    "dcp:manual",
    "dcp:decompress",
    "dcp:recompress",
    "dcp:permission",
  ]) {
    await commands.get(name)?.handler("", ctx);
  }

  expect(sendMessage).not.toHaveBeenCalled();
  expect(onStateChange).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledTimes(6);
  expect(notify.mock.calls.map(([message]) => message)).toEqual(
    Array(6).fill("DCP is disabled for the current model."),
  );
});
```

- [ ] **Step 2: Add failing model-status coverage**

Add to `tests/commands-context.test.ts`:

```ts
it("reports model-level disablement", () => {
  expect(contextCommand(createSessionState(), undefined, true)).toContain(
    "disabled for the current model",
  );
});
```

- [ ] **Step 3: Run the command tests and confirm the expected failures**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/commands-register.test.ts tests/commands-context.test.ts
```

Expected: FAIL because commands do not use model eligibility, `dcp:compress` does not call the shared guard, and `contextCommand` has two parameters.

- [ ] **Step 4: Implement command gating**

Import `isDcpEnabledForModel` in `src/commands/register.ts`. Replace `rejectWhenDisabled` with:

```ts
const rejectWhenDisabled = (ctx: ExtensionCommandContext): boolean => {
  if (!config.enabled) {
    ctx.ui.notify("DCP is disabled by configuration.", "info");
    return true;
  }
  if (!isDcpEnabledForModel(config, ctx.model?.provider, ctx.model?.id)) {
    ctx.ui.notify("DCP is disabled for the current model.", "info");
    return true;
  }
  return false;
};
```

Call `rejectWhenDisabled(ctx)` before `compressCommand` in `dcp:compress`. Keep it on `dcp:sweep`, `dcp:manual`, `dcp:decompress`, `dcp:recompress`, and `dcp:permission`. Leave help, lifetime, and stats unchanged.

For `dcp:context`, compute:

```ts
const modelDisabled =
  config.enabled &&
  !isDcpEnabledForModel(config, ctx.model?.provider, ctx.model?.id);
```

Pass `modelDisabled` as the third argument to `contextCommand`.

- [ ] **Step 5: Implement model-level context status**

Change the signature in `src/commands/context.ts` to:

```ts
export function contextCommand(
  state: SessionState,
  contextUsage: ContextUsage | undefined,
  modelDisabled = false,
): string {
```

Before returning the joined lines, add:

```ts
if (modelDisabled) {
  lines.push("  DCP status: disabled for the current model");
}
```

- [ ] **Step 6: Run the command tests**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/commands-register.test.ts tests/commands-context.test.ts
```

Expected: PASS.

### Task 5: Publish and verify static-model behavior

**Files:**

- Modify: `README.md`
- Verify: `src/index.ts`
- Verify: `src/commands/register.ts`
- Verify: `src/commands/context.ts`
- Verify: `tests/index.test.ts`
- Verify: `tests/commands-register.test.ts`
- Verify: `tests/commands-context.test.ts`

**Interfaces:**

- Documents exact model keys, disabled precedence, independent max/min maps, and static-session behavior.
- Does not claim live switching support before Phase 3.

- [ ] **Step 1: Add `disabledModels` to the documented top-level defaults**

Add `"disabledModels": []` beside `"enabled": true` in the default JSON, and add this bullet under `### Top-level`:

```markdown
- `disabledModels` — exact, case-sensitive `provider/modelId` keys for which DCP processing, mutating commands, and the active `compress` tool are disabled.
```

- [ ] **Step 2: Add the combined configuration example**

After the top-level option list, add:

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

Follow it with this behavior statement:

```markdown
For a session using `openai-codex/gpt-5.6-sol`, DCP leaves messages unchanged, rejects mutating DCP commands, and removes `compress` from the active tools. The configured `sol` thresholds remain dormant while that model is disabled. The independent `terra` thresholds remain active for sessions using `openai-codex/gpt-5.6-terra`. Live model switching is handled separately and is not part of this static-session behavior.
```

- [ ] **Step 3: Run the complete Phase 2 test set**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/config.test.ts tests/context-limits.test.ts tests/commands-register.test.ts tests/commands-context.test.ts tests/index.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run type, format, and lint checks**

Run:

```bash
mise exec node@24.15.0 -- pnpm typecheck
mise exec node@24.15.0 -- pnpm format:check
mise exec node@24.15.0 -- pnpm lint
```

Expected: all three commands exit `0`.

- [ ] **Step 5: Inspect the final diff and reference repositories**

Run:

```bash
git diff --check
git status --short
git -C /Users/lanh/Developer/pi-packages/pi status --short
git -C /Users/lanh/Developer/pi-packages/opencode-dynamic-context-pruning status --short
```

Expected: `git diff --check` exits `0`; only the Phase 2 implementation and documentation files are changed in `pi-dcp`; both reference repositories print no changes.
