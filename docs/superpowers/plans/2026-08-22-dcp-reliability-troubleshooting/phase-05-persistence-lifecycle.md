# Phase 5: Persistence Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop full snapshot writes caused only by message-reference growth while preserving stable references and every semantic lifecycle mutation.

**Architecture:** Keep full snapshot-v1 serialization unchanged and compare a semantic fingerprint that omits the complete `messageIds` object. Prove deterministic reconstruction before accepting the change. If reconstruction fails, retain the full fingerprint, move ordinary context persistence to `agent_settled`, and keep explicit lifecycle/compression writes.

**Tech Stack:** TypeScript ESM, Pi custom entries and lifecycle hooks, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-dcp-troubleshooting-design.md`

## Global Constraints

- Keep `DcpSnapshotV1`, parser behavior, and serialized snapshot content unchanged.
- Exclude both `messageIds.byRawId` and `messageIds.nextRefIndex` from the semantic fingerprint.
- Preserve forced recovery writes and explicit command/compression/compaction writes.
- Use the current Pi 0.84.2 lifecycle contract for the gate: `session_tree` changes the active branch, `session_compact` fires after a successful compaction, and `agent_settled` fires only after retries, compaction, and queued follow-ups are finished. Keep the historical v0.83.0 corpus numbers separate from current lifecycle behavior.
- Treat synthetic message refs as a reconstruction contract. OpenCode DCP is a reference for using host-stable message IDs; it does not justify removing Pi's synthetic-ID proof.
- Accept the projection only if the complete lifecycle reconstruction matrix passes.
- Do not combine the projection and `agent_settled` fallback; select one design from evidence.

---

### Task 1: Define the semantic fingerprint contract

**Files:**

- Modify: `tests/persistence.test.ts`
- Modify: `src/state/persistence.ts`

**Interfaces:**

- Consumes: `serializeDcpSnapshot(state, "owner")`.
- Produces: `durableStateFingerprint(state): string | undefined` that ignores only `messageIds`.

- [ ] **Step 1: Add a message-ID-only fingerprint regression**

Add inside `describe("native snapshots")` in `tests/persistence.test.ts`:

```typescript
it("excludes message-id bookkeeping from the durable fingerprint", () => {
  const state = createSessionState();
  state.sessionId = "owner";
  const before = persistence.durableStateFingerprint(state);

  state.messageIds.byRawId.set("user:1:0", "m0001");
  state.messageIds.byRef.set("m0001", "user:1:0");
  state.messageIds.nextRefIndex = 2;

  expect(persistence.durableStateFingerprint(state)).toBe(before);
  expect(persistence.serializeDcpSnapshot(state)?.messageIds).toEqual({
    byRawId: [["user:1:0", "m0001"]],
    nextRefIndex: 2,
  });
});
```

- [ ] **Step 2: Add semantic-field fingerprint regressions**

Add:

```typescript
it("changes the durable fingerprint for semantic mutations", () => {
  const mutations: Array<
    (state: ReturnType<typeof createSessionState>) => void
  > = [
    (state) => {
      state.manualMode = "active";
    },
    (state) => {
      state.compressPermission = "deny";
    },
    (state) => {
      state.stats.totalPruneTokens = 1;
    },
    (state) => {
      state.lastCompaction = 1;
    },
    (state) => {
      state.prune.tools.set("call", 1);
    },
    (state) => {
      state.prune.messages.nextBlockId = 2;
    },
    (state) => {
      state.prune.messages.nextRunId = 2;
    },
    (state) => {
      state.nudges.turnAnchors.add("user:1:0");
    },
  ];

  for (const mutate of mutations) {
    const state = createSessionState();
    state.sessionId = "owner";
    const before = persistence.durableStateFingerprint(state);
    mutate(state);
    expect(persistence.durableStateFingerprint(state)).not.toBe(before);
  }
});
```

Existing snapshot tests already cover block serialization. Do not duplicate the full block fixture solely for this test.

- [ ] **Step 3: Run the focused tests and verify failure**

Run:

```bash
pnpm vitest run tests/persistence.test.ts -t "fingerprint"
```

Expected: the message-ID exclusion test FAILS; semantic mutation test PASSES.

- [ ] **Step 4: Implement the projection**

Replace `durableStateFingerprint()` in `src/state/persistence.ts` with:

```typescript
export function durableStateFingerprint(
  state: SessionState,
): string | undefined {
  const snapshot = serializeDcpSnapshot(state, "owner");
  if (!snapshot) return undefined;
  const { messageIds: _messageIds, ...durable } = snapshot;
  return JSON.stringify(durable);
}
```

If lint rejects the underscore-prefixed destructure, use this equivalent typed projection instead:

```typescript
const durable: Omit<DcpSnapshotV1, "messageIds"> = {
  version: snapshot.version,
  ownerSessionId: snapshot.ownerSessionId,
  manualMode: snapshot.manualMode,
  compressPermission: snapshot.compressPermission,
  stats: snapshot.stats,
  lastCompaction: snapshot.lastCompaction,
  pruneTools: snapshot.pruneTools,
  blocks: snapshot.blocks,
  nextBlockId: snapshot.nextBlockId,
  nextRunId: snapshot.nextRunId,
  nudges: snapshot.nudges,
};
return JSON.stringify(durable);
```

Use one implementation, not both.

- [ ] **Step 5: Run persistence tests**

Run:

```bash
pnpm vitest run tests/persistence.test.ts
pnpm typecheck
```

Expected: PASS.

### Task 2: Prove deterministic reconstruction without ID-only checkpoints

**Files:**

- Modify: `tests/stable-ids.test.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/pipeline.test.ts`

**Interfaces:**

- Consumes: `serializeDcpSnapshot()`, `restoreDcpSnapshot()`, and `assignMessageRefs()`.
- Produces: lifecycle evidence required to accept or reject the projection, including Pi branch/compaction events and compression-block boundary rebuilding.

- [ ] **Step 1: Add persistence imports and a message helper**

Add imports:

```typescript
import {
  restoreDcpSnapshot,
  serializeDcpSnapshot,
} from "../src/state/persistence.ts";
```

Use existing inline messages or existing `makeUserMessage`/`makeAssistantMessage`; do not create a second production helper.

- [ ] **Step 2: Test same-order resume and fork reconstruction**

Add inside `describe("assignMessageRefs (stable)")`:

```typescript
it("reconstructs the same refs after ID-only growth was not checkpointed", () => {
  const baseline = createSessionState();
  baseline.sessionId = "owner";
  const snapshot = serializeDcpSnapshot(baseline);
  if (!snapshot) throw new Error("expected snapshot");
  const messages: AgentMessage[] = [
    {
      role: "user",
      content: [{ type: "text", text: "one" }],
      timestamp: 1,
    } as AgentMessage,
    {
      role: "user",
      content: [{ type: "text", text: "two" }],
      timestamp: 2,
    } as AgentMessage,
  ];

  assignMessageRefs(baseline, messages);
  const original = [...baseline.messageIds.byIndex.values()];

  const resumed = createSessionState();
  expect(restoreDcpSnapshot(snapshot, resumed, "owner")).toBe(true);
  assignMessageRefs(resumed, messages);

  const forked = createSessionState();
  expect(restoreDcpSnapshot(snapshot, forked, "child")).toBe(true);
  assignMessageRefs(forked, messages);

  expect([...resumed.messageIds.byIndex.values()]).toEqual(original);
  expect([...forked.messageIds.byIndex.values()]).toEqual(original);
});
```

- [ ] **Step 3: Test branch reconstruction**

Add:

```typescript
it("reconstructs stable refs independently on sibling branches", () => {
  const baseline = createSessionState();
  baseline.sessionId = "owner";
  const snapshot = serializeDcpSnapshot(baseline);
  if (!snapshot) throw new Error("expected snapshot");
  const prefix = {
    role: "user",
    content: [{ type: "text", text: "prefix" }],
    timestamp: 1,
  } as AgentMessage;
  const branchA = {
    ...prefix,
    content: [{ type: "text" as const, text: "A" }],
    timestamp: 2,
  } as AgentMessage;
  const branchB = {
    ...prefix,
    content: [{ type: "text" as const, text: "B" }],
    timestamp: 3,
  } as AgentMessage;

  const firstA = createSessionState();
  restoreDcpSnapshot(snapshot, firstA, "owner");
  assignMessageRefs(firstA, [prefix, branchA]);

  const siblingB = createSessionState();
  restoreDcpSnapshot(snapshot, siblingB, "owner");
  assignMessageRefs(siblingB, [prefix, branchB]);

  const returnedA = createSessionState();
  restoreDcpSnapshot(snapshot, returnedA, "owner");
  assignMessageRefs(returnedA, [prefix, branchA]);

  expect([...returnedA.messageIds.byIndex.values()]).toEqual([
    ...firstA.messageIds.byIndex.values(),
  ]);
  expect(siblingB.messageIds.byIndex.get(0)).toBe(
    firstA.messageIds.byIndex.get(0),
  );
});
```

- [ ] **Step 4: Test compaction checkpoint reconstruction**

Add:

```typescript
it("uses the semantic compaction checkpoint to preserve retained refs", () => {
  const state = createSessionState();
  state.sessionId = "owner";
  const old = {
    role: "user",
    content: [{ type: "text", text: "old" }],
    timestamp: 1,
  } as AgentMessage;
  const retained = {
    role: "user",
    content: [{ type: "text", text: "retained" }],
    timestamp: 2,
  } as AgentMessage;
  assignMessageRefs(state, [old, retained]);
  expect(state.messageIds.byIndex.get(1)).toBe("m0002");
  state.lastCompaction = 10;
  const checkpoint = serializeDcpSnapshot(state);
  if (!checkpoint) throw new Error("expected checkpoint");

  const restored = createSessionState();
  restoreDcpSnapshot(checkpoint, restored, "owner");
  const summary = {
    role: "compactionSummary",
    summary: "summary",
    tokensBefore: 100,
    timestamp: 3,
  } as unknown as AgentMessage;
  assignMessageRefs(restored, [summary, retained]);

  expect(restored.messageIds.byIndex.get(1)).toBe("m0002");
  expect(restored.messageIds.byIndex.get(0)).toBe("m0003");
});
```

- [ ] **Step 5: Test Pi tree navigation and compaction restart**

Add extension-level regressions in `tests/index.test.ts` using the existing `createMockApi()`:

1. Build two valid branch paths from the same semantic checkpoint. Drive `session_tree` from branch A to B and back to A, then run `context` on each path. Assert that the shared prefix and each branch's messages receive the same refs as independent reconstruction, and that ID-only context growth does not append a state entry.
2. Drive `session_compact` on a state containing an old message and a retained message. Run `context` with a `compactionSummary` plus the retained tail, capture the resulting refs, create a fresh extension instance from the persisted checkpoint, and run the same context again. Assert that retained refs and the next allocated ref are unchanged across the restart.

The test must use the actual registered handlers, not direct calls to `restoreDcpSnapshot()` alone. It should assert that the compaction handler clears runtime indexes while the persisted raw-key map remains available for reconstruction.

- [ ] **Step 6: Test compression-block boundary reconstruction**

Add in `tests/pipeline.test.ts`:

1. Create a compression block with stable `startKey`, `endKey`, `anchorKey`, and `compressToolCallId` boundaries, then serialize that semantic checkpoint.
2. Run a later pipeline pass that adds messages and grows only `messageIds`; do not serialize that ID-only change.
3. Restore the semantic checkpoint into a fresh state and run the pipeline over the later message list.

Assert that `startIndex`, `endIndex`, `anchorIndex`, `effectiveMessageIndices`, and the resulting pruned messages match the uninterrupted state. This proves that omitted ID-only checkpoints do not invalidate persisted compression boundaries.

- [ ] **Step 7: Run the lifecycle gate**

Run:

```bash
pnpm vitest run tests/stable-ids.test.ts tests/persistence.test.ts tests/index.test.ts tests/pipeline.test.ts
```

Expected: PASS for same-owner resume, fork with reset statistics, both tree directions, compaction followed by restart, and compression-block boundary reconstruction. If any expected ref or block result changes, stop and execute Task 5 instead of Task 3/4.

### Task 3: Stop context writes caused only by growing messages

**Files:**

- Modify: `tests/index.test.ts`

**Interfaces:**

- Consumes: the semantic fingerprint from Task 1.
- Produces: extension-level evidence that growing contexts do not append state without semantic changes.

- [ ] **Step 1: Replace the obsolete context-write expectation**

Replace `"persists one context mutation and skips an unchanged repeated pass"` with:

```typescript
it("skips state writes when growing context changes only message IDs", async () => {
  const { api, handlers, entries } = createMockApi();
  createExtension(api);
  const ctx = {
    sessionManager: {
      getSessionDir: () => "/tmp/test-session-dir",
      getSessionId: () => "session",
      getBranch: () => [] as unknown[],
    },
    getContextUsage: () => ({
      tokens: 20_000,
      contextWindow: 1_000_000,
      percent: 2,
    }),
    hasUI: false,
  };
  const start = handlers.get("session_start")?.[0];
  await (start as (...args: unknown[]) => Promise<void>)(
    { reason: "new" },
    ctx,
  );
  entries.length = 0;
  const context = handlers.get("context")?.[0];
  const first = [
    { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 },
  ];
  const second = [
    ...first,
    {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      timestamp: 2,
    },
  ];

  await (context as (...args: unknown[]) => Promise<unknown>)(
    { messages: first },
    ctx,
  );
  await (context as (...args: unknown[]) => Promise<unknown>)(
    { messages: second },
    ctx,
  );

  expect(entries).toHaveLength(0);
});
```

- [ ] **Step 2: Add a semantic nudge-write test**

Add:

```typescript
it("persists one context snapshot when a nudge anchor changes", async () => {
  const { api, handlers, entries } = createMockApi();
  createExtension(api);
  const ctx = {
    sessionManager: {
      getSessionDir: () => "/tmp/test-session-dir",
      getSessionId: () => "session",
      getBranch: () => [] as unknown[],
    },
    getContextUsage: () => ({
      tokens: 800_000,
      contextWindow: 1_000_000,
      percent: 80,
    }),
    hasUI: false,
  };
  await (
    handlers.get("session_start")?.[0] as (...args: unknown[]) => Promise<void>
  )({ reason: "new" }, ctx);
  entries.length = 0;
  const event = {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: 1,
      },
    ],
  };
  const context = handlers.get("context")?.[0] as (
    ...args: unknown[]
  ) => Promise<unknown>;

  await context(event, ctx);
  await context(event, ctx);

  expect(entries).toHaveLength(1);
  expect(entries[0]?.data).toMatchObject({
    messageIds: { byRawId: [["user:1:0", "m0001"]] },
    nudges: { contextLimitAnchors: ["user:1:0"] },
  });
});
```

- [ ] **Step 3: Run extension persistence tests**

Run:

```bash
pnpm vitest run tests/index.test.ts -t "state writes|context snapshot|persists command|compression once"
```

Expected: PASS with no `src/index.ts` production change.
The accepted projection path must not add an `agent_settled` persistence handler; that handler belongs only to Task 5's rejected-projection fallback.

### Task 4: Verify the accepted projection design

**Files:**

- Verify: `src/state/persistence.ts`
- Verify: `src/index.ts`
- Verify: persistence and lifecycle tests

**Interfaces:**

- Produces: the selected persistence design and evidence for approximately 56 semantic checkpoints in the historical corpus.

- [ ] **Step 1: Run all persistence/lifecycle tests**

Run:

```bash
pnpm vitest run tests/persistence.test.ts tests/stable-ids.test.ts tests/index.test.ts tests/pipeline.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run the historical analyzer**

