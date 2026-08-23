# Pi-DCP Session Evidence Report

**Date:** 2026-08-22
**Scope:** Exact ten-session corpus specified for Phase 1; Pi v0.83.0 loader behavior; current DCP configuration metadata.

## Corpus baseline

The analyzer was run against the ten explicit session paths, without a glob. It reported:

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

The categories are distinct: an exact duplicate has identical serialized DCP state; a message-ID-only transition changes only `messageIds`; a semantic checkpoint changes other DCP state.

### Duplicate-writer evidence

All 42 exact duplicates occur in `2026-08-19T20:08` as adjacent, parent-linked pairs with 1–4 ms deltas. Under the current `persistIfChanged()` logic, identical adjacent snapshots written as linked entries at that cadence are evidence of two independent DCP state closures writing the same state.

The first exact pair has source-state ordinal 36. Its 42 transitions are adjacent and parent-linked, with 1–4 ms deltas.

## Pi loader and configuration findings

Pi v0.83.0 `ResourceLoader.mergePaths()` resolves paths and deduplicates their `canonicalizePath()` values. `canonicalizePath()` uses `realpathSync`, so one physical path referenced more than once, including through symlinks, is loaded once. This excludes one canonical path as the explanation for concurrent writers.

Separate physical DCP copies remain separate load paths and create independent extension closures. Reload emits `session_shutdown`, reloads resources, replaces the old runner, and then emits `session_start` on the replacement; this sequential lifecycle is not a concurrent duplicate-writer explanation, and the reload path itself does not call `runner.invalidate()`. DCP registers the `compress` tool during `session_start`; `registerDcpCommands(...)` occurs during extension construction. The load-time conflict scan therefore precedes this runtime tool registration.

Current filtered metadata is not historical proof: `~/.pi/agent` resolves to `/Users/lanh/Developer/dotfiles/configs/pi`; its `packages` list contains no `pi-dcp` entry, while the package-cache dependency is `@pi-vault/pi-dcp: ^0.5.0`. Neither inspected project has a `.pi/settings.json` result to report. Current configuration and package-cache contents cannot reconstruct the historical CLI `-e` flags or the extension-source pair used by the August sessions. The exact historical source-path pair is therefore unresolved.

## Confirmed DCP defects

### Message-ID snapshot amplification

`serializeDcpSnapshot()` persists `messageIds.byRawId`, and `durableStateFingerprint()` fingerprints that snapshot. The message-ID map grows as messages are assigned references, so the 594 message-ID-only transitions demonstrate confirmed snapshot amplification. This is distinct from the 42 exact duplicate transitions and does not classify those exact pairs as ordinary changed-state writes.

### Orphan message-ID stripping

`stripHallucinationsFromString()` removes a lone opening `<dcp-message-id>` tag but does not consume its following unclosed content. An orphan message ID can therefore remain and later be re-injected. This remains a confirmed DCP defect.

## Informational external events

Provider failures, malformed model tool markup, idle gaps, and user aborts are external informational events. They are not evidence of a DCP persistence or duplicate-writer defect.

## Phase 1 recommendation

Do not add a Phase 1 production guard or runtime tracing. The corpus establishes duplicate runtime writers, while the historical pair of source paths remains unresolved; Pi v0.83.0 behavior excludes a single canonical path and ordinary reload. Preserve this baseline for a later, targeted source-path investigation.
