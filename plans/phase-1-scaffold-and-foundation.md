# Phase 1: Scaffold + Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **IMPORTANT:** Read `plans/ERRATA.md` before implementing. It contains corrections to API signatures, type shapes, and import paths verified against Pi source.

**Goal:** Create a working Pi extension package that loads in Pi, reads JSON config, logs debug output, manages session state, and hooks into Pi's extension lifecycle — producing the skeleton that all later phases build on.

**Architecture:** Standalone pnpm package exporting a Pi `ExtensionFactory`. Registers `session_start`, `session_compact`, `session_shutdown`, and `context` event handlers. The `context` handler is a passthrough (returns messages unmodified) — later phases add pipeline steps.

**Tech Stack:** TypeScript (erasable syntax only), Pi Extension API (`@earendil-works/pi-coding-agent`), TypeBox (via `typebox`), biome, vitest

**Usable result after this phase:** The extension installs in Pi (via `pi.extensions` config), loads without error, logs session lifecycle events to `{sessionDir}/dcp/logs/` (where `sessionDir` = `ctx.sessionManager.getSessionDir()`), and reads configuration from `~/.pi/agent/extensions/dcp.json`.

**Reference Material:**

- Pi extension types: `pi/packages/coding-agent/src/core/extensions/types.ts`
- Pi agent types: `pi/packages/agent/src/types.ts`
- Reference extension: `pi-subagents/` (package.json, tsconfig.json, biome.json conventions)
- Design spec: `plans/2026-06-15-pi-dcp-design.md`

**Conventions:**

- Package manager: pnpm with `pnpm-workspace.yaml`
- Import extensions: `.ts` with `allowImportingTsExtensions: true`
- Linter/formatter: biome (`@biomejs/biome`)
- Test directory: `tests/`
- tsconfig module: `node16` / `Node16`
- TypeScript: Erasable syntax only (no enums, no parameter properties)
- Entry point: `"pi": { "extensions": ["./src/index.ts"] }`
- Scripts: format, lint, typecheck, test, check, pack:dry-run
- Config: Plain JSON at `~/.pi/agent/extensions/dcp.json` (resolved via `getAgentDir()`)

---

## File Structure

```
pi-dcp/
  src/
    index.ts                    # Extension factory entry point
    config.ts                   # Config loading, validation, defaults
    logger.ts                   # File-based debug logging
    state/
      types.ts                  # SessionState, CompressionBlock, Prune, etc.
      state.ts                  # State creation, reset
    utils/
      tokens.ts                 # Token counting (char-based estimation)
      message-ids.ts            # m0001/b1 formatting, parsing
  tests/
    index.test.ts               # Extension loads without error
    logger.test.ts
    message-ids.test.ts
    tokens.test.ts
    state.test.ts
    config.test.ts
  package.json
  tsconfig.json
  vitest.config.ts
  biome.json
  pnpm-workspace.yaml
  .gitignore
```

---

### Task 1: Initialize package scaffold

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `biome.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `src/index.ts`
- Create: `tests/index.test.ts`
- Create: `.github/workflows/quality.yml`
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@pi-vault/pi-dcp",
  "version": "0.1.0",
  "type": "module",
  "description": "Pi extension for dynamic context pruning — incremental tool output pruning and conversation compression",
  "author": "Lanh Hoang <lanhhoang@users.noreply.github.com>",
  "license": "MIT",
  "homepage": "https://github.com/pi-vault/pi-dcp#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/pi-vault/pi-dcp.git"
  },
  "bugs": {
    "url": "https://github.com/pi-vault/pi-dcp/issues"
  },
  "keywords": [
    "pi",
    "pi-coding-agent",
    "pi-package",
    "pi-extension",
    "pi-dcp",
    "context-pruning",
    "compression"
  ],
  "scripts": {
    "format": "biome format --write .",
    "lint": "biome lint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check": "biome lint . && tsc --noEmit && vitest run",
    "pack:dry-run": "pnpm pack --dry-run"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "engines": {
    "node": ">=22.19.0"
  },
  "files": ["src", "README.md"],
  "peerDependencies": {
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-coding-agent": "*"
  },
  "dependencies": {
    "typebox": "^1.2.10"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.5.0",
    "@earendil-works/pi-agent-core": "^0.79.3",
    "@earendil-works/pi-coding-agent": "^0.79.3",
    "@types/node": "^25.9.3",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.0/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": false,
    "includes": ["src/**/*.ts", "tests/**/*.ts", "!**/node_modules"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "preset": "recommended"
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always"
    }
  },
  "assist": {
    "enabled": true,
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  }
}
```