Run the analyzer over the exact corpus:

```bash
SESSION_FILES=(
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-plan--/2026-08-02T19-24-55-646Z_019fc3ef-b9de-7ec9-ac8e-09929b9260e9.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-plan--/2026-08-02T20-28-27-872Z_019fc429-e560-7e9d-ac45-08298f1617fd.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-plan--/2026-08-03T13-39-40-042Z_019fc7d9-fd8a-794e-8fc2-343882ec4fce.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-19T20-08-51-180Z_01a01ba4-0ceb-7723-a1c4-57b90ba3a425.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-19T21-05-32-576Z_01a01bd7-f3a0-71e1-bdc0-9d67f1c3fd97.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-20T03-22-14-675Z_01a01d30-d513-71be-a344-79eef133737a.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-20T05-21-15-146Z_01a01d9d-c98a-772f-98f0-080bcca01c29.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-20T23-12-54-846Z_01a02172-ec3e-7518-9e34-96579374fda5.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-21T01-38-06-722Z_01a021f7-db02-7b9e-9a60-b0dc5ffc6f4d.jsonl"
  "/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-21T04-00-58-017Z_01a0227a-a4a1-7e8e-af49-33e6ec7b9bc7.jsonl"
)
pnpm run analyze:sessions -- "${SESSION_FILES[@]}"
```

