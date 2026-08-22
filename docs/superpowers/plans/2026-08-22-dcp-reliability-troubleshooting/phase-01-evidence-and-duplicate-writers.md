# Phase 1: Session Evidence and Duplicate-Writer Diagnosis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a tested, read-only Pi session analyzer, correct the ten-file evidence report, and explain the exact duplicate snapshots without changing production DCP behavior.

**Architecture:** Stream each JSONL file once, classify adjacent DCP snapshots by full and message-ID-excluded equality, and retain only structural diagnostic metadata. Use the resulting chronology together with Pi v0.83.0 loader semantics to distinguish two independent runtime writers from ordinary message-ID snapshot growth; do not add runtime tracing or a singleton guard.

**Tech Stack:** TypeScript ESM, Node.js filesystem/readline APIs, Vitest, tsx, Pi JSONL v3, Pi coding-agent v0.83.0 reference source.

**Spec:** `docs/superpowers/specs/2026-08-22-dcp-troubleshooting-design.md`

## Global Constraints

- The ten external JSONL files are read-only and must not be copied into the repository.
- Analyzer output must not include message content, tool arguments, error text, or secrets.
- Malformed lines are counted and skipped.
- Use `/Users/lanh/Developer/pi-packages/pi` as a read-only reference; do not modify it.
- Inspect Pi tag `v0.83.0` for corpus-era behavior and current `main` only for drift.
- Do not add dependencies, runtime tracing, a duplicate-factory characterization test, or a singleton guard.
- Do not modify `src/` or `tests/index.test.ts` in this phase.
- Keep the analyzer outside the published package contents; `package.json.files` remains unchanged.
- Every code change begins with the focused failing test and ends with the narrowest relevant checks.

---

### Task 1: Align the controlling design and parent plan

**Files:**

- Modify: `docs/superpowers/specs/2026-08-22-dcp-troubleshooting-design.md`
- Modify: `docs/superpowers/plans/2026-08-22-dcp-reliability-troubleshooting.md`

**Interfaces:**

- Consumes: the approved evidence-only Phase 1 scope.
- Produces: controlling documentation that no longer requires unimplemented runtime trace fields or a tautological duplicate-factory test.

- [ ] **Step 1: Replace the spec's duplicate-instance diagnosis requirement**

Replace the `### Duplicate-instance diagnosis` section with:

```markdown
### Duplicate-instance diagnosis

Phase 1 uses committed, content-free corpus evidence rather than production runtime tracing. For each exact duplicate transition, the analyzer records only state ordinal, file adjacency, parent linkage, and timestamp delta.

Interpret the evidence against Pi v0.83.0 loader behavior:

1. `DefaultResourceLoader.mergePaths()` canonicalizes real paths, so repeated references to one physical extension are deduplicated.
2. Distinct physical copies can still load as separate extension instances.
3. Reload invalidates the old extension runner before constructing the replacement.
4. DCP registers `compress` during `session_start`, after Pi's load-time conflict scan, and Pi does not scan command conflicts.

The historical source-path pair remains unresolved unless a contemporaneous configuration or launch command is available. This uncertainty does not justify a production singleton guard.
```

In `## Troubleshooting Sequence`, replace `### Phase C: Duplicate-instance gate` with:

```markdown
### Phase C: Duplicate-instance evidence

Use the analyzer's exact-duplicate chronology and Pi v0.83.0 loader semantics to classify the duplicate writer. Record the current configuration separately and do not present it as historical proof. Add no production guard without a supported single-instance reproduction.
```

In `## Finding Classification`, replace the unresolved-cause paragraph with:

```markdown
The 42 byte-identical snapshot pairs are adjacent, parent-linked, and 1–4 ms apart; under the current `persistIfChanged()` logic this is evidence of two independent DCP state closures. The exact historical extension-source pair remains unresolved. Do not add a production guard without a supported single-instance reproduction.
```

In `## Error Handling`, replace the temporary-diagnostics bullet with:

