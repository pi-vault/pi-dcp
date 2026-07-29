# Pi DCP Phase 5 Trusted Operator Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trusted project configuration and a safe manual compression command while preserving Phase 4 native state behavior.

**Architecture:** Load defaults, global JSON, and an optional trusted project JSON at `session_start`. Keep one mutable effective-config object so existing handlers observe reloads, register the mode-specific tool after the effective config is known, and gate every command/tool path on current enablement and permission. Project prompt overrides use the same Pi cwd/trust boundary.

**Tech Stack:** TypeScript ESM, Pi ExtensionAPI 0.80.3-compatible APIs, TypeBox, Vitest, pnpm, and Node standard-library filesystem/path APIs.

---

## Source, Prerequisite, and Boundaries

- Source requirements: Task 5 of [2026-07-28-pi-dcp-reliability-roadmap.md](2026-07-28-pi-dcp-reliability-roadmap.md).
- Phase 4 prerequisite: [2026-07-28-pi-dcp-phase-4-native-session-state.md](2026-07-28-pi-dcp-phase-4-native-session-state.md) is released and its full checks pass.
- Pi 0.80.3 is authoritative for `ctx.cwd`, `ctx.isProjectTrusted()`, `registerTool()`, and `sendMessage()`.
- Phase 5 does not add a state store, benchmark harness, lifetime scanner, package version bump, tag, or publish action. Benchmarks and final release evidence belong to Phase 6.
- The original reliability roadmap remains byte-for-byte unchanged.

## File Map

- `src/config.ts`: parse global/project layers, merge plain objects, replace arrays, clean unknown keys, validate, and return warnings.
- `src/prompts/store.ts`: accept an absent project override directory so untrusted project prompt files cannot be read.
- `src/index.ts`: load trusted project config at session start, retain the stable config object, register/gate the compression tool, and pass the current config to commands.
- `src/commands/register.ts`, `src/commands/compress.ts`: register live-config commands and send the hidden manual-compression follow-up.
- `tests/config.test.ts`, `tests/prompt-store.test.ts`, `tests/commands-register.test.ts`, `tests/commands-compress.test.ts`, `tests/integration.test.ts`: focused config, trust, lifecycle, tool, and command regressions.
- `README.md`, `CHANGELOG.md`: document the Phase 5 operator contract after code verification.

### Task 1: Load trusted project configuration and prompt overrides

**Files:**

- Modify: `src/config.ts`, `src/prompts/store.ts`
- Test: `tests/config.test.ts`, `tests/prompt-store.test.ts`

- [ ] **Step 1: Add failing layered-config tests**

  Add tests that create temporary files and call the loader with explicit absolute paths:

  ```ts
  it("merges defaults, global, and project layers", () => {
    writeJson(globalPath, {
      enabled: false,
      compress: { mode: "message", protectedTools: ["read"] },
      protectedFilePatterns: ["**/*.secret"],
    });
    writeJson(projectPath, {
      enabled: true,
      compress: { showCompression: true, protectedTools: ["write"] },
      protectedFilePatterns: ["**/*.key"],
    });

    const result = loadConfig(globalPath, projectPath);

    expect(result.config.enabled).toBe(true);
    expect(result.config.compress.mode).toBe("message");
    expect(result.config.compress.showCompression).toBe(true);
    expect(result.config.compress.protectedTools).toEqual(["write"]);
    expect(result.config.protectedFilePatterns).toEqual(["**/*.key"]);
  });

  it("skips a missing layer and warns for malformed JSON", () => {
    fs.writeFileSync(globalPath, "{");
    const result = loadConfig(globalPath, path.join(tempDir, "missing.json"));
    expect(result.config).toEqual(DEFAULT_CONFIG);
    expect(result.warnings).toContain(
      `Unable to parse config file: ${globalPath}`,
    );
  });

  it("cleans unknown keys and warns for invalid values", () => {
    writeJson(globalPath, { unknown: true, compress: { mode: "invalid" } });
    const result = loadConfig(globalPath);
    expect("unknown" in (result.config as Record<string, unknown>)).toBe(false);
    expect(result.config.compress.mode).toBe(DEFAULT_CONFIG.compress.mode);
    expect(
      result.warnings.some((warning) => warning.includes("/compress/mode")),
    ).toBe(true);
  });
  ```

  Also assert arrays replace rather than concatenate and that the returned config is a fresh clone on every call.

