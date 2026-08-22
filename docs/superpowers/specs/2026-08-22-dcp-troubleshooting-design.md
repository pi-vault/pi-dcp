# DCP Session Reliability Troubleshooting Design

**Date:** 2026-08-22  
**Status:** Approved design  
**Scope:** `pi-dcp` persistence, sanitization, protected-pattern matching, anchor reconciliation, and statistics wording

## Goal

Troubleshoot and correct the findings in `analysis-report.md` using the ten supplied Pi session logs and Pi's native extension/session implementation as evidence. Reduce unnecessary `pi-dcp-state` writes without weakening resume, fork, tree, compaction, or message-reference behavior. Correct malformed DCP-tag handling and align the remaining configuration and operator-facing behavior with explicit contracts.

## References

Pi lifecycle and persistence behavior is read from `/Users/lanh/Developer/pi-packages/pi`, especially:

- `packages/coding-agent/docs/extensions.md`
- `packages/coding-agent/docs/session-format.md`
- `packages/coding-agent/docs/compaction.md`
- `packages/coding-agent/src/core/agent-session.ts`
- `packages/coding-agent/src/core/session-manager.ts`
- `packages/coding-agent/src/core/extensions/types.ts`

Pi is a reference only. This work does not modify that repository.

The evidence corpus consists of the ten JSONL files named in Appendix A. They remain external and read-only.

## Corrected Baseline

Analysis of only the ten named files produces this baseline:

- 692 `pi-dcp-state` entries.
- Approximately 5.45 MB of DCP state.
- Approximately 51% of the files' combined size.
- 594 transitions where only `messageIds` changed.
- 42 byte-identical adjacent state transitions, all in one session and typically separated by 1–3 ms.
- 56 projected semantic checkpoints when `messageIds`-only and exact-duplicate transitions are excluded.
- No Pi compaction entries.

The earlier 22% figure included files outside the exact ten-file corpus. The earlier 91% figure usefully identified amplification but conflated message-ID-only snapshots with byte-identical snapshots. The corrected report will separate those classes.

## Finding Classification

### Confirmed defects

1. Full snapshots are appended for ordinary message-reference growth, causing large synchronous session writes.
2. An orphan `<dcp-message-id>` can leave a bounded `mNNNN` payload in assistant text.

### Unresolved cause

The 42 byte-identical snapshot pairs strongly suggest two DCP extension instances handling the same events. This must be reproduced or traced before a production guard is added.

### Contract improvements

1. Protected patterns should use Node's native glob semantics, including character classes.
2. Operator output should distinguish active-context counts from cumulative-session totals.

### Already handled or overstated findings

1. `src/pipeline.ts` already intersects nudge anchors with current raw message keys. The work is regression coverage and removal of the stale TODO, not another cleanup implementation.
2. Cumulative statistics surviving compaction are intentional and support lifetime totals. No snapshot schema change is required.
3. Sanitization occurs at different lifecycle boundaries. Only the redundant pipeline pass will be removed; persisted-output and injection-boundary protection remain.
4. Provider errors, malformed MiniMax tool markup, idle gaps, and user aborts are not DCP defects unless a deterministic DCP correlation is found.

## Architecture

### Evidence classes

Troubleshooting preserves four separate evidence classes:

- exact duplicate snapshots,
- message-ID-only snapshots,
- other durable-state changes,
- external provider/user control-flow events.

The analyzer must not label the first two classes identically. It must also count malformed JSONL lines, tool-call/result mismatches, stop reasons, errors, and compactions.

### Pi custom-entry behavior

Pi's `appendEntry()` creates a custom tree entry, advances the active leaf, and synchronously persists the complete entry once the session file is active. Custom entries do not enter LLM context. Avoiding unnecessary writes therefore reduces disk use, synchronous I/O, and tree noise without changing model-visible messages.

### Snapshot and fingerprint separation

`serializeDcpSnapshot()` remains the complete snapshot-v1 serializer. Saved snapshots continue to contain `messageIds.byRawId` and `messageIds.nextRefIndex`.

`durableStateFingerprint()` will compare a projection that excludes the entire `messageIds` object. Excluding only `byRawId` is insufficient because `nextRefIndex` changes at the same time.

