# Task 3 Report — Exact Corpus and Evidence Correction

## Analyzer corpus

The ten explicit paths in the Task 3 plan were used; no glob, corpus copy, or corpus modification was used.

The exact required command, `pnpm run analyze:sessions -- "${SESSION_FILES[@]}"`, was run successfully with the separator accepted as CLI syntax. Its output was:

```text
files: 10
fileBytes: 10740340
dcpBytes: 5451357
dcpStates: 692
exactDuplicateTransitions: 42
messageIdOnlyTransitions: 594
semanticCheckpoints: 56
compactions: 0
malformedLines: 0
unmatchedToolCalls: 0
unmatchedToolResults: 0
assistantErrors: 15
stopReasons: { toolUse: 550, stop: 82, aborted: 5, error: 10 }
```

The `2026-08-19T20:08` file reported:

```text
firstStateOrdinal: 36
adjacentTransitions: 42
parentLinkedTransitions: 42
minDeltaMs: 1
maxDeltaMs: 4
```

The first-state ordinal is 36, the source state of the first exact pair. The explicit path list and analyzer newline handling (`crlfDelay: Infinity`; `Buffer.byteLength(line) + 1`) were inspected; all aggregate values and chronology match.

## Source findings

Read-only inspection of Pi tag `v0.83.0` found that `mergePaths()` deduplicates `canonicalizePath()` values, and `canonicalizePath()` uses `realpathSync`. One physical path referenced more than once is consequently deduplicated; separate physical copies remain independent load paths and closures. The reload path invalidates the old runner before building a new runtime. DCP registers the `compress` tool during `session_start`, after the earlier load-time conflict scan; `registerDcpCommands(...)` occurs during extension construction.

The requested current-main `resource-loader.ts` inspection was also run only to check drift.

## Filtered configuration findings

```text
realpath ~/.pi/agent
/Users/lanh/Developer/dotfiles/configs/pi

settings packages filtered for pi-dcp
[]

package-cache dependencies filtered for pi-dcp
[ [ '@pi-vault/pi-dcp', '^0.5.0' ] ]

project .pi/settings.json checks
/Users/lanh/Developer/pi-vault/pi-plan
/Users/lanh/Developer/pi-vault/pi-subagents
```

No unrelated settings or credentials were printed. Current configuration and package-cache contents cannot reconstruct the historical CLI `-e` flags or the extension-source pair used by the August sessions.

## Report changes

Rewrote `docs/analysis-report.md` to use only the exact corpus totals; distinguish 42 exact duplicates, 594 message-ID-only transitions, and 56 semantic checkpoints; classify the adjacent parent-linked 1–4 ms pairs as independent DCP closures; retain message-ID snapshot amplification and orphan message-ID stripping; and remove stale-anchor and compaction-stat claims. It identifies historical source paths as unresolved, excludes one canonical path and ordinary reload based on Pi behavior, keeps external events informational, and recommends no Phase 1 production guard or runtime tracing.

## Verification

```text
$ pnpm vitest run tests/session-analysis.test.ts tests/index.test.ts tests/persistence.test.ts
Test Files  3 passed (3)
Tests  44 passed (44)

$ pnpm typecheck
$ tsc --noEmit

$ git diff --check
(exit 0)

$ git status --short
 M docs/analysis-report.md
```

The final required verification passed after the report rewrite. No external JSONL file, runtime trace, `src/` file, or `tests/index.test.ts` change appeared.

## Commit

`0298144` — `docs: correct dcp session evidence`

## Self-review

The original report commit changed only `docs/analysis-report.md`; the subsequent fix adds the focused analyzer/test changes. No corpus, runtime trace, `src/`, package metadata, Pi source, or user configuration was modified.

## Fix round 1

### Red regression evidence

Before changing the analyzer, the synthetic duplicate assertion was changed from destination ordinal `3` to source ordinal `2`, and a temporary-file CLI regression invoked the package command with its separator:

```text
$ pnpm vitest run tests/session-analysis.test.ts
Test Files  1 failed (1)
Tests  2 failed | 3 passed (5)
```

The synthetic assertion received `firstStateOrdinal: 3`, proving the analyzer recorded the destination rather than source state. The CLI regression ran `pnpm run analyze:sessions -- <temporary-session.jsonl>` and failed with `ENOENT: no such file or directory, stat '--'`, proving the separator was treated as an input file.

### Changes

- `scripts/analyze-sessions.ts` removes one leading CLI `--` before analyzing files and records `stateOrdinal - 1` as the source state of the first exact pair.
- `tests/session-analysis.test.ts` covers the real package CLI command against a temporary JSONL file and asserts source ordinal `2` for the synthetic pair between states 2 and 3.
- `docs/analysis-report.md` records the successful source ordinal `36` baseline and corrects the DCP terminology: `compress` is registered during `session_start`, while `registerDcpCommands(...)` runs during extension construction.

### Corpus and source evidence

The exact ten explicit Task 3 paths were passed, without a glob, to:

```text
$ pnpm run analyze:sessions -- "${SESSION_FILES[@]}"
files: 10
fileBytes: 10740340
dcpBytes: 5451357
dcpStates: 692
exactDuplicateTransitions: 42
messageIdOnlyTransitions: 594
semanticCheckpoints: 56
compactions: 0
malformedLines: 0
unmatchedToolCalls: 0
unmatchedToolResults: 0
assistantErrors: 15
stopReasons: { toolUse: 550, stop: 82, aborted: 5, error: 10 }
firstStateOrdinal: 36
adjacentTransitions: 42
parentLinkedTransitions: 42
minDeltaMs: 1
maxDeltaMs: 4
```

