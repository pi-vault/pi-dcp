# Pi-DCP Bug Analysis Report

**Date:** 2026-08-22
**Scope:** `pi-dcp` codebase (v0.5.0) + 10 provided session logs from `pi-plan` and `pi-subagents`
**Conclusion:** Multiple real bugs found. The most severe is a **91% redundant-write leak** in session state persistence.

---

## TL;DR

| Severity  | Bug                                                                                          | Impact                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 🔴 High   | `persistIfChanged` writes redundant state on every context event                             | Session files bloated by 22–72% with redundant `pi-dcp-state` entries; **91% of all writes are pure no-ops** |
| 🟠 Medium | `durableStateFingerprint` includes `byRawId` so the dedup check never matches                | Root cause of the leak above                                                                                 |
| 🟠 Medium | `stripHallucinationsFromString` leaves orphaned content when a tag is unclosed               | Hallucinated message IDs (`m0001`) can leak back into model context                                          |
| 🟠 Medium | Glob implementation does not support character classes (`[abc]`)                             | Documented as "glob" but doesn't match fnmatch/picomatch semantics                                           |
| � Low     | Nudge anchors never pruned from `Set` after message loss                                     | Known TODO — leaks memory in long sessions with compactions                                                  |
| 🟡 Low    | `session_compact` clears `prune.tools` but keeps cumulative `stats`                          | Stats become misleading after compaction                                                                     |
| � Low     | Stripping happens 3× per message (pipeline + message_end + inject)                           | Wasted work, but correct                                                                                     |
| 🔵 Info   | Model emits malformed tool-call markup in 7+ consecutive attempts (session 2026-08-19T20:08) | Model-side issue, not DCP                                                                                    |
| 🔵 Info   | Long pauses (>5min) between events                                                           | User/system idle, not a bug                                                                                  |
| 🔵 Info   | Sessions ending in `sr=aborted` mid-task                                                     | User-initiated interruption, normal Pi behavior                                                              |

---

## 1. The Big One: `pi-dcp-state` Session Log Leakage

### Evidence

Across all 10 user-provided session logs (pi-plan + pi-subagents, Aug 2 – Aug 21 2026):

| Metric                                                        | Value                                              |
| ------------------------------------------------------------- | -------------------------------------------------- |
| Total `pi-dcp-state` entries written                          | **692**                                            |
| Entries that contain a real change to `stats` or `pruneTools` | **56**                                             |
| **Redundant writes**                                          | **636 (91%)**                                      |
| Total session-file bytes                                      | 24,216,730 (~24 MB)                                |
| Bytes consumed by `pi-dcp-state` entries                      | 5,451,141 (~5.4 MB, **22%** of all session files)  |
| Worst case (single session 2026-08-20T05:21)                  | 143 states, 2.45 MB = **72%** of that session file |

Per-session breakdown:

| Session                         | Duration | Tool calls | dcp-state writes | Redundant |
| ------------------------------- | -------- | ---------: | ---------------: | --------: |
| 2026-08-02T19:24 (pi-plan)      | 1h 03m   |         96 |               79 |  74 (94%) |
| 2026-08-02T20:28 (pi-plan)      | 2h 34m   |        111 |              106 |  99 (93%) |
| 2026-08-03T13:39 (pi-plan)      | 54m      |         85 |               39 |  36 (92%) |
| 2026-08-19T20:08 (pi-subagents) | 56m      |         75 |              119 | 118 (99%) |
| 2026-08-19T21:05 (pi-subagents) | 6h 16m   |         62 |               42 |  39 (93%) |
| 2026-08-20T03:22 (pi-subagents) | 1h 59m   |         85 |               49 |  47 (96%) |
| 2026-08-20T05:21 (pi-subagents) | 17h 40m  |        153 |              143 | 114 (80%) |
| 2026-08-20T23:12 (pi-subagents) | 2h 25m   |         73 |               51 |  47 (92%) |
| 2026-08-21T01:38 (pi-subagents) | 1h 46m   |         60 |               51 |  50 (98%) |
| 2026-08-21T04:00 (pi-subagents) | 4m       |         20 |               13 |  12 (92%) |