When another durable field changes, the full saved snapshot captures the current message-ID map. Missing message-ID-only checkpoints are acceptable only if focused tests prove deterministic reconstruction across all supported lifecycle transitions.

### Persistence fallback gate

Before accepting the projection design, tests must cover:

- growing contexts,
- same-owner resume,
- fork with reset statistics,
- tree navigation in both directions,
- compaction followed by restart,
- compression blocks with stable message-key boundaries.

If any test shows changed message references, the projection approach is rejected. The fallback is one message-ID checkpoint at `agent_settled`, not snapshot v2 or delta replay. This reduces writes to once per completed agent run while preserving the existing snapshot contract.

### Duplicate-instance diagnosis

Temporary diagnostics will include process ID, random extension-instance ID, session ID, persistence callsite, force flag, and semantic fingerprint. Reproduction covers:

1. one DCP extension path,
2. one canonical path listed twice,
3. two distinct paths containing separate DCP copies,
4. reload and session replacement.

If duplicate configuration or package discovery is confirmed, correct or document that setup and use Pi's conflict diagnostics where available. Add a global singleton guard only if supported single-instance configuration still loads duplicate runtime instances and Pi cannot prevent it.

## Component Design

### Persistence

**Files:** `src/state/persistence.ts`, `src/index.ts`, `tests/persistence.test.ts`, `tests/index.test.ts`

- Keep snapshot v1 unchanged.
- Fingerprint every durable field except `messageIds`.
- Preserve forced writes for missing, invalid, inherited, or branch-specific state.
- Preserve explicit mutation writes for commands, compression completion, compaction, and shutdown.
- Add `agent_settled` persistence only if required by the reconstruction gate.

### DCP-tag sanitization

**Files:** `src/messages/strip.ts`, `src/messages/inject.ts`, `src/pipeline.ts`, `tests/strip.test.ts`, `tests/message-end.test.ts`, `tests/pipeline.test.ts`

The malformed-input contract is deliberately narrow:

- Complete and currently supported truncated DCP pairs remain removable.
- An orphan `<dcp-message-id>` consumes only an immediately following valid `m\d{4,}` reference.
- Text following that bounded reference remains.
- Arbitrary text following an orphan opening tag remains because it cannot safely be classified as generated payload.
- Stripping is idempotent.

Examples:

```text
hello <dcp-message-id>m0001
=> hello

hello <dcp-message-id>m0001 continued prose
=> hello  continued prose

hello <dcp-message-id>discussion
=> hello discussion
```

Two boundaries remain:

1. `message_end` cleans new assistant output before Pi persists it.
2. `injectMessageIds` cleans injectable restored/user/assistant content immediately before adding one canonical tag.

The separate pipeline-wide assistant stripping pass is removed after tests prove the injection boundary preserves current behavior.

### Protected-pattern matching

**Files:** `src/strategies/protected-patterns.ts`, `tests/protected-patterns.test.ts`, `src/config-schema.ts`, `README.md`

- Replace the custom regex compiler with `node:path.matchesGlob`.
- Evaluate every configured pattern rather than only patterns containing `*` or `?`.
- Preserve exact, `*`, `**`, `?`, separator, and regex-literal behavior.
- Add character-class and malformed-pattern tests.
- Document Node native glob semantics.
- Add no dependency; Node 24.15 is already required.

Malformed untrusted patterns must safely fail validation or behave as non-matches; they must not crash a context pass.

### Nudge-anchor reconciliation

**Files:** `src/pipeline.ts`, `src/messages/inject.ts`, `tests/pipeline.test.ts`

- Keep the current `rawKeys` intersection as the implementation.
- Prove stale anchors disappear while surviving anchors remain.
- Remove the obsolete TODO.
- Do not add cleanup directly to `session_compact`, where surviving raw keys are not yet available.

### Compaction statistics

**Files:** `src/commands/context.ts`, `src/commands/stats.ts`, associated command tests

Keep cumulative counters and snapshot v1 unchanged. Clarify labels:

- `Pruned tool calls` becomes `Currently pruned tool calls`.
- `Tools pruned` becomes `Tools pruned this session`.
- Token-saving text explicitly states cumulative scope where necessary.

Tests cover output before and after compaction.

### Report and diagnostics

Correct `analysis-report.md` to:

- use only the exact ten-file corpus,
- separate exact duplicates from message-ID-only transitions,
- remove claims contradicted by current code,
- describe unsupported findings as investigation results rather than bugs.

