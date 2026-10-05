# Phase 4 — Pi DCP Lifecycle Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate pi-dcp with Pi structured prompts, public session APIs, and active-tool lifecycle while preserving automatic pruning semantics and the user's tool selection.

**Architecture:** A pure capability calculation separates pipeline eligibility from compression policy. Pi owns the restored tool loadout; DCP remembers temporary suppression only within the current branch. Compression guidance additionally requires an active `compress` tool, and custom prompts are captured once before each agent run.

**Tech Stack:** Node.js, TypeScript 7, Pi 1.0 extension APIs, TypeBox 1.3, Vitest 5, Biome 2, pnpm

**Spec:** `docs/superpowers/specs/2026-10-03-pi-dcp-improvement-roadmap-design.md`

## Global Constraints

- Execute this phase after `2026-10-03-phase-03-pi-dcp-compact-markers.md` and start from v0.8.0; prepare v0.9.0.
- Use `event.systemPromptOptions.sections.dcp`; never return a full DCP `systemPrompt` override or change another extension's forced prompt.
- `deny` suppresses model-driven compression but does not disable deduplication or stale-error pruning.
- Preserve an inactive `compress` selection across model, permission, definition-refresh, resume, and reload transitions. Hide its instructions and nudges while inactive.
- Pi's restored loadout is authoritative on session/tree changes. Do not carry the previous branch's suppression memory into the restored branch or persist that memory in snapshots.
- Existing command names, snapshot version 1, configuration keys, canonical IDs, marker syntax, protection rules, and benchmark budgets remain unchanged.
- Register one `compress` definition with `defaultActive: false` during extension creation, then refresh its mode-specific schema from trusted project configuration at session start. Activate it implicitly only on the first fresh-session initialization described in Task 2.
- Add no dependencies or Pi package upgrades. Keep host-provided packages as exact `"*"` peers.
- OpenCode DCP is behavioral inspiration only; do not copy its AGPL source or add OpenCode-specific infrastructure.
- Manual mode retains its existing behavior; `ask` permission and the interactive panel belong to Phase 5.

## Readiness Review and References

The previous plan required revision: the public-manager test already passed through compatibility
casts, the mocks reactivated existing tools incorrectly, startup reconciled before restoration and
sub-agent detection, and direct execution did not enforce all suppression reasons.

The 2026-10-04 review used these clean checkouts:

- pi-dcp: `9188118`, package v0.8.0, after Phase 3 merged.
- Pi: `/Users/lanh/Developer/pi-packages/pi` at `1b094148b91d737fb398bf1591604de58ec169e1` (v1.0.2).
- OpenCode DCP: `/Users/lanh/Developer/pi-packages/opencode-dynamic-context-pruning` at `f8232fde1e63c2251687e4d9634bd53ce11568cb` (v3.2.0).

Pi's relevant extension types, loader, runner, agent session, SDK, system prompt, and session manager
are unchanged from the roadmap's `83692682f` reference. Installed Pi development packages are
v1.0.1 and already expose the required APIs. Consult Pi's `system-prompt-updates.test.ts` and tool
allowlist regression tests for host behavior; OpenCode's prompt and permission hooks inform only
the separation of compression from automatic pruning.

Baseline verification passed: `pnpm check` (52 files, 661 tests), `pnpm run pack:dry-run`, and
`node scripts/generate-schema.ts | diff - dcp.schema.json`. Interactive Pi checks remain part of
Task 4. This records the review baseline, not completion of the implementation tasks below.

## Implementation Review — 2026-10-04

Reviewed `854e592..f2f4bb6` against this plan and the local Pi contracts. No confirmed production
defect was found. Review corrections are limited to tests: the SDK fixture now binds extensions
so reload emits lifecycle events, exercises actual deselection/reload and both supplied resume
selections, and checks trusted-project schema changes. Model/message fixtures use checked Pi
shapes, and prompt tests cover system and turn-nudge edits before a run, stability through repeated
context passes after mid-run edits, and refresh on the next run. An independent follow-up review
found no unresolved findings in these test changes.

Verification passed: `pnpm check` (55 files, 710 tests), generated-schema comparison,
`pnpm run pack:dry-run`, and `git diff --check`. No provider requests were made. Interactive Pi
smoke checks in Task 4 remain unperformed.