- [ ] **Step 5: Create pnpm-workspace.yaml**

```yaml
allowBuilds:
  "@google/genai": true
  protobufjs: true
minimumReleaseAgeExclude:
  - typebox
```

- [ ] **Step 6: Create .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
tmp/
```

- [ ] **Step 7: Create minimal extension entry point**

Create `src/index.ts`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function createExtension(pi: ExtensionAPI): void {
  // Foundation handlers will be added in Task 7
}
```

- [ ] **Step 8: Create extension smoke test (`tests/index.test.ts`)**

Create `tests/index.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import createExtension from "../src/index.ts";

describe("dcp extension", () => {
  it("exports a function", () => {
    expect(typeof createExtension).toBe("function");
  });
});
```

- [ ] **Step 9: Create workflow to quality check**

Create `.github/workflows/quality.yml`:

```yaml
name: Quality Check

on:
  push:
    branches: ["master"]
  pull_request:
    branches: ["master"]

jobs:
  quality:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 11.3.0
          run_install: false

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: pnpm
          registry-url: "https://registry.npmjs.org"

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Check
        run: pnpm check

      - name: Format
        run: pnpm format
```

- [ ] **Step 10: Create workflow to release**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          registry-url: "https://registry.npmjs.org"

      - name: Install
        run: npm install --legacy-peer-deps

      - name: Semantic Release
        uses: cycjimmy/semantic-release-action@v4
        with:
          branches: ["master"]
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 11: Install dependencies**

```bash
pnpm install
```

Expected: `node_modules/` created, `pnpm-lock.yaml` generated.

- [ ] **Step 12: Verify typecheck and test pass**

```bash
pnpm run typecheck
pnpm test
```

Expected: No type errors. 1 test passes.

