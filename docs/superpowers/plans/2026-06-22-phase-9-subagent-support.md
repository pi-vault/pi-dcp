# Phase 9: Sub-Agent Support

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DCP aware of Pi's sub-agent system — skip DCP processing when running as a child agent, and enrich compression summaries with cached sub-agent results in the parent.

**Architecture:** Detect sub-agent child sessions via `process.env.PI_SUBAGENT_CHILD === "1"`. On `tool_execution_end` for subagent tool calls, read the child session `.jsonl` file and cache assistant messages. Protect subagent tool results from pruning.

**Tech Stack:** TypeScript, Node.js `fs`, Vitest

---

## File Structure

| File                                | Responsibility                                                              |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `src/subagents/subagent-results.ts` | New: session file parser, result caching logic                              |
| `src/state/types.ts`                | Add `isSubAgent`, `subAgentResultCache` to state                            |
| `src/state/state.ts`                | Initialize new fields                                                       |
| `src/config.ts`                     | Add `experimental.allowSubAgents`, add `"subagent"` to BASE_PROTECTED_TOOLS |
| `src/index.ts`                      | Detection on session_start, caching on tool_execution_end, skip logic       |
| `tests/subagent-support.test.ts`    | Unit tests for parsing and caching                                          |

---

### Task 1: Add state fields and config

**Files:**

- Modify: `src/state/types.ts`
- Modify: `src/state/state.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Add fields to `SessionState`**

In `src/state/types.ts`, add to `SessionState`:

```typescript
/** True if this session is running as a sub-agent child. */
isSubAgent: boolean;
/** Cached sub-agent results from completed child sessions, keyed by toolCallId. */
subAgentResultCache: Map<string, string>;
```

- [ ] **Step 2: Initialize in state factory**

In `src/state/state.ts`, add to `createSessionState()`:

```typescript
    isSubAgent: false,
    subAgentResultCache: new Map(),
```

In `resetSessionState()`:

```typescript
state.isSubAgent = false;
state.subAgentResultCache.clear();
```

- [ ] **Step 3: Add config and protected tools**

In `src/config.ts`, add to `DcpConfig`:

```typescript
experimental: ExperimentalConfig;
```

Add the interface:

```typescript
export interface ExperimentalConfig {
  allowSubAgents: boolean;
}
```

Add to `DEFAULT_CONFIG`:

```typescript
  experimental: {
    allowSubAgents: false,
  },
```

Add `"experimental"` to `KNOWN_TOP_LEVEL_KEYS`.

Add parsing in `mergeConfig`:

```typescript
if (source.experimental && typeof source.experimental === "object") {
  const e = source.experimental as Record<string, unknown>;
  if (typeof e.allowSubAgents === "boolean")
    target.experimental.allowSubAgents = e.allowSubAgents;
}
```

Add `"subagent"` to `BASE_PROTECTED_TOOLS`:

```typescript
export const BASE_PROTECTED_TOOLS = [
  "compress",
  "bash",
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
  "subagent",
];
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/state/types.ts src/state/state.ts src/config.ts
git commit -m "feat(subagents): add state fields and config for sub-agent support"
```

---

### Task 2: Implement session file parser

**Files:**

- Create: `src/subagents/subagent-results.ts`
- Test: `tests/subagent-support.test.ts` (create)

- [ ] **Step 1: Write tests for session parsing**

Create `tests/subagent-support.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseChildSessionResults } from "../src/subagents/subagent-results.ts";