Host limitation: the current Pi SDK always supplies `initialActiveToolNames`, which skips its
constructor's transcript loadout restoration during initial resume. DCP respects the loadout Pi
supplies; this review does not change the approved restored-loadout ownership rule.

## Review Focus

- Resume/reload or a trusted-project mode change must preserve an inactive tool; Task 2 checks definition refresh through the real host.
- Overlapping model, permission, and sub-agent suppression must not briefly reactivate compression; Task 2 checks both transition orders.
- Restored permission, model identity, and sub-agent status must be established before reconciliation; Task 2 checks initial denial and branch changes.
- Files changed before a run must update both instructions and nudges, while edits during the run wait until the next run; Task 3 checks reload count and event order.
- Direct `execute` calls must reject every policy suppression reason and never use another branch's cached messages; Task 2 checks authorization and transient reset.

---

### Task 1: Establish accurate Pi extension contracts

**Files:**

- Create: `tests/extension-harness.ts`
- Create: `tests/pi-contract.test.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/integration.test.ts`
- Modify: `src/index.ts`

**Interfaces:**

- Consumes: Pi `ExtensionAPI`, `ExtensionContext`, `ExtensionEvent`, `AgentMessage`, and public session-manager methods.
- Produces: `createExtensionHarness(options?: ExtensionHarnessOptions): ExtensionHarness`, with typed API/context adapters, registered tool/command maps, active-tool inspection, UI spies, sent messages, and persisted entries.
- Produces: `emit<K extends ExtensionEvent["type"]>(name: K, event: Extract<ExtensionEvent, { type: K }>): Promise<unknown[]>`. The harness uses its current context and reports a named error for missing handlers.

- [ ] **Step 1: Build the typed harness and passing characterization fixtures**

Check implemented API/context surfaces with `satisfies Pick<...>`. Confine necessary casts to the
harness adapters and callback storage; use no explicit `any` or unchecked fixture casts. Supply
complete Pi model, session-entry, and message fixtures. Use `satisfies AgentMessage` for user,
assistant/tool-call, and tool-result messages, including `nestedCalls`.

The manager exposes `getSessionId()`, `getSessionDir()`, and `getBranch()`. Distinguish ID from
path, restore the selected branch's v1 snapshot, and assert owner identity through appended entries.
Registration activates a newly registered direct tool unless `defaultActive` is false, but
preserves the active state when replacing an existing definition. `setActiveTools` ignores
unknown names. The harness can distinguish a fresh branch from a branch with a structured system
message declaring a tool loadout.

- [ ] **Step 2: Run characterization tests before removing casts**

Run: `pnpm vitest run tests/pi-contract.test.ts && pnpm typecheck`

Expected: PASS. These are refactor safety tests; production compatibility casts do not make this
behavior fail and must not be presented as an expected red test.

- [ ] **Step 3: Use public session methods and migrate duplicated mocks**

In `src/index.ts`, call `ctx.sessionManager.getSessionId()` and `getBranch()` directly and narrow
custom entries by their discriminants. Remove optional compatibility fallbacks and manager casts.
Migrate index/integration lifecycle tests to the harness without changing their assertions. Replace
partial or cast message/model fixtures touched by the migration with checked fixtures.

- [ ] **Step 4: Add an offline SDK contract fixture**

In `tests/pi-contract.test.ts`, use the installed package's public `createAgentSession`,
`DefaultResourceLoader`, `SessionManager.inMemory`, and `SettingsManager.inMemory` APIs with the
DCP factory. Isolate agent configuration, model storage, resource discovery, and environment in
temporary directories; disable model network refresh and make no provider requests. Dispose
sessions and restore environment in cleanup.

Use the public extension runner to emit events and inspect structured prompt results. Establish
that initial registration activates a direct tool and replacing an inactive definition leaves it
inactive. This fixture will exercise DCP's registration and prompt changes in Tasks 2 and 3; do
not import Pi checkout test internals or rely solely on the mock harness for host behavior.

- [ ] **Step 5: Verify the migrated contracts**

Run: `pnpm vitest run tests/pi-contract.test.ts tests/index.test.ts tests/integration.test.ts && pnpm typecheck && pnpm lint`

Expected: PASS, including existing branch restoration behavior and zero lint warnings.

- [ ] **Step 6: Commit the contract refactor**

```bash
git add tests/extension-harness.ts tests/pi-contract.test.ts tests/index.test.ts tests/integration.test.ts src/index.ts
git commit -m "test: exercise DCP through current Pi contracts"
```

