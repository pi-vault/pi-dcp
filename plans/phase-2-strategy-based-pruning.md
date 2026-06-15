# Phase 2: Strategy-Based Pruning

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **IMPORTANT:** Read `plans/ERRATA.md` before implementing. It contains corrections to API signatures, type shapes, and import paths verified against Pi source.

**Prerequisite:** Phase 1 (Scaffold + Foundation) completed and passing.

**Goal:** Add automatic tool output deduplication and old error pruning to the extension. After this phase, pi-dcp actively reduces context size by replacing superseded tool outputs and stale error inputs with compact placeholders.

**Usable result after this phase:** The extension automatically detects duplicate tool calls (same tool + identical parameters), keeps only the most recent output, and replaces older ones with `[Output removed to save context]`. It also detects errored tool calls older than N turns and replaces their inputs with `[input removed due to failed tool call]`. Both strategies respect protected tool lists and file path patterns.

**Architecture:** The context pipeline (in the `context` event handler) gains four steps:
1. Strip hallucinated DCP tags from assistant messages
2. Sync tool parameter cache + build tool ID list
3. Run strategies (deduplication, purge-errors) to mark tool call IDs for pruning
4. Apply pruning — replace tool result content for marked IDs

**Reference Material:**
- Original DCP strategies: `opencode-dynamic-context-pruning/lib/strategies/deduplication.ts`, `purge-errors.ts`
- Original DCP pruning: `opencode-dynamic-context-pruning/lib/messages/prune.ts`
- Original DCP protected patterns: `opencode-dynamic-context-pruning/lib/protected-patterns.ts`
- Original DCP tool cache: `opencode-dynamic-context-pruning/lib/state/tool-cache.ts`
- Original DCP strip: `opencode-dynamic-context-pruning/lib/messages/utils.ts` (stripHallucinations)
- Pi message types: `AgentMessage` union — `toolResult` role has `toolCallId`, `toolName`, `content`, `isError`
- Pi assistant messages: `content` array with `{ type: "toolCall", id, name, arguments }` items
- Phase 1 state types: `src/state/types.ts` (SessionState, ToolParameterEntry, Prune)

