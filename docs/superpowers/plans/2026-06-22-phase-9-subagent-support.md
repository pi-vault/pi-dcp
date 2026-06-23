# Phase 9: Sub-Agent Support

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DCP aware of Pi's sub-agent system — skip DCP processing when running as a child agent, cache child session results in the parent, and enrich compression summaries with those cached results.

**Architecture:** Detect sub-agent child sessions via `process.env.PI_SUBAGENT_CHILD === "1"`. On `tool_execution_end` for subagent tool calls, read the child session `.jsonl` file and cache assistant messages. Protect subagent tool results from pruning. Enrich compression summaries with cached child session content.

**Tech Stack:** TypeScript, Node.js `fs`, Vitest

---

## File Structure

| File                                          | Responsibility                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `src/subagents/subagent-results.ts`           | New: session file parser                                                    |
| `src/state/types.ts`                          | Add `isSubAgent`, `subAgentResultCache` to state                            |
| `src/state/state.ts`                          | Initialize new fields                                                       |
| `src/config.ts`                               | Add `experimental.allowSubAgents`, add `"subagent"` to BASE_PROTECTED_TOOLS |
| `src/index.ts`                                | Detection on session_start, caching on tool_execution_end, skip logic       |
| `src/compress/protected-content.ts`           | Add `appendSubAgentResults` enrichment step                                 |
| `src/compress/handler.ts`                     | Pass subAgentResultCache to enrichment                                      |
| `tests/helpers.ts`                            | Add `experimental` to `makeDefaultConfig`                                   |
| `tests/subagent-support.test.ts`              | Unit tests for parsing                                                      |
| `tests/subagent-enrichment.test.ts`           | Unit tests for compression enrichment with cached results                   |
| `tests/index.test.ts`                         | Integration tests for detection, skip, and caching                          |
| `tests/config.test.ts`                        | Config parsing test for experimental.allowSubAgents                         |

---

### Task 1: Add state fields, config, and update test helper

**Files:**

- Modify: `src/state/types.ts`
- Modify: `src/state/state.ts`
- Modify: `src/config.ts`
- Modify: `tests/helpers.ts`

- [ ] **Step 1: Add fields to `SessionState`**

In `src/state/types.ts`, add to `SessionState` (after `compressionTiming`):

```typescript
/** True if this session is running as a sub-agent child. */
isSubAgent: boolean;
/** Cached sub-agent results from completed child sessions, keyed by toolCallId. */
subAgentResultCache: Map<string, string>;
```

- [ ] **Step 2: Initialize in state factory**

In `src/state/state.ts`, add to `createSessionState()` (after `compressionTiming`):

```typescript
    isSubAgent: false,
    subAgentResultCache: new Map(),
```

In `resetSessionState()` (after the compressionTiming clears):

```typescript
state.isSubAgent = false;
state.subAgentResultCache.clear();
```

- [ ] **Step 3: Add config and protected tools**

In `src/config.ts`:

Add the interface (before `DcpConfig`):

```typescript
export interface ExperimentalConfig {
  allowSubAgents: boolean;
}
```

Add to `DcpConfig`:

```typescript
experimental: ExperimentalConfig;
```

Add to `DEFAULT_CONFIG`:

```typescript
  experimental: {
    allowSubAgents: false,
  },
```

Add `"experimental"` to `KNOWN_TOP_LEVEL_KEYS`:

```typescript
const KNOWN_TOP_LEVEL_KEYS = new Set([
  "enabled", "debug", "compress", "manualMode", "strategies",
  "protectedFilePatterns", "nudgeNotification", "nudgeNotificationType",
  "experimental",
]);
```

Add parsing at the end of `mergeConfig`:

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

- [ ] **Step 4: Update test helper**

In `tests/helpers.ts`, add `experimental` to `makeDefaultConfig()`:

```typescript
export function makeDefaultConfig(overrides?: Partial<DcpConfig["compress"]>): DcpConfig {
  return {
    // ... existing fields ...
    experimental: { allowSubAgents: false },
  };
}
```

This is required because `DcpConfig` now requires `experimental`. Without this change, the entire test suite (42 files, 319 tests) will fail with type errors.

- [ ] **Step 5: Run typecheck + tests**

Run: `npm run check`

Expected: No errors. All 319 existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/state/types.ts src/state/state.ts src/config.ts tests/helpers.ts
git commit -m "feat(subagents): add state fields and config for sub-agent support"
```

---

### Task 2: Implement session file parser

**Files:**

- Create: `src/subagents/subagent-results.ts`
- Create: `tests/subagent-support.test.ts`

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

  it("handles string content (non-array)", () => {
    const sessionFile = path.join(tempDir, "session.jsonl");
    const entries = [
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: "Plain string content",
        },
      }),
    ];
    fs.writeFileSync(sessionFile, entries.join("\n"));

    const result = parseChildSessionResults(sessionFile);
    expect(result).toBe("Plain string content");
  });

  it("handles empty file", () => {
    const sessionFile = path.join(tempDir, "session.jsonl");
    fs.writeFileSync(sessionFile, "");

    const result = parseChildSessionResults(sessionFile);
    expect(result).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/subagent-support.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/subagents/subagent-results.ts`**

Create directory `src/subagents/` and create the file:

```typescript
import * as fs from "node:fs";

/**
 * Parse a child sub-agent session .jsonl file and extract assistant message text.
 * Returns concatenated assistant text.
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

Run: `npx vitest run tests/subagent-support.test.ts`

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/subagents/subagent-results.ts tests/subagent-support.test.ts
git commit -m "feat(subagents): implement child session .jsonl parser"
```

---

### Task 3: Wire detection, caching, and skip logic into index.ts

**Files:**

- Modify: `src/index.ts`

**Important:** There is an existing `tool_execution_end` handler at line 218 for compression timing. Do NOT register a second handler — merge subagent logic into the existing one.

- [ ] **Step 1: Add import**

Add at top of `src/index.ts`:

```typescript
import { parseChildSessionResults } from "./subagents/subagent-results.ts";
```

- [ ] **Step 2: Add sub-agent detection on session_start**

In the `session_start` handler, after `state.manualMode = config.manualMode.default;` (line 132):

```typescript
state.isSubAgent = process.env.PI_SUBAGENT_CHILD === "1";
```

- [ ] **Step 3: Add early return in `before_agent_start` handler**

In the `before_agent_start` handler (line 115), after `if (config.compress.permission === "deny") return;`:

```typescript
if (state.isSubAgent && !config.experimental.allowSubAgents) return;
```

This prevents DCP system prompt injection in sub-agent sessions. Without the DCP prompt, the child model won't produce DCP-related tags, so `message_end` stripping becomes harmless (no-op).

- [ ] **Step 4: Add early return in `context` handler**

In the `context` handler (line 248), after `if (!config.enabled) return;`:

```typescript
if (state.isSubAgent && !config.experimental.allowSubAgents) return;
```

This is the primary skip — prevents the full DCP pipeline from running in sub-agent sessions.

- [ ] **Step 5: Merge result caching into existing `tool_execution_end` handler**

The existing handler (line 218) currently returns early if `event.toolName !== "compress"`. Restructure it to handle both compress and subagent tool names:

```typescript
pi.on("tool_execution_end", async (event, _ctx) => {
  if (!config.enabled) return;

  // Compression timing (Phase 2)
  if (event.toolName === "compress") {
    const startTime = state.compressionTiming.startTimes.get(event.toolCallId);
    if (startTime === undefined) return;

    const durationMs = Date.now() - startTime;
    state.compressionTiming.startTimes.delete(event.toolCallId);

    if (event.isError) return;

    let latestBlockId: number | undefined;
    let latestCreatedAt = 0;
    for (const [blockId, block] of state.prune.messages.blocksById) {
      if (block.createdAt > latestCreatedAt) {
        latestCreatedAt = block.createdAt;
        latestBlockId = blockId;
      }
    }

    if (latestBlockId !== undefined) {
      state.compressionTiming.callIdToBlockId.set(event.toolCallId, latestBlockId);
    }
    state.compressionTiming.pendingDurations.set(event.toolCallId, durationMs);
    return;
  }

  // Sub-agent result caching (Phase 9)
  if (event.toolName === "subagent" && !event.isError) {
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

Note on `event.result`: `ToolExecutionEndEvent.result` is typed as `any` in Pi's extension API. `AgentToolResult<T>` has `details: T` for arbitrary structured data. The subagent tool is expected to populate `details.childSessionPath` with the child session file path. If this property is absent (e.g., different subagent implementation), caching silently skips.

- [ ] **Step 6: Clear cache on session_compact**

In the `session_compact` handler (line 168), add after the compression timing clears:

```typescript
state.subAgentResultCache.clear();
```

This prevents stale cached results from referencing tool calls that no longer exist after compaction.

- [ ] **Step 7: Run full check**

Run: `npm run check`

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/index.ts
git commit -m "feat(subagents): detect child sessions, cache results, skip DCP in sub-agents"
```

---

### Task 4: Enrich compression summaries with cached sub-agent results

**Files:**

- Modify: `src/compress/protected-content.ts`
- Modify: `src/compress/handler.ts`
- Create: `tests/subagent-enrichment.test.ts`

The spec requires: "When compressing messages containing subagent tool results, read cached result text and merge into the summary." Without this, `subAgentResultCache` is dead state.

- [ ] **Step 1: Write tests for sub-agent enrichment**

Create `tests/subagent-enrichment.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { appendSubAgentResults } from "../src/compress/protected-content.ts";

describe("appendSubAgentResults", () => {
  it("appends cached child session content for subagent tool results in range", () => {
    const messages: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "call-sub-1",
        toolName: "subagent",
        content: [{ type: "text", text: "Subagent completed successfully" }],
        isError: false,
        timestamp: 1000,
      } as AgentMessage,
    ];
    const cache = new Map([
      ["call-sub-1", "Child assistant: I refactored the module.\n\nChild assistant: All tests pass."],
    ]);

    const result = appendSubAgentResults("Original summary", messages, cache);
    expect(result).toContain("Original summary");
    expect(result).toContain("I refactored the module");
    expect(result).toContain("All tests pass");
    expect(result).toContain("[Sub-Agent Results: call-sub-1]");
  });

  it("returns summary unchanged when no subagent results in range", () => {
    const messages: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "call-read-1",
        toolName: "read",
        content: [{ type: "text", text: "file contents" }],
        isError: false,
        timestamp: 1000,
      } as AgentMessage,
    ];
    const cache = new Map<string, string>();

    const result = appendSubAgentResults("Summary", messages, cache);
    expect(result).toBe("Summary");
  });

  it("skips error subagent results", () => {
    const messages: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "call-sub-err",
        toolName: "subagent",
        content: [{ type: "text", text: "Error" }],
        isError: true,
        timestamp: 1000,
      } as AgentMessage,
    ];
    const cache = new Map([["call-sub-err", "Some cached text"]]);

    const result = appendSubAgentResults("Summary", messages, cache);
    expect(result).toBe("Summary");
  });

  it("returns summary unchanged when cache is empty", () => {
    const messages: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "call-sub-1",
        toolName: "subagent",
        content: [{ type: "text", text: "Done" }],
        isError: false,
        timestamp: 1000,
      } as AgentMessage,
    ];
    const cache = new Map<string, string>();

    const result = appendSubAgentResults("Summary", messages, cache);
    expect(result).toBe("Summary");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/subagent-enrichment.test.ts`