### Task 2: Centralize capabilities, tool selection, and authorization

**Files:**

- Create: `src/capabilities.ts`
- Create: `tests/capabilities.test.ts`
- Modify: `src/index.ts`
- Modify: `src/commands/register.ts`
- Test: `tests/pi-contract.test.ts`
- Test: `tests/index.test.ts`
- Test: `tests/commands-register.test.ts`
- Test: `tests/integration.test.ts`

**Interfaces:**

- Produces: `DcpSuppressionReason = "config" | "model" | "subagent" | "permission"` and `DcpCapabilities { pipelineEnabled: boolean; compressionEnabled: boolean; reasons: DcpSuppressionReason[] }`.
- Produces: `getDcpCapabilities(config: DcpConfig, state: SessionState, provider?: string, modelId?: string): DcpCapabilities`.
- Changes: `registerDcpCommands` keeps four arguments; its fourth becomes `onStateChange: (ctx: ExtensionCommandContext) => void`.
- Produces: one `compress` definition, registered before session initialization, with `defaultActive: false` and `executionMode: "sequential"` in both modes.

- [ ] **Step 1: Add failing policy tests**

Name cases for enabled defaults, each suppression reason, combined reasons, session permission
overriding configuration, and missing model identity. Assert independent applicable reasons in
`config`, `model`, `subagent`, `permission` order. Missing provider/model retains the existing
model-enablement behavior.

```ts
expect(getDcpCapabilities(config, deniedState, provider, modelId)).toEqual({
  pipelineEnabled: true,
  compressionEnabled: false,
  reasons: ["permission"],
});
```

Global/model/sub-agent suppression makes both capabilities false; permission denial alone leaves
the pipeline enabled. Combined global/model suppression must report both reasons.

- [ ] **Step 2: Verify policy tests fail**

Run: `pnpm vitest run tests/capabilities.test.ts`

Expected: FAIL because `src/capabilities.ts` does not yet exist.

- [ ] **Step 3: Implement the pure capability calculation**

Reuse `isDcpEnabledForModel` for the model check with an enabled configuration view so global
disablement does not mask the model reason. Resolve permission with
`state.compressPermission ?? config.compress.permission`. Do not include active-tool selection
or manual mode in these policy capabilities.

- [ ] **Step 4: Add failing lifecycle and authorization cases**

In the harness, test active and inactive tools through suppression, both overlap orders, restored
deny/allow permissions, initially denied sessions, disallowed child processes, allowed child
processes, permission commands immediately after startup, and global disablement after a prior
enabled session. Assert other active tools are preserved.

Add real-host cases named `activates compress once for a fresh default session`,
`preserves inactive compress across resume and reload`, and
`refreshes trusted project mode without activating compress`. Supply an inactive Pi loadout and a
structured branch for resume, and use the public reload path after deselecting the tool. Assert
the effective range/message schema, `defaultActive === false`, and
`executionMode === "sequential"`. Assert registration exists during extension creation. Cover
`tools: ["read"]`, `excludeTools: ["compress"]`, and `noTools: "all"` so implicit activation
cannot override host exclusions.

On session/tree changes, establish the host-restored selection before emitting the event; assert
it wins over the previous branch's suppression memory. Refresh model identity after restoring
state. Assert cached previous-branch messages cannot be compressed before the new context arrives.

For each policy suppression reason, emit `tool_call` and invoke the registered `execute` function
with a valid compression request. Assert block/error results and unchanged compression state.
Verify non-compress calls remain unaffected, and denied permission still allows deduplication and
stale-error pruning. An inactive `dcp:compress` call must not enqueue a follow-up or activate tools.
If permission changes after a permitted compression starts, assert execution end clears its timing
entry and records the completed duration.

- [ ] **Step 5: Verify lifecycle tests expose the current gaps**

Run: `pnpm vitest run tests/pi-contract.test.ts tests/index.test.ts tests/commands-register.test.ts tests/integration.test.ts`

Expected: FAIL on early registration, restored suppression, inactive-trigger, and defensive
execution cases. Existing unrelated assertions must continue to pass.

- [ ] **Step 6: Reconcile lifecycle state and enforce authorization**