This is also a **regression**. All 45 sessions from **before** 2026-08-02 in the same projects have **0** `pi-dcp-state` entries. The leak started on the `phase-4-native-session-state` branch (merged via PR #49 / commit `42a575f` on 2026-07-29).

### Root cause

`src/index.ts:110-122` — `persistIfChanged`:

```typescript
function persistIfChanged(force = false): void {
  const snapshot = serializeDcpSnapshot(state);
  if (!snapshot) return;
  const fingerprint = durableStateFingerprint(state);
  if (!fingerprint) return;
  if (!force && fingerprint === lastPersistedFingerprint) return;
  try {
    pi.appendEntry("pi-dcp-state", snapshot);
    lastPersistedFingerprint = fingerprint;
  } catch (error) { … }
}
```

This is called **unconditionally** at the end of the `context` handler (`src/index.ts:433`). Every context pass fires this. The fingerprint comparison is supposed to dedupe, but…

`src/state/persistence.ts:71-73` — `durableStateFingerprint`:

```typescript
export function durableStateFingerprint(
  state: SessionState,
): string | undefined {
  return JSON.stringify(serializeDcpSnapshot(state, "owner"));
}
```

`src/state/persistence.ts:53-68` — `serializeDcpSnapshot` includes:

```typescript
messageIds: {
  byRawId: sorted(state.messageIds.byRawId, ([a], [b]) => a.localeCompare(b)),
  nextRefIndex: state.messageIds.nextRefIndex,
},
```

So the fingerprint is `JSON.stringify` of a snapshot that **includes the full `byRawId` map**, which is appended to on every context pass (`src/messages/inject.ts:46-49`). Each new tool call, each new assistant turn → new entry in `byRawId` → fingerprint changes → new `pi-dcp-state` written → almost always no real `stats`/`pruneTools` change.

The `lastPersistedFingerprint === fingerprint` check works in unit tests (`tests/index.test.ts:492` "persists one context mutation and skips an unchanged repeated pass") because the test calls context twice with the **same** message array. In real usage the message array always grows, so the check never matches.

### Fix (smallest viable)

Either:

1. **Don't include `byRawId` in the fingerprint** — fingerprint should reflect _durable user-visible state_ (stats, pruneTools, blocks, mode, permission), not the transient message-id cache. `byRawId` is already rebuildable from current messages on session restore.
2. **Or only call `persistIfChanged()` when something actually changed** (e.g. when `strategyResult.pruned > 0`, when a compress block is created/touched, or on lifecycle events). The current call site at the end of every `context` pass is wrong.

Option 1 is the lazier one-liner: drop `byRawId` from the snapshot used by the fingerprint (keep it in the actual persisted snapshot). Option 2 is more correct but touches more callers.

### Secondary symptoms of the same bug

- `lastCompaction` is set once at session start but the dcp-state is written every context pass — no diff, no leak, but it confirms the fingerprint never matches.
- The `lifetime` command scans every JSONL in the session dir (`src/state/persistence.ts:330-358`). With session files 22–72% dcp-state, this scan becomes significantly slower on every `dcp:lifetime` invocation. Not blocking but compounds with the leak.

---

## 2. Hallucination Stripping Leaves Orphaned Content

### Evidence

Tested `src/messages/strip.ts` `stripHallucinationsFromString`:

| Input                                          | Output          | Expected   |
| ---------------------------------------------- | --------------- | ---------- |
| `"hello <dcp-message-id>m0001"`                | `"hello m0001"` | `"hello "` |
| `"<dcp-message-id>m0001<dcp-message-id>m0002"` | `"m0001m0002"`  | `""`       |

### Root cause

`src/messages/strip.ts:6-15`:

```typescript
const DCP_COMPLETE_PAIR = /<dcp[-\w]*(?:\s[^>]*)?>[\s\S]*?<\/dcp[-\w]*>/gi;
const DCP_TRUNCATED_PAIR = /<dcp[-\w]*(?:\s[^>]*)?>[\s\S]*?<\/dcp[-\w]*/gi;
const DCP_UNPAIRED_TAG = /<\/?dcp[-\w]*(?:\s[^>]*)?>/gi;
const DCP_PARTIAL_TAG = /<\/?dcp[-\w]*(?:[^\S\n][^>\n]*)?$/gim;
```

If the model produces an unclosed `<dcp-message-id>m0001` (no closing tag at all), `DCP_COMPLETE_PAIR` and `DCP_TRUNCATED_PAIR` both fail to match (they require `</dcp`). `DCP_UNPAIRED_TAG` strips just `<dcp-message-id>`, leaving the content `m0001` behind. `DCP_PARTIAL_TAG` is `$`-anchored so it only catches the end of a line.

### Impact

The orphaned `m0001` then gets injected **back into** a later `<dcp-message-id>m0001</dcp-message-id>` tag by `injectMessageIds` (because that key is now in `byRawId`). The model sees both versions and may emit `<dcp-message-id>m0001</dcp-message-id>` in its own output. Minor correctness bug, but the strip → re-inject cycle was supposed to be idempotent.

### Fix

One regex that matches a `<dcp-…>` open tag and consumes the rest of the _string_ (not just to the next `</dcp`), then trims trailing whitespace. ~3 lines.

```typescript
// ponytail: DCP_PARTIAL_TAG only matches end-of-line; mid-string unclosed tags orphan their content.
const DCP_ORPHANED_CONTENT = /<dcp[-\w]*(?:\s[^>]*)?>[^<]*$/gim;
```

Order after the existing rules so it doesn't double-strip.

---

## 3. Glob Implementation Skips Character Classes

### Evidence

```
matchesGlob("testa.ts", "test[abc].ts")  → false  (expected true)
matchesGlob("testc.ts", "test[abc].ts")  → false  (expected true)
```

### Root cause

`src/strategies/protected-patterns.ts:18-41` — the special-character class only escapes `[` and `]`. It never interprets them as a class.

```typescript
} else if (".+^${}()|[]\\".includes(c)) {
  result += "\\" + c;
  i += 1;
}
```

### Impact

Users configuring `protectedTools: ["todo[_-]*write"]` will not get the behavior they expect — every literal `[`/`]` is matched literally. This silently breaks protected-tool configs that use class syntax.

### Fix

Either escape `[`/`]` only when not part of a class, or document that the matcher does not support classes. The README says "glob patterns" without qualification, so users will assume fnmatch semantics. Cheapest correct fix: keep current behavior and add a one-line warning in `isToolNameProtected` if a pattern contains `[`.

---

## 4. Known TODO: Nudge Anchors Never Pruned

`src/messages/inject.ts:249`:

```typescript
// TODO: Stale anchors (keys not present in current messages) are never pruned from the Sets.
// In sessions with heavy compaction, Sets may grow over time. A future task should clean them
// up — e.g., after compaction by intersecting anchor sets with keys of surviving messages.
```

### Impact

Long sessions with multiple compactions accumulate orphan anchor keys. Not exercised in the provided logs (no session compacted), but it's a known leak. Will fire as soon as any of these sessions hit a compaction.

### Fix

One-line after the existing pipeline pruning (`src/pipeline.ts:48-50`):

```typescript
for (const anchors of Object.values(state.nudges)) {
  for (const key of anchors) if (!rawKeys.has(key)) anchors.delete(key);
}
```

(This is exactly what the TODO describes — the plumbing already exists.)

---

## 5. `session_compact` Clears `prune.tools` But Leaves Cumulative Stats

`src/index.ts:323-340`:

```typescript
pi.on("session_compact", async (_event, _ctx) => {
  state.prune.tools.clear();
  state.prune.messages.byMessageIndex.clear();
  state.prune.messages.blocksById.clear();
  state.prune.messages.activeBlockIds.clear();
  state.prune.messages.activeByAnchorIndex.clear();
  state.messageIds.byIndex.clear();
  state.compressionTiming.startTimes.clear();
  state.subAgentResultCache.clear();
  state.lastCompaction = Date.now();
  logger.info("dcp", "compaction detected, pruning state reset");
  persistIfChanged();
});
```

`stats` (totals) is intentionally preserved to keep lifetime accounting. But `prune.tools` is empty after compaction, while `stats.toolsPruned` and `stats.totalPruneTokens` still reflect the pre-compaction count. `dcp:context` will then display:

```
Pruned tool calls: 0
Tools pruned: 5   ← inconsistent
```

Not a crash, but the displayed numbers contradict each other after the first compaction.

### Fix

Either reset the cumulative stats on compaction (clean but loses accounting), or add a `lifetimePruned` field that's preserved across compaction and a `currentPruned` field that gets reset (more correct). Cheapest fix: split `stats` into `lifetimeStats` (preserved) and `currentStats` (reset on compaction), and let `dcp:context` display both.

---

## 6. Stripping Is Done Three Times Per Message

Tracing one user/assistant message through the pipeline:

| Location                                                | Trigger                                  | Cost   |
| ------------------------------------------------------- | ---------------------------------------- | ------ |
| `src/messages/strip.ts:32` `stripHallucinations`        | Every pipeline pass, every message       | O(N×L) |
| `src/messages/inject.ts:84-85` `mapText` + `appendText` | Every pipeline pass, user/assistant only | O(N×L) |
| `src/index.ts:345-352` `message_end` handler            | Once per message, before pipeline        | O(L)   |

The `stripHallucinations` in step 0 of the pipeline runs first; `injectMessageIds` then strips again right before re-injecting; `message_end` strips before the pipeline even sees the message. Three strip passes; functionally only one is needed (the `message_end` one) because the result is persisted.

### Fix

Drop the `stripHallucinations` call from `pipeline.ts:31` and the `mapText(msg, stripHallucinationsFromString)` in `injectMessageIds:84`. The `message_end` handler is sufficient. Saves ~2N strip ops per context pass.

---

## 7. Findings That Are _Not_ Bugs

For completeness, the following appeared suspicious at first glance but are correct:

- **`fetch failed` followed by `Aborted after 1 retry attempt`** (session 2026-08-19T21:05 around L137-138): real network failure to upstream LLM API. Not a DCP bug; DCP handled the abort cleanly and persisted state.
- **3-hour gap between tool call and tool result** (L134→L135): user/system was idle, Pi suspended the session. Not a leak.
- **Model emits 7 consecutive "MiniMax returned malformed tool-call markup" errors** (session 2026-08-19T20:08 around L71-116): model-side issue, not DCP. The agent's retry behavior is correct.
- **`Plan mode blocks mutating bash command`** (session 2026-08-03 L14, L30, L71): pi-plan correctly blocks `git tag`, `git show` etc. while in plan mode. Working as intended.
- **Long pauses (>5 min) between events** in 9 of 10 sessions: user idle time. Not a leak.
- **Sessions ending with `sr=aborted`** (3 sessions): user-initiated interruption, normal Pi behavior. DCP's `session_shutdown` persists state correctly afterwards.

---

## Recommended Fix Priority

1. **Fix `durableStateFingerprint` to exclude `byRawId`** — 5-line patch, removes 91% of session-file bloat.
2. **Fix `stripHallucinationsFromString` for unclosed tags** — 3-line patch, prevents model-context pollution.
3. **Drop redundant strip passes** in pipeline/inject — small diff, cleaner code.
4. **Add the nudge-anchor cleanup** that's already a TODO — 1-line, prevents future leak.
5. **Fix `session_compact` stats inconsistency** — small, mostly cosmetic.
6. **Document or implement glob character classes** — one-line `warn()` is enough for now.

None of these require API changes, new dependencies, or migration. The biggest one (#1) is the right size for a TDD red/green cycle: write a test that asserts "two consecutive context passes with growing messages produce only one `pi-dcp-state` entry", watch it fail, then drop `byRawId` from the fingerprint.

---

## Verification

- All 446 existing tests pass (`pnpm test`, Node 24.15.0).
- The reported leakage is observable directly from the session logs the user supplied (no code instrumentation needed).
- The strip bug is reproducible with the 3 test cases above.
- The glob bug is reproducible with `matchesGlob("testa.ts", "test[abc].ts")`.