Expected: FAIL — `appendSubAgentResults` does not exist.

- [ ] **Step 3: Implement `appendSubAgentResults` in `protected-content.ts`**

Add to `src/compress/protected-content.ts`:

```typescript
/**
 * Append cached sub-agent child session results to the summary.
 * Looks up toolCallId for subagent tool results in the compressed range.
 */
export function appendSubAgentResults(
  summary: string,
  messages: AgentMessage[],
  cache: Map<string, string>,
): string {
  if (cache.size === 0) return summary;

  const outputs: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "toolResult") continue;
    if (msg.isError) continue;
    if (msg.toolName !== "subagent") continue;

    const cached = cache.get(msg.toolCallId);
    if (cached?.trim()) {
      outputs.push(`[Sub-Agent Results: ${msg.toolCallId}]\n${cached}`);
    }
  }

  if (outputs.length === 0) return summary;

  return `${summary}\n\n---\n${outputs.join("\n\n")}`;
}
```

- [ ] **Step 4: Wire into `enrichSummaryWithProtectedContent`**

Update the function signature to accept an optional cache parameter:

```typescript
export function enrichSummaryWithProtectedContent(
  summary: string,
  messages: AgentMessage[],
  config: DcpConfig,
  subAgentResultCache?: Map<string, string>,
): string {
  let enriched = summary;
  enriched = appendProtectedUserMessages(enriched, messages, config.compress.protectUserMessages);
  enriched = appendProtectedPromptInfo(enriched, messages, config.compress.protectTags);
  enriched = appendProtectedToolOutputs(enriched, messages, config.compress.protectedTools);
  if (subAgentResultCache) {
    enriched = appendSubAgentResults(enriched, messages, subAgentResultCache);
  }
  return enriched;
}
```

- [ ] **Step 5: Pass cache from `handleCompress`**

In `src/compress/handler.ts`, the `handleCompress` function already receives `state: SessionState`. Update the `enrichSummaryWithProtectedContent` call to pass the cache:

```typescript
const enrichedSummary = enrichSummaryWithProtectedContent(
  entry.summary,
  rangeMessages,
  config,
  state.subAgentResultCache,
);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/subagent-enrichment.test.ts`

Expected: All PASS.

- [ ] **Step 7: Run full check**

Run: `npm run check`

Expected: All pass (including existing protected-content tests).

- [ ] **Step 8: Commit**

```bash
git add src/compress/protected-content.ts src/compress/handler.ts tests/subagent-enrichment.test.ts
git commit -m "feat(subagents): enrich compression summaries with cached child session results"
```

---

### Task 5: Integration tests and config test

**Files:**