Register the provisional global-mode definition with `defaultActive: false` during extension
creation and retain that flag on schema refresh. Pi reload uses `includeAllExtensionTools`, so
early registration with the default activation flag would still reactivate a deselected tool.
At session start, reload configuration; reset transient state and cached messages; restore branch state; set
`state.modelProvider`, `state.modelId`, and process sub-agent status; initialize prompts; refresh
the effective tool definition; initialize fresh-session selection once; reconcile; then persist
using the existing policy. Do not let a global-disabled early return skip suppression of a
previously registered tool.

Track whether this extension instance has processed `session_start`. Treat a system message with
`sections`, `toolsAdded`, or `toolsRemoved` as a declared loadout, including empty collections.
On its first event only, implicitly select `compress` if the reason is not `reload`, the active branch contains no
structured system message declaring a tool loadout, and `pi.getAllTools()` includes `compress`.
This preserves the default for fresh sessions while respecting host exclusions. Existing active
selection is left intact. Never implicitly select it on resume of a declared loadout, subsequent
session events, tree navigation, or reload. Run this initialization before policy suppression so
an initially denied fresh session can restore its default selection when permission later allows.

Keep `compressWasActiveBeforeSuppression: boolean | undefined` outside persisted state. Record
selection only on the first suppression transition; remove `compress` while any policy reason
remains; restore only a recorded true value when all reasons clear. Clear the record on session
and tree restoration so the host-selected loadout is authoritative. Never activate an already
inactive tool merely because compression policy allows it.

Reconcile after model selection, session/tree restoration, command state changes, and before
prompt/context processing. The command callback receives its context, refreshes model identity,
reconciles, and persists. Gate mutating commands with pipeline eligibility; `dcp:compress`
additionally requires compression policy and an active tool. Keep informational commands usable.

Use the capability calculation in both `tool_call` and `execute`; global/model/sub-agent/permission
suppression must block even if the tool was invoked despite hidden exposure. Use the first
applicable reason in the deterministic order. Preserve existing configuration/model/permission
error messages and use `Compression is disabled in sub-agent sessions.` for sub-agent denial.
Mark both mode definitions sequential. Keep timing completion/cleanup for calls that actually
started; exposure changes must
not strand their timing entries.

- [ ] **Step 7: Verify capabilities and lifecycle behavior**

Run: `pnpm vitest run tests/capabilities.test.ts tests/pi-contract.test.ts tests/index.test.ts tests/commands-register.test.ts tests/integration.test.ts tests/compression-timing.test.ts && pnpm typecheck && pnpm lint`

Expected: PASS across both tool modes, restored selection, combined suppression, command callback,
and defensive execution cases, with automatic strategies still available under deny.

- [ ] **Step 8: Commit lifecycle reconciliation**

```bash
git add src/capabilities.ts src/index.ts src/commands/register.ts tests/capabilities.test.ts tests/pi-contract.test.ts tests/index.test.ts tests/commands-register.test.ts tests/integration.test.ts
git commit -m "fix: reconcile DCP capabilities with Pi lifecycle"
```

### Task 3: Adopt structured prompts and one prompt snapshot per run

**Files:**

- Modify: `src/index.ts`
- Modify: `src/pipeline.ts`
- Modify: `src/prompts/store.ts`
- Test: `tests/index.test.ts`
- Test: `tests/pi-contract.test.ts`
- Test: `tests/pipeline.test.ts`
- Test: `tests/prompt-store.test.ts`

**Interfaces:**

- Consumes: Task 2 capabilities and the reconciled active tools.
- Produces: guidance availability equal to `capabilities.compressionEnabled && pi.getActiveTools().includes("compress")`.
- Changes: `runPipeline(state: SessionState, config: DcpConfig, messages: AgentMessage[], contextUsage: ContextUsage | undefined, runtimePrompts?: RuntimePrompts, compressionEnabled?: boolean): PipelineResult`.
- Produces: one refreshed `RuntimePrompts` snapshot shared by `before_agent_start` and subsequent context passes until the next `before_agent_start`.

- [ ] **Step 1: Add failing structured-section assertions**

Test `sets only the dcp section`, `replaces dcp idempotently`, and `removes dcp when guidance is
unavailable`. Preserve unrelated sections, selected tools, guidelines, and any forced prompt.
Assert the handler returns no full `systemPrompt` and enabled defaults set the section to
`DCP_SYSTEM_PROMPT`. Verify the structured result through the real extension runner.

