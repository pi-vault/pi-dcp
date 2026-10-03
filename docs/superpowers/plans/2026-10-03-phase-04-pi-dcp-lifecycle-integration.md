# Phase 4 — Pi DCP Lifecycle Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate pi-dcp with current Pi structured prompts, public session APIs, and active-tool lifecycle without changing automatic pruning semantics.

**Architecture:** Put Pi lifecycle behavior behind a typed extension test harness and a pure capability calculation. Treat pipeline eligibility and model-driven compression availability as separate capabilities, then reconcile the prompt and active tool from those capabilities at every relevant transition.

**Tech Stack:** Node.js, TypeScript 7, Pi 1.0 extension APIs, TypeBox 1.3, Vitest 5, Biome 2, pnpm

**Spec:** `docs/superpowers/specs/2026-10-03-pi-dcp-improvement-roadmap-design.md`

## Global Constraints

- Execute this phase after `2026-10-03-phase-03-pi-dcp-compact-markers.md` and start from v0.8.0.
- Use `event.systemPromptOptions.sections.dcp`; never return a full DCP `systemPrompt` override.
- `deny` suppresses model-driven compression but does not disable deduplication or stale-error pruning.
- Preserve a user's inactive `compress` selection across model, permission, and sub-agent transitions.
- Existing commands, snapshot version 1, configuration keys, and marker syntax remain unchanged in this release.

## Review Focus

- Switching directly between two simultaneous suppression reasons must not restore `compress` between them; Task 3 tests model-disabled plus permission-denied transitions.
- A tool that was inactive before DCP suppression must remain inactive afterward; Task 3 pins this user-loadout case.
- A custom prompt changed immediately before a turn must affect both the system section and nudges in that same turn; Task 2 tests the event order.
- A denied compression call issued defensively despite hidden tool exposure must still be blocked; Task 3 covers direct tool events.
- A sub-agent session must determine its status before initial tool reconciliation, avoiding a one-turn exposure leak; Task 3 adds the session-start case.

---

### Task 1: Add a typed Pi extension contract harness

**Files:**

- Create: `tests/extension-harness.ts`
- Create: `tests/pi-contract.test.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/integration.test.ts`
- Modify: `src/index.ts`

**Interfaces:**

- Consumes: `ExtensionAPI`, `ExtensionContext`, `AgentMessage`, public session-manager methods, and registered extension callbacks.
- Produces: `createExtensionHarness(options?: ExtensionHarnessOptions): ExtensionHarness`, with typed `api`, `context`, `activeTools`, `registeredTools`, UI spies, and `emit(eventName: string, event: unknown): Promise<unknown[]>`.

- [ ] **Step 1: Create the typed harness and a failing host-contract test**

Build `tests/extension-harness.ts` without explicit `any`. The session manager must expose real
`getSessionId()`, `getSessionDir()`, and `getBranch()` methods. In `tests/pi-contract.test.ts`, use
`satisfies AgentMessage` for representative user, assistant/tool-call, and tool-result messages,
including a result with `nestedCalls`.

Instantiate the extension, emit `session_start`, and assert the session identifier and active
branch restore through the public manager contract.

- [ ] **Step 2: Run the contract test and verify production casts are still required**

Run: `pnpm vitest run tests/pi-contract.test.ts`

Expected: FAIL or fail to typecheck until `src/index.ts` uses the current public methods directly.

- [ ] **Step 3: Remove session-manager compatibility casts**

Change `getSessionId(ctx)` to call `ctx.sessionManager.getSessionId()` and
`restoreActiveBranch(ctx)` to call `ctx.sessionManager.getBranch()` directly. Keep the existing
fallback behavior out of the new implementation because Pi 1.0 declares both methods.

- [ ] **Step 4: Move lifecycle tests onto the typed harness**