- Modify: `tests/index.test.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Add integration tests to `tests/index.test.ts`**

Add these tests (follow existing patterns — use `createMockApi()`, fire handlers directly):

```typescript
describe("sub-agent support", () => {
  it("context handler returns early when PI_SUBAGENT_CHILD=1", async () => {
    const originalEnv = process.env.PI_SUBAGENT_CHILD;
    process.env.PI_SUBAGENT_CHILD = "1";

    try {
      const { api, handlers } = createMockApi();
      createExtension(api);

      // Fire session_start to set isSubAgent
      const sessionStartHandler = handlers.get("session_start")?.[0];
      await (sessionStartHandler as (...args: unknown[]) => Promise<void>)(
        { reason: "new" },
        {
          sessionManager: { getSessionDir: () => "/tmp/test-session" },
          getContextUsage: () => ({ tokens: 100, contextWindow: 200000, percent: 0.05 }),
        },
      );

      // Fire context — should return early (undefined), not { messages: [...] }
      const contextHandler = handlers.get("context")?.[0];
      const result = await (contextHandler as (...args: unknown[]) => Promise<unknown>)(
        { messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() }] },
        { getContextUsage: () => ({ tokens: 100, contextWindow: 200000, percent: 0.05 }) },
      );

      expect(result).toBeUndefined();
    } finally {
      if (originalEnv === undefined) delete process.env.PI_SUBAGENT_CHILD;
      else process.env.PI_SUBAGENT_CHILD = originalEnv;
    }
  });

  it("before_agent_start returns early when PI_SUBAGENT_CHILD=1", async () => {
    const originalEnv = process.env.PI_SUBAGENT_CHILD;
    process.env.PI_SUBAGENT_CHILD = "1";

    try {
      const { api, handlers } = createMockApi();
      createExtension(api);

      // Fire session_start
      const sessionStartHandler = handlers.get("session_start")?.[0];
      await (sessionStartHandler as (...args: unknown[]) => Promise<void>)(
        { reason: "new" },
        {
          sessionManager: { getSessionDir: () => "/tmp/test-session" },
          getContextUsage: () => ({ tokens: 100, contextWindow: 200000, percent: 0.05 }),
        },
      );

      // Fire before_agent_start — should return early
      const handler = handlers.get("before_agent_start")?.[0];
      const result = await (handler as (...args: unknown[]) => Promise<unknown>)(
        { systemPrompt: "Original", prompt: "input" },
        {},
      );

      expect(result).toBeUndefined();
    } finally {
      if (originalEnv === undefined) delete process.env.PI_SUBAGENT_CHILD;
      else process.env.PI_SUBAGENT_CHILD = originalEnv;
    }
  });
});
```

- [ ] **Step 2: Add config test to `tests/config.test.ts`**

Add to the existing `describe("config")` block:

```typescript
it("parses experimental.allowSubAgents", () => {
  const configPath = path.join(tempDir, "dcp.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({ experimental: { allowSubAgents: true } }),
  );
  const { config } = loadConfig(configPath);
  expect(config.experimental.allowSubAgents).toBe(true);
});

it("defaults experimental.allowSubAgents to false", () => {
  const configPath = path.join(tempDir, "dcp.json");
  const { config } = loadConfig(configPath);
  expect(config.experimental.allowSubAgents).toBe(false);
});
```

- [ ] **Step 3: Run full check**

Run: `npm run check`

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add tests/index.test.ts tests/config.test.ts
git commit -m "test(subagents): add integration tests for detection, skip, config, and caching"
```

---

## Design Notes

**Persistence:** `isSubAgent` is derived from `process.env.PI_SUBAGENT_CHILD` on every `session_start` — no persistence needed. `subAgentResultCache` is keyed by `toolCallId` which doesn't survive compaction, so it's not persisted either.

**Event shape:** `ToolExecutionEndEvent.result` is typed `any` in Pi's extension API. `AgentToolResult<T>` has `details: T` for arbitrary structured data. The subagent tool is expected to populate `result.details.childSessionPath` with the child session file path. If this property is absent (e.g., different subagent implementation), caching silently skips.

**Skip scope:** Sub-agent skip covers `before_agent_start` (no DCP system prompt) and `context` (no pipeline). Other handlers (`message_end`, `tool_execution_start/end`, `session_compact`) are left active — they're lightweight no-ops when DCP tags aren't present in the conversation.

---

## Verification Checklist

- [ ] `npm run check` passes (all existing 319+ tests still green)
- [ ] `PI_SUBAGENT_CHILD=1` causes early return from `context` and `before_agent_start`
- [ ] `experimental.allowSubAgents: true` overrides the skip
- [ ] `"subagent"` in `BASE_PROTECTED_TOOLS` prevents pruning by strategies
- [ ] Child session `.jsonl` parsed correctly (handles malformed lines, empty files, string content)
- [ ] Cached results keyed by `toolCallId` in state
- [ ] Cached results enriched into compression summaries via `appendSubAgentResults`
- [ ] `subAgentResultCache` cleared on `session_compact`
- [ ] `makeDefaultConfig` in test helper includes `experimental` field