- [ ] **Step 2: Run the focused tests and confirm the current API fails**

  Run:

  ```bash
  pnpm vitest run tests/config.test.ts -t "merges defaults|malformed JSON|unknown keys"
  ```

  Expected: FAIL because `loadConfig()` currently accepts one path, does not parse a second layer, and does not report malformed JSON.

- [ ] **Step 3: Implement the two-layer loader**

  Change the exported signature to:

  ```ts
  export function loadConfig(
    configFilePath: string,
    projectConfigPath?: string,
  ): { config: DcpConfig; warnings: string[] };
  ```

  Make `parseConfigFile()` return `{ value?: Record<string, unknown>; warning?: string }`. Treat `ENOENT` as an absent file with no warning; report malformed JSON, non-object JSON, and read failures as `Unable to parse config file: <path>`. Start from `structuredClone(DEFAULT_CONFIG)`, merge the parsed global value, then the parsed project value. Reuse the existing `deepMerge`, `Value.Clean`, validation, semantic range checks, and default replacement logic. Do not add a merge dependency.

- [ ] **Step 4: Add trust-safe prompt-store tests**

  Extend `PromptStore` tests with:

  ```ts
  it("uses global overrides when the project directory is absent", () => {
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, "system.md"), "Global prompt");
    const store = new PromptStore({ globalOverrideDir: globalDir });
    store.reload();
    expect(store.getRuntimePrompts().system).toBe("Global prompt");
  });
  ```

  Keep the existing project-over-global test for trusted projects.

- [ ] **Step 5: Make project prompt overrides optional**

  Change the options interface and loader path:

  ```ts
  interface PromptStoreOptions {
    projectOverrideDir?: string;
    globalOverrideDir: string;
  }

  private loadOverride(filename: string): string | undefined {
    if (this.projectDir) {
      const projectContent = this.readAndNormalize(path.join(this.projectDir, filename));
      if (projectContent !== undefined) return projectContent;
    }
    return this.readAndNormalize(path.join(this.globalDir, filename));
  }
  ```

  Store `projectDir` as `options.projectOverrideDir ?? ""` so existing filesystem error handling remains unchanged.

- [ ] **Step 6: Run config and prompt tests**

  ```bash
  pnpm vitest run tests/config.test.ts tests/prompt-store.test.ts
  ```

  Expected: all precedence, warning, merge, and trust-boundary tests pass.

- [ ] **Step 7: Commit the loader and trust boundary**

  ```bash
  git add src/config.ts src/prompts/store.ts tests/config.test.ts tests/prompt-store.test.ts
  git commit -m "feat: load trusted project configuration"
  ```

### Task 2: Load effective config at session start and gate runtime behavior

**Files:**

- Modify: `src/index.ts`
- Test: `tests/integration.test.ts`, `tests/commands-register.test.ts`