Replace the duplicated untyped handler maps in `tests/index.test.ts` and `tests/integration.test.ts`
with `createExtensionHarness`. Use small message-narrowing helpers instead of explicit `any` and
replace non-null handler assertions with harness errors that name the missing event.

- [ ] **Step 5: Run the contract and integration tests**

Run: `pnpm vitest run tests/pi-contract.test.ts tests/index.test.ts tests/integration.test.ts`

Expected: PASS with the Phase 1 warning-free lint contract preserved in the harness and migrated
tests.

- [ ] **Step 6: Commit the Pi contract harness**

```bash
git add tests/extension-harness.ts tests/pi-contract.test.ts tests/index.test.ts tests/integration.test.ts src/index.ts
git commit -m "test: exercise DCP through current Pi contracts"
```

### Task 2: Adopt structured prompt sections and same-turn reloads

**Files:**

- Modify: `src/index.ts`
- Modify: `src/prompts/store.ts`
- Test: `tests/index.test.ts`
- Test: `tests/prompt-store.test.ts`

**Interfaces:**

- Consumes: `BeforeAgentStartEvent.systemPromptOptions.sections`, `PromptStore.reload()`, and existing runtime prompt files.
- Produces: an idempotent `dcp` section containing the effective DCP system prompt for the current turn.

- [ ] **Step 1: Add failing structured-prompt tests**

Emit `before_agent_start` with an existing unrelated section. Assert the handler returns no full
`systemPrompt`, preserves the unrelated section, and sets
`event.systemPromptOptions.sections.dcp` to `DCP_SYSTEM_PROMPT` when compression is available.
Assert it removes or omits only `sections.dcp` when compression is unavailable.

- [ ] **Step 2: Add the same-turn custom-prompt test**

Enable custom prompts in a trusted temporary project, start the session, then change `system.md`
and `turn-nudge.md` before the next `before_agent_start`. Emit `before_agent_start` followed by
`context`; assert the new system text and new nudge text are both used in that turn.

- [ ] **Step 3: Run prompt tests and verify current behavior lags or replaces the prompt**

Run: `pnpm vitest run tests/index.test.ts tests/prompt-store.test.ts`

Expected: FAIL because the handler returns a full prompt and reload occurs later in `context`.

- [ ] **Step 4: Reload once before populating the structured section**

In `before_agent_start`, reload `promptStore`, refresh `runtimePrompts`, and assign the effective
system text to `event.systemPromptOptions.sections.dcp`. Remove the full-prompt return. Leave the
context handler using the already-refreshed `runtimePrompts`; do not perform a second filesystem
reload in the same turn.

- [ ] **Step 5: Run prompt, nudge, and integration tests**

Run: `pnpm vitest run tests/index.test.ts tests/prompt-store.test.ts tests/anchored-nudges.test.ts tests/integration.test.ts`

Expected: PASS with unrelated prompt sections and custom nudge precedence preserved.

- [ ] **Step 6: Commit structured prompt integration**

```bash
git add src/index.ts src/prompts/store.ts tests/index.test.ts tests/prompt-store.test.ts
git commit -m "refactor: integrate DCP through Pi prompt sections"
```

### Task 3: Centralize capability and active-tool reconciliation

**Files:**

- Create: `src/capabilities.ts`
- Modify: `src/index.ts`
- Modify: `src/commands/register.ts`
- Test: `tests/capabilities.test.ts`
- Test: `tests/index.test.ts`
- Test: `tests/commands-register.test.ts`

**Interfaces:**

- Consumes: `DcpConfig`, `SessionState`, provider/model IDs, permission, and sub-agent state.
- Produces: `getDcpCapabilities(config: DcpConfig, state: SessionState, provider?: string, modelId?: string): DcpCapabilities`, where `DcpCapabilities` contains `pipelineEnabled: boolean`, `compressionEnabled: boolean`, and `reasons: DcpSuppressionReason[]`.

- [ ] **Step 1: Add failing pure capability-matrix tests**

