# Phase 1: Session Evidence and Duplicate-Writer Diagnosis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a tested, read-only analyzer for Pi session JSONL and use it to correct the report and diagnose exact duplicate DCP snapshots before production behavior changes.

**Architecture:** Parse each file line-by-line, classify DCP transitions by full equality and semantic equality, and aggregate stop/tool/compaction evidence without mutating source logs. Reproduce duplicate writers with extension registration tests and inspect configured extension paths before deciding whether any production guard is justified.

**Tech Stack:** TypeScript ESM, Node.js filesystem/readline APIs, Vitest, tsx, Pi JSONL v3.

**Spec:** `docs/superpowers/specs/2026-08-22-dcp-troubleshooting-design.md`

## Global Constraints

- The ten external JSONL files are read-only and must not be copied into the repository.
- Analyzer output must not include message content, tool arguments, or secrets.
- Malformed lines are counted and skipped.
- No production DCP behavior changes in this phase.
- Do not add a singleton guard.

---

### Task 1: Add a synthetic JSONL analyzer regression

**Files:**
- Create: `tests/session-analysis.test.ts`
- Create: `scripts/analyze-sessions.ts`

**Interfaces:**
- Consumes: Pi JSONL entries with `type`, `message`, `customType`, and `data` fields.
- Produces: `analyzeSessionFiles(files: string[]): Promise<SessionCorpusReport>` and exported report interfaces.

- [ ] **Step 1: Write the failing synthetic test**

Create `tests/session-analysis.test.ts` with a temporary JSONL containing a session header, assistant tool call, tool result, four DCP snapshots, one compaction, and one malformed line:

```typescript
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeSessionFiles } from "../scripts/analyze-sessions.ts";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function state(messageIds: string[][], totalPruneTokens = 0) {
  return {
    version: 1,
    ownerSessionId: "session-1",
    manualMode: false,
    compressPermission: "allow",
    stats: { pruneTokenCounter: 0, totalPruneTokens, toolsPruned: 0, messagesCompressed: 0 },
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
  it("separates exact, message-id-only, and semantic state transitions", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-analysis-"));
    tempDirs.push(dir);
    const file = path.join(dir, "session.jsonl");
    const first = state([]);
    const idsOnly = state([["user:1:0", "m0001"]]);
    const semantic = state([["user:1:0", "m0001"]], 5);
    const lines = [
      { type: "session", version: 3, id: "session-1", timestamp: "2026-08-22T00:00:00Z", cwd: "/tmp" },
      { type: "message", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }] } },
      { type: "message", message: { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [], isError: false } },
      { type: "custom", customType: "pi-dcp-state", data: first },
      { type: "custom", customType: "pi-dcp-state", data: idsOnly },
      { type: "custom", customType: "pi-dcp-state", data: idsOnly },
      { type: "custom", customType: "pi-dcp-state", data: semantic },
      { type: "compaction" },
    ];
    fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\nnot-json\n`);

    const report = await analyzeSessionFiles([file]);

    expect(report.totals).toMatchObject({
      files: 1,
      dcpStates: 4,
      exactDuplicateTransitions: 1,
      messageIdOnlyTransitions: 1,
      semanticCheckpoints: 2,
      compactions: 1,
      malformedLines: 1,
      unmatchedToolCalls: 0,
      unmatchedToolResults: 0,
    });
    expect(report.totals.stopReasons).toEqual({ toolUse: 1 });
  });
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run:

```bash
pnpm vitest run tests/session-analysis.test.ts
```

Expected: FAIL because `scripts/analyze-sessions.ts` does not exist.

- [ ] **Step 3: Implement the report types and semantic projection**

Create `scripts/analyze-sessions.ts` with these public shapes:

```typescript
export interface SessionFileReport {
  file: string;
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
  stopReasons: Record<string, number>;
}

export interface SessionCorpusReport {
  files: SessionFileReport[];
  totals: Omit<SessionFileReport, "file"> & { files: number };
}

function semanticState(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { messageIds: _messageIds, ...semantic } = value as Record<string, unknown>;
  return semantic;
}
```

Implement `analyzeSessionFiles()` with `node:readline`, `fs.createReadStream`, `Buffer.byteLength`, a `Map<string, number>` of open tool-call IDs, and JSON-string equality for full and semantic states. Count the first DCP state in each file as one semantic checkpoint. For each later state:

```typescript
const full = JSON.stringify(data);
const semantic = JSON.stringify(semanticState(data));
if (full === previousFull) exactDuplicateTransitions++;
else if (semantic === previousSemantic) messageIdOnlyTransitions++;
else semanticCheckpoints++;
previousFull = full;
previousSemantic = semantic;
```

Track tool calls from assistant `content` parts with `type === "toolCall"`; remove IDs when a top-level `toolResult` message is seen. A tool result without an open ID increments `unmatchedToolResults`; remaining IDs increment `unmatchedToolCalls` at EOF.