- [ ] **Step 1: Add failing lifecycle tests**

  Extend the mock context with `cwd` and `isProjectTrusted()` and add these cases:

  ```ts
  it("lets trusted project config enable a globally disabled extension", async () => {
    writeJson(globalConfigPath, { enabled: false });
    writeJson(path.join(projectCwd, ".pi", "dcp.json"), {
      enabled: true,
      compress: { mode: "message" },
    });
    const { api, handlers, tools, commands } = createMockApi();
    createExtension(api);

    expect(commands.has("dcp:help")).toBe(true);
    expect(tools.has("compress")).toBe(false);
    await runHandlers(handlers.get("session_start"), {
      cwd: projectCwd,
      isProjectTrusted: () => true,
    });

    expect(tools.has("compress")).toBe(true);
    expect(getRegisteredCompressParameters(tools)).toMatchObject({
      type: "object",
    });
  });

  it("ignores the project file when the project is untrusted", async () => {
    writeJson(globalConfigPath, { enabled: false });
    writeJson(path.join(projectCwd, ".pi", "dcp.json"), { enabled: true });
    const { api, handlers, tools } = createMockApi();
    createExtension(api);
    await runHandlers(handlers.get("session_start"), {
      cwd: projectCwd,
      isProjectTrusted: () => false,
    });
    expect(tools.has("compress")).toBe(false);
  });
  ```

  Add a regression that changes the global file between two `session_start` events and confirms existing command handlers observe the updated stable config object.

- [ ] **Step 2: Run the lifecycle tests and confirm the current startup order fails**

  ```bash
  pnpm vitest run tests/integration.test.ts tests/commands-register.test.ts -t "trusted|untrusted|stable config"
  ```

  Expected: FAIL because the factory returns before registering handlers when global config is disabled and `session_start` loads only the global path.

- [ ] **Step 3: Register handlers before configuration is known**

  In `createExtension`, initialize the stable object from the global file only, remove the factory-level `if (!config.enabled) return`, and register commands/lifecycle handlers unconditionally. Keep existing Phase 4 snapshot and mutation persistence closures unchanged.

- [ ] **Step 4: Resolve trusted project config from the Pi context**

  Change `reloadConfig` to accept the session context:

  ```ts
  function reloadConfig(ctx: ExtensionContext, logDir?: string): void {
    const projectConfigPath = ctx.isProjectTrusted()
      ? path.join(ctx.cwd, ".pi", "dcp.json")
      : undefined;
    const result = loadConfig(configFilePath, projectConfigPath);
    Object.assign(config, result.config);
    logger = new Logger(config.debug, logDir);
    for (const warning of result.warnings) logger.info("config", warning);
  }
  ```

  Call it before `if (!config.enabled)` inside `session_start`. Use `ctx.cwd` and trust for `PromptStore`; never use `process.cwd()` for project-local prompt overrides.

- [ ] **Step 5: Register the mode-specific tool after effective config load**

  Move the existing two `pi.registerTool()` definitions into a local `registerCompressTool()` function. Call it from `session_start` after `reloadConfig(ctx, logDir)` only when `config.enabled` is true. Re-registering the same `name: "compress"` replaces the extension map entry and Pi refreshes the active registry.

  Every tool execute closure must begin with:

  ```ts
  if (!config.enabled) {
    return {
      content: [
        { type: "text", text: "Compression is disabled by configuration." },
      ],
      details: {},
      isError: true,
    };
  }
  ```

  Keep the `tool_call` handler’s disabled guard and permission block so a stale registration cannot mutate state after a later session disables DCP. Do not call `setActiveTools()`; it would modify the user’s tool selection.

- [ ] **Step 6: Run lifecycle and full integration tests**

  ```bash
  pnpm vitest run tests/integration.test.ts tests/commands-register.test.ts tests/index.test.ts
  ```

  Expected: trusted enablement, untrusted exclusion, mode-specific registration, stable-config reload, disabled pipeline behavior, and Phase 4 persistence regressions pass.

- [ ] **Step 7: Commit live configuration behavior**

  ```bash
  git add src/index.ts tests/integration.test.ts tests/commands-register.test.ts
  git commit -m "fix: bind dcp runtime to trusted session config"
  ```

### Task 3: Add `/dcp:compress [focus]`

**Files:**

- Create: `src/commands/compress.ts`
- Modify: `src/commands/register.ts`
- Test: `tests/commands-compress.test.ts`, `tests/commands-register.test.ts`, `tests/integration.test.ts`