```markdown
- Analyzer output contains no message content, tool arguments, error text, or secrets.
```

- [ ] **Step 2: Correct the parent Phase 1 acceptance criteria**

Replace:

```markdown
- Duplicate-writer tracing contains only IDs, callsites, force flags, and fingerprints.
```

with:

```markdown
- Exact-duplicate evidence contains only state ordinals, entry adjacency, parent linkage, and timestamp deltas.
```

Keep the existing no-production-behavior-change requirement.

Also replace the parent global constraint:

```markdown
- Temporary diagnostics must not log message content, tool arguments, or secrets.
```

with:

```markdown
- Analyzer output must not contain message content, tool arguments, error text, or secrets.
```

- [ ] **Step 3: Verify and commit the documentation alignment**

Run:

```bash
git diff --check
git diff -- docs/superpowers/specs/2026-08-22-dcp-troubleshooting-design.md docs/superpowers/plans/2026-08-22-dcp-reliability-troubleshooting.md
```

Expected: no whitespace errors; the only semantic change is the evidence-only duplicate diagnosis.

```bash
git add docs/superpowers/specs/2026-08-22-dcp-troubleshooting-design.md docs/superpowers/plans/2026-08-22-dcp-reliability-troubleshooting.md
git commit -m "docs: align duplicate-writer evidence plan"
```

### Task 2: Add the tested read-only session analyzer

**Files:**

- Create: `tests/session-analysis.test.ts`
- Create: `scripts/analyze-sessions.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: Pi JSONL v3 entries with top-level `type`, `id`, `parentId`, `timestamp`, `message`, `customType`, and `data` fields.
- Produces: `analyzeSessionFiles(files: string[]): Promise<SessionCorpusReport>` and `pnpm run analyze:sessions -- <session.jsonl>...`.

- [ ] **Step 1: Write the failing synthetic regression**

Create `tests/session-analysis.test.ts`:

```typescript
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeSessionFiles } from "../scripts/analyze-sessions.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

function state(messageIds: string[][], totalPruneTokens = 0) {
  return {
    version: 1,
    ownerSessionId: "session-1",
    manualMode: false,
    compressPermission: "allow",
    stats: {
      pruneTokenCounter: 0,
      totalPruneTokens,
      toolsPruned: 0,
      messagesCompressed: 0,
    },
    lastCompaction: 0,
    pruneTools: [],
    blocks: [],
    nextBlockId: 1,
    nextRunId: 1,
    messageIds: { byRawId: messageIds, nextRefIndex: messageIds.length + 1 },
    nudges: { contextLimitAnchors: [], turnAnchors: [], iterationAnchors: [] },
  };
}