**Key adaptation from OpenCode DCP:**
- OpenCode uses `WithParts` (message with `.parts[]` containing tool parts with `.callID`, `.state.status`, `.state.output`).
- Pi uses `AgentMessage` union. Tool calls live in `assistant` messages as `{ type: "toolCall", id, name, arguments }` content items. Tool results are separate `toolResult` messages with `toolCallId`, `toolName`, `content[]`, `isError`.
- Pruning in OpenCode mutates `part.state.output` in-place. In Pi, we return a new message array with replaced `content` arrays (Pi's `context` handler expects returned `{ messages }`).

**Conventions:**
- Strategies are pure functions: `(state, config) => { pruned, tokensSaved }`. They only write to `state.prune.tools`.
- Pruning is a pure transform: `(state, messages) => messages`. Returns new array, does not mutate input.
- All functions are unit-testable without Pi mocks.

---

## File Structure (additions to Phase 1)

```
src/
  strategies/
    protected-patterns.ts       # Glob matching, tool/file protection
    deduplication.ts             # Signature-based dedup strategy
    purge-errors.ts              # Age-gated error input pruning
  state/
    tool-cache.ts                # Sync tool parameters + build ID list
  messages/
    prune.ts                     # Apply pruning marks to messages
    strip.ts                     # Strip hallucinated DCP tags
tests/
  protected-patterns.test.ts
  deduplication.test.ts
  purge-errors.test.ts
  tool-cache.test.ts
  prune.test.ts
  strip.test.ts
```

---

### Task 1: Protected Patterns

**Files:**
- Create: `src/strategies/protected-patterns.ts`
- Test: `tests/protected-patterns.test.ts`

Glob matching for tool name and file path protection. Tools in the protected list are never pruned by strategies.

- [ ] **Step 1: Write tests**

Create `tests/protected-patterns.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  matchesGlob,
  isToolNameProtected,
  getFilePathsFromParameters,
  isFilePathProtected,
} from "../src/strategies/protected-patterns.ts";

describe("protected-patterns", () => {
  describe("matchesGlob", () => {
    it("matches exact strings", () => {
      expect(matchesGlob("bash", "bash")).toBe(true);
      expect(matchesGlob("bash", "read")).toBe(false);
    });

    it("matches * wildcard", () => {
      expect(matchesGlob("test_foo", "test_*")).toBe(true);
      expect(matchesGlob("other", "test_*")).toBe(false);
    });

    it("matches ** for paths", () => {
      expect(matchesGlob("src/foo/bar.ts", "src/**/*.ts")).toBe(true);
      expect(matchesGlob("src/foo/bar.ts", "src/**/*.ts")).toBe(false);
    });

    it("matches ? single char", () => {
      expect(matchesGlob("ab", "a?")).toBe(true);
      expect(matchesGlob("abc", "a?")).toBe(false);
    });
  });

  describe("isToolNameProtected", () => {
    it("checks exact match", () => {
      expect(isToolNameProtected("bash", ["bash", "read"])).toBe(true);
      expect(isToolNameProtected("write", ["bash", "read"])).toBe(false);
    });

    it("checks glob patterns", () => {
      expect(isToolNameProtected("todo_write", ["todo*"])).toBe(true);
      expect(isToolNameProtected("other", ["todo*"])).toBe(false);
    });

    it("returns false for empty patterns", () => {
      expect(isToolNameProtected("bash", [])).toBe(false);
    });
  });

  describe("getFilePathsFromParameters", () => {
    it("extracts filePath from standard tools", () => {
      const paths = getFilePathsFromParameters("read", {
        filePath: "/tmp/foo.ts",
      });
      expect(paths).toEqual(["/tmp/foo.ts"]);
    });

    it("returns empty for tools without file paths", () => {
      const paths = getFilePathsFromParameters("bash", { command: "ls" });
      expect(paths).toEqual([]);
    });
  });

  describe("isFilePathProtected", () => {
    it("matches file paths against glob patterns", () => {
      expect(isFilePathProtected(["/src/config.ts"], ["src/**/*.ts"])).toBe(true);
      expect(isFilePathProtected(["/tmp/foo.ts"], ["src/**/*.ts"])).toBe(false);
    });

    it("returns false for empty paths or patterns", () => {
      expect(isFilePathProtected([], ["src/**"])).toBe(false);
      expect(isFilePathProtected(["/tmp/a"], [])).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/protected-patterns.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement protected patterns**

Create `src/strategies/protected-patterns.ts`:

```typescript
/**
 * Glob matching and tool/file path protection for pruning strategies.
 *
 * Custom glob implementation (no external dependency) supporting:
 * - `*` matches any chars except `/`
 * - `**` matches any chars including `/`
 * - `?` matches single char except `/`
 */

export function matchesGlob(input: string, pattern: string): boolean {
  return globToRegex(pattern).test(input);
}

function globToRegex(pattern: string): RegExp {
  let result = "^";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          result += "(?:.*/)?";
          i += 3;
        } else {
          result += ".*";
          i += 2;
        }
      } else {
        result += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      result += "[^/]";
      i += 1;
    } else if (".+^${}()|[]\\".includes(c)) {
      result += "\\" + c;
      i += 1;
    } else {
      result += c;
      i += 1;
    }
  }
  result += "$";
  return new RegExp(result);
}

export function isToolNameProtected(
  toolName: string,
  protectedPatterns: string[],
): boolean {
  for (const pattern of protectedPatterns) {
    if (pattern === toolName) return true;
    if (pattern.includes("*") || pattern.includes("?")) {
      if (matchesGlob(toolName, pattern)) return true;
    }
  }
  return false;
}

export function getFilePathsFromParameters(
  toolName: string,
  parameters: Record<string, unknown>,
): string[] {
  const paths: string[] = [];
  if (typeof parameters.filePath === "string") {
    paths.push(parameters.filePath);
  }
  return paths;
}

export function isFilePathProtected(
  filePaths: string[],
  patterns: string[],
): boolean {
  if (filePaths.length === 0 || patterns.length === 0) return false;
  return filePaths.some((fp) => patterns.some((p) => matchesGlob(fp, p)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- tests/protected-patterns.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategies/protected-patterns.ts tests/protected-patterns.test.ts
git commit -m "feat: add glob matching for tool and file path protection"
```

---

### Task 2: Tool Parameter Cache

**Files:**
- Create: `src/state/tool-cache.ts`
- Test: `tests/tool-cache.test.ts`

Scans Pi's `AgentMessage[]` to populate `state.toolParameters` and `state.toolIdList`. Tool calls come from `assistant` messages (`content[].type === "toolCall"`), results from `toolResult` messages.

- [ ] **Step 1: Write tests**

Create `tests/tool-cache.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { syncToolCache, buildToolIdList } from "../src/state/tool-cache.ts";
import { createSessionState } from "../src/state/state.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

function makeAssistantWithToolCall(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): AgentMessage {
  return {
    role: "assistant",
    content: [
      { type: "toolCall", id: toolCallId, name: toolName, arguments: args },
    ],
    stopReason: "toolUse",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
    timestamp: Date.now(),
  } as AgentMessage;
}

function makeToolResult(
  toolCallId: string,
  toolName: string,
  isError = false,
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text: "result" }],
    isError,
    timestamp: Date.now(),
  } as AgentMessage;
}