- [ ] **Step 13: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vitest.config.ts biome.json .gitignore src/index.ts tests/index.test.ts
git commit -m "chore: scaffold pi-dcp extension package"
```

---

### Task 2: Logger

**Files:**

- Create: `src/logger.ts`
- Test: `tests/logger.test.ts`

The logger writes debug lines to `{sessionDir}/dcp/logs/YYYY-MM-DD.log` when debug mode is enabled. Disabled by default. The log directory is resolved from `ctx.sessionManager.getSessionDir()` in `session_start`, but the logger accepts a `logDir` parameter for testability. No `daily/` subdirectory.

- [ ] **Step 1: Write tests for Logger**

Create `tests/logger.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Logger } from "../src/logger.ts";

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

    const logFiles = fs.readdirSync(tempDir);
    expect(logFiles).toHaveLength(1);

    const content = fs.readFileSync(path.join(tempDir, logFiles[0]), "utf-8");
    expect(content).toContain("INFO");
    expect(content).toContain("test-source");
    expect(content).toContain("hello world");
  });

  it("formats key-value data", () => {
    const logger = new Logger(true, tempDir);
    logger.info("src", "msg", { count: 5, name: "foo" });

    const logFiles = fs.readdirSync(tempDir);
    const content = fs.readFileSync(path.join(tempDir, logFiles[0]), "utf-8");
    expect(content).toContain("count=5");
    expect(content).toContain('name="foo"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/logger.test.ts
```

Expected: FAIL — `Logger` not found.

- [ ] **Step 3: Implement Logger**

Create `src/logger.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";

export class Logger {
  private enabled: boolean;
  private logDir: string | undefined;

  constructor(enabled: boolean, logDir?: string) {
    this.enabled = enabled;
    this.logDir = logDir;
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
    if (!this.enabled || !this.logDir) return;

    const now = new Date();
    const timestamp = now.toISOString();
    const dateStr = timestamp.slice(0, 10);

    fs.mkdirSync(this.logDir, { recursive: true });

    let line = `${timestamp} ${level.padEnd(5)} ${source}: ${message}`;
    if (data) {
      const pairs = Object.entries(data)
        .map(([k, v]) => `${k}=${typeof v === "string" ? `"${v}"` : String(v)}`)
        .join(" ");
      line += ` | ${pairs}`;
    }

    fs.appendFileSync(path.join(this.logDir, `${dateStr}.log`), line + "\n");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- tests/logger.test.ts
```

Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat: add file-based debug logger"
```

---

### Task 3: Message ID System

**Files:**

- Create: `src/utils/message-ids.ts`
- Test: `tests/message-ids.test.ts`

Sequential message IDs (`m0001`–`m9999`) and block IDs (`b1`, `b2`, ...) for referencing messages and compression blocks in the compress tool.

- [ ] **Step 1: Write tests**

Create `tests/message-ids.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  formatMessageRef,
  formatBlockRef,
  parseMessageRef,
  parseBlockRef,
  parseBoundaryId,
  formatMessageIdTag,
} from "../src/utils/message-ids.ts";

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
pnpm test -- tests/message-ids.test.ts
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
pnpm test -- tests/message-ids.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/message-ids.ts tests/message-ids.test.ts
git commit -m "feat: add message ID formatting and parsing"
```

---

### Task 4: Token Counting

**Files:**

- Create: `src/utils/tokens.ts`
- Test: `tests/tokens.test.ts`

Character-based token estimation (`text.length / 4`). Pi's `ctx.getContextUsage()` provides accurate context-level counts for threshold decisions. These per-message estimates are for relative comparisons (compression savings, priority ranking).

- [ ] **Step 1: Write tests**

Create `tests/tokens.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  countTokens,
  countTokensBatch,
  extractMessageText,
  countMessageTokens,
} from "../src/utils/tokens.ts";

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

  describe("extractMessageText", () => {
    it("extracts text from text content array", () => {
      const text = extractMessageText({
        role: "user",
        content: [{ type: "text", text: "hello" }],
      });
      expect(text).toBe("hello");
    });

    it("extracts text from string content", () => {
      const text = extractMessageText({
        role: "user",
        content: "hello world",
      });
      expect(text).toBe("hello world");
    });

    it("extracts tool call info", () => {
      const text = extractMessageText({
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "c1",
            name: "read",
            arguments: { filePath: "/tmp/a" },
          },
        ],
      });
      expect(text).toContain("read");
      expect(text).toContain("/tmp/a");
    });

    it("returns empty for missing content", () => {
      expect(extractMessageText({ role: "user" })).toBe("");
    });
  });

  describe("countMessageTokens", () => {
    it("counts tokens for a message", () => {
      const count = countMessageTokens({
        role: "user",
        content: [{ type: "text", text: "hello world" }],
      });
      expect(count).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/tokens.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement token utilities**

Create `src/utils/tokens.ts`:

```typescript
/**
 * Token counting using character-based estimation.
 *
 * Uses length/4 as a rough approximation. Pi's built-in ctx.getContextUsage()
 * provides accurate context-level token counts for threshold decisions. These
 * per-message estimates are for relative comparisons (compression savings,
 * priority ranking).
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
 * Extract all text content from a message-shaped object for token counting.
 * Handles UserMessage (string | TextContent[]), AssistantMessage (TextContent +
 * ToolCallContent), and ToolResultMessage.
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
pnpm test -- tests/tokens.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/tokens.ts tests/tokens.test.ts
git commit -m "feat: add token counting utilities"
```

---

### Task 5: State Types and Creation

**Files:**

- Create: `src/state/types.ts`
- Create: `src/state/state.ts`
- Test: `tests/state.test.ts`

Session state holds pruning marks, compression blocks, tool caches, nudge anchors, and statistics. Designed for in-memory use; persistence comes in Phase 7.

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
  /** Anchor message index -> active block ID. */
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
  startIndex: number;
  endIndex: number;
  anchorIndex: number;
  compressMessageIndex: number;
  includedBlockIds: number[];
  consumedBlockIds: number[];
  parentBlockIds: number[];
  directMessageIndices: number[];
  directToolIds: string[];
  effectiveMessageIndices: number[];
  effectiveToolIds: string[];
  createdAt: number;
  deactivatedAt: number | undefined;
  deactivatedByBlockId: number | undefined;
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
  contextLimitAnchors: Set<number>;
  turnAnchors: Set<number>;
  iterationAnchors: Set<number>;
}

export interface SessionStats {
  pruneTokenCounter: number;
  totalPruneTokens: number;
  toolsPruned: number;
  messagesCompressed: number;
}

export interface MessageIdState {
  byIndex: Map<number, string>;
  nextRefIndex: number;
}
```

- [ ] **Step 2: Write tests for state creation and reset**

Create `tests/state.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createSessionState, resetSessionState } from "../src/state/state.ts";

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

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm test -- tests/state.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement state creation**

Create `src/state/state.ts`:

```typescript
import type {
  MessageIdState,
  Nudges,
  Prune,
  PruneMessagesState,
  SessionState,
  SessionStats,
} from "./types.ts";

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

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm run typecheck
pnpm test -- tests/state.test.ts
```

Expected: No type errors. All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/state/types.ts src/state/state.ts tests/state.test.ts
git commit -m "feat: add session state types and creation"
```

---

### Task 6: Configuration System

**Files:**

- Create: `src/config.ts`
- Test: `tests/config.test.ts`

Loads DCP configuration from a single plain JSON file at `~/.pi/agent/extensions/dcp.json`. The path is resolved via `getAgentDir()` from `@earendil-works/pi-coding-agent` at runtime. Falls back to defaults on parse error or missing file. No project-level overrides, no JSONC.

- [ ] **Step 1: Write tests**

Create `tests/config.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig } from "../src/config.ts";

describe("config", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const configPath = path.join(tempDir, "dcp.json");
    const config = loadConfig(configPath);
    expect(config.enabled).toBe(true);
    expect(config.debug).toBe(false);
    expect(config.compress.mode).toBe("range");
    expect(config.compress.permission).toBe("allow");
    expect(config.strategies.deduplication.enabled).toBe(true);
    expect(config.strategies.purgeErrors.enabled).toBe(true);
  });

  it("loads config from file", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        debug: true,
        compress: { mode: "message" },
      }),
    );

    const config = loadConfig(configPath);
    expect(config.debug).toBe(true);
    expect(config.compress.mode).toBe("message");
    expect(config.enabled).toBe(true);
  });

  it("handles invalid JSON gracefully", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(configPath, "not valid json {{{");

    const config = loadConfig(configPath);
    expect(config.enabled).toBe(true);
  });

  it("ignores unknown keys", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        unknownKey: "value",
        compress: { mode: "range", unknownNested: true },
      }),
    );

    const config = loadConfig(configPath);
    expect(config.compress.mode).toBe("range");
  });

  it("validates numeric ranges", () => {
    const configPath = path.join(tempDir, "dcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        compress: { maxContextPercent: -5, nudgeFrequency: 0 },
      }),
    );

    const config = loadConfig(configPath);
    expect(config.compress.maxContextPercent).toBe(80);
    expect(config.compress.nudgeFrequency).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/config.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement config**