Large logs are not copied into the repository. Synthetic regression data and reproducible commands are sufficient.

## Troubleshooting Sequence

### Phase A: Baseline

Run the read-only analyzer before production edits. Save corrected aggregate and per-session results in the report.

### Phase B: Persistence red/green gate

1. Add failing lifecycle and growing-context tests.
2. Implement only the fingerprint projection.
3. Run focused tests.
4. Accept the projection only if all reference-stability tests pass.
5. Otherwise restore the previous fingerprint and implement the `agent_settled` fallback.

Acceptance criteria:

- ordinary context growth produces no write after the baseline,
- each durable mutation produces exactly one write,
- the modeled corpus projects approximately 56 semantic writes instead of 692,
- snapshot v1 round-trips unchanged,
- message references remain stable across tested lifecycle transitions.

### Phase C: Duplicate-instance gate

Reproduce the four extension-loading configurations with temporary diagnostics. Commit only a justified regression, diagnostic, documentation change, or configuration fix. Remove temporary tracing before completion.

### Phase D: Independent behavior fixes

Run separate red/green cycles for sanitization, lifecycle strip boundaries, native globs, anchors, and command wording.

### Phase E: Stop/abort triage

Use Pi event semantics to classify malformed model output, provider failures, aborts, and idle gaps. Verify there are no unmatched DCP persistence operations or partial DCP mutations around those events. Make no DCP code change without deterministic reproduction.

## Error Handling

- `appendEntry` failures remain non-fatal and leave state eligible for a later retry.
- Malformed glob configuration cannot crash context processing.
- Sanitization preserves ambiguous prose rather than over-deleting it.
- JSONL analysis skips malformed lines, records their count, and continues.
- Temporary diagnostics contain no message content or secrets.

## Verification

1. Run focused tests for every changed module.
2. Run `pnpm check`.
3. Run `pnpm run pack:verify`.
4. Re-run the ten-log analyzer and compare the modeled write projection.
5. Optionally run a local Pi smoke session with multiple tool iterations, resume, tree switching, manual compaction, and clean shutdown.

No work is complete until the relevant command output is captured. If an optional smoke test is skipped, the remaining lifecycle risk must be stated.

## Scope Boundaries

This work does not:

- modify the Pi reference repository,
- add dependencies,
- introduce snapshot v2,
- copy or commit external JSONL files,
- reset cumulative statistics at compaction,
- duplicate existing anchor cleanup,
- add a singleton guard without reproduction,
- fix provider/model malformed tool calls inside DCP,
- refactor unrelated compression or pruning behavior.

## Rollback

Each behavioral area is independently revertible:

- fingerprint projection,
- sanitization grammar and pass removal,
- native glob semantics,
- command wording.

Snapshot v1 compatibility requires no migration rollback.

## Appendix A: Session Evidence

### pi-plan

- `/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-plan--/2026-08-02T19-24-55-646Z_019fc3ef-b9de-7ec9-ac8e-09929b9260e9.jsonl`
- `/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-plan--/2026-08-02T20-28-27-872Z_019fc429-e560-7e9d-ac45-08298f1617fd.jsonl`
- `/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-plan--/2026-08-03T13-39-40-042Z_019fc7d9-fd8a-794e-8fc2-343882ec4fce.jsonl`

### pi-subagents

- `/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-19T20-08-51-180Z_01a01ba4-0ceb-7723-a1c4-57b90ba3a425.jsonl`
- `/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-19T21-05-32-576Z_01a01bd7-f3a0-71e1-bdc0-9d67f1c3fd97.jsonl`
- `/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-20T03-22-14-675Z_01a01d30-d513-71be-a344-79eef133737a.jsonl`
- `/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-20T05-21-15-146Z_01a01d9d-c98a-772f-98f0-080bcca01c29.jsonl`
- `/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-20T23-12-54-846Z_01a02172-ec3e-7518-9e34-96579374fda5.jsonl`
- `/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-21T01-38-06-722Z_01a021f7-db02-7b9e-9a60-b0dc5ffc6f4d.jsonl`
- `/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/2026-08-21T04-00-58-017Z_01a0227a-a4a1-7e8e-af49-33e6ec7b9bc7.jsonl`