describe("tool-cache", () => {
  describe("syncToolCache", () => {
    it("populates toolParameters from messages", () => {
      const state = createSessionState();
      state.currentTurn = 1;

      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("call1", "read", { filePath: "/tmp/foo.ts" }),
        makeToolResult("call1", "read"),
      ];

      syncToolCache(state, messages);

      expect(state.toolParameters.has("call1")).toBe(true);
      const entry = state.toolParameters.get("call1")!;
      expect(entry.tool).toBe("read");
      expect(entry.status).toBe("completed");
    });

    it("detects error status from tool result", () => {
      const state = createSessionState();
      state.currentTurn = 2;

      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("call1", "bash", { command: "fail" }),
        makeToolResult("call1", "bash", true),
      ];

      syncToolCache(state, messages);
      expect(state.toolParameters.get("call1")!.status).toBe("error");
    });

    it("does not overwrite existing entries", () => {
      const state = createSessionState();
      state.currentTurn = 3;
      state.toolParameters.set("call1", {
        tool: "read",
        parameters: { filePath: "/old" },
        status: "completed",
        error: undefined,
        turn: 1,
        tokenCount: 50,
      });

      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("call1", "read", { filePath: "/new" }),
        makeToolResult("call1", "read"),
      ];

      syncToolCache(state, messages);
      // Original entry preserved
      expect((state.toolParameters.get("call1")!.parameters as any).filePath).toBe("/old");
    });
  });

  describe("buildToolIdList", () => {
    it("collects tool call IDs in order", () => {
      const state = createSessionState();
      const messages: AgentMessage[] = [
        makeAssistantWithToolCall("c1", "read", {}),
        makeToolResult("c1", "read"),
        makeAssistantWithToolCall("c2", "write", {}),
        makeToolResult("c2", "write"),
      ];

      buildToolIdList(state, messages);
      expect(state.toolIdList).toEqual(["c1", "c2"]);
    });

    it("handles empty messages", () => {
      const state = createSessionState();
      buildToolIdList(state, []);
      expect(state.toolIdList).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/tool-cache.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement tool cache**

Create `src/state/tool-cache.ts`:

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState, ToolParameterEntry } from "./types.ts";

/**
 * Scan messages and populate state.toolParameters with metadata for each tool call.
 * Called on every context event to keep the cache current.
 *
 * Pi message model:
 * - Tool calls are in `assistant` messages: content[].type === "toolCall"
 * - Tool results are separate `toolResult` messages with toolCallId, isError
 */
export function syncToolCache(
  state: SessionState,
  messages: AgentMessage[],
): void {
  // First pass: collect tool results
  const resultsByCallId = new Map<string, { isError: boolean; errorText?: string }>();
  for (const msg of messages) {
    if (msg.role !== "toolResult") continue;
    resultsByCallId.set(msg.toolCallId, {
      isError: msg.isError,
      errorText: msg.isError ? extractToolResultText(msg) : undefined,
    });
  }

  // Second pass: collect tool calls from assistant messages
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    if (!Array.isArray(msg.content)) continue;

    for (const part of msg.content) {
      if (typeof part !== "object" || part === null) continue;
      const p = part as Record<string, unknown>;
      if (p.type !== "toolCall" || typeof p.id !== "string") continue;

      const callId = p.id as string;
      if (state.toolParameters.has(callId)) continue;

      const result = resultsByCallId.get(callId);
      const entry: ToolParameterEntry = {
        tool: (p.name as string) ?? "unknown",
        parameters: p.arguments ?? {},
        status: result ? (result.isError ? "error" : "completed") : "pending",
        error: result?.errorText,
        turn: state.currentTurn,
        tokenCount: undefined,
      };

      state.toolParameters.set(callId, entry);
    }
  }
}

/**
 * Build ordered list of tool call IDs from messages.
 */
export function buildToolIdList(
  state: SessionState,
  messages: AgentMessage[],
): void {
  const ids: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    if (!Array.isArray(msg.content)) continue;

    for (const part of msg.content) {
      if (typeof part !== "object" || part === null) continue;
      const p = part as Record<string, unknown>;
      if (p.type === "toolCall" && typeof p.id === "string") {
        ids.push(p.id as string);
      }
    }
  }
  state.toolIdList = ids;
}

function extractToolResultText(msg: AgentMessage): string | undefined {
  if (msg.role !== "toolResult") return undefined;
  if (!Array.isArray(msg.content)) return undefined;
  const texts: string[] = [];
  for (const part of msg.content) {
    if (typeof part === "object" && part !== null && (part as any).type === "text") {
      texts.push((part as any).text);
    }
  }
  return texts.join("\n") || undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm run typecheck
pnpm test -- tests/tool-cache.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/tool-cache.ts tests/tool-cache.test.ts
git commit -m "feat: add tool parameter cache for strategy support"
```

---

### Task 3: Deduplication Strategy

**Files:**
- Create: `src/strategies/deduplication.ts`
- Test: `tests/deduplication.test.ts`

Identifies repeated tool calls with identical signature (tool name + normalized parameters), keeps only the most recent, marks older ones for pruning.

- [ ] **Step 1: Write tests**

Create `tests/deduplication.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { deduplicate, createToolSignature } from "../src/strategies/deduplication.ts";
import { createSessionState } from "../src/state/state.ts";
import type { DcpConfig } from "../src/config.ts";

function makeDefaultConfig(): DcpConfig {
  return {
    enabled: true,
    debug: false,
    compress: {
      mode: "range",
      permission: "allow",
      maxContextPercent: 80,
      minContextPercent: 50,
      nudgeFrequency: 5,
      iterationNudgeThreshold: 15,
      nudgeForce: "soft",
      protectedTools: [],
      protectUserMessages: false,
      protectTags: false,
    },
    manualMode: { default: false, automaticStrategies: true },
    strategies: {
      deduplication: { enabled: true, protectedTools: [] },
      purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
    },
    protectedFilePatterns: [],
    nudgeNotification: "minimal",
  };
}

describe("deduplication", () => {
  describe("createToolSignature", () => {
    it("creates deterministic signature", () => {
      const sig1 = createToolSignature("read", { filePath: "/tmp/a.ts" });
      const sig2 = createToolSignature("read", { filePath: "/tmp/a.ts" });
      expect(sig1).toBe(sig2);
    });

    it("normalizes key order", () => {
      const sig1 = createToolSignature("edit", { filePath: "a", content: "b" });
      const sig2 = createToolSignature("edit", { content: "b", filePath: "a" });
      expect(sig1).toBe(sig2);
    });

    it("strips null/undefined values", () => {
      const sig1 = createToolSignature("read", { filePath: "a" });
      const sig2 = createToolSignature("read", { filePath: "a", extra: null });
      expect(sig1).toBe(sig2);
    });
  });

  describe("deduplicate", () => {
    it("marks older duplicate tool calls for pruning", () => {
      const state = createSessionState();
      const config = makeDefaultConfig();

      state.toolParameters.set("call1", {
        tool: "grep",
        parameters: { pattern: "foo" },
        status: "completed",
        error: undefined,
        turn: 1,
        tokenCount: 100,
      });
      state.toolParameters.set("call2", {
        tool: "grep",
        parameters: { pattern: "foo" },
        status: "completed",
        error: undefined,
        turn: 2,
        tokenCount: 100,
      });
      state.toolIdList = ["call1", "call2"];

      const result = deduplicate(state, config);
      expect(result.pruned).toBe(1);
      expect(state.prune.tools.has("call1")).toBe(true);
      expect(state.prune.tools.has("call2")).toBe(false);
    });

    it("skips protected tools (BASE_PROTECTED_TOOLS)", () => {
      const state = createSessionState();
      const config = makeDefaultConfig();

      state.toolParameters.set("call1", {
        tool: "bash",
        parameters: { command: "ls" },
        status: "completed",
        error: undefined,
        turn: 1,
        tokenCount: 50,
      });
      state.toolParameters.set("call2", {
        tool: "bash",
        parameters: { command: "ls" },
        status: "completed",
        error: undefined,
        turn: 2,
        tokenCount: 50,
      });
      state.toolIdList = ["call1", "call2"];

      const result = deduplicate(state, config);
      expect(result.pruned).toBe(0);
    });

    it("does nothing when disabled", () => {
      const state = createSessionState();
      const config = makeDefaultConfig();
      config.strategies.deduplication.enabled = false;

      state.toolParameters.set("call1", {
        tool: "grep",
        parameters: { pattern: "a" },
        status: "completed",
        error: undefined,
        turn: 1,
        tokenCount: 100,
      });
      state.toolParameters.set("call2", {
        tool: "grep",
        parameters: { pattern: "a" },
        status: "completed",
        error: undefined,
        turn: 2,
        tokenCount: 100,
      });
      state.toolIdList = ["call1", "call2"];

      const result = deduplicate(state, config);
      expect(result.pruned).toBe(0);
    });

    it("does not prune already-pruned IDs", () => {
      const state = createSessionState();
      const config = makeDefaultConfig();

      state.prune.tools.set("call1", 100);
      state.toolParameters.set("call1", {
        tool: "grep",
        parameters: { pattern: "a" },
        status: "completed",
        error: undefined,
        turn: 1,
        tokenCount: 100,
      });
      state.toolParameters.set("call2", {
        tool: "grep",
        parameters: { pattern: "a" },
        status: "completed",
        error: undefined,
        turn: 2,
        tokenCount: 100,
      });
      state.toolIdList = ["call1", "call2"];

      const result = deduplicate(state, config);
      expect(result.pruned).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/deduplication.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement deduplication**

Create `src/strategies/deduplication.ts`:

```typescript
import { BASE_PROTECTED_TOOLS, type DcpConfig } from "../config.ts";
import type { SessionState } from "../state/types.ts";
import {
  isToolNameProtected,
  getFilePathsFromParameters,
  isFilePathProtected,
} from "./protected-patterns.ts";

export interface DeduplicationResult {
  pruned: number;
  tokensSaved: number;
}

export function deduplicate(
  state: SessionState,
  config: DcpConfig,
): DeduplicationResult {
  if (!config.strategies.deduplication.enabled) {
    return { pruned: 0, tokensSaved: 0 };
  }

  if (state.manualMode === "active" && !config.manualMode.automaticStrategies) {
    return { pruned: 0, tokensSaved: 0 };
  }

  if (state.toolIdList.length === 0) {
    return { pruned: 0, tokensSaved: 0 };
  }

  const protectedTools = [
    ...BASE_PROTECTED_TOOLS,
    ...config.strategies.deduplication.protectedTools,
  ];

  const unpruned = state.toolIdList.filter((id) => !state.prune.tools.has(id));

  // Group by signature
  const groups = new Map<string, string[]>();
  for (const callId of unpruned) {
    const entry = state.toolParameters.get(callId);
    if (!entry) continue;

    if (isToolNameProtected(entry.tool, protectedTools)) continue;

    const filePaths = getFilePathsFromParameters(
      entry.tool,
      entry.parameters as Record<string, unknown>,
    );
    if (isFilePathProtected(filePaths, config.protectedFilePatterns)) continue;

    const sig = createToolSignature(entry.tool, entry.parameters);
    const group = groups.get(sig) ?? [];
    group.push(callId);
    groups.set(sig, group);
  }

  // For each group with duplicates, prune all but the last (most recent)
  let pruned = 0;
  let tokensSaved = 0;
  for (const [, callIds] of groups) {
    if (callIds.length <= 1) continue;

    for (let i = 0; i < callIds.length - 1; i++) {
      const callId = callIds[i];
      const entry = state.toolParameters.get(callId);
      const tokens = entry?.tokenCount ?? 0;
      state.prune.tools.set(callId, tokens);
      pruned++;
      tokensSaved += tokens;
    }
  }

  state.stats.totalPruneTokens += tokensSaved;
  state.stats.toolsPruned += pruned;

  return { pruned, tokensSaved };
}

export function createToolSignature(toolName: string, parameters: unknown): string {
  const normalized = normalizeParams(parameters);
  return `${toolName}::${JSON.stringify(normalized)}`;
}

function normalizeParams(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizeParams);

  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = normalizeParams(obj[key]);
    if (v !== undefined) {
      sorted[key] = v;
    }
  }
  return sorted;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- tests/deduplication.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategies/deduplication.ts tests/deduplication.test.ts
git commit -m "feat: add signature-based tool deduplication strategy"
```

---

### Task 4: Purge Errors Strategy

**Files:**
- Create: `src/strategies/purge-errors.ts`
- Test: `tests/purge-errors.test.ts`

Prunes input content of errored tool calls after they've aged past a configurable number of turns.

- [ ] **Step 1: Write tests**

Create `tests/purge-errors.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { purgeErrors } from "../src/strategies/purge-errors.ts";
import { createSessionState } from "../src/state/state.ts";
import type { DcpConfig } from "../src/config.ts";

function makeDefaultConfig(): DcpConfig {
  return {
    enabled: true,
    debug: false,
    compress: {
      mode: "range",
      permission: "allow",
      maxContextPercent: 80,
      minContextPercent: 50,
      nudgeFrequency: 5,
      iterationNudgeThreshold: 15,
      nudgeForce: "soft",
      protectedTools: [],
      protectUserMessages: false,
      protectTags: false,
    },
    manualMode: { default: false, automaticStrategies: true },
    strategies: {
      deduplication: { enabled: true, protectedTools: [] },
      purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
    },
    protectedFilePatterns: [],
    nudgeNotification: "minimal",
  };
}

describe("purge-errors", () => {
  it("marks old errored tool calls for pruning", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 10;

    state.toolParameters.set("err1", {
      tool: "grep",
      parameters: { pattern: "foo" },
      status: "error",
      error: "not found",
      turn: 3,
      tokenCount: 200,
    });
    state.toolIdList = ["err1"];

    const result = purgeErrors(state, config);
    expect(result.pruned).toBe(1);
    expect(state.prune.tools.has("err1")).toBe(true);
  });

  it("does not prune recent errors", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 5;

    state.toolParameters.set("err1", {
      tool: "grep",
      parameters: { pattern: "foo" },
      status: "error",
      error: "not found",
      turn: 3,
      tokenCount: 200,
    });
    state.toolIdList = ["err1"];

    const result = purgeErrors(state, config);
    expect(result.pruned).toBe(0);
  });

  it("does not prune non-error tools", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 10;

    state.toolParameters.set("ok1", {
      tool: "grep",
      parameters: { pattern: "foo" },
      status: "completed",
      error: undefined,
      turn: 1,
      tokenCount: 200,
    });
    state.toolIdList = ["ok1"];

    const result = purgeErrors(state, config);
    expect(result.pruned).toBe(0);
  });

  it("does nothing when disabled", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    config.strategies.purgeErrors.enabled = false;
    state.currentTurn = 10;

    state.toolParameters.set("err1", {
      tool: "grep",
      parameters: {},
      status: "error",
      error: "fail",
      turn: 1,
      tokenCount: 200,
    });
    state.toolIdList = ["err1"];

    const result = purgeErrors(state, config);
    expect(result.pruned).toBe(0);
  });

  it("skips protected tools", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    state.currentTurn = 10;

    state.toolParameters.set("err1", {
      tool: "bash",
      parameters: { command: "fail" },
      status: "error",
      error: "exit 1",
      turn: 1,
      tokenCount: 200,
    });
    state.toolIdList = ["err1"];

    const result = purgeErrors(state, config);
    expect(result.pruned).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/purge-errors.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement purge errors**

Create `src/strategies/purge-errors.ts`:

```typescript
import { BASE_PROTECTED_TOOLS, type DcpConfig } from "../config.ts";
import type { SessionState } from "../state/types.ts";
import {
  isToolNameProtected,
  getFilePathsFromParameters,
  isFilePathProtected,
} from "./protected-patterns.ts";

export interface PurgeErrorsResult {
  pruned: number;
  tokensSaved: number;
}

export function purgeErrors(
  state: SessionState,
  config: DcpConfig,
): PurgeErrorsResult {
  if (!config.strategies.purgeErrors.enabled) {
    return { pruned: 0, tokensSaved: 0 };
  }

  if (state.manualMode === "active" && !config.manualMode.automaticStrategies) {
    return { pruned: 0, tokensSaved: 0 };
  }

  if (state.toolIdList.length === 0) {
    return { pruned: 0, tokensSaved: 0 };
  }

  const protectedTools = [
    ...BASE_PROTECTED_TOOLS,
    ...config.strategies.purgeErrors.protectedTools,
  ];

  const turnThreshold = config.strategies.purgeErrors.turns;
  const unpruned = state.toolIdList.filter((id) => !state.prune.tools.has(id));

  let pruned = 0;
  let tokensSaved = 0;

  for (const callId of unpruned) {
    const entry = state.toolParameters.get(callId);
    if (!entry) continue;
    if (entry.status !== "error") continue;

    if (isToolNameProtected(entry.tool, protectedTools)) continue;

    const filePaths = getFilePathsFromParameters(
      entry.tool,
      entry.parameters as Record<string, unknown>,
    );
    if (isFilePathProtected(filePaths, config.protectedFilePatterns)) continue;

    const turnAge = state.currentTurn - entry.turn;
    if (turnAge < turnThreshold) continue;

    const tokens = entry.tokenCount ?? 0;
    state.prune.tools.set(callId, tokens);
    pruned++;
    tokensSaved += tokens;
  }

  state.stats.totalPruneTokens += tokensSaved;
  state.stats.toolsPruned += pruned;

  return { pruned, tokensSaved };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- tests/purge-errors.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategies/purge-errors.ts tests/purge-errors.test.ts
git commit -m "feat: add age-gated error tool input pruning strategy"
```

---

### Task 5: Tool Output and Input Pruning

**Files:**
- Create: `src/messages/prune.ts`
- Test: `tests/prune.test.ts`

Applies pruning marks from strategies to the actual message array. Replaces tool result content with placeholder text.

- [ ] **Step 1: Write tests**

Create `tests/prune.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { pruneToolOutputs, pruneToolErrors, applyPruning } from "../src/messages/prune.ts";
import { createSessionState } from "../src/state/state.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

function makeToolResult(
  toolCallId: string,
  toolName: string,
  text: string,
  isError = false,
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError,
    timestamp: Date.now(),
  } as AgentMessage;
}

describe("prune", () => {
  describe("pruneToolOutputs", () => {
    it("replaces output of pruned tool calls", () => {
      const state = createSessionState();
      state.prune.tools.set("call1", 100);

      const messages: AgentMessage[] = [
        makeToolResult("call1", "grep", "lots of output here"),
      ];

      const result = pruneToolOutputs(state, messages);
      expect(result).toHaveLength(1);
      const content = (result[0] as any).content;
      expect(content[0].text).toContain("[Output removed");
    });

    it("does not modify unpruned tool results", () => {
      const state = createSessionState();

      const messages: AgentMessage[] = [
        makeToolResult("call1", "grep", "output"),
      ];

      const result = pruneToolOutputs(state, messages);
      expect((result[0] as any).content[0].text).toBe("output");
    });

    it("skips error tool results (handled by pruneToolErrors)", () => {
      const state = createSessionState();
      state.prune.tools.set("call1", 100);

      const messages: AgentMessage[] = [
        makeToolResult("call1", "bash", "Error: not found", true),
      ];

      const result = pruneToolOutputs(state, messages);
      expect((result[0] as any).content[0].text).toBe("Error: not found");
    });
  });

  describe("pruneToolErrors", () => {
    it("replaces content of pruned error tool results", () => {
      const state = createSessionState();
      state.prune.tools.set("call1", 100);

      const messages: AgentMessage[] = [
        makeToolResult("call1", "bash", "Error: command not found", true),
      ];

      const result = pruneToolErrors(state, messages);
      expect(result).toHaveLength(1);
      const content = (result[0] as any).content;
      expect(content[0].text).toContain("[input removed");
    });
  });

  describe("applyPruning", () => {
    it("applies both output and error pruning", () => {
      const state = createSessionState();
      state.prune.tools.set("call1", 100);
      state.prune.tools.set("call2", 50);

      const messages: AgentMessage[] = [
        makeToolResult("call1", "grep", "big output"),
        makeToolResult("call2", "bash", "Error: fail", true),
        makeToolResult("call3", "read", "untouched"),
      ];

      const result = applyPruning(state, messages);
      expect((result[0] as any).content[0].text).toContain("[Output removed");
      expect((result[1] as any).content[0].text).toContain("[input removed");
      expect((result[2] as any).content[0].text).toBe("untouched");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/prune.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement pruning**

Create `src/messages/prune.ts`:

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";

const PRUNED_OUTPUT_TEXT =
  "[Output removed to save context - information superseded or no longer needed]";
const PRUNED_ERROR_INPUT_TEXT = "[input removed due to failed tool call]";

/**
 * Replace outputs of pruned tool results with placeholder text.
 * Returns a new array (does not mutate input).
 */
export function pruneToolOutputs(
  state: SessionState,
  messages: AgentMessage[],
): AgentMessage[] {
  if (state.prune.tools.size === 0) return messages;

  return messages.map((msg) => {
    if (msg.role !== "toolResult") return msg;
    if (!state.prune.tools.has(msg.toolCallId)) return msg;
    if (msg.isError) return msg;

    return {
      ...msg,
      content: [{ type: "text" as const, text: PRUNED_OUTPUT_TEXT }],
    };
  });
}

/**
 * Replace content of pruned error tool results with placeholder text.
 * Returns a new array (does not mutate input).
 */
export function pruneToolErrors(
  state: SessionState,
  messages: AgentMessage[],
): AgentMessage[] {
  if (state.prune.tools.size === 0) return messages;

  return messages.map((msg) => {
    if (msg.role !== "toolResult") return msg;
    if (!state.prune.tools.has(msg.toolCallId)) return msg;
    if (!msg.isError) return msg;

    return {
      ...msg,
      content: [{ type: "text" as const, text: PRUNED_ERROR_INPUT_TEXT }],
    };
  });
}

/**
 * Apply all pruning passes to a message array.
 * Returns a new array.
 */
export function applyPruning(
  state: SessionState,
  messages: AgentMessage[],
): AgentMessage[] {
  let result = pruneToolOutputs(state, messages);
  result = pruneToolErrors(state, result);
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- tests/prune.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/messages/prune.ts tests/prune.test.ts
git commit -m "feat: add tool output and error pruning"
```

---

### Task 6: Hallucination Stripping

**Files:**
- Create: `src/messages/strip.ts`
- Test: `tests/strip.test.ts`

Removes hallucinated `<dcp-*>` tags from assistant messages. Models sometimes output these tags in their responses — we strip them before the rest of the pipeline runs.

- [ ] **Step 1: Write tests**

Create `tests/strip.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { stripHallucinations, stripHallucinationsFromString } from "../src/messages/strip.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("strip", () => {
  describe("stripHallucinationsFromString", () => {
    it("removes paired dcp tags", () => {
      const result = stripHallucinationsFromString(
        "hello <dcp-message-id>m0001</dcp-message-id> world"
      );
      expect(result).toBe("hello  world");
    });

    it("removes unpaired dcp tags", () => {
      const result = stripHallucinationsFromString("text </dcp-foo> more");
      expect(result).toBe("text  more");
    });

    it("preserves text without dcp tags", () => {
      const result = stripHallucinationsFromString("no tags here");
      expect(result).toBe("no tags here");
    });
  });

  describe("stripHallucinations", () => {
    it("strips dcp tags from assistant text content", () => {
      const messages: AgentMessage[] = [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Answer <dcp-message-id>m0001</dcp-message-id> here",
            },
          ],
          stopReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
          timestamp: Date.now(),
        } as AgentMessage,
      ];

      const result = stripHallucinations(messages);
      const text = (result[0] as any).content[0].text;
      expect(text).not.toContain("dcp-message-id");
      expect(text).toContain("Answer");
    });

    it("does not modify user messages", () => {
      const messages: AgentMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "<dcp-message-id>m0001</dcp-message-id>" },
          ],
          timestamp: Date.now(),
        } as AgentMessage,
      ];

      const result = stripHallucinations(messages);
      expect((result[0] as any).content[0].text).toContain("dcp-message-id");
    });

    it("returns same reference when no changes needed", () => {
      const messages: AgentMessage[] = [
        {
          role: "assistant",
          content: [{ type: "text", text: "clean text" }],
          stopReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
          timestamp: Date.now(),
        } as AgentMessage,
      ];

      const result = stripHallucinations(messages);
      expect(result[0]).toBe(messages[0]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/strip.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement stripping**

Create `src/messages/strip.ts`:

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";

const DCP_PAIRED_TAG_REGEX = /<dcp[^>]*>[\s\S]*?<\/dcp[^>]*>/gi;
const DCP_UNPAIRED_TAG_REGEX = /<\/?dcp[^>]*>/gi;

/**
 * Strip hallucinated DCP tags from a string.
 */
export function stripHallucinationsFromString(text: string): string {
  return text.replace(DCP_PAIRED_TAG_REGEX, "").replace(DCP_UNPAIRED_TAG_REGEX, "");
}

/**
 * Strip hallucinated DCP tags from assistant messages.
 * Returns a new array. Messages without changes are returned by reference.
 */
export function stripHallucinations(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    if (!Array.isArray(msg.content)) return msg;

    let changed = false;
    const newContent = msg.content.map((part) => {
      if (typeof part !== "object" || part === null) return part;
      const p = part as Record<string, unknown>;
      if (p.type !== "text" || typeof p.text !== "string") return part;

      const cleaned = stripHallucinationsFromString(p.text as string);
      if (cleaned !== p.text) {
        changed = true;
        return { ...part, text: cleaned };
      }
      return part;
    });

    if (!changed) return msg;
    return { ...msg, content: newContent };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- tests/strip.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/messages/strip.ts tests/strip.test.ts
git commit -m "feat: add hallucinated DCP tag stripping"
```

---

### Task 7: Wire Strategies and Pruning into Context Pipeline

**Files:**
- Modify: `src/index.ts`

Connect the tool cache, strategies, pruning, and stripping to the `context` event handler. Also add `turn_end` handler to increment turn counter.

- [ ] **Step 1: Update index.ts**

Add imports and replace the context handler body:

```typescript
// Add these imports to the top of src/index.ts:
import { syncToolCache, buildToolIdList } from "./state/tool-cache.ts";
import { deduplicate } from "./strategies/deduplication.ts";
import { purgeErrors } from "./strategies/purge-errors.ts";
import { applyPruning } from "./messages/prune.ts";
import { stripHallucinations } from "./messages/strip.ts";

// Add turn_end handler after session_shutdown:
pi.on("turn_end", async (_event, _ctx) => {
  state.currentTurn++;
});

// Replace the context handler body:
pi.on("context", async (event, ctx) => {
  if (!config.enabled) return;

  const usage = ctx.getContextUsage();
  if (usage) {
    state.modelContextWindow = usage.contextWindow;
  }

  let messages = event.messages;

  // Step 1: Strip hallucinated DCP tags
  messages = stripHallucinations(messages);

  // Step 2: Build tool caches
  syncToolCache(state, messages);
  buildToolIdList(state, messages);

  // Step 3: Run strategies
  const dedupResult = deduplicate(state, config);
  const purgeResult = purgeErrors(state, config);

  if (dedupResult.pruned > 0) {
    logger.info("dedup", "pruned duplicates", {
      count: dedupResult.pruned,
      tokens: dedupResult.tokensSaved,
    });
  }
  if (purgeResult.pruned > 0) {
    logger.info("purge", "pruned error inputs", {
      count: purgeResult.pruned,
      tokens: purgeResult.tokensSaved,
    });
  }

  // Step 4: Apply pruning to messages
  messages = applyPruning(state, messages);

  // Steps 5-8 (nudges, message IDs, compression) added in later phases

  return { messages };
});
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Run all tests**

```bash
pnpm test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire strategies and pruning into context pipeline"
```
