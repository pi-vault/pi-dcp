# pi-dcp Implementation Plan (SUPERSEDED)

> **This monolithic plan has been split into 7 atomic phase plans.** Use the phase-specific plans instead:
>
> 1. `phase-1-scaffold-and-foundation.md` — Package scaffold, logger, config, state, entry point
> 2. `phase-2-strategy-based-pruning.md` — Protected patterns, tool cache, dedup, purge-errors, pruning pipeline
> 3. `phase-3-nudges-and-message-ids.md` — System prompt, nudge templates, message ref + ID injection
> 4. `phase-4-range-compression.md` — Compress tool (range mode), block state, search, sync, range filtering
> 5. `phase-5-message-compression.md` — Priority map, message-mode compress handler
> 6. `phase-6-commands.md` — `/dcp` command router and all subcommands
> 7. `phase-7-polish.md` — State persistence, config validation, status bar, integration test
>
> Each phase is atomic: it produces a usable, testable result and builds on the previous phase.

---

_Original plan below retained for reference._

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port OpenCode's Dynamic Context Pruning logic to Pi as a standalone extension that incrementally prunes obsolete tool outputs, deduplicates tool calls, and compresses conversation ranges — working alongside Pi's existing compaction system.

**Architecture:** Self-contained Pi extension (`@pi-vault/pi-dcp`) using Pi's public `ExtensionAPI`. The extension registers event handlers (`context`, `before_agent_start`, `session_start`, `session_compact`, `tool_result`, `message_update`), a custom `compress` tool, and `/dcp` slash commands. DCP handles incremental context pruning; Pi's native compaction remains as overflow safety net.

**Tech Stack:** TypeScript, Pi Extension API (`@earendil-works/pi-coding-agent`), TypeBox (via `@earendil-works/pi-ai`), `jsonc-parser`, vitest

**Reference Material:**

- Pi extension examples: `pi/packages/coding-agent/examples/extensions/` (especially `hello.ts`, `tools.ts`, `custom-compaction.ts`)
- Pi extension types: `pi/packages/coding-agent/src/core/extensions/types.ts`
- Pi agent types: `pi/packages/agent/src/types.ts`
- Pi message types: `pi/packages/coding-agent/src/core/messages.ts`
- Pi extension tests: `pi/packages/coding-agent/test/extensions-runner.test.ts`
- Original DCP source: `opencode-dynamic-context-pruning/` (the repo we analyzed in `plans/01-09`)
- Original DCP analysis docs: `plans/01-plugin-architecture.md` through `plans/09-supporting-modules.md`

**Conventions:**

- Pi extensions export a default function `(pi: ExtensionAPI) => void | Promise<void>`
- Pi uses TypeBox (`Type.Object`, `Type.String`, etc.) for tool parameter schemas, re-exported from `@earendil-works/pi-ai`
- Pi messages use `AgentMessage` union type (discriminated on `role`: `user | assistant | toolResult | custom | bashExecution | compactionSummary | branchSummary`)
- Pi provides `ctx.getContextUsage()` returning `{ tokens, contextWindow, percent }` — use this for nudge threshold checks
- Pi's `context` event receives a `structuredClone`'d message array — mutations are safe but return the modified array via `{ messages }`
- This project uses erasable TypeScript only (no enums, no parameter properties, no namespace)

---

## File Structure

```
pi-dcp/
  src/
    index.ts                          # Extension factory entry point
    config.ts                         # Config loading, merging, validation
    logger.ts                         # File-based debug logging
    state/
      types.ts                        # SessionState, CompressionBlock, Prune, etc.
      state.ts                        # State creation, reset, session detection
      persistence.ts                  # Disk persistence (save/load)
      tool-cache.ts                   # Tool parameter caching from messages
    messages/
      prune.ts                        # Apply pruning (compressed ranges, tool outputs/inputs/errors)
      sync.ts                         # Synchronize compression block state with current messages
      inject.ts                       # Inject nudges and message ID tags
      priority.ts                     # Compression priority map (message mode)
      query.ts                        # Message query utilities (last user msg, ignored msgs)
      shape.ts                        # Message shape validation
      strip.ts                        # Strip hallucinated DCP tags
    compress/
      range.ts                        # Range-mode compress tool
      message.ts                      # Message-mode compress tool
      state.ts                        # Block allocation and compression state application
      search.ts                       # Boundary resolution, selection resolution
      protected.ts                    # Protected content (tools, user messages, tags)
      pipeline.ts                     # Shared prepare/finalize for both modes
    strategies/
      deduplication.ts                # Signature-based duplicate tool call removal
      purge-errors.ts                 # Age-gated error input pruning
      protected-patterns.ts           # Glob matching, file path extraction, tool name protection
    commands/
      index.ts                        # Command routing for /dcp
      context.ts                      # /dcp context — token breakdown
      stats.ts                        # /dcp stats — cumulative statistics
      sweep.ts                        # /dcp sweep — bulk tool pruning
      manual.ts                       # /dcp manual — manual mode toggle + trigger
      decompress.ts                   # /dcp decompress — restore compressed content
      recompress.ts                   # /dcp recompress — re-apply compression
      help.ts                         # /dcp help
    prompts/
      system.ts                       # DCP system prompt text
      compress-range.ts               # Range-mode compress instructions
      compress-message.ts             # Message-mode compress instructions
      nudges.ts                       # Context-limit, turn, and iteration nudge texts
    utils/
      tokens.ts                       # Token counting (Anthropic tokenizer with fallback)
      message-ids.ts                  # m0001/b1 formatting, parsing, assignment
  test/
    config.test.ts
    state.test.ts
    tool-cache.test.ts
    deduplication.test.ts
    purge-errors.test.ts
    protected-patterns.test.ts
    message-ids.test.ts
    tokens.test.ts
    prune.test.ts
    sync.test.ts
    inject.test.ts
    strip.test.ts
    compress-state.test.ts
    search.test.ts
    commands.test.ts
  package.json
  tsconfig.json
```

---

## Phase 0: Repo Scaffold

### Task 0.1: Initialize npm package

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@pi-vault/pi-dcp",
  "version": "0.1.0",
  "type": "module",
  "description": "Pi extension for dynamic context pruning — incremental tool output pruning and conversation compression",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "pi": {
    "extensions": ["dist/index.js"]
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest --run",
    "test:watch": "vitest"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.79.0",
    "@earendil-works/pi-ai": ">=0.79.0",
    "@earendil-works/pi-agent-core": ">=0.79.0"
  },
  "dependencies": {
    "jsonc-parser": "^3.3.1"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "^0.79.3",
    "@earendil-works/pi-ai": "^0.79.3",
    "@earendil-works/pi-agent-core": "^0.79.3",
    "typescript": "^5.8.3",
    "vitest": "^3.2.4"
  },
  "files": ["dist/", "README.md", "LICENSE"]
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Create minimal extension entry point**

Create `src/index.ts`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function createExtension(pi: ExtensionAPI): void {
  // Phase 1+ will register handlers here
}
```

- [ ] **Step 4: Install dependencies**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
npm install --ignore-scripts
```

Expected: `node_modules/` created, `package-lock.json` generated.

- [ ] **Step 5: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 6: Create vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 7: Create a smoke test**

Create `test/smoke.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import createExtension from "../src/index.js";

describe("pi-dcp", () => {
  it("exports a function", () => {
    expect(typeof createExtension).toBe("function");
  });
});
```

