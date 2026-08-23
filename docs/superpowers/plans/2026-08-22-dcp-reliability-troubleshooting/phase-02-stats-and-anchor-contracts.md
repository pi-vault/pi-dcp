# Phase 2: Statistics and Anchor Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make active-versus-cumulative statistics explicit and prove the existing stale-anchor reconciliation behavior.

**Architecture:** Change operator-facing copy only; preserve all counters and snapshot fields. Exercise stale-anchor cleanup through `runPipeline()`, where current raw message keys are available, then remove the obsolete TODO from the lower-level nudge helper.

**Tech Stack:** TypeScript ESM, Vitest, existing command and pipeline helpers.

**Spec:** `docs/superpowers/specs/2026-08-22-dcp-troubleshooting-design.md`

## Global Constraints

- Do not change `SessionStats`, `DcpSnapshotV1`, compaction persistence, or lifetime aggregation.
- Do not add a second anchor-cleanup loop.
- Copy changes must identify active context separately from cumulative session totals.

---

### Task 1: Clarify command statistics

**Files:**
- Modify: `tests/commands-context.test.ts`
- Modify: `tests/commands-stats.test.ts`
- Modify: `tests/index.test.ts`
- Modify: `src/commands/context.ts`
- Modify: `src/commands/stats.ts`

**Interfaces:**
- Consumes: `contextCommand(state, usage)` and `statsCommand(state)`.
- Produces: exact active/cumulative labels without changing values.

- [ ] **Step 1: Tighten command tests to require scope labels**

In `tests/commands-context.test.ts`, add to the first test:

```typescript
expect(result).toContain("Currently pruned tool calls: 1");
expect(result).not.toContain("\n  Pruned tool calls:");
```

Replace the weak assertions in `tests/commands-stats.test.ts` with:

```typescript
expect(result).toContain("Tools pruned this session: 5");
expect(result).toContain("Cumulative tokens saved by pruning: 1234");
expect(result).toContain("Messages compressed this session: 3");
```

- [ ] **Step 2: Run tests and verify label failures**

Run:

```bash
pnpm vitest run tests/commands-context.test.ts tests/commands-stats.test.ts
```

Expected: FAIL because current labels do not identify active versus cumulative scope.

- [ ] **Step 3: Apply the minimal copy changes**

In `src/commands/context.ts`, change only the prune count line to:

```typescript
lines.push(`  Currently pruned tool calls: ${state.prune.tools.size}`);
```

In `src/commands/stats.ts`, return:

```typescript
return [
  "DCP Session Statistics:",
  `  Tools pruned this session: ${state.stats.toolsPruned}`,
  `  Cumulative tokens saved by pruning: ${state.stats.totalPruneTokens}`,
  `  Messages compressed this session: ${state.stats.messagesCompressed}`,
  `  Prune token counter: ${state.stats.pruneTokenCounter}`,
].join("\n");
```

- [ ] **Step 4: Run command tests**

Run:

```bash
pnpm vitest run tests/commands-context.test.ts tests/commands-stats.test.ts
```

Expected: PASS.

The extension-level compaction regression must also verify that `dcp:stats`
preserves cumulative values while `dcp:context` reports zero active pruned
tool calls after `session_compact`.

### Task 2: Prove stale-anchor reconciliation and remove stale commentary

**Files:**
- Modify: `tests/pipeline.test.ts`
- Modify: `src/messages/inject.ts`

**Interfaces:**
- Consumes: `runPipeline()` and its existing `rawKeys` reconciliation.
- Produces: a regression proving stale keys are deleted and surviving keys remain.

- [ ] **Step 1: Add a focused pipeline regression**

Add to `tests/pipeline.test.ts`:

```typescript
it("removes stale nudge anchors and preserves surviving anchors", () => {
  const state = createSessionState();
  const config = makeDefaultConfig();
  state.nudges.turnAnchors.add("user:1:0");
  state.nudges.turnAnchors.add("user:999:0");
  state.nudges.contextLimitAnchors.add("assistant:2:0");
  state.nudges.iterationAnchors.add("assistant:998:0");
  const messages = [makeUserMessage("kept user", 1), makeAssistantMessage("kept assistant", 2)];

  runPipeline(state, config, messages, undefined);

  expect(state.nudges.turnAnchors).toEqual(new Set(["user:1:0"]));
  expect(state.nudges.contextLimitAnchors).toEqual(new Set(["assistant:2:0"]));
  expect(state.nudges.iterationAnchors).toEqual(new Set());
});
```

- [ ] **Step 2: Run the regression against existing code**

Run:

```bash
pnpm vitest run tests/pipeline.test.ts -t "removes stale nudge anchors"
```

Expected: PASS, proving the implementation already exists.

- [ ] **Step 3: Remove only the obsolete TODO**

Delete this comment block from `src/messages/inject.ts`:

```typescript
// TODO: Stale anchors (keys not present in current messages) are never pruned from the Sets.
// In sessions with heavy compaction, Sets may grow over time. A future task should clean them
// up — e.g., after compaction by intersecting anchor sets with keys of surviving messages.
```

Do not alter `addAnchorIfAllowed()` or add cleanup to `session_compact`.

- [ ] **Step 4: Run all focused phase tests**

Run:

```bash
pnpm vitest run tests/commands-context.test.ts tests/commands-stats.test.ts tests/index.test.ts tests/pipeline.test.ts
pnpm typecheck
git diff --check
```

Expected: all PASS.

- [ ] **Step 5: Commit Phase 2**

```bash
git add docs/superpowers/plans/2026-08-22-dcp-reliability-troubleshooting/phase-02-stats-and-anchor-contracts.md src/commands/context.ts src/commands/stats.ts src/messages/inject.ts tests/commands-context.test.ts tests/commands-stats.test.ts tests/index.test.ts tests/pipeline.test.ts
git commit -m "fix: clarify dcp statistics and anchor cleanup"
```