Create `src/config.ts`:

```typescript
import * as fs from "node:fs";

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
 * Tool names always protected from pruning strategies.
 * Pi's core tools that should never have their outputs removed.
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

/**
 * Load DCP configuration from a single JSON file.
 * Falls back to defaults on missing file, parse error, or invalid content.
 *
 * @param configFilePath - Absolute path to dcp.json (typically resolved via getAgentDir())
 */
export function loadConfig(configFilePath: string): DcpConfig {
  const config = structuredClone(DEFAULT_CONFIG);

  const parsed = parseConfigFile(configFilePath);
  if (parsed) mergeConfig(config, parsed);

  return config;
}

function parseConfigFile(
  filePath: string,
): Record<string, unknown> | undefined {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
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
pnpm test -- tests/config.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add JSON configuration system with defaults"
```

---

### Task 7: Wire Foundation into Extension Entry Point

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

Connect logger, config, state, and lifecycle hooks. The `context` handler is a passthrough that later phases will extend. Uses `getAgentDir()` from `@earendil-works/pi-coding-agent` to resolve config and log paths.

- [ ] **Step 1: Update entry point**

Replace `src/index.ts`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
import { loadConfig, type DcpConfig } from "./config.ts";
import { Logger } from "./logger.ts";
import { createSessionState, resetSessionState } from "./state/state.ts";
import type { SessionState } from "./state/types.ts";