Expected immutable history remains 692 states, while `semanticCheckpoints` remains 56. State clearly that this is a projection; historical files are not rewritten.

- [ ] **Step 3: Review serialized compatibility**

Run:

```bash
pnpm vitest run tests/persistence.test.ts -t "serializes only stable durable state|restores in place|repairs the message reference counter"
git diff --check
```

Expected: PASS; `DcpSnapshotV1` and serialized `messageIds` remain unchanged.

- [ ] **Step 4: Commit the accepted projection**

```bash
git add src/state/persistence.ts tests/persistence.test.ts tests/stable-ids.test.ts tests/index.test.ts tests/pipeline.test.ts
git commit -m "fix: skip message-id-only dcp snapshots"
```

### Task 5: Fallback only if deterministic reconstruction fails

**Files:**

- Revert Task 1 production change: `src/state/persistence.ts`
- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

**Interfaces:**

- Consumes: full existing fingerprint.
- Produces: one ordinary checkpoint at `agent_settled` instead of one per context pass.

Execute this task only when Task 2 produces a failing reference-stability case that cannot be corrected without persisting message IDs.

- [ ] **Step 1: Restore the full fingerprint**

Restore:

```typescript
export function durableStateFingerprint(
  state: SessionState,
): string | undefined {
  return JSON.stringify(serializeDcpSnapshot(state, "owner"));
}
```