describe("parseChildSessionResults", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-subagent-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("extracts assistant message text from jsonl session file", () => {
    const sessionFile = path.join(tempDir, "session.jsonl");
    const entries = [
      JSON.stringify({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "Do task" }] },
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I completed the task. Result: OK" }],
        },
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Final summary here" }],
        },
      }),
    ];
    fs.writeFileSync(sessionFile, entries.join("\n"));

    const result = parseChildSessionResults(sessionFile);
    expect(result).toContain("I completed the task. Result: OK");
    expect(result).toContain("Final summary here");
  });

  it("returns empty string for non-existent file", () => {
    const result = parseChildSessionResults("/nonexistent/path.jsonl");
    expect(result).toBe("");
  });

  it("skips non-assistant entries", () => {
    const sessionFile = path.join(tempDir, "session.jsonl");
    const entries = [
      JSON.stringify({
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "User msg" }],
        },
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Result" }],
        },
      }),
      JSON.stringify({ type: "tool_call", toolName: "read" }),
    ];
    fs.writeFileSync(sessionFile, entries.join("\n"));

    const result = parseChildSessionResults(sessionFile);
    expect(result).toBe("Result");
    expect(result).not.toContain("User msg");
  });

  it("handles malformed JSON lines gracefully", () => {
    const sessionFile = path.join(tempDir, "session.jsonl");
    const entries = [
      "not valid json",
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Good line" }],
        },
      }),
    ];
    fs.writeFileSync(sessionFile, entries.join("\n"));

    const result = parseChildSessionResults(sessionFile);
    expect(result).toBe("Good line");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/subagent-support.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/subagents/subagent-results.ts`**

```typescript
import * as fs from "node:fs";

/**
 * Parse a child sub-agent session .jsonl file and extract assistant message text.
 * Returns concatenated assistant text (last N messages for context).
 */
export function parseChildSessionResults(sessionFilePath: string): string {
  try {
    const content = fs.readFileSync(sessionFilePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());
    const assistantTexts: string[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "message") continue;
        if (entry.message?.role !== "assistant") continue;

        const text = extractText(entry.message.content);
        if (text.trim()) assistantTexts.push(text);
      } catch {
        // Skip malformed lines
      }
    }

    return assistantTexts.join("\n\n");
  } catch {
    return "";
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (p): p is { type: string; text: string } =>
        typeof p === "object" &&
        p !== null &&
        (p as Record<string, unknown>).type === "text",
    )
    .map((p) => p.text)
    .join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/subagent-support.test.ts`

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/subagents/subagent-results.ts tests/subagent-support.test.ts
git commit -m "feat(subagents): implement child session .jsonl parser"
```

---

### Task 3: Wire detection and caching into index.ts

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Add sub-agent detection on session_start**

In the `session_start` handler, after `state.manualMode = config.manualMode.default;`:

```typescript
state.isSubAgent = process.env.PI_SUBAGENT_CHILD === "1";
```

- [ ] **Step 2: Add early return in context handler when running as sub-agent**

At the top of the `context` handler (after `if (!config.enabled) return;`):

```typescript
if (state.isSubAgent && !config.experimental.allowSubAgents) return;
```

- [ ] **Step 3: Add result caching on tool_execution_end**

Import the parser:

```typescript
import { parseChildSessionResults } from "./subagents/subagent-results.ts";
```

In the `tool_execution_end` handler (add a separate one or extend existing), add handling for subagent tool:

```typescript
pi.on("tool_execution_end", async (event, _ctx) => {
  if (!config.enabled) return;

  // Compression timing (Phase 2)
  if (event.toolName === "compress") {
    // ... existing timing logic ...
  }

  // Sub-agent result caching (Phase 9)
  if (event.toolName === "subagent") {
    const details = event.result?.details as
      | Record<string, unknown>
      | undefined;
    const childSessionPath = details?.childSessionPath;
    if (typeof childSessionPath === "string") {
      const resultText = parseChildSessionResults(childSessionPath);
      if (resultText) {
        state.subAgentResultCache.set(event.toolCallId, resultText);
      }
    }
  }
});
```

Note: If a `tool_execution_end` handler already exists (from Phase 2), merge the subagent logic into it rather than registering a duplicate handler.

- [ ] **Step 4: Run full check**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npm run check`

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/index.ts
git commit -m "feat(subagents): detect child sessions and cache results on tool_execution_end"
```

---

## Verification Checklist

- [ ] `npm run check` passes
- [ ] `PI_SUBAGENT_CHILD=1` causes early return from context handler
- [ ] `experimental.allowSubAgents: true` overrides the skip
- [ ] `"subagent"` in BASE_PROTECTED_TOOLS prevents pruning
- [ ] Child session .jsonl parsed correctly (handles malformed lines)
- [ ] Cached results keyed by toolCallId in state