- [ ] **Step 1: Add failing command tests**

  Use a fake `ExtensionAPI` that records `sendMessage` calls and assert the exact contract:

  ```ts
  it("sends a hidden generic follow-up", () => {
    const sendMessage = vi.fn();
    const message = compressCommand(
      { sendMessage } as unknown as ExtensionAPI,
      createSessionState(),
      makeDefaultConfig(),
      "",
    );
    expect(message).toBe("Compression triggered.");
    expect(sendMessage).toHaveBeenCalledWith(
      {
        customType: "dcp-compress-trigger",
        content:
          "Run the compress tool now on stale, completed context. Preserve details needed for active work.",
        display: false,
      },
      { triggerTurn: true, deliverAs: "followUp" },
    );
  });

  it("trims and includes focus", () => {
    const sendMessage = vi.fn();
    compressCommand(
      { sendMessage } as unknown as ExtensionAPI,
      createSessionState(),
      makeDefaultConfig(),
      "  database migrations  ",
    );
    expect(sendMessage.mock.calls[0][0].content).toContain(
      "Focus especially on: database migrations",
    );
  });

  it("does not send when disabled or denied", () => {
    const sendMessage = vi.fn();
    const state = createSessionState();
    state.compressPermission = "deny";
    expect(
      compressCommand(
        { sendMessage } as unknown as ExtensionAPI,
        state,
        makeDefaultConfig(),
        "focus",
      ),
    ).toBe("Compression is denied by configuration.");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(
      compressCommand(
        { sendMessage } as unknown as ExtensionAPI,
        createSessionState(),
        { ...makeDefaultConfig(), enabled: false },
        "focus",
      ),
    ).toBe("DCP is disabled by configuration.");
    expect(sendMessage).not.toHaveBeenCalled();
  });
  ```

  Add integration assertions for command delivery while idle and while streaming; both must use `{ triggerTurn: true, deliverAs: "followUp" }`. Assert the command does not call `appendEntry`.

- [ ] **Step 2: Run the command tests and confirm the module is absent**

  ```bash
  pnpm vitest run tests/commands-compress.test.ts tests/commands-register.test.ts -t "compress"
  ```

  Expected: FAIL because `src/commands/compress.ts` and the `dcp:compress` registration do not exist.

- [ ] **Step 3: Implement the command with an explicit current-config gate**

  Create:

  ```ts
  import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
  import type { DcpConfig } from "../config.ts";
  import type { SessionState } from "../state/types.ts";

  const TRIGGER =
    "Run the compress tool now on stale, completed context. Preserve details needed for active work.";

  export function compressCommand(
    pi: ExtensionAPI,
    state: SessionState,
    config: DcpConfig,
    args: string,
  ): string {
    if (!config.enabled) return "DCP is disabled by configuration.";
    if ((state.compressPermission ?? config.compress.permission) === "deny") {
      return "Compression is denied by configuration.";
    }
    const focus = args.trim();
    pi.sendMessage(
      {
        customType: "dcp-compress-trigger",
        content: focus ? `${TRIGGER} Focus especially on: ${focus}` : TRIGGER,
        display: false,
      },
      { triggerTurn: true, deliverAs: "followUp" },
    );
    return "Compression triggered.";
  }
  ```

- [ ] **Step 4: Register the command against the stable config object**

  Add to `registerDcpCommands`:

  ```ts
  pi.registerCommand("dcp:compress", {
    description: "Trigger manual compression, optionally focused on a topic",
    handler: async (args, ctx) => {
      ctx.ui.notify(compressCommand(pi, state, config, args), "info");
    },
  });
  ```

  Keep the existing four-argument `registerDcpCommands(pi, state, config, onStateChange)` signature so every handler shares the Phase 4 stable config object. Do not call `onStateChange()` for this command.