Keep the failing lifecycle regression that rejected the projection.

- [ ] **Step 2: Move ordinary persistence to `agent_settled`**

Remove the unconditional `persistIfChanged()` call at the end of the `context` handler. Register the fallback alongside the other top-level lifecycle handlers:

```typescript
pi.on("agent_settled", async () => {
  persistIfChanged();
});
```

Keep command, compression completion, compaction, shutdown, start, and tree persistence unchanged.

- [ ] **Step 3: Replace the growing-context test expectation**

Assert that `handlers.get("agent_settled")` contains exactly one handler. After two growing context calls, assert zero entries; invoke the registered `agent_settled` handler and assert one full snapshot containing the latest `messageIds.byRawId` and `nextRefIndex`. Invoke it again and assert the count remains one. Also assert that a semantic mutation still persists once before `agent_settled` and does not duplicate at settlement.

- [ ] **Step 4: Run the fallback lifecycle suite**

Run:

```bash
pnpm vitest run tests/persistence.test.ts tests/stable-ids.test.ts tests/index.test.ts tests/pipeline.test.ts
pnpm typecheck
git diff --check
```

Expected: all PASS, including the lifecycle regression that rejected the projection.

- [ ] **Step 5: Commit the fallback instead of Task 4's commit**

```bash
git add src/index.ts src/state/persistence.ts tests/index.test.ts tests/persistence.test.ts tests/stable-ids.test.ts tests/pipeline.test.ts
git commit -m "fix: checkpoint dcp state after settled agent runs"
```