describe("session analysis", () => {
  it("reports safe transition, tool, error, and duplicate evidence", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-analysis-"));
    tempDirs.push(dir);
    const file = path.join(dir, "session.jsonl");
    const first = state([]);
    const idsOnly = state([["user:1:0", "m0001"]]);
    const semantic = state([["user:1:0", "m0001"]], 5);
    const lines = [
      {
        type: "session",
        version: 3,
        id: "session-1",
        timestamp: "2026-08-22T00:00:00.000Z",
        cwd: "/tmp",
      },
      {
        type: "message",
        id: "a1",
        parentId: null,
        timestamp: "2026-08-22T00:00:00.100Z",
        message: {
          role: "assistant",
          stopReason: "toolUse",
          content: [
            { type: "toolCall", id: "call-1", name: "read", arguments: {} },
            { type: "toolCall", id: "call-open", name: "read", arguments: {} },
          ],
        },
      },
      {
        type: "message",
        id: "r1",
        parentId: "a1",
        timestamp: "2026-08-22T00:00:00.200Z",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "read",
          content: [],
          isError: false,
        },
      },
      {
        type: "message",
        id: "r2",
        parentId: "r1",
        timestamp: "2026-08-22T00:00:00.300Z",
        message: {
          role: "toolResult",
          toolCallId: "missing",
          toolName: "read",
          content: [],
          isError: true,
        },
      },
      {
        type: "custom",
        id: "s1",
        parentId: "r2",
        timestamp: "2026-08-22T00:00:01.000Z",
        customType: "pi-dcp-state",
        data: first,
      },
      {
        type: "custom",
        id: "s2",
        parentId: "s1",
        timestamp: "2026-08-22T00:00:02.000Z",
        customType: "pi-dcp-state",
        data: idsOnly,
      },
      {
        type: "custom",
        id: "s3",
        parentId: "s2",
        timestamp: "2026-08-22T00:00:02.003Z",
        customType: "pi-dcp-state",
        data: idsOnly,
      },
      {
        type: "custom",
        id: "s4",
        parentId: "s3",
        timestamp: "2026-08-22T00:00:03.000Z",
        customType: "pi-dcp-state",
        data: semantic,
      },
      {
        type: "message",
        id: "a2",
        parentId: "s4",
        timestamp: "2026-08-22T00:00:04.000Z",
        message: {
          role: "assistant",
          stopReason: "error",
          errorMessage: "redacted by analyzer",
          content: [],
        },
      },
      {
        type: "compaction",
        id: "c1",
        parentId: "a2",
        timestamp: "2026-08-22T00:00:05.000Z",
      },
    ];
    fs.writeFileSync(
      file,
      `${lines.map((line) => JSON.stringify(line)).join("\n")}\nnot-json\n`,
    );

    const report = await analyzeSessionFiles([file]);

    expect(report.totals).toMatchObject({
      files: 1,
      dcpStates: 4,
      exactDuplicateTransitions: 1,
      messageIdOnlyTransitions: 1,
      semanticCheckpoints: 2,
      compactions: 1,
      malformedLines: 1,
      unmatchedToolCalls: 1,
      unmatchedToolResults: 1,
      assistantErrors: 1,
      stopReasons: { toolUse: 1, error: 1 },
    });
    expect(report.files[0]?.exactDuplicateEvidence).toEqual({
      firstStateOrdinal: 3,
      adjacentTransitions: 1,
      parentLinkedTransitions: 1,
      minDeltaMs: 3,
      maxDeltaMs: 3,
    });
    expect(report.files[0]?.dcpBytes).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the regression and verify it fails**

```bash
pnpm vitest run tests/session-analysis.test.ts
```

Expected: FAIL because `scripts/analyze-sessions.ts` does not exist.

- [ ] **Step 3: Define the analyzer's report shapes**

Create `scripts/analyze-sessions.ts` with imports from `node:fs`, `node:readline`, and `node:url`, followed by:

```typescript
export interface ExactDuplicateEvidence {
  firstStateOrdinal: number;
  adjacentTransitions: number;
  parentLinkedTransitions: number;
  minDeltaMs: number | null;
  maxDeltaMs: number | null;
}

export interface SessionCounts {
  fileBytes: number;
  dcpBytes: number;
  dcpStates: number;
  exactDuplicateTransitions: number;
  messageIdOnlyTransitions: number;
  semanticCheckpoints: number;
  compactions: number;
  malformedLines: number;
  unmatchedToolCalls: number;
  unmatchedToolResults: number;
  assistantErrors: number;
  stopReasons: Record<string, number>;
}

export interface SessionFileReport extends SessionCounts {
  file: string;
  exactDuplicateEvidence?: ExactDuplicateEvidence;
}

export interface SessionCorpusReport {
  files: SessionFileReport[];
  totals: SessionCounts & { files: number };
}
```

Use `fileBytes = fs.statSync(file).size`. Define `dcpBytes` as `Buffer.byteLength(line) + 1` for each DCP JSON record; this convention includes its JSONL line feed and remains separate from filesystem bytes.

- [ ] **Step 4: Implement semantic projection and transition classification**

Add:

```typescript
function semanticState(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { messageIds: _messageIds, ...semantic } = value as Record<
    string,
    unknown
  >;
  return semantic;
}
```

For each file, stream lines with:

```typescript
readline.createInterface({
  input: fs.createReadStream(file),
  crlfDelay: Infinity,
});
```

Increment a physical line counter before parsing. For each `custom` entry whose `customType` is `pi-dcp-state`:

```typescript
const full = JSON.stringify(entry.data);
const semantic = JSON.stringify(semanticState(entry.data));
const stateOrdinal = report.dcpStates + 1;

if (previousFull === undefined) {
  report.semanticCheckpoints++;
} else if (full === previousFull) {
  report.exactDuplicateTransitions++;
} else if (semantic === previousSemantic) {
  report.messageIdOnlyTransitions++;
} else {
  report.semanticCheckpoints++;
}

report.dcpStates = stateOrdinal;
previousFull = full;
previousSemantic = semantic;
```

On exact transitions, create `exactDuplicateEvidence` once and retain its first ordinal. Increment adjacency only when the physical lines are consecutive. Increment parent linkage only when both IDs are strings and `entry.parentId === previousEntryId`. Update minimum/maximum delta only for finite, non-negative timestamp differences.

- [ ] **Step 5: Implement tool, error, and corpus aggregation**

Use `Map<string, number>` for open tool-call IDs:

- Assistant messages increment their string `stopReason`.
- `assistantErrors` increments when `stopReason === "error"` or `errorMessage` is a non-empty string; never retain the text.
- Assistant `toolCall` parts increment their ID count.
- Tool results decrement their ID count; a missing open ID increments `unmatchedToolResults`.
- Remaining counts at EOF become `unmatchedToolCalls`.
- Corpus totals sum every numeric count and merge stop-reason counts.
- Do not aggregate `exactDuplicateEvidence`; its chronology is file-specific.

- [ ] **Step 6: Add the CLI and package command**

Add the direct-execution guard:

```typescript
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    process.stderr.write(
      "Usage: tsx scripts/analyze-sessions.ts <session.jsonl>...\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `${JSON.stringify(await analyzeSessionFiles(files), null, 2)}\n`,
    );
  }
}
```

Add to `package.json`:

```json
"analyze:sessions": "tsx scripts/analyze-sessions.ts"
```

- [ ] **Step 7: Verify and commit the analyzer**

```bash
pnpm vitest run tests/session-analysis.test.ts
pnpm typecheck
```

Expected: both PASS.

```bash
git add scripts/analyze-sessions.ts tests/session-analysis.test.ts package.json
git commit -m "test: add reproducible dcp session analysis"
```

### Task 3: Run the exact corpus and correct the evidence report

**Files:**

- Modify: `docs/analysis-report.md`

**Interfaces:**

- Consumes: `pnpm run analyze:sessions -- <files...>` from Task 2 and read-only Pi source at tag `v0.83.0`.
- Produces: a reproducible ten-file baseline and an evidence-backed duplicate-writer classification.

- [ ] **Step 1: Run the analyzer with the ten explicit paths**

Do not replace this list with a directory glob:

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

Expected totals:

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

The `2026-08-19T20:08` file must report:

```text
firstStateOrdinal: 36
adjacentTransitions: 42
parentLinkedTransitions: 42
minDeltaMs: 1
maxDeltaMs: 4
```

Do not alter classification logic to force these values. If a value differs, inspect the exact file list and newline convention, then report the discrepancy.

- [ ] **Step 2: Verify Pi v0.83.0 loader and reload behavior**

Run:

```bash
git -C /Users/lanh/Developer/pi-packages/pi show v0.83.0:packages/coding-agent/src/core/resource-loader.ts | sed -n '540,870p'
git -C /Users/lanh/Developer/pi-packages/pi show v0.83.0:packages/coding-agent/src/utils/paths.ts | sed -n '1,45p'
git -C /Users/lanh/Developer/pi-packages/pi show v0.83.0:packages/coding-agent/src/core/extensions/loader.ts | sed -n '490,610p'
git -C /Users/lanh/Developer/pi-packages/pi show v0.83.0:packages/coding-agent/src/core/agent-session.ts | sed -n '2715,2775p'
git -C /Users/lanh/Developer/pi-packages/pi show main:packages/coding-agent/src/core/resource-loader.ts | sed -n '540,870p'
```

Record:

- `mergePaths()` uses `canonicalizePath()`, which resolves symlinks with `realpathSync`; one physical path referenced more than once is deduplicated.
- Separate physical DCP copies remain separate load paths and create independent closures.
- Reload invalidates the old runner before building the new runtime.
- DCP registers `compress` inside `session_start`; Pi's earlier load-time conflict scan cannot see it, and the scan does not inspect commands.

- [ ] **Step 3: Inspect only current DCP configuration metadata**

Run filtered checks that do not print unrelated settings or credentials:

```bash
realpath ~/.pi/agent
node -e 'const s=require(process.env.HOME+"/.pi/agent/settings.json"); console.log((s.packages ?? []).filter((p) => /pi-dcp/i.test(p)))'
node -e 'const p=require(process.env.HOME+"/.pi/agent/npm/package.json"); console.log(Object.entries(p.dependencies ?? {}).filter(([name]) => /pi-dcp/i.test(name)))'
for repo in /Users/lanh/Developer/pi-vault/pi-plan /Users/lanh/Developer/pi-vault/pi-subagents; do
  printf '%s\n' "$repo"
  test -f "$repo/.pi/settings.json" && node -e 'const s=require(process.argv[1]); console.log((s.packages ?? []).filter((p) => /pi-dcp/i.test(p)), (s.extensions ?? []).filter((p) => /pi-dcp/i.test(p)))' "$repo/.pi/settings.json"
done
```

State explicitly that current configuration and package-cache contents cannot reconstruct historical CLI `-e` flags or the extension-source pair used by the August sessions.

- [ ] **Step 4: Correct `docs/analysis-report.md`**

Rewrite the report so it:

- Uses only the exact ten-file totals from Step 1.
- Reports DCP data as 5,451,357 of 10,740,340 bytes, approximately 50.8%.
- Separates 42 exact duplicate transitions, 594 message-ID-only transitions, and 56 semantic checkpoints.
- Describes the 42 adjacent, parent-linked, 1–4 ms pairs as evidence of two independent DCP state closures under the current `persistIfChanged()` logic.
- Labels the exact historical source-path pair unresolved; current configuration is not historical proof.
- Explains why one canonical path and ordinary reload are excluded by Pi v0.83.0 behavior.
- Retains message-ID snapshot amplification and orphan message-ID stripping as confirmed DCP defects.
- Removes the stale-anchor leak and compaction-stat bug claims contradicted by current code and the approved design.
- Keeps provider failures, malformed model tool markup, idle gaps, and user aborts as external informational events.
- Recommends no Phase 1 production guard or runtime tracing.

- [ ] **Step 5: Verify and commit the corrected report**

```bash
pnpm vitest run tests/session-analysis.test.ts tests/index.test.ts tests/persistence.test.ts
pnpm typecheck
git diff --check
git status --short
```

Expected:

- The focused analyzer test passes.
- Existing index and persistence tests remain green.
- Type checking and whitespace checks pass.
- No external JSONL file, runtime trace, `src/` file, or `tests/index.test.ts` change appears.

```bash
git add docs/analysis-report.md
git commit -m "docs: correct dcp session evidence"
```

## Phase 1 Completion Criteria

- The analyzer reproduces all aggregate and duplicate chronology values above.
- Synthetic malformed JSON and unmatched tool events are reported without aborting.
- Analyzer output contains structural counts and IDs only, never content or arguments.
- The report distinguishes confirmed snapshot amplification, evidence-backed duplicate runtime writers, unresolved historical source paths, and external provider/user events.
- Pi v0.83.0 behavior—not only current `main`—supports the loader conclusions.
- No production DCP behavior, snapshot schema, dependency, or user configuration changes.