- [ ] **Step 4: Add the CLI entry point**

At the end of `scripts/analyze-sessions.ts`, add:

```typescript
import { pathToFileURL } from "node:url";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    process.stderr.write("Usage: tsx scripts/analyze-sessions.ts <session.jsonl>...\n");
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify(await analyzeSessionFiles(files), null, 2)}\n`);
  }
}
```

Place imports at the top of the file when implementing; do not leave the `node:url` import at the bottom.

- [ ] **Step 5: Run the focused test**

Run:

```bash
pnpm vitest run tests/session-analysis.test.ts
```

Expected: PASS.

### Task 2: Add the analyzer command and run the exact corpus

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: `scripts/analyze-sessions.ts` from Task 1.
- Produces: `pnpm run analyze:sessions --` followed by one or more session paths.

- [ ] **Step 1: Add the package script**

Add to `package.json` scripts:

```json
"analyze:sessions": "tsx scripts/analyze-sessions.ts"
```

- [ ] **Step 2: Run the command with all ten explicit paths**

Run this exact command; do not replace it with a directory glob:

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

Expected aggregate values:

```text
dcpStates: 692
dcpBytes: approximately 5451357
exactDuplicateTransitions: 42
messageIdOnlyTransitions: 594
semanticCheckpoints: 56
compactions: 0
unmatchedToolCalls: 0
unmatchedToolResults: 0
```

If byte counts differ only by newline accounting, report both the analyzer's convention and the filesystem total. Do not change classification counts to force the expected output.

- [ ] **Step 3: Run type checking and the focused test**

Run:

```bash
pnpm typecheck
pnpm vitest run tests/session-analysis.test.ts
```

Expected: both PASS.

### Task 3: Reproduce duplicate extension writers without production guards

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `docs/analysis-report.md`

**Interfaces:**
- Consumes: existing `createExtension()` and `createMockApi()` test harness.
- Produces: evidence that two extension factories bound to one API can append byte-identical states independently.

- [ ] **Step 1: Add a duplicate-registration characterization test**

Add this test beside the persistence tests in `tests/index.test.ts`:

```typescript
it("characterizes duplicate state writes from two extension instances", async () => {
  const { api, handlers, entries } = createMockApi();
  createExtension(api);
  createExtension(api);
  const ctx = {
    sessionManager: {
      getSessionDir: () => "/tmp/test-session-dir",
      getSessionId: () => "session",
      getBranch: () => [] as unknown[],
    },
    getContextUsage: () => undefined,
    hasUI: false,
  };

  for (const start of handlers.get("session_start") ?? []) {
    await (start as (...args: unknown[]) => Promise<void>)({ reason: "new" }, ctx);
  }

  expect(entries).toHaveLength(2);
  expect(entries[0]?.data).toEqual(entries[1]?.data);
});
```

This is a characterization test and should pass on current code. It does not justify a singleton guard.

- [ ] **Step 2: Run the characterization test**

Run:

```bash
pnpm vitest run tests/index.test.ts -t "characterizes duplicate state writes"
```

Expected: PASS with two equal snapshots.

- [ ] **Step 3: Inspect configured extension sources**

Run read-only searches:

```bash
rg -n 'pi-dcp|@pi-vault/pi-dcp' ~/.pi/agent/settings.json ~/.pi/agent/extensions .pi 2>/dev/null || true
find ~/.pi/agent/extensions .pi/extensions -maxdepth 3 \( -type f -o -type l \) 2>/dev/null | sort
```

Resolve every file containing a DCP package/path reference with:

```bash
rg -l 'pi-dcp|@pi-vault/pi-dcp' ~/.pi/agent/settings.json ~/.pi/agent/extensions .pi 2>/dev/null |
  while IFS= read -r file; do
    node -e 'console.log(require("node:fs").realpathSync(process.argv[1]))' "$file"
  done
```

Record whether the historical session could have loaded distinct DCP copies. Do not edit user configuration as part of this repository change.

- [ ] **Step 4: Correct the report**

Update `docs/analysis-report.md` so it:

- uses the exact ten-file totals,
- separates 42 exact duplicates from 594 message-ID-only transitions,
- identifies duplicate extension instances as the supported explanation only if source inspection corroborates it,
- otherwise labels the cause unresolved but reproducible with two factory instances,
- removes the stale-anchor and compaction-stat bug claims,
- retains provider/abort findings as external informational events.

- [ ] **Step 5: Run focused checks**

Run:

```bash
pnpm vitest run tests/session-analysis.test.ts tests/index.test.ts
pnpm typecheck
git diff --check
```

Expected: all PASS.

- [ ] **Step 6: Commit Phase 1**

```bash
git add scripts/analyze-sessions.ts tests/session-analysis.test.ts tests/index.test.ts package.json docs/analysis-report.md
git commit -m "test: add reproducible dcp session analysis"
```
