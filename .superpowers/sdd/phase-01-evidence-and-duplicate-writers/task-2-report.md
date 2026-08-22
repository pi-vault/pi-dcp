# Task 2 Report — Add the tested read-only session analyzer

## Red regression

```text
$ pnpm vitest run tests/session-analysis.test.ts

 RUN  v4.1.10 /Users/lanh/Developer/pi-vault/pi-dcp

 ❯ tests/session-analysis.test.ts (0 test)

 FAIL  tests/session-analysis.test.ts [ tests/session-analysis.test.ts ]
Error: Cannot find module '../scripts/analyze-sessions.ts' imported from /Users/lanh/Developer/pi-vault/pi-dcp/tests/session-analysis.test.ts
 ❯ tests/session-analysis.test.ts:5:1
      3| import * as path from "node:path";
      4| import { afterEach, describe, expect, it } from "vitest";
      5| import { analyzeSessionFiles } from "../scripts/analyze-sessions.ts";
       | ^

 Test Files  1 failed (1)
      Tests  no tests
```

This failed correctly because the regression imports the required analyzer module before that module existed.

## Files changed

Committed:

- `tests/session-analysis.test.ts` — supplied synthetic regression for state transitions, malformed JSON, tool calls/results, errors, and duplicate chronology.
- `scripts/analyze-sessions.ts` — read-only JSONL streaming analyzer and direct CLI entry point.
- `package.json` — adds `analyze:sessions` using the existing `tsx` development dependency.

The analyzer reports only structural counts, file paths, and state ordinals; it does not retain or emit message content, tool arguments, error text, or secrets.

## Green verification

```text
$ pnpm vitest run tests/session-analysis.test.ts

 RUN  v4.1.10 /Users/lanh/Developer/pi-vault/pi-dcp

 Test Files  1 passed (1)
      Tests  1 passed (1)

$ pnpm typecheck
$ tsc --noEmit
```

Both commands exited successfully. `git diff --check` also exited successfully before commit.

## Commit

`8e121e4 test: add reproducible dcp session analysis`

## Self-review

- The committed diff contains only the three Task 2 implementation files; `src/`, `tests/index.test.ts`, and `package.json.files` are unchanged.
- Each input file is read once through `createReadStream` and `readline`; malformed JSON increments a counter without aborting analysis.
- Exact duplicate evidence is kept per file, and corpus aggregation combines only numeric counts and stop reasons.

## Fix round 1

### Red regression evidence

Added three real-file streaming regressions to `tests/session-analysis.test.ts`, then ran:

```text
$ pnpm vitest run tests/session-analysis.test.ts

Test Files  1 failed (1)
Tests  3 failed | 1 passed (4)
```

The new metadata regression failed because `previousFull` / `previousSemantic` retained serialized strings. The non-entry JSONL regression aborted with `TypeError: Cannot read properties of null (reading 'type')` at `analyze-sessions.ts:101`. The stop-reason regression reported the raw unknown reason as an output key instead of `other`.

### Changed files

- `scripts/analyze-sessions.ts` — stores SHA-256 fingerprints rather than prior serialized DCP states; rejects non-entry JSON values; normalizes unknown string stop reasons to `other`.
- `tests/session-analysis.test.ts` — adds real JSONL streaming coverage for content-free transition metadata, non-object/incomplete entries, and known/unknown stop reasons.
- `.superpowers/sdd/phase-01-evidence-and-duplicate-writers/task-2-report.md` — this evidence append.

### Green verification

```text
$ pnpm vitest run tests/session-analysis.test.ts
Test Files  1 passed (1)
Tests  4 passed (4)

$ pnpm typecheck
$ tsc --noEmit

$ pnpm format:check
$ biome format .
Checked 96 files in 26ms. No fixes applied.

$ git diff --check
(exit 0)
```

`pnpm format:check` initially identified two formatting differences in the changed test file; `pnpm exec biome format --write scripts/analyze-sessions.ts tests/session-analysis.test.ts` corrected them before the final passing check.

### Commit

Focused implementation commit: `4f2cd17 fix: harden session analyzer evidence`

### Self-review

- Prior transition values are SHA-256 digests only; serialized DCP state is not retained or emitted, while exact and semantic transition classifications remain unchanged.
- Parsed values must be object entries with string `type`, `id`, and `timestamp`; malformed values are counted and streaming continues.
- Only the corpus Pi stop reasons (`toolUse`, `stop`, `aborted`, `error`) are output verbatim; every other string is counted as `other`.