Test an otherwise enabled session with an inactive tool: the section and nudges are absent while
automatic strategies, message references, and existing compression summaries continue working.

- [ ] **Step 2: Add failing custom-prompt event-order assertions**

In a trusted temporary project, change `system.md` and `turn-nudge.md` before
`before_agent_start`. Assert that run uses both new values. Change them again after
`before_agent_start`; assert repeated context passes retain the captured values and the next run
uses the later edits. Spy on `PromptStore.reload()` after startup: one call per
`before_agent_start`, none from context. Retain project/global/default precedence and untrusted
project exclusion tests.

- [ ] **Step 3: Verify prompt and pipeline tests fail**

Run: `pnpm vitest run tests/index.test.ts tests/pi-contract.test.ts tests/pipeline.test.ts tests/prompt-store.test.ts`

Expected: FAIL on full-prompt replacement, context reloads, and inactive-tool guidance.

- [ ] **Step 4: Populate the section and gate nudge injection**

At the beginning of `before_agent_start`, reload the prompt store once and refresh runtime
prompts, then reconcile and calculate guidance availability. Set `sections.dcp` to the effective
system text or delete only that section; return no full prompt. Remove filesystem reloads from
context, which consumes the captured prompt snapshot.

The optional sixth pipeline parameter defaults to effective permission being different from
`deny`, preserving existing callers. The extension passes current guidance availability. Use it
only to skip `injectCompressNudges`; retain reference assignment, compression restoration,
strategies, priority/marker handling, and pruning. Do not overwrite permission or remove nudge
anchors to simulate an inactive tool. Update the prompt-store reload documentation.

- [ ] **Step 5: Verify prompts, nudges, and pipeline compatibility**

Run: `pnpm vitest run tests/index.test.ts tests/pi-contract.test.ts tests/pipeline.test.ts tests/prompt-store.test.ts tests/anchored-nudges.test.ts tests/integration.test.ts && pnpm typecheck && pnpm lint`

Expected: PASS with one prompt reload per run, preserved unrelated options, no inactive-tool
guidance, and unchanged automatic pruning and benchmark inputs.

- [ ] **Step 6: Commit structured prompt integration**

```bash
git add src/index.ts src/pipeline.ts src/prompts/store.ts tests/index.test.ts tests/pi-contract.test.ts tests/pipeline.test.ts tests/prompt-store.test.ts
git commit -m "refactor: integrate DCP through Pi prompt sections"
```

### Task 4: Finalize and verify the v0.9.0 release

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

**Interfaces:**

- Consumes: typed contracts, capabilities, selection reconciliation, and structured prompts from Tasks 1–3.
- Produces: documented v0.9.0 lifecycle behavior with existing configuration and snapshot compatibility.

- [ ] **Step 1: Prepare release documentation and metadata**

Describe the named prompt section, run-boundary reloads, early registration with explicit fresh
activation and trusted schema refresh, inactive-tool guidance, restored-loadout precedence,
suppression, and defensive execution. Document that `dcp:compress` does not activate an inactive
tool. Add v0.9.0 release notes and set
the package version to `0.9.0` without dependency changes.

- [ ] **Step 2: Run complete verification and compare the generated schema**

```bash
pnpm check
node scripts/generate-schema.ts | diff - dcp.schema.json
pnpm run pack:dry-run
git diff --check
```

Expected: all commands exit 0; no schema difference, lint warnings, new dependencies, or
compact-marker benchmark regressions. Unlike `generate:schema`, this comparison does not rewrite
the tracked schema.

- [ ] **Step 3: Smoke-test lifecycle behavior in Pi**

Run the extension locally with isolated configuration. Inspect structured sections and tool
visibility on startup, resume, reload, fork/tree navigation, trusted-project compression-mode
changes, model switches, permission toggles, and disallowed/allowed child processes. Verify an
inactive tool remains inactive, guidance follows the loadout, no suppressed tool reaches the first
request, and automatic pruning results are unchanged under denied permission. Restore environment
and configuration after testing; explicitly report any unperformed interactive checks.

- [ ] **Step 4: Review and commit release metadata**

Run: `git diff --check && git status --short`

```bash
git add README.md CHANGELOG.md package.json
git commit -m "chore: prepare pi-dcp 0.9.0"
```

Publishing is outside this phase. The release is ready when Tasks 1–4 pass, existing v1 snapshots
remain readable, and all manual verification results or remaining limitations are recorded.
