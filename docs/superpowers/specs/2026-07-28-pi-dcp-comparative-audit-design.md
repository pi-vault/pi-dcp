# Pi DCP Comparative Audit Summary

Date: 2026-07-28

Compared repositories:

- Current: `/Users/lanh/Developer/pi-vault/pi-dcp`
- Pi core reference: `/Users/lanh/Developer/pi-packages/pi` (`8eef62ed`, `@earendil-works/pi-coding-agent` 0.82.0)
- Upstream reference: `/Users/lanh/Developer/pi-packages/opencode-dynamic-context-pruning` (`85b6f5c`, 3.1.14)
- Pi port: `/Users/lanh/Developer/pi-packages/Davidcreador-pi-dcp` (`7ae24be9`)
- Pi port: `/Users/lanh/Developer/pi-packages/complexthings-pi-dcp` (`75e04cb`)

## Executive Summary

The current implementation has the broadest Pi-specific feature surface and the strongest locally verified test coverage. It also has correctness gaps that matter more than feature breadth: session state is not isolated per Pi session, compression state is not durable, compression token totals are currently zero, and nested compression is only represented in types rather than fully applied.

The Pi reference changes the recommended design. Pi 0.80.3, the version installed by this repository, already provides `pi.appendEntry()`, `sessionManager.getBranch()`, `sessionManager.getSessionId()`, and `session_tree`. These APIs are intended for branch-aware extension state and remove the need for a second session-persistence system.

The current checkout passed 368 tests and TypeScript typechecking at audit time. Lint exits successfully but reports 88 existing warnings. The comparison checkouts were not runnable in this environment because upstream lacked its local `tsx`/TypeScript tooling, Davidcreador lacked installed peer/runtime packages, and complexthings requires Bun.

## Comparison

| Area                | Current implementation                                                                | Pi core constraint                                                             | Upstream OpenCode DCP                  | Davidcreador Pi DCP                   | complexthings Pi DCP                    |
| ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------- | --------------------------------------- |
| State persistence   | Shared `{sessionDir}/dcp/state.json`; compression blocks are omitted                  | Native append-only custom entries, branch IDs, and `session_tree`              | Versioned compression/pruning sidecar  | Atomic compression sidecar            | Custom session entries                  |
| Failed-call pruning | Replaces error output and leaves large failed inputs                                  | Tool calls/results have stable IDs; provider transform preserves pair validity | Purges failed inputs, preserves errors | Same behavior                         | Replaces error output                   |
| Dedup defaults      | Protects read/search/shell tools                                                      | Core tools are read, bash, edit, write, grep, find, ls                         | Protects mutation/orchestration tools  | Protects mutation/orchestration tools | Protects mutation/orchestration tools   |
| Compression         | Range/message modes, but token totals are zero and consumed blocks are never recorded | `toolCallId` is available at execution; session entries are stable             | Full nested block lifecycle            | Tool-output compression               | Session-entry compression               |
| Tool-pair repair    | Removes orphan results only                                                           | Pi synthesizes missing results before provider requests                        | Grouped message model                  | Tool-output-only model                | Bidirectional repair                    |
| Configuration       | TypeBox schema and generated JSON schema                                              | Project cwd/trust are available in extension context                           | Layered JSONC                          | Layered JSON                          | Layered JSONC without schema validation |
| Operator controls   | Separate `dcp:*` commands, decompression, recompression, lifetime stats               | `sendMessage` supports hidden custom follow-ups                                | Unified surface, manual trigger, TUI   | Unified surface, manual trigger       | Unified surface, manual trigger         |
| Packaging           | MIT, CI, schema, current Pi dependencies                                              | Installed Pi API is 0.80.3                                                     | AGPL-3.0-or-later                      | AGPL-3.0-or-later                     | No license file or CI workflow found    |

## What We Did Well

- The pipeline has clear stages for state synchronization, strategy execution, ID injection, compression filtering, and nudge injection.
- TypeBox is the source of truth for defaults, validation, and the shipped schema.
- The implementation includes range and message compression, protected-content preservation, summary buffering, sub-agent enrichment, runtime permission control, and notifications.
- The character-based token estimator avoids repeatedly invoking a provider tokenizer.
- The repository has current Pi dependencies, CI, release checks, and materially more automated coverage than the smaller Pi ports.

These strengths should be preserved, but claims of “stable message references” and “nested range compression” must be qualified until the persistence and relationship fixes below are implemented.

## Priority Findings

1. **Cross-session state collision.** `ctx.sessionManager.getSessionDir()` is a project session directory, not a unique session directory. Every session currently reads and writes the same `dcp/state.json`; the random DCP `sessionId` is not checked on load.
2. **Persistence is incomplete.** Compression blocks, active mappings, pruned tool IDs, block counters, and compression relationships are not restored.
3. **Compression accounting is wrong.** `applyCompressionState()` creates per-message entries with `tokenCount: 0`, so `compressedTokens` and the user-facing savings display remain zero.
4. **Nested compression is incomplete.** `handleCompress()` always passes `consumedBlockIds: []`; active blocks can be overwritten in `activeByAnchorIndex` without their relationships being recorded.
5. **Compression ownership is guessed.** `compressMessageIndex = messages.length - 1` is captured from the pre-request context and does not identify the current `compress` tool call. Batch timing then scans for the newest block and attaches duration to one block.
6. **Failed-error pruning is reversed.** The current pass replaces useful error diagnostics while leaving the failed assistant arguments intact.
7. **Deduplication defaults protect the wrong tools.** Protecting read/search/shell output disables the main repeated-lookup savings case.
8. **Turn semantics are inconsistent.** `turn_end` counts agent iterations, while the requested safety window is expressed in user turns. The current counter is persisted and then assigned to all restored tool calls.
9. **Orphan repair should respect Pi.** DCP should preserve complete tool ranges and remove orphan results it created; Pi’s provider transform already synthesizes missing results for unmatched assistant calls.
10. **Configuration reload is stale.** Commands capture the original config object, and project config is loaded after the compression tool schema has already been selected.
11. **Project config uses the wrong cwd source.** `process.cwd()` is not the authoritative Pi session cwd and bypasses project-trust checks.
12. **Lifetime totals are misnamed.** The current command scans sidecars by project directory, not Pi session files, and would double-count inherited fork state if native snapshots are introduced without an owner session ID.
13. **Provenance must remain explicit.** The upstream and Davidcreador repositories are AGPL-3.0-or-later. They are behavioral references only; no source copying is authorized by this audit.

## Recommended Direction

- Persist DCP state as versioned `pi-dcp-state` custom entries on the active Pi branch. Restore from `getBranch()` on `session_start` and `session_tree`; append after durable mutations.
- Ignore existing shared sidecars for restoration and leave them untouched. They cannot be safely associated with a Pi session.
- Use the real compression `toolCallId`, incremental visible-token accounting, complete nested-block relationships, and user-turn ordinals derived from message history.
- Keep existing commands and JSON configuration. Add a numeric opt-in `turnProtection: 0`, trusted project overrides, and `/dcp:compress [focus]`.
- Keep deterministic benchmarks informational until measured variance supports a release threshold.

The implementation sequence is defined in [2026-07-28-pi-dcp-reliability-roadmap.md](../plans/2026-07-28-pi-dcp-reliability-roadmap.md).