Create `tests/capabilities.test.ts` covering global disablement, disabled model, disallowed sub-agent,
permission deny, and combinations. Assert permission deny yields
`pipelineEnabled: true, compressionEnabled: false`; global/model/sub-agent suppression makes both
false. Assert reasons are deterministic in the order `config`, `model`, `subagent`, `permission`.

- [ ] **Step 2: Implement the pure capability calculation**

Define `DcpSuppressionReason` and `DcpCapabilities` in `src/capabilities.ts`. Reuse
`isDcpEnabledForModel` for global/model checks and derive compression availability from pipeline
eligibility plus permission.

- [ ] **Step 3: Add failing active-tool transition tests**

Through the extension harness, cover:

- active -> model-disabled -> active;
- inactive -> model-disabled -> still inactive;
- active -> model-disabled plus deny -> model-enabled but still denied -> allow and restored;
- initial denied session never exposes `compress` after `session_start`;
- disallowed sub-agent never exposes it;
- defensive denied `tool_call` is blocked.

Also assert automatic deduplication still runs while permission is denied.

- [ ] **Step 4: Reconcile all compression surfaces from capabilities**

Replace scattered enablement checks with the capability result. Use `pipelineEnabled` for the
context pipeline and `compressionEnabled` for prompt section, nudges, tool exposure, and tool-call
authorization. Track whether `compress` was active at the first transition into suppression; do
not overwrite that value while other suppression reasons remain. Restore only that recorded state
when compression becomes available.

- [ ] **Step 5: Reconcile after every state transition**

Set `state.isSubAgent` before initial reconciliation. Reconcile after session restore, tree change,
model selection, and command-driven state changes. Change the command callback passed from
`src/index.ts` so it reconciles with `state.modelProvider/state.modelId` before persisting.

- [ ] **Step 6: Mark compression execution sequential**

Add `executionMode: "sequential"` to both range and message registrations of `compress`. Add a
contract assertion that the registered definition carries this value.

- [ ] **Step 7: Run capability, lifecycle, command, and pipeline tests**

Run: `pnpm vitest run tests/capabilities.test.ts tests/index.test.ts tests/commands-register.test.ts tests/integration.test.ts tests/pipeline.test.ts`

Expected: PASS across the transition matrix, with denied permission still allowing automatic
strategy pruning.

- [ ] **Step 8: Commit lifecycle reconciliation**

```bash
git add src/capabilities.ts src/index.ts src/commands/register.ts tests/capabilities.test.ts tests/index.test.ts tests/commands-register.test.ts
git commit -m "fix: reconcile DCP capabilities with Pi lifecycle"
```

### Task 4: Finalize and verify the v0.9.0 release

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

**Interfaces:**

- Consumes: typed contracts, structured prompts, and capability reconciliation from Tasks 1-3.
- Produces: documented v0.9.0 lifecycle behavior without configuration or snapshot migration.

- [ ] **Step 1: Document the lifecycle changes**

Update the Pi integration notes to describe the named prompt section, same-turn custom prompt
reload, model/sub-agent suppression, and permission behavior. Add v0.9.0 release notes and set the
package version to `0.9.0`.

- [ ] **Step 2: Run complete checks and package inspection**

Run: `pnpm check && pnpm run pack:dry-run`

Expected: exit 0; package contents include no new runtime dependency and the generated schema is
unchanged from v0.8.0.

- [ ] **Step 3: Smoke-test the lifecycle in Pi**

Run Pi locally with the extension, inspect one turn's system sections, switch between an enabled
and disabled model, toggle `dcp:permission`, and start a sub-agent-disabled session. Confirm prompt
and tool visibility follow capabilities without changing automatic pruning statistics.

- [ ] **Step 4: Review and commit the release metadata**

Run: `git diff --check && git status --short`

```bash
git add README.md CHANGELOG.md package.json
git commit -m "chore: prepare pi-dcp 0.9.0"
```