- [ ] **Step 5: Run command and integration tests**

  ```bash
  pnpm vitest run tests/commands-compress.test.ts tests/commands-register.test.ts tests/integration.test.ts
  ```

  Expected: generic/focused triggers, disabled/denied no-send behavior, idle/streaming follow-up delivery, and command registration pass.

- [ ] **Step 6: Commit manual compression**

  ```bash
  git add src/commands/compress.ts src/commands/register.ts tests/commands-compress.test.ts tests/commands-register.test.ts tests/integration.test.ts
  git commit -m "feat: add manual compression trigger"
  ```

### Task 4: Document and release Phase 5

**Files:**

- Modify: `README.md`, `CHANGELOG.md`
- Test/verification: all Phase 5 tests and release checks

- [ ] **Step 1: Document the operator contract**

  Add README sections covering:
  - global path `<agentDir>/extensions/dcp.json`;
  - trusted project path `<ctx.cwd>/.pi/dcp.json`;
  - defaults → global → project precedence, recursive object merge, and array replacement;
  - untrusted project exclusion;
  - trusted project prompt overrides and global fallback;
  - `/dcp:compress [focus]`, hidden follow-up delivery, and denial behavior;
  - configuration reload at session start and disabled stale-tool blocking.

  Add matching Unreleased changelog entries without changing the package version.

- [ ] **Step 2: Run focused Phase 5 verification**

  ```bash
  pnpm vitest run tests/config.test.ts tests/prompt-store.test.ts tests/commands-register.test.ts tests/commands-compress.test.ts tests/integration.test.ts tests/index.test.ts
  pnpm run generate:schema
  git diff --exit-code -- dcp.schema.json
  ```

  Expected: all focused tests pass and schema regeneration produces no diff because Phase 5 adds no configuration fields.

- [ ] **Step 3: Run the Phase 5 release checks**

  ```bash
  pnpm test
  pnpm typecheck
  pnpm lint
  pnpm pack --dry-run
  git diff --check
  git diff --exit-code HEAD -- docs/superpowers/plans/2026-07-28-pi-dcp-reliability-roadmap.md
  ```

  Expected: 421 existing tests plus Phase 5 tests pass, typecheck succeeds, lint does not exceed the Phase 5 entry baseline of 58 warnings and 1 info, packaging succeeds, and the source roadmap is unchanged. Run the release gate on Node 24.15+; the local Node 23.11 result is supplemental.

- [ ] **Step 4: Record Phase 5 completion**

  Update only the Phase 5 status and this plan’s release record after all acceptance criteria pass. Do not mark Phase 6 complete.

  ```bash
  git add README.md CHANGELOG.md docs/superpowers/plans/2026-07-28-pi-dcp-phase-5-operator-and-release-hardening.md docs/superpowers/plans/2026-07-28-pi-dcp-reliability-phased-roadmap.md
  git commit -m "docs: complete phase 5 operator controls"
  ```

## Acceptance Criteria

- Trusted project configuration uses `ctx.cwd`, is excluded when `ctx.isProjectTrusted()` is false, and follows documented precedence.
- Project prompt overrides use the same trust boundary.
- A trusted project can enable DCP when global config disables it.
- Commands and compression execution observe the current effective config object.
- A disabled or denied `/dcp:compress` sends no follow-up.
- An already registered tool cannot mutate state after DCP becomes disabled.
- Manual compression uses Pi’s hidden follow-up API and does not append durable state.
- Focused tests, full checks, schema regeneration, package dry-run, and source-roadmap immutability pass.

## Phase 5 Handoff to Phase 6

- Effective config loading and stable-object mutation are fixed.
- `compressCommand(pi, state, config, args)` and its exact follow-up contract are fixed.
- Phase 4 snapshot persistence remains the only durable state mechanism.
- Phase 6 owns benchmark fixtures, benchmark output, final release documentation, and roadmap completion.

## Release Record

- Status: not started
- Release commit or tag: not recorded
- Verification date: not recorded
