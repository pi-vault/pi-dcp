# Pi-DCP Session Evidence Report

**Date:** 2026-08-23
**Scope:** Final verification of the Phase 1–5 changes against the exact ten-session corpus from Phase 1, plus current Pi and OpenCode reference evidence.

## Verification boundary

All repository checks used Node.js `v24.15.0` through `mise exec node@24.15.0`; pnpm was `11.22.0`. The current Pi host was `0.84.2` at commit `cec3a91c029e453c4bebdd02d84335a0f52503d7`. The historical JSONL files were read only; none were rewritten.

The exact corpus was analyzed with:

```text
mise exec node@24.15.0 -- pnpm run analyze:sessions -- <the ten explicit JSONL paths>
```

## Historical corpus baseline

The analyzer reported these historical, pre-fix measurements:

| Metric | Value |
| --- | ---: |
| Files | 10 |
| Session-file bytes | 10,740,340 |
| `pi-dcp-state` bytes | 5,451,357 (approximately 50.8%) |
| `pi-dcp-state` entries | 692 |
| Exact duplicate transitions | 42 |
| Message-ID-only transitions | 594 |
| Semantic checkpoints | 56 |
| Compactions | 0 |
| Malformed lines | 0 |
| Unmatched tool calls/results | 0 / 0 |
| Assistant errors | 15 |
| Stop reasons | `toolUse: 550`, `stop: 82`, `aborted: 5`, `error: 10` |

These are historical analysis values and projection inputs, not post-fix runtime measurements. The accepted durable fingerprint projects 56 semantic checkpoints from this corpus because message-ID bookkeeping no longer changes the persistence comparison. The 42 exact duplicate transitions remain a separate duplicate-writer finding and are not claimed to be removed by that projection.

### Duplicate-writer diagnosis

All 42 exact duplicates occur in the `2026-08-19T20:08` session as adjacent, parent-linked pairs with 1–4 ms deltas. This is evidence of two independent DCP state closures writing the same state. Pi's loader canonicalizes and deduplicates one physical extension path, so the historical pair of physical source paths remains unresolved; separate physical copies remain a plausible explanation. No duplicate-cleanup mechanism, snapshot-schema change, or runtime tracing was added.

## Phase outcomes

### Fixed state-write amplification

`serializeDcpSnapshot()` remains snapshot-v1 and still serializes `messageIds` for restoration. `durableStateFingerprint()` now omits only `messageIds` when deciding whether a durable custom entry is semantically new. Persistence tests cover ID-only changes being ignored and semantic state changes still changing the fingerprint; stable-ID and lifecycle tests cover reconstruction after resume, branches, and compaction.

This is an accepted persistence comparison change, not an observed reduction measured by rewriting or replaying the historical corpus.

### Duplicate-writer behavior remains a historical finding

The 42 exact duplicate transitions are not the same as the 594 message-ID-only transitions. The Phase 5 fingerprint handles semantic write amplification but does not claim to identify or remove multiple extension instances. Source-path ownership remains a follow-up investigation.

### Fixed orphan message-ID stripping

Sanitization now removes bounded orphan message-ID suffixes and the observed `dpc`/`dcp` transposition before canonical injection, while retaining the existing complete-pair, truncated-pair, unpaired-tag, and partial-tag handling. Focused strip, pipeline, message-end, injection, and end-to-end pipeline tests passed.

### Native glob contract is intentional

Protected file paths and tool names use Node `path.posix.matchesGlob` semantics, including `*`, `**`, `?`, and character classes. The compatibility fallback preserves the previous leading-dot wildcard behavior. The same matcher is used by compression, deduplication, purge-error, sweep, and protected-content paths; focused protected-pattern and strategy tests passed.

### Anchor cleanup is covered by tests

The pipeline removes nudge anchors whose raw message keys are no longer present while preserving anchors for surviving messages. The pipeline test covers both stale-anchor removal and surviving-anchor retention.

### Compaction statistics wording changed without a schema change

Context and statistics command labels now distinguish current, per-session, and cumulative values. This is display wording only; no DCP snapshot-v1 field or persistence schema was changed.

### External provider and abort events are not DCP fixes

Provider failures, malformed model tool markup outside DCP's bounded sanitizer contract, idle gaps, and user aborts remain informational external events. They are not evidence that DCP should change its persistence or duplicate-writer behavior.

## Phase 6 command evidence

| Check | Result |
| --- | --- |
| Focused analysis/command tests | 3 files, 11 tests passed |
| Focused glob/sanitization tests | 7 files, 120 tests passed |
| Focused persistence/lifecycle tests | 3 files, 60 tests passed |
| `mise exec node@24.15.0 -- pnpm check` | format passed; typecheck passed; 51 files and 482 tests passed; 58 pre-existing lint warnings remained |
| Disposable-cache `pack:verify` | passed; 48 package files verified |
| History-aware `c173923..HEAD` audit | diff check passed; no temporary repository artifacts; no Pi reference files changed |
| Exact ten-file historical analyzer | totals above reproduced exactly |
| Snapshot/schema and dependency review | snapshot-v1 unchanged; no new dependency added |

## Current host references

Pi `0.84.2` applies `transformContext` before LLM conversion, emits `session_compact` and `session_tree` at their lifecycle transitions, appends session messages through its session manager, and emits `agent_settled` after work settles. Those host behaviors support the Phase 5 reconstruction tests.

OpenCode DCP at commit `11f6517780a502512a3467645074be447cb0369e` uses host-stable message IDs, synchronizes compression relationships from current messages, and persists sidecar state. It is a reference for identity and reconstruction behavior only; Pi-DCP does not copy the sidecar persistence model or change snapshot-v1 fields.

## Optional Pi lifecycle smoke test

Skipped as optional: this non-interactive verification run had no provider-backed interactive session available for a disposable prompt/resume/tree/compact sequence. Residual risk is limited to live extension loading and observed JSONL lifecycle ordering; deterministic lifecycle tests, Pi source inspection, package verification, and the historical analyzer all ran. No normal Pi settings, external sessions, or repository artifacts were modified.

`CHANGELOG.md` was intentionally left untouched because this is an internal verification phase, not a release phase.