- [ ] **Step 8: Run the smoke test**

```bash
npm test
```

Expected: 1 test passes.

- [ ] **Step 9: Add .gitignore**

Create `.gitignore`:

```
node_modules/
dist/
*.tsbuildinfo
```

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/index.ts test/smoke.test.ts .gitignore
git commit -m "chore: scaffold pi-dcp extension package"
```

---

## Phase 1: Foundation

### Task 1.1: Logger

**Files:**

- Create: `src/logger.ts`
- Test: `test/logger.test.ts`

The logger writes debug lines to `~/.config/pi/logs/dcp/daily/YYYY-MM-DD.log` when debug mode is enabled.

- [ ] **Step 1: Write tests for Logger**

Create `test/logger.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Logger } from "../src/logger.js";

describe("Logger", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-logger-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not write when disabled", () => {
    const logger = new Logger(false, tempDir);
    logger.info("test", "should not appear");
    const files = fs.readdirSync(tempDir, { recursive: true });
    expect(files).toHaveLength(0);
  });

  it("writes log line when enabled", () => {
    const logger = new Logger(true, tempDir);
    logger.info("test-source", "hello world");

    const dailyDir = path.join(tempDir, "daily");
    expect(fs.existsSync(dailyDir)).toBe(true);
    const logFiles = fs.readdirSync(dailyDir);
    expect(logFiles).toHaveLength(1);

    const content = fs.readFileSync(path.join(dailyDir, logFiles[0]), "utf-8");
    expect(content).toContain("INFO");
    expect(content).toContain("test-source");
    expect(content).toContain("hello world");
  });

  it("formats key-value data", () => {
    const logger = new Logger(true, tempDir);
    logger.info("src", "msg", { count: 5, name: "foo" });

    const dailyDir = path.join(tempDir, "daily");
    const logFiles = fs.readdirSync(dailyDir);
    const content = fs.readFileSync(path.join(dailyDir, logFiles[0]), "utf-8");
    expect(content).toContain("count=5");
    expect(content).toContain('name="foo"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- test/logger.test.ts
```

Expected: FAIL — `Logger` not found.

- [ ] **Step 3: Implement Logger**

Create `src/logger.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";

export class Logger {
  private enabled: boolean;
  private logDir: string;

  constructor(enabled: boolean, logDir?: string) {
    this.enabled = enabled;
    this.logDir = logDir ?? defaultLogDir();
  }

  info(source: string, message: string, data?: Record<string, unknown>): void {
    this.write("INFO", source, message, data);
  }

  warn(source: string, message: string, data?: Record<string, unknown>): void {
    this.write("WARN", source, message, data);
  }

  error(source: string, message: string, data?: Record<string, unknown>): void {
    this.write("ERROR", source, message, data);
  }

  private write(
    level: string,
    source: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (!this.enabled) return;

    const now = new Date();
    const timestamp = now.toISOString();
    const dateStr = timestamp.slice(0, 10);
    const dailyDir = path.join(this.logDir, "daily");

    fs.mkdirSync(dailyDir, { recursive: true });

    let line = `${timestamp} ${level.padEnd(5)} ${source}: ${message}`;
    if (data) {
      const pairs = Object.entries(data)
        .map(([k, v]) => `${k}=${typeof v === "string" ? `"${v}"` : String(v)}`)
        .join(" ");
      line += ` | ${pairs}`;
    }

    fs.appendFileSync(path.join(dailyDir, `${dateStr}.log`), line + "\n");
  }
}

function defaultLogDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return path.join(home, ".config", "pi", "logs", "dcp");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- test/logger.test.ts
```

Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts test/logger.test.ts
git commit -m "feat: add file-based debug logger"
```

---

### Task 1.2: Message ID System

**Files:**

- Create: `src/utils/message-ids.ts`
- Test: `test/message-ids.test.ts`

Sequential message IDs (`m0001`–`m9999`) and block IDs (`b1`, `b2`, ...) for referencing messages and compression blocks.

- [ ] **Step 1: Write tests**

Create `test/message-ids.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  formatMessageRef,
  formatBlockRef,
  parseMessageRef,
  parseBlockRef,
  parseBoundaryId,
  formatMessageIdTag,
} from "../src/utils/message-ids.js";

describe("message-ids", () => {
  describe("formatMessageRef", () => {
    it("zero-pads to 4 digits", () => {
      expect(formatMessageRef(1)).toBe("m0001");
      expect(formatMessageRef(42)).toBe("m0042");
      expect(formatMessageRef(9999)).toBe("m9999");
    });
  });

  describe("formatBlockRef", () => {
    it("formats block IDs", () => {
      expect(formatBlockRef(1)).toBe("b1");
      expect(formatBlockRef(123)).toBe("b123");
    });
  });

  describe("parseMessageRef", () => {
    it("parses valid message refs", () => {
      expect(parseMessageRef("m0001")).toBe(1);
      expect(parseMessageRef("m0042")).toBe(42);
    });

    it("returns undefined for invalid refs", () => {
      expect(parseMessageRef("b1")).toBeUndefined();
      expect(parseMessageRef("abc")).toBeUndefined();
      expect(parseMessageRef("m00001")).toBeUndefined();
    });
  });

  describe("parseBlockRef", () => {
    it("parses valid block refs", () => {
      expect(parseBlockRef("b1")).toBe(1);
      expect(parseBlockRef("b42")).toBe(42);
    });

    it("returns undefined for invalid refs", () => {
      expect(parseBlockRef("m0001")).toBeUndefined();
      expect(parseBlockRef("bx")).toBeUndefined();
    });
  });

  describe("parseBoundaryId", () => {
    it("parses message boundaries", () => {
      const result = parseBoundaryId("m0001");
      expect(result).toEqual({ type: "message", index: 1 });
    });

    it("parses block boundaries", () => {
      const result = parseBoundaryId("b3");
      expect(result).toEqual({ type: "block", blockId: 3 });
    });

    it("returns undefined for invalid", () => {
      expect(parseBoundaryId("xyz")).toBeUndefined();
    });
  });

  describe("formatMessageIdTag", () => {
    it("formats basic tag", () => {
      expect(formatMessageIdTag("m0001")).toBe(
        "<dcp-message-id>m0001</dcp-message-id>",
      );
    });

    it("formats tag with priority", () => {
      expect(formatMessageIdTag("m0001", { priority: 3 })).toBe(
        '<dcp-message-id priority="3">m0001</dcp-message-id>',
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- test/message-ids.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement message-ids**

Create `src/utils/message-ids.ts`:

```typescript
export function formatMessageRef(index: number): string {
  return `m${String(index).padStart(4, "0")}`;
}

export function formatBlockRef(blockId: number): string {
  return `b${blockId}`;
}

export function parseMessageRef(ref: string): number | undefined {
  const match = /^m(\d{4})$/.exec(ref);
  if (!match) return undefined;
  return parseInt(match[1], 10);
}

export function parseBlockRef(ref: string): number | undefined {
  const match = /^b(\d+)$/.exec(ref);
  if (!match) return undefined;
  const n = parseInt(match[1], 10);
  if (n <= 0) return undefined;
  return n;
}

export type ParsedBoundaryId =
  | { type: "message"; index: number }
  | { type: "block"; blockId: number };

export function parseBoundaryId(id: string): ParsedBoundaryId | undefined {
  const msgIndex = parseMessageRef(id);
  if (msgIndex !== undefined) return { type: "message", index: msgIndex };

  const blockId = parseBlockRef(id);
  if (blockId !== undefined) return { type: "block", blockId };

  return undefined;
}

export function formatMessageIdTag(
  ref: string,
  attrs?: { priority?: number },
): string {
  if (attrs?.priority !== undefined) {
    return `<dcp-message-id priority="${attrs.priority}">${ref}</dcp-message-id>`;
  }
  return `<dcp-message-id>${ref}</dcp-message-id>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- test/message-ids.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/message-ids.ts test/message-ids.test.ts
git commit -m "feat: add message ID formatting and parsing"
```

---

### Task 1.3: Token Counting Utilities

**Files:**

- Create: `src/utils/tokens.ts`
- Test: `test/tokens.test.ts`

Token counting with character-based fallback (Pi doesn't bundle the Anthropic tokenizer; we use `text.length / 4` as a portable estimate).

- [ ] **Step 1: Write tests**

Create `test/tokens.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { countTokens, countTokensBatch } from "../src/utils/tokens.js";

describe("tokens", () => {
  describe("countTokens", () => {
    it("estimates tokens for text", () => {
      const result = countTokens("hello world");
      expect(result).toBeGreaterThan(0);
      expect(typeof result).toBe("number");
    });

    it("returns 0 for empty string", () => {
      expect(countTokens("")).toBe(0);
    });

    it("scales roughly with text length", () => {
      const short = countTokens("hello");
      const long = countTokens("hello ".repeat(100));
      expect(long).toBeGreaterThan(short);
    });
  });

  describe("countTokensBatch", () => {
    it("counts tokens for array of texts", () => {
      const result = countTokensBatch(["hello", "world"]);
      expect(result).toBeGreaterThan(0);
    });

    it("returns 0 for empty array", () => {
      expect(countTokensBatch([])).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- test/tokens.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement token utilities**

Create `src/utils/tokens.ts`:

```typescript
/**
 * Token counting using character-based estimation.
 *
 * Uses length/4 as a rough approximation. This is intentionally simple —
 * Pi's built-in ctx.getContextUsage() provides accurate context-level
 * token counts for threshold decisions. These per-message estimates are
 * used for relative comparisons (compression savings, priority ranking).
 */
export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.round(text.length / 4));
}

export function countTokensBatch(texts: string[]): number {
  if (texts.length === 0) return 0;
  return countTokens(texts.join(" "));
}

/**
 * Extract all text content from an AgentMessage for token counting.
 * Works with user messages (TextContent[]), assistant messages (TextContent + ToolCallContent),
 * and toolResult messages.
 */
export function extractMessageText(message: {
  role: string;
  content?: unknown;
}): string {
  const content = message.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const p = part as Record<string, unknown>;
    if (p.type === "text" && typeof p.text === "string") {
      parts.push(p.text);
    } else if (p.type === "toolCall") {
      if (typeof p.name === "string") parts.push(p.name);
      if (p.arguments && typeof p.arguments === "object") {
        parts.push(JSON.stringify(p.arguments));
      }
    }
  }
  return parts.join(" ");
}

export function countMessageTokens(message: {
  role: string;
  content?: unknown;
}): number {
  return countTokens(extractMessageText(message));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- test/tokens.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/tokens.ts test/tokens.test.ts
git commit -m "feat: add token counting utilities"
```

---

### Task 1.4: State Types

**Files:**

- Create: `src/state/types.ts`

State type definitions adapted for Pi's `AgentMessage` types. No tests needed — these are pure types.

- [ ] **Step 1: Create state types**

Create `src/state/types.ts`:

```typescript
/**
 * DCP session state types.
 *
 * Adapted from OpenCode DCP for Pi's AgentMessage-based message model.
 * All Maps/Sets are used in-memory; persistence serializes to plain objects.
 */

export interface SessionState {
  /** Current session identifier (set on session_start). */
  sessionId: string | null;
  /** Manual mode: false = auto, "active" = manual, "compress-pending" = trigger queued. */
  manualMode: false | "active" | "compress-pending";
  /** Effective compress permission for this session. */
  compressPermission: "allow" | "deny" | undefined;
  /** Pending manual compress trigger. */
  pendingManualTrigger: PendingManualTrigger | null;
  /** Pruning state (tools + message compression). */
  prune: Prune;
  /** Nudge anchor tracking. */
  nudges: Nudges;
  /** Token savings statistics. */
  stats: SessionStats;
  /** Tool parameter cache for deduplication and purge-errors. */
  toolParameters: Map<string, ToolParameterEntry>;
  /** Ordered list of tool call IDs in current context. */
  toolIdList: string[];
  /** Message ID assignment state. */
  messageIds: MessageIdState;
  /** Timestamp of last compaction detected. */
  lastCompaction: number;
  /** Current conversation turn number. */
  currentTurn: number;
  /** Model context window size (from Pi's ctx.getContextUsage). */
  modelContextWindow: number | undefined;
}

export interface PendingManualTrigger {
  sessionId: string;
  prompt: string;
}

export interface Prune {
  /** Tool call IDs marked for output pruning, mapped to estimated token count. */
  tools: Map<string, number>;
  /** Compression block state. */
  messages: PruneMessagesState;
}

export interface PruneMessagesState {
  /** Per-message compression metadata. */
  byMessageIndex: Map<number, PrunedMessageEntry>;
  /** All compression blocks by ID. */
  blocksById: Map<number, CompressionBlock>;
  /** Currently active block IDs. */
  activeBlockIds: Set<number>;
  /** Anchor message index → active block ID. */
  activeByAnchorIndex: Map<number, number>;
  /** Next block ID to allocate. */
  nextBlockId: number;
  /** Next run ID to allocate. */
  nextRunId: number;
}

export interface PrunedMessageEntry {
  /** Estimated token count of the original message. */
  tokenCount: number;
  /** Block IDs that cover this message (may have multiple from nesting). */
  blockIds: number[];
  /** Block IDs that are currently active on this message. */
  activeBlockIds: number[];
}

export interface CompressionBlock {
  blockId: number;
  runId: number;
  active: boolean;
  deactivatedByUser: boolean;
  compressedTokens: number;
  summaryTokens: number;
  durationMs: number;
  mode: "range" | "message" | undefined;
  topic: string;
  batchTopic: string | undefined;
  /** Message index of the start boundary. */
  startIndex: number;
  /** Message index of the end boundary. */
  endIndex: number;
  /** Message index where summary is injected. */
  anchorIndex: number;
  /** Message index containing the compress tool call. */
  compressMessageIndex: number;
  /** Block IDs included (nested) in this block. */
  includedBlockIds: number[];
  /** Block IDs consumed (deactivated) by this block. */
  consumedBlockIds: number[];
  /** Block IDs of blocks that consumed this one. */
  parentBlockIds: number[];
  /** Direct message indices compressed by this block. */
  directMessageIndices: number[];
  /** Direct tool call IDs compressed by this block. */
  directToolIds: string[];
  /** All message indices including consumed blocks'. */
  effectiveMessageIndices: number[];
  /** All tool IDs including consumed blocks'. */
  effectiveToolIds: string[];
  createdAt: number;
  deactivatedAt: number | undefined;
  deactivatedByBlockId: number | undefined;
  /** The actual summary content. */
  summary: string;
}

export interface ToolParameterEntry {
  tool: string;
  parameters: unknown;
  status: "pending" | "running" | "completed" | "error" | undefined;
  error: string | undefined;
  turn: number;
  tokenCount: number | undefined;
}

export interface Nudges {
  /** Message indices that have context-limit nudge anchors. */
  contextLimitAnchors: Set<number>;
  /** Message indices that have turn nudge anchors. */
  turnAnchors: Set<number>;
  /** Message indices that have iteration nudge anchors. */
  iterationAnchors: Set<number>;
}

export interface SessionStats {
  /** Total tokens pruned by tool output removal. */
  pruneTokenCounter: number;
  /** Total tokens saved (tools + compression). */
  totalPruneTokens: number;
  /** Number of tool outputs pruned. */
  toolsPruned: number;
  /** Number of messages compressed. */
  messagesCompressed: number;
}

export interface MessageIdState {
  /** Map of message array index → assigned ref string (e.g., "m0001"). */
  byIndex: Map<number, string>;
  /** Next ref index to assign. */
  nextRefIndex: number;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/state/types.ts
git commit -m "feat: add DCP state type definitions"
```

---

### Task 1.5: State Creation and Reset

**Files:**

- Create: `src/state/state.ts`
- Test: `test/state.test.ts`

- [ ] **Step 1: Write tests**

Create `test/state.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createSessionState, resetSessionState } from "../src/state/state.js";

describe("state", () => {
  describe("createSessionState", () => {
    it("creates empty state", () => {
      const state = createSessionState();
      expect(state.sessionId).toBeNull();
      expect(state.manualMode).toBe(false);
      expect(state.prune.tools.size).toBe(0);
      expect(state.prune.messages.nextBlockId).toBe(1);
      expect(state.prune.messages.nextRunId).toBe(1);
      expect(state.stats.totalPruneTokens).toBe(0);
      expect(state.currentTurn).toBe(0);
      expect(state.messageIds.nextRefIndex).toBe(1);
    });
  });

  describe("resetSessionState", () => {
    it("resets mutable state to initial values", () => {
      const state = createSessionState();
      state.sessionId = "test-session";
      state.currentTurn = 5;
      state.prune.tools.set("tool1", 100);
      state.stats.totalPruneTokens = 500;

      resetSessionState(state);

      expect(state.sessionId).toBeNull();
      expect(state.currentTurn).toBe(0);
      expect(state.prune.tools.size).toBe(0);
      expect(state.stats.totalPruneTokens).toBe(0);
    });

    it("preserves object reference", () => {
      const state = createSessionState();
      const ref = state;
      resetSessionState(state);
      expect(state).toBe(ref);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- test/state.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement state creation**

Create `src/state/state.ts`:

```typescript
import type {
  MessageIdState,
  Nudges,
  Prune,
  PruneMessagesState,
  SessionState,
  SessionStats,
} from "./types.js";

export function createSessionState(): SessionState {
  return {
    sessionId: null,
    manualMode: false,
    compressPermission: undefined,
    pendingManualTrigger: null,
    prune: createPrune(),
    nudges: createNudges(),
    stats: createStats(),
    toolParameters: new Map(),
    toolIdList: [],
    messageIds: createMessageIdState(),
    lastCompaction: 0,
    currentTurn: 0,
    modelContextWindow: undefined,
  };
}

export function resetSessionState(state: SessionState): void {
  state.sessionId = null;
  state.manualMode = false;
  state.compressPermission = undefined;
  state.pendingManualTrigger = null;
  state.prune.tools.clear();
  resetPruneMessages(state.prune.messages);
  state.nudges.contextLimitAnchors.clear();
  state.nudges.turnAnchors.clear();
  state.nudges.iterationAnchors.clear();
  state.stats.pruneTokenCounter = 0;
  state.stats.totalPruneTokens = 0;
  state.stats.toolsPruned = 0;
  state.stats.messagesCompressed = 0;
  state.toolParameters.clear();
  state.toolIdList = [];
  state.messageIds.byIndex.clear();
  state.messageIds.nextRefIndex = 1;
  state.lastCompaction = 0;
  state.currentTurn = 0;
  state.modelContextWindow = undefined;
}

function createPrune(): Prune {
  return {
    tools: new Map(),
    messages: createPruneMessages(),
  };
}

function createPruneMessages(): PruneMessagesState {
  return {
    byMessageIndex: new Map(),
    blocksById: new Map(),
    activeBlockIds: new Set(),
    activeByAnchorIndex: new Map(),
    nextBlockId: 1,
    nextRunId: 1,
  };
}

function resetPruneMessages(m: PruneMessagesState): void {
  m.byMessageIndex.clear();
  m.blocksById.clear();
  m.activeBlockIds.clear();
  m.activeByAnchorIndex.clear();
  m.nextBlockId = 1;
  m.nextRunId = 1;
}

function createNudges(): Nudges {
  return {
    contextLimitAnchors: new Set(),
    turnAnchors: new Set(),
    iterationAnchors: new Set(),
  };
}

function createStats(): SessionStats {
  return {
    pruneTokenCounter: 0,
    totalPruneTokens: 0,
    toolsPruned: 0,
    messagesCompressed: 0,
  };
}

function createMessageIdState(): MessageIdState {
  return {
    byIndex: new Map(),
    nextRefIndex: 1,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- test/state.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/state.ts test/state.test.ts
git commit -m "feat: add session state creation and reset"
```

---

### Task 1.6: Configuration System

**Files:**

- Create: `src/config.ts`
- Test: `test/config.test.ts`

Loads DCP configuration from JSONC files at three precedence levels: project (`.pi/dcp.jsonc`), config-dir, global (`~/.config/pi/dcp.jsonc`). Project overrides global.

- [ ] **Step 1: Write tests**

Create `test/config.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, type DcpConfig } from "../src/config.js";

describe("config", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const config = loadConfig(tempDir, tempDir);
    expect(config.enabled).toBe(true);
    expect(config.debug).toBe(false);
    expect(config.compress.mode).toBe("range");
    expect(config.compress.permission).toBe("allow");
    expect(config.strategies.deduplication.enabled).toBe(true);
    expect(config.strategies.purgeErrors.enabled).toBe(true);
  });

  it("loads project-level config", () => {
    const piDir = path.join(tempDir, ".pi");
    fs.mkdirSync(piDir, { recursive: true });
    fs.writeFileSync(
      path.join(piDir, "dcp.jsonc"),
      `{
        // Enable debug mode
        "debug": true,
        "compress": { "mode": "message" }
      }`,
    );

    const config = loadConfig(tempDir, path.join(tempDir, "global"));
    expect(config.debug).toBe(true);
    expect(config.compress.mode).toBe("message");
    // Other defaults preserved
    expect(config.enabled).toBe(true);
  });

  it("project overrides global", () => {
    // Global config
    const globalDir = path.join(tempDir, "global");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, "dcp.jsonc"),
      '{ "debug": true, "compress": { "mode": "message" } }',
    );

    // Project config
    const projectDir = path.join(tempDir, "project");
    const piDir = path.join(projectDir, ".pi");
    fs.mkdirSync(piDir, { recursive: true });
    fs.writeFileSync(
      path.join(piDir, "dcp.jsonc"),
      '{ "compress": { "mode": "range" } }',
    );

    const config = loadConfig(projectDir, globalDir);
    expect(config.debug).toBe(true); // from global
    expect(config.compress.mode).toBe("range"); // project overrides
  });

  it("handles invalid JSON gracefully", () => {
    const piDir = path.join(tempDir, ".pi");
    fs.mkdirSync(piDir, { recursive: true });
    fs.writeFileSync(path.join(piDir, "dcp.jsonc"), "not valid json {{{");

    const config = loadConfig(tempDir, path.join(tempDir, "global"));
    // Falls back to defaults
    expect(config.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- test/config.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement config**

Create `src/config.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";

export interface DcpConfig {
  enabled: boolean;
  debug: boolean;
  compress: CompressConfig;
  manualMode: ManualModeConfig;
  strategies: StrategiesConfig;
  protectedFilePatterns: string[];
  nudgeNotification: "off" | "minimal" | "detailed";
}

export interface CompressConfig {
  mode: "range" | "message";
  permission: "allow" | "deny";
  maxContextPercent: number;
  minContextPercent: number;
  nudgeFrequency: number;
  iterationNudgeThreshold: number;
  nudgeForce: "strong" | "soft";
  protectedTools: string[];
  protectUserMessages: boolean;
  protectTags: boolean;
}

export interface ManualModeConfig {
  default: false | "active";
  automaticStrategies: boolean;
}

export interface StrategiesConfig {
  deduplication: DeduplicationConfig;
  purgeErrors: PurgeErrorsConfig;
}

export interface DeduplicationConfig {
  enabled: boolean;
  protectedTools: string[];
}

export interface PurgeErrorsConfig {
  enabled: boolean;
  turns: number;
  protectedTools: string[];
}

const DEFAULT_CONFIG: DcpConfig = {
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
    protectedTools: ["compress"],
    protectUserMessages: false,
    protectTags: false,
  },
  manualMode: {
    default: false,
    automaticStrategies: true,
  },
  strategies: {
    deduplication: {
      enabled: true,
      protectedTools: [],
    },
    purgeErrors: {
      enabled: true,
      turns: 4,
      protectedTools: [],
    },
  },
  protectedFilePatterns: [],
  nudgeNotification: "minimal",
};

/**
 * Base set of tool names that are always protected from pruning strategies.
 * These are Pi's critical tools that should never have their outputs removed.
 */
export const BASE_PROTECTED_TOOLS = [
  "compress",
  "bash",
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
];

export function loadConfig(
  projectDir: string,
  globalConfigDir: string,
): DcpConfig {
  const config = structuredClone(DEFAULT_CONFIG);

  // Load global config
  const globalFile = findConfigFile(globalConfigDir);
  if (globalFile) {
    const parsed = parseConfigFile(globalFile);
    if (parsed) mergeConfig(config, parsed);
  }

  // Load project config (overrides global)
  const projectFile = findConfigFile(path.join(projectDir, ".pi"));
  if (projectFile) {
    const parsed = parseConfigFile(projectFile);
    if (parsed) mergeConfig(config, parsed);
  }

  return config;
}

function findConfigFile(dir: string): string | undefined {
  const jsonc = path.join(dir, "dcp.jsonc");
  if (fs.existsSync(jsonc)) return jsonc;
  const json = path.join(dir, "dcp.json");
  if (fs.existsSync(json)) return json;
  return undefined;
}

function parseConfigFile(
  filePath: string,
): Record<string, unknown> | undefined {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = parseJsonc(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function mergeConfig(target: DcpConfig, source: Record<string, unknown>): void {
  if (typeof source.enabled === "boolean") target.enabled = source.enabled;
  if (typeof source.debug === "boolean") target.debug = source.debug;
  if (typeof source.nudgeNotification === "string") {
    if (["off", "minimal", "detailed"].includes(source.nudgeNotification)) {
      target.nudgeNotification = source.nudgeNotification as
        | "off"
        | "minimal"
        | "detailed";
    }
  }
  if (Array.isArray(source.protectedFilePatterns)) {
    target.protectedFilePatterns = source.protectedFilePatterns.filter(
      (p): p is string => typeof p === "string",
    );
  }

  if (source.compress && typeof source.compress === "object") {
    const c = source.compress as Record<string, unknown>;
    if (c.mode === "range" || c.mode === "message")
      target.compress.mode = c.mode;
    if (c.permission === "allow" || c.permission === "deny")
      target.compress.permission = c.permission;
    if (typeof c.maxContextPercent === "number" && c.maxContextPercent > 0)
      target.compress.maxContextPercent = c.maxContextPercent;
    if (typeof c.minContextPercent === "number" && c.minContextPercent > 0)
      target.compress.minContextPercent = c.minContextPercent;
    if (typeof c.nudgeFrequency === "number" && c.nudgeFrequency >= 1)
      target.compress.nudgeFrequency = c.nudgeFrequency;
    if (
      typeof c.iterationNudgeThreshold === "number" &&
      c.iterationNudgeThreshold >= 1
    )
      target.compress.iterationNudgeThreshold = c.iterationNudgeThreshold;
    if (c.nudgeForce === "strong" || c.nudgeForce === "soft")
      target.compress.nudgeForce = c.nudgeForce;
    if (Array.isArray(c.protectedTools))
      target.compress.protectedTools = c.protectedTools.filter(
        (t): t is string => typeof t === "string",
      );
    if (typeof c.protectUserMessages === "boolean")
      target.compress.protectUserMessages = c.protectUserMessages;
    if (typeof c.protectTags === "boolean")
      target.compress.protectTags = c.protectTags;
  }

  if (source.manualMode && typeof source.manualMode === "object") {
    const m = source.manualMode as Record<string, unknown>;
    if (m.default === false || m.default === "active")
      target.manualMode.default = m.default;
    if (typeof m.automaticStrategies === "boolean")
      target.manualMode.automaticStrategies = m.automaticStrategies;
  }

  if (source.strategies && typeof source.strategies === "object") {
    const s = source.strategies as Record<string, unknown>;
    if (s.deduplication && typeof s.deduplication === "object") {
      const d = s.deduplication as Record<string, unknown>;
      if (typeof d.enabled === "boolean")
        target.strategies.deduplication.enabled = d.enabled;
      if (Array.isArray(d.protectedTools))
        target.strategies.deduplication.protectedTools =
          d.protectedTools.filter((t): t is string => typeof t === "string");
    }
    if (s.purgeErrors && typeof s.purgeErrors === "object") {
      const p = s.purgeErrors as Record<string, unknown>;
      if (typeof p.enabled === "boolean")
        target.strategies.purgeErrors.enabled = p.enabled;
      if (typeof p.turns === "number" && p.turns >= 1)
        target.strategies.purgeErrors.turns = p.turns;
      if (Array.isArray(p.protectedTools))
        target.strategies.purgeErrors.protectedTools = p.protectedTools.filter(
          (t): t is string => typeof t === "string",
        );
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- test/config.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: add JSONC configuration system with layered merging"
```

---

### Task 1.7: Wire Foundation into Extension Entry Point

**Files:**

- Modify: `src/index.ts`

Connect logger, config, and state to the extension lifecycle hooks.

- [ ] **Step 1: Update entry point**

Replace `src/index.ts`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, type DcpConfig } from "./config.js";
import { Logger } from "./logger.js";
import { createSessionState, resetSessionState } from "./state/state.js";
import type { SessionState } from "./state/types.js";

export default function createExtension(pi: ExtensionAPI): void {
  // Resolve config directories
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const globalConfigDir = process.env.PI_CONFIG_DIR ?? `${home}/.config/pi`;

  // Config is loaded once at extension init; reload on session_start
  let config: DcpConfig;
  const state: SessionState = createSessionState();
  let logger: Logger;

  function reloadConfig(cwd: string): void {
    config = loadConfig(cwd, globalConfigDir);
    logger = new Logger(config.debug);
  }

  // Initial load with no project dir
  reloadConfig(process.cwd());

  if (!config!.enabled) return;

  // Session lifecycle
  pi.on("session_start", async (event, ctx) => {
    reloadConfig(ctx.cwd);
    if (!config.enabled) return;

    resetSessionState(state);
    state.sessionId = `pi-${Date.now()}`;
    state.manualMode = config.manualMode.default;

    const usage = ctx.getContextUsage();
    if (usage) {
      state.modelContextWindow = usage.contextWindow;
    }

    logger.info("dcp", "session started", {
      sessionId: state.sessionId,
      reason: event.reason,
      mode: config.compress.mode,
    });
  });

  pi.on("session_compact", async (_event, _ctx) => {
    // Compaction ran — reset pruning state since compressed content is gone
    state.prune.tools.clear();
    state.prune.messages.byMessageIndex.clear();
    state.prune.messages.blocksById.clear();
    state.prune.messages.activeBlockIds.clear();
    state.prune.messages.activeByAnchorIndex.clear();
    state.lastCompaction = Date.now();

    logger.info("dcp", "compaction detected, pruning state reset");
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    logger.info("dcp", "session shutdown");
  });

  // Context transform — this is where the DCP pipeline runs.
  // Phases 2-6 will add logic here.
  pi.on("context", async (event, ctx) => {
    if (!config.enabled) return;

    const usage = ctx.getContextUsage();
    if (usage) {
      state.modelContextWindow = usage.contextWindow;
    }

    // Pipeline steps will be added here in later phases
    return { messages: event.messages };
  });
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Update smoke test**

Replace `test/smoke.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import createExtension from "../src/index.js";

describe("pi-dcp", () => {
  it("exports a function", () => {
    expect(typeof createExtension).toBe("function");
  });

  it("accepts a mock ExtensionAPI without throwing", () => {
    const handlers = new Map<string, Function[]>();
    const mockApi = {
      on(event: string, handler: Function) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
      registerTool() {},
      registerCommand() {},
    } as any;

    expect(() => createExtension(mockApi)).not.toThrow();

    // Verify handlers were registered
    expect(handlers.has("session_start")).toBe(true);
    expect(handlers.has("session_compact")).toBe(true);
    expect(handlers.has("session_shutdown")).toBe(true);
    expect(handlers.has("context")).toBe(true);
  });
});
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/smoke.test.ts
git commit -m "feat: wire foundation into extension lifecycle hooks"
```

---

## Phase 2: Strategies

### Task 2.1: Protected Patterns

**Files:**

- Create: `src/strategies/protected-patterns.ts`
- Test: `test/protected-patterns.test.ts`

Glob matching for tool name and file path protection. Tools in the protected list are never pruned by strategies.

- [ ] **Step 1: Write tests**

Create `test/protected-patterns.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  matchesGlob,
  isToolNameProtected,
  getFilePathsFromParameters,
  isFilePathProtected,
} from "../src/strategies/protected-patterns.js";

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
      expect(matchesGlob("src/foo/bar.js", "src/**/*.ts")).toBe(false);
    });

    it("matches ? single char", () => {
      expect(matchesGlob("ab", "a?")).toBe(true);
      expect(matchesGlob("abc", "a?")).toBe(false);
    });
  });

  describe("isToolNameProtected", () => {
    it("checks exact match in set", () => {
      expect(isToolNameProtected("bash", ["bash", "read"])).toBe(true);
      expect(isToolNameProtected("write", ["bash", "read"])).toBe(false);
    });

    it("checks glob patterns", () => {
      expect(isToolNameProtected("todo_write", ["todo*"])).toBe(true);
      expect(isToolNameProtected("other", ["todo*"])).toBe(false);
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

    it("extracts from edit tool", () => {
      const paths = getFilePathsFromParameters("edit", {
        filePath: "/tmp/bar.ts",
      });
      expect(paths).toEqual(["/tmp/bar.ts"]);
    });
  });

  describe("isFilePathProtected", () => {
    it("matches file paths against glob patterns", () => {
      expect(isFilePathProtected(["/src/config.ts"], ["src/**/*.ts"])).toBe(
        true,
      );
      expect(isFilePathProtected(["/tmp/foo.js"], ["src/**/*.ts"])).toBe(false);
    });

    it("returns false for empty paths", () => {
      expect(isFilePathProtected([], ["src/**"])).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- test/protected-patterns.test.ts
```

Expected: FAIL.

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
  const regex = globToRegex(pattern);
  return regex.test(input);
}

function globToRegex(pattern: string): RegExp {
  let result = "^";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // ** matches everything including /
        if (pattern[i + 2] === "/") {
          result += "(?:.*/)?";
          i += 3;
        } else {
          result += ".*";
          i += 2;
        }
      } else {
        // * matches everything except /
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

  // Standard filePath parameter (read, write, edit, etc.)
  if (typeof parameters.filePath === "string") {
    paths.push(parameters.filePath);
  }

  // Future: handle tool-specific path extraction
  // (apply_patch patchText parsing, multiedit nested paths, etc.)

  return paths;
}

export function isFilePathProtected(
  filePaths: string[],
  patterns: string[],
): boolean {
  if (filePaths.length === 0 || patterns.length === 0) return false;
  for (const filePath of filePaths) {
    for (const pattern of patterns) {
      if (matchesGlob(filePath, pattern)) return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- test/protected-patterns.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategies/protected-patterns.ts test/protected-patterns.test.ts
git commit -m "feat: add glob matching for tool and file path protection"
```

---

### Task 2.2: Tool Parameter Cache

**Files:**

- Create: `src/state/tool-cache.ts`
- Test: `test/tool-cache.test.ts`

Scans messages to build `state.toolParameters` and `state.toolIdList` on each context event. Used by deduplication and purge-errors strategies.

- [ ] **Step 1: Write tests**

Create `test/tool-cache.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { syncToolCache, buildToolIdList } from "../src/state/tool-cache.js";
import { createSessionState } from "../src/state/state.js";
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
    stopReason: "tool",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
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
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- test/tool-cache.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement tool cache**

Create `src/state/tool-cache.ts`:

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState, ToolParameterEntry } from "./types.js";
import { countTokens, extractMessageText } from "../utils/tokens.js";

/**
 * Scan messages and populate state.toolParameters with metadata for each tool call.
 * Called on every context event to keep the cache current.
 */
export function syncToolCache(
  state: SessionState,
  messages: AgentMessage[],
): void {
  // Track which tool call IDs we've seen results for
  const resultsByCallId = new Map<
    string,
    { isError: boolean; errorText?: string }
  >();

  // First pass: collect tool results
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
      if (state.toolParameters.has(callId)) continue; // Already cached

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
    if (
      typeof part === "object" &&
      part !== null &&
      (part as any).type === "text"
    ) {
      texts.push((part as any).text);
    }
  }
  return texts.join("\n") || undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- test/tool-cache.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/tool-cache.ts test/tool-cache.test.ts
git commit -m "feat: add tool parameter cache for strategy support"
```

---

### Task 2.3: Deduplication Strategy

**Files:**

- Create: `src/strategies/deduplication.ts`
- Test: `test/deduplication.test.ts`

Identifies repeated tool calls with identical signature (tool name + normalized parameters), keeps only the most recent, marks older ones for pruning.

- [ ] **Step 1: Write tests**

Create `test/deduplication.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  deduplicate,
  createToolSignature,
} from "../src/strategies/deduplication.js";
import { createSessionState } from "../src/state/state.js";
import type { DcpConfig } from "../src/config.js";

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

      // Simulate two identical read calls
      state.toolParameters.set("call1", {
        tool: "read",
        parameters: { filePath: "/tmp/a.ts" },
        status: "completed",
        error: undefined,
        turn: 1,
        tokenCount: 100,
      });
      state.toolParameters.set("call2", {
        tool: "read",
        parameters: { filePath: "/tmp/a.ts" },
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

    it("skips protected tools", () => {
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
      // bash is in BASE_PROTECTED_TOOLS
      expect(result.pruned).toBe(0);
    });

    it("does nothing when disabled", () => {
      const state = createSessionState();
      const config = makeDefaultConfig();
      config.strategies.deduplication.enabled = false;

      state.toolParameters.set("call1", {
        tool: "read",
        parameters: { filePath: "a" },
        status: "completed",
        error: undefined,
        turn: 1,
        tokenCount: 100,
      });
      state.toolParameters.set("call2", {
        tool: "read",
        parameters: { filePath: "a" },
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
npm test -- test/deduplication.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement deduplication**

Create `src/strategies/deduplication.ts`:

```typescript
import { BASE_PROTECTED_TOOLS, type DcpConfig } from "../config.js";
import type { SessionState } from "../state/types.js";
import {
  isToolNameProtected,
  getFilePathsFromParameters,
  isFilePathProtected,
} from "./protected-patterns.js";

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

  // Filter to unpruned tool IDs
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
  for (const [_sig, callIds] of groups) {
    if (callIds.length <= 1) continue;

    // Keep last, prune the rest
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

export function createToolSignature(
  toolName: string,
  parameters: unknown,
): string {
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
npm test -- test/deduplication.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategies/deduplication.ts test/deduplication.test.ts
git commit -m "feat: add signature-based tool deduplication strategy"
```

---

### Task 2.4: Purge Errors Strategy

**Files:**

- Create: `src/strategies/purge-errors.ts`
- Test: `test/purge-errors.test.ts`

Prunes input content of errored tool calls after they've aged past a configurable number of turns.

- [ ] **Step 1: Write tests**

Create `test/purge-errors.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { purgeErrors } from "../src/strategies/purge-errors.js";
import { createSessionState } from "../src/state/state.js";
import type { DcpConfig } from "../src/config.js";

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
      turn: 3, // age = 10 - 3 = 7 >= 4
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
      turn: 3, // age = 5 - 3 = 2 < 4
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- test/purge-errors.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement purge errors**

Create `src/strategies/purge-errors.ts`:

```typescript
import { BASE_PROTECTED_TOOLS, type DcpConfig } from "../config.js";
import type { SessionState } from "../state/types.js";
import {
  isToolNameProtected,
  getFilePathsFromParameters,
  isFilePathProtected,
} from "./protected-patterns.js";

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
npm test -- test/purge-errors.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategies/purge-errors.ts test/purge-errors.test.ts
git commit -m "feat: add age-gated error tool input pruning strategy"
```

---

## Phase 3: Core Pruning

### Task 3.1: Tool Output and Input Pruning

**Files:**

- Create: `src/messages/prune.ts`
- Test: `test/prune.test.ts`

Applies pruning marks from strategies to the actual message array. Replaces tool outputs/inputs with placeholder text.

- [ ] **Step 1: Write tests**

Create `test/prune.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { pruneToolOutputs, pruneToolErrors } from "../src/messages/prune.js";
import { createSessionState } from "../src/state/state.js";
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
      // No prune marks

      const messages: AgentMessage[] = [
        makeToolResult("call1", "grep", "output"),
      ];

      const result = pruneToolOutputs(state, messages);
      expect((result[0] as any).content[0].text).toBe("output");
    });
  });

  describe("pruneToolErrors", () => {
    it("replaces input text of pruned error tool results", () => {
      const state = createSessionState();
      state.prune.tools.set("call1", 100);

      const messages: AgentMessage[] = [
        makeToolResult("call1", "bash", "Error: command not found", true),
      ];

      // For error pruning, we replace the content but keep the error message
      const result = pruneToolErrors(state, messages);
      expect(result).toHaveLength(1);
      const content = (result[0] as any).content;
      expect(content[0].text).toContain("[input removed");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- test/prune.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement pruning**

Create `src/messages/prune.ts`:

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.js";

const PRUNED_OUTPUT_TEXT =
  "[Output removed to save context — information superseded or no longer needed]";
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
    if (msg.isError) return msg; // Errors handled by pruneToolErrors

    return {
      ...msg,
      content: [{ type: "text" as const, text: PRUNED_OUTPUT_TEXT }],
    };
  });
}

/**
 * Replace content of pruned error tool results with placeholder text.
 * The error information is preserved (Pi stores isError flag).
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
    if (!msg.isError) return msg; // Non-errors handled by pruneToolOutputs

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
npm test -- test/prune.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/messages/prune.ts test/prune.test.ts
git commit -m "feat: add tool output and error pruning"
```

---

### Task 3.2: Hallucination Stripping

**Files:**

- Create: `src/messages/strip.ts`
- Test: `test/strip.test.ts`

Removes hallucinated `<dcp-message-id>` and `<dcp-system-reminder>` tags from messages that models might accidentally output.

- [ ] **Step 1: Write tests**

Create `test/strip.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { stripHallucinations } from "../src/messages/strip.js";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("strip", () => {
  describe("stripHallucinations", () => {
    it("removes dcp-message-id tags from assistant text", () => {
      const messages: AgentMessage[] = [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Here is the answer <dcp-message-id>m0001</dcp-message-id> with stuff",
            },
          ],
          stopReason: "end",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
          },
          timestamp: Date.now(),
        } as AgentMessage,
      ];

      const result = stripHallucinations(messages);
      const text = (result[0] as any).content[0].text;
      expect(text).not.toContain("dcp-message-id");
      expect(text).toContain("Here is the answer");
      expect(text).toContain("with stuff");
    });

    it("removes dcp-system-reminder tags", () => {
      const messages: AgentMessage[] = [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "text <dcp-system-reminder>reminder</dcp-system-reminder> more",
            },
          ],
          stopReason: "end",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
          },
          timestamp: Date.now(),
        } as AgentMessage,
      ];

      const result = stripHallucinations(messages);
      const text = (result[0] as any).content[0].text;
      expect(text).not.toContain("dcp-system-reminder");
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
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- test/strip.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement stripping**

Create `src/messages/strip.ts`:

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";

const DCP_TAG_REGEX = /<dcp-message-id[^>]*>.*?<\/dcp-message-id>/gs;
const DCP_REMINDER_REGEX =
  /<dcp-system-reminder[^>]*>.*?<\/dcp-system-reminder>/gs;

/**
 * Strip hallucinated DCP tags from assistant messages.
 * Models sometimes output these tags in their responses.
 * Returns a new array.
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

      const cleaned = (p.text as string)
        .replace(DCP_TAG_REGEX, "")
        .replace(DCP_REMINDER_REGEX, "");

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

/**
 * Strip hallucinated DCP tags from a single string.
 * Used for streaming text cleanup.
 */
export function stripHallucinationsFromString(text: string): string {
  return text.replace(DCP_TAG_REGEX, "").replace(DCP_REMINDER_REGEX, "");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- test/strip.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/messages/strip.ts test/strip.test.ts
git commit -m "feat: add hallucinated DCP tag stripping"
```

---

### Task 3.3: Wire Strategies and Pruning into Context Pipeline

**Files:**

- Modify: `src/index.ts`

Connect the strategies, tool cache, pruning, and stripping to the `context` event handler.

- [ ] **Step 1: Update index.ts context handler**

Update the `context` event handler in `src/index.ts` to call the strategy and pruning functions:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, type DcpConfig } from "./config.js";
import { Logger } from "./logger.js";
import { createSessionState, resetSessionState } from "./state/state.js";
import type { SessionState } from "./state/types.js";
import { syncToolCache, buildToolIdList } from "./state/tool-cache.js";
import { deduplicate } from "./strategies/deduplication.js";
import { purgeErrors } from "./strategies/purge-errors.js";
import { applyPruning } from "./messages/prune.js";
import { stripHallucinations } from "./messages/strip.js";

export default function createExtension(pi: ExtensionAPI): void {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const globalConfigDir = process.env.PI_CONFIG_DIR ?? `${home}/.config/pi`;

  let config: DcpConfig;
  const state: SessionState = createSessionState();
  let logger: Logger;

  function reloadConfig(cwd: string): void {
    config = loadConfig(cwd, globalConfigDir);
    logger = new Logger(config.debug);
  }

  reloadConfig(process.cwd());

  if (!config!.enabled) return;

  // Session lifecycle
  pi.on("session_start", async (event, ctx) => {
    reloadConfig(ctx.cwd);
    if (!config.enabled) return;

    resetSessionState(state);
    state.sessionId = `pi-${Date.now()}`;
    state.manualMode = config.manualMode.default;
    state.currentTurn = 0;

    const usage = ctx.getContextUsage();
    if (usage) {
      state.modelContextWindow = usage.contextWindow;
    }

    logger.info("dcp", "session started", {
      sessionId: state.sessionId,
      reason: event.reason,
      mode: config.compress.mode,
    });
  });

  pi.on("session_compact", async (_event, _ctx) => {
    state.prune.tools.clear();
    state.prune.messages.byMessageIndex.clear();
    state.prune.messages.blocksById.clear();
    state.prune.messages.activeBlockIds.clear();
    state.prune.messages.activeByAnchorIndex.clear();
    state.lastCompaction = Date.now();
    logger.info("dcp", "compaction detected, pruning state reset");
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    logger.info("dcp", "session shutdown");
  });

  // Core context transform pipeline
  pi.on("context", async (event, ctx) => {
    if (!config.enabled) return;

    const usage = ctx.getContextUsage();
    if (usage) {
      state.modelContextWindow = usage.contextWindow;
    }

    let messages = event.messages;

    // Count turns (user messages)
    let turnCount = 0;
    for (const msg of messages) {
      if (msg.role === "user") turnCount++;
    }
    state.currentTurn = turnCount;

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

    // Steps 5-8 (nudges, message IDs, compression) will be added in later phases

    return { messages };
  });
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire strategies and pruning into context pipeline"
```

---

## Phase 4-8: Remaining Phases (Summary)

The remaining phases follow the same pattern established above. Here is a condensed summary of what each phase builds. Each will be expanded into full tasks with tests when the previous phase is complete.

### Phase 4: Nudges

**Task 4.1: Nudge Prompt Texts** — Create `src/prompts/nudges.ts` with the three nudge prompt templates (context-limit, turn, iteration).

**Task 4.2: Message ID Injection** — Create `src/messages/inject.ts` implementing `assignMessageRefs()` (assigns m0001-m9999 to messages) and `injectMessageIds()` (appends `<dcp-message-id>` tags to message content).

**Task 4.3: Nudge Injection** — Add `injectCompressNudges()` to `src/messages/inject.ts` — evaluates context usage via `ctx.getContextUsage()`, determines nudge tier, injects nudge prompt text into appropriate messages.

**Task 4.4: System Prompt** — Create `src/prompts/system.ts` with the DCP system prompt. Wire into `before_agent_start` event to append DCP instructions to Pi's system prompt.

**Task 4.5: Wire Nudges** — Add message ID assignment and nudge injection to the context pipeline in `src/index.ts`.

### Phase 5: Range Compression

**Task 5.1: Compress Tool Prompt** — Create `src/prompts/compress-range.ts` with range-mode compress tool instructions.

**Task 5.2: Compression Block State** — Create `src/compress/state.ts` implementing `allocateBlockId()`, `allocateRunId()`, `applyCompressionState()`, `wrapCompressedSummary()`.

**Task 5.3: Search and Boundary Resolution** — Create `src/compress/search.ts` implementing `resolveBoundaryIds()`, `resolveSelection()`, `buildSearchContext()`.

**Task 5.4: Protected Content** — Create `src/compress/protected.ts` implementing protected tool output, user message, and tag content appending to summaries.

**Task 5.5: Range Compression Pipeline** — Create `src/compress/pipeline.ts` (shared prepare/finalize) and `src/compress/range.ts` (the compress tool implementation).

**Task 5.6: Register Compress Tool** — Wire the compress tool into the extension via `pi.registerTool()` with TypeBox parameters.

**Task 5.7: Compression Block Sync** — Create `src/messages/sync.ts` implementing `syncCompressionBlocks()` — reconciles block state with current messages on each context event.

**Task 5.8: Summary Injection in Prune** — Extend `src/messages/prune.ts` with `filterCompressedRanges()` — replaces compressed message ranges with summary custom messages.

### Phase 6: Message Compression

**Task 6.1: Message-Mode Prompt** — Create `src/prompts/compress-message.ts`.

**Task 6.2: Priority Map** — Create `src/messages/priority.ts` implementing `buildPriorityMap()`.

**Task 6.3: Message-Mode Tool** — Create `src/compress/message.ts` — the message-mode compress tool variant.

### Phase 7: Commands

**Task 7.1: Command Router** — Create `src/commands/index.ts` routing `/dcp` subcommands.

**Task 7.2: Help Command** — Create `src/commands/help.ts`.

**Task 7.3: Context Command** — Create `src/commands/context.ts` — token usage breakdown.

**Task 7.4: Stats Command** — Create `src/commands/stats.ts` — cumulative statistics.

**Task 7.5: Sweep Command** — Create `src/commands/sweep.ts` — bulk tool pruning.

**Task 7.6: Manual Mode** — Create `src/commands/manual.ts` — toggle + trigger.

**Task 7.7: Decompress/Recompress** — Create `src/commands/decompress.ts` and `src/commands/recompress.ts`.

**Task 7.8: Register Commands** — Wire all commands via `pi.registerCommand("dcp", ...)` in `src/index.ts`.

### Phase 8: Polish

**Task 8.1: State Persistence** — Create `src/state/persistence.ts` — save/load session state to `~/.local/share/pi/dcp/{sessionId}.json`.

**Task 8.2: Cross-Session Stats** — Add `loadAllSessionStats()` to persistence for `/dcp stats` aggregation.

**Task 8.3: Full Config Validation** — Add validation for unknown keys and type errors to `src/config.ts`.

**Task 8.4: Status Bar Integration** — Add `ctx.ui.setStatus("dcp", ...)` calls to show compression savings in Pi's footer.

**Task 8.5: Final Integration Test** — End-to-end test loading the extension with a mock Pi API, running a context event through the full pipeline.