Read-only Pi v0.83.0 checks confirmed that `mergePaths()` deduplicates `canonicalizePath()` values and `canonicalizePath()` uses `realpathSync`; reload invalidates the previous runner before rebuilding. Current DCP source confirms `registerDcpCommands(...)` precedes the `session_start` handler, whose `registerCompressTool()` registers `compress`. The report no longer asserts that the conflict scan excludes commands.

### Green verification

```text
$ pnpm vitest run tests/session-analysis.test.ts
Test Files  1 passed (1)
Tests  5 passed (5)

$ pnpm vitest run tests/session-analysis.test.ts tests/index.test.ts tests/persistence.test.ts
Test Files  3 passed (3)
Tests  45 passed (45)

$ pnpm typecheck
$ tsc --noEmit

$ pnpm format:check
$ biome format .
Checked 96 files in 24ms. No fixes applied.

$ git diff --check
(exit 0)
```

### Commits

- Baseline report: `0298144 docs: correct dcp session evidence`
- Focused fix: `89c2e7d fix: correct session analyzer evidence`

### Self-review

- The corpus was read only; no corpus copy, runtime trace/config, dependency/package file, or `src/` change was made.
- The analyzer still emits structural metadata only, and the CLI regression uses an isolated temporary file.
- `docs/analysis-report.md` retains no failed-command or ordinal-discrepancy claim.

## Final review fix

### Red regression evidence

Added the deeply nested DCP-data regression before changing the analyzer, then ran:

```text
$ pnpm vitest run tests/session-analysis.test.ts

Test Files  1 failed (1)
Tests  1 failed | 5 passed (6)

RangeError: Maximum call stack size exceeded
❯ fingerprint scripts/analyze-sessions.ts:50:18
❯ analyzeFile scripts/analyze-sessions.ts:161:30
```

The parsed deep DCP object caused `JSON.stringify` during fingerprinting to overflow the stack and abort analysis before the valid following line could be processed.

### Changes

- `scripts/analyze-sessions.ts` — hashes tool-call map keys and retained parent-link IDs with the existing SHA-256 fingerprint helper; catches per-entry state projection/fingerprinting failures, counts them as malformed, and continues.
- `tests/session-analysis.test.ts` — uses secret-like tool-call IDs while retaining the structural tool assertions and verifies report omission; adds the deep-data continuation regression.
- `.superpowers/sdd/phase-01-evidence-and-duplicate-writers/task-3-report.md` — this evidence append.

### Green verification

```text
$ pnpm vitest run tests/session-analysis.test.ts

Test Files  1 passed (1)
Tests  6 passed (6)

$ pnpm vitest run tests/session-analysis.test.ts tests/index.test.ts tests/persistence.test.ts

Test Files  3 passed (3)
Tests  46 passed (46)

$ pnpm typecheck
$ tsc --noEmit

$ pnpm format:check
$ biome format .
Checked 96 files in 26ms. No fixes applied.

$ git diff --check
(exit 0)
```

### Commit

`3fec1757bdf1194d671dc8458f16ba8229e60190` — `fix: harden session analyzer safety`

### Self-review

- No raw entry ID or tool-call ID crosses a streamed-record boundary; retained comparison and map keys are SHA-256 digests.
- Unsafe parsed DCP state is neither emitted nor retained; it is counted as malformed and later valid lines continue.
- No `src/`, package metadata, lockfile, or analyzer output content was changed beyond the phase-owned analyzer, test, and required report.

## Final review fix 2

### Red regression evidence

Added the byte-count assertion to the existing deeply nested DCP-data regression before changing the analyzer, then ran:

```text
$ pnpm vitest run tests/session-analysis.test.ts

Test Files  1 failed (1)
Tests  1 failed | 5 passed (6)

AssertionError: expected 482 to be 110589
```

The unsafe but valid `pi-dcp-state` JSONL record was counted as malformed and skipped before its `Buffer.byteLength(line) + 1` contribution was added.

### Changes

- `scripts/analyze-sessions.ts` — counts each valid DCP JSON record's bytes before unsafe-state fingerprinting can mark it malformed.
- `tests/session-analysis.test.ts` — asserts both the deeply nested malformed state record and following valid state record contribute to `dcpBytes`.

### Green verification

```text
$ pnpm vitest run tests/session-analysis.test.ts
Test Files  1 passed (1)
Tests  6 passed (6)

$ pnpm vitest run tests/session-analysis.test.ts tests/index.test.ts tests/persistence.test.ts
Test Files  3 passed (3)
Tests  46 passed (46)

$ pnpm typecheck
$ tsc --noEmit

$ pnpm format:check
$ biome format .
Checked 96 files in 24ms. No fixes applied.

$ git diff --check
(exit 0)
```

### Commit

`c3c637c1dc195cf3d528aa0214546665dc7c547f` — `fix: count unsafe DCP records`

### Self-review

- `dcpBytes` now includes every syntactically valid, structurally valid DCP record exactly once, even when state projection/fingerprinting is unsafe.
- Unsafe state remains malformed and does not update transition state; following records continue to stream normally.
- No package, configuration, source, corpus, or unrelated documentation was changed.