export default function createExtension(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const configFilePath = path.join(agentDir, "extensions", "dcp.json");

  let config: DcpConfig = loadConfig(configFilePath);
  let logger: Logger = new Logger(config.debug);
  const state: SessionState = createSessionState();

  function reloadConfig(logDir?: string): void {
    config = loadConfig(configFilePath);
    logger = new Logger(config.debug, logDir);
  }

  if (!config.enabled) return;

  pi.on("session_start", async (event, ctx) => {
    const sessionDir = ctx.sessionManager.getSessionDir();
    const logDir = path.join(sessionDir, "dcp", "logs");
    reloadConfig(logDir);
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

  pi.on("context", async (event, _ctx) => {
    if (!config.enabled) return;

    // Pipeline steps added in Phase 2+
    return { messages: event.messages };
  });
}
```

- [ ] **Step 2: Update `tests/index.test.ts`**

Replace `tests/index.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => "/tmp/test-pi-agent",
}));

describe("dcp extension", () => {
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

    expect(handlers.has("session_start")).toBe(true);
    expect(handlers.has("session_compact")).toBe(true);
    expect(handlers.has("session_shutdown")).toBe(true);
    expect(handlers.has("context")).toBe(true);
  });

  it("session_start resolves logDir from sessionManager", async () => {
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

    createExtension(mockApi);

    const sessionStartHandlers = handlers.get("session_start") ?? [];
    expect(sessionStartHandlers).toHaveLength(1);

    const mockCtx = {
      sessionManager: {
        getSessionDir: () => "/tmp/test-session-dir",
      },
      getContextUsage: () => ({
        tokens: 100,
        contextWindow: 200000,
        percent: 0.05,
      }),
    };

    await expect(
      sessionStartHandlers[0]({ reason: "new" }, mockCtx),
    ).resolves.not.toThrow();
  });
});
```

- [ ] **Step 3: Run all tests**

```bash
pnpm run typecheck
pnpm test
```

Expected: No type errors. All tests pass.

- [ ] **Step 4: Run lint and format**

```bash
pnpm run format
pnpm run lint
```

Expected: No lint errors after formatting.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: wire foundation into extension lifecycle hooks"
```

---

## Phase 1 Verification Checklist

After completing all tasks, run the full check:

```bash
pnpm run check
```

This runs: `biome lint . && tsc --noEmit && vitest run`

Expected output:

- 0 lint errors
- 0 type errors
- All tests pass (index, logger, message-ids, tokens, state, config)

The extension is now ready for Phase 2 (Strategy-Based Pruning) which will add the deduplication and error purging pipeline steps to the `context` handler.
