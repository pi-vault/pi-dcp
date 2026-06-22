# Phase 10: Custom Prompts (PromptStore)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to customize DCP's system prompt, nudge text, and compress tool descriptions via plain-text override files without modifying source.

**Architecture:** A `PromptStore` class reads override files from project-local and global directories with a defined precedence. When `experimental.customPrompts` is disabled (default), bundled prompts are used directly with zero filesystem access. When enabled, the store hot-reloads overrides on each `context` pass.

**Tech Stack:** TypeScript, Node.js `fs`, Vitest

---

## File Structure

| File                              | Responsibility                                               |
| --------------------------------- | ------------------------------------------------------------ |
| `src/prompts/store.ts`            | New: `PromptStore` class, override loading, hot-reload       |
| `src/config.ts`                   | Add `experimental.customPrompts` config                      |
| `src/index.ts`                    | Initialize store, pass to prompt consumers                   |
| `src/prompts/system.ts`           | Export default as constant (unchanged), consumed via store   |
| `src/prompts/nudges.ts`           | Export defaults as constants (unchanged), consumed via store |
| `src/prompts/compress-message.ts` | Export default as constant (unchanged), consumed via store   |
| `tests/prompt-store.test.ts`      | Unit tests for store loading and precedence                  |

---

### Task 1: Add config and implement PromptStore

**Files:**

- Modify: `src/config.ts`
- Create: `src/prompts/store.ts`
- Test: `tests/prompt-store.test.ts` (create)

- [ ] **Step 1: Add `customPrompts` to experimental config**

In `src/config.ts`, add to `ExperimentalConfig`:

```typescript
export interface ExperimentalConfig {
  allowSubAgents: boolean;
  customPrompts: boolean;
}
```

Update default:

```typescript
  experimental: {
    allowSubAgents: false,
    customPrompts: false,
  },
```

Add parsing:

```typescript
if (typeof e.customPrompts === "boolean")
  target.experimental.customPrompts = e.customPrompts;
```

- [ ] **Step 2: Write tests for PromptStore**

Create `tests/prompt-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PromptStore } from "../src/prompts/store.ts";

describe("PromptStore", () => {
  let tempDir: string;
  let projectDir: string;
  let globalDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-prompts-test-"));
    projectDir = path.join(
      tempDir,
      "project",
      ".pi",
      "dcp-prompts",
      "overrides",
    );
    globalDir = path.join(tempDir, "global", "overrides");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns bundled defaults when no override files exist", () => {
    const store = new PromptStore({
      projectOverrideDir: projectDir,
      globalOverrideDir: globalDir,
    });
    store.reload();
    const prompts = store.getRuntimePrompts();

    expect(prompts.system).toContain("context-constrained environment");
    expect(prompts.contextLimitNudge).toContain("CRITICAL WARNING");
    expect(prompts.turnNudge).toContain("Evaluate the conversation");
    expect(prompts.iterationNudge).toContain("iterating for a while");
  });

  it("project override takes precedence over global", () => {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, "system.md"), "Global system prompt");
    fs.writeFileSync(
      path.join(projectDir, "system.md"),
      "Project system prompt",
    );

    const store = new PromptStore({
      projectOverrideDir: projectDir,
      globalOverrideDir: globalDir,
    });
    store.reload();

    expect(store.getRuntimePrompts().system).toBe("Project system prompt");
  });

  it("global override used when no project override exists", () => {
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, "turn-nudge.md"),
      "Custom turn nudge",
    );

    const store = new PromptStore({
      projectOverrideDir: projectDir,
      globalOverrideDir: globalDir,
    });
    store.reload();

    expect(store.getRuntimePrompts().turnNudge).toBe("Custom turn nudge");
    // Other prompts remain default
    expect(store.getRuntimePrompts().system).toContain("context-constrained");
  });

  it("strips HTML comments from override files", () => {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "system.md"),
      "Prompt <!-- comment --> text",
    );

    const store = new PromptStore({
      projectOverrideDir: projectDir,
      globalOverrideDir: globalDir,
    });
    store.reload();

    expect(store.getRuntimePrompts().system).toBe("Prompt  text");
  });

  it("falls back to default for empty override files", () => {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "system.md"), "   ");

    const store = new PromptStore({
      projectOverrideDir: projectDir,
      globalOverrideDir: globalDir,
    });
    store.reload();

    expect(store.getRuntimePrompts().system).toContain("context-constrained");
  });

  it("hot-reloads on subsequent reload() calls", () => {
    fs.mkdirSync(projectDir, { recursive: true });
    const store = new PromptStore({
      projectOverrideDir: projectDir,
      globalOverrideDir: globalDir,
    });

    store.reload();
    expect(store.getRuntimePrompts().system).toContain("context-constrained");

    fs.writeFileSync(path.join(projectDir, "system.md"), "Updated prompt");
    store.reload();
    expect(store.getRuntimePrompts().system).toBe("Updated prompt");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/prompt-store.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `src/prompts/store.ts`**

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { DCP_SYSTEM_PROMPT } from "./system.ts";
import { CONTEXT_LIMIT_NUDGE, TURN_NUDGE, ITERATION_NUDGE } from "./nudges.ts";
import { COMPRESS_MESSAGE_PROMPT } from "./compress-message.ts";

export interface RuntimePrompts {
  system: string;
  compressMessage: string;
  contextLimitNudge: string;
  turnNudge: string;
  iterationNudge: string;
}

interface PromptStoreOptions {
  projectOverrideDir: string;
  globalOverrideDir: string;
}

const PROMPT_FILES: Record<keyof RuntimePrompts, string> = {
  system: "system.md",
  compressMessage: "compress-message.md",
  contextLimitNudge: "context-limit-nudge.md",
  turnNudge: "turn-nudge.md",
  iterationNudge: "iteration-nudge.md",
};

const BUNDLED_DEFAULTS: RuntimePrompts = {
  system: DCP_SYSTEM_PROMPT,
  compressMessage: COMPRESS_MESSAGE_PROMPT,
  contextLimitNudge: CONTEXT_LIMIT_NUDGE,
  turnNudge: TURN_NUDGE,
  iterationNudge: ITERATION_NUDGE,
};

const HTML_COMMENT_REGEX = /<!--[\s\S]*?-->/g;

/**
 * PromptStore manages override precedence for DCP prompts.
 * Precedence: project > global > bundled defaults.
 */
export class PromptStore {
  private projectDir: string;
  private globalDir: string;
  private prompts: RuntimePrompts;

  constructor(options: PromptStoreOptions) {
    this.projectDir = options.projectOverrideDir;
    this.globalDir = options.globalOverrideDir;
    this.prompts = { ...BUNDLED_DEFAULTS };
  }

  /**
   * Re-read override files and rebuild runtime prompts.
   * Safe to call on every context pass (filesystem errors are swallowed).
   */
  reload(): void {
    const result = { ...BUNDLED_DEFAULTS };

    for (const [key, filename] of Object.entries(PROMPT_FILES)) {
      const override = this.loadOverride(filename);
      if (override !== undefined) {
        (result as Record<string, string>)[key] = override;
      }
    }

    this.prompts = result;
  }

  getRuntimePrompts(): RuntimePrompts {
    return this.prompts;
  }

  private loadOverride(filename: string): string | undefined {
    // Project overrides take precedence
    const projectFile = path.join(this.projectDir, filename);
    const projectContent = this.readAndNormalize(projectFile);
    if (projectContent !== undefined) return projectContent;

    // Fall back to global overrides
    const globalFile = path.join(this.globalDir, filename);
    return this.readAndNormalize(globalFile);
  }

  private readAndNormalize(filePath: string): string | undefined {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const normalized = raw.replace(HTML_COMMENT_REGEX, "").trim();
      if (!normalized) return undefined; // Empty files fall back to default
      return normalized;
    } catch {
      return undefined;
    }
  }
}

/**
 * Write bundled defaults to a directory for user reference.
 */
export function writeDefaultPrompts(targetDir: string): void {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const [key, filename] of Object.entries(PROMPT_FILES)) {
      const content = BUNDLED_DEFAULTS[key as keyof RuntimePrompts];
      const filePath = path.join(targetDir, filename);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content, "utf-8");
      }
    }
  } catch {
    // Non-fatal: defaults directory is just for reference
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/prompt-store.test.ts`

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/prompts/store.ts src/config.ts tests/prompt-store.test.ts
git commit -m "feat(prompts): implement PromptStore with override precedence and hot-reload"
```

---

### Task 2: Wire PromptStore into extension lifecycle

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Initialize PromptStore on session_start when customPrompts enabled**

In `src/index.ts`, add imports:

```typescript
import { PromptStore, writeDefaultPrompts } from "./prompts/store.ts";
import type { RuntimePrompts } from "./prompts/store.ts";
```

Add store variable after `let sessionDir`:

```typescript
let promptStore: PromptStore | undefined;
let runtimePrompts: RuntimePrompts | undefined;
```

In `session_start` handler, after config reload:

```typescript
if (config.experimental.customPrompts) {
  const projectOverrideDir = path.join(
    process.cwd(),
    ".pi",
    "dcp-prompts",
    "overrides",
  );
  const globalOverrideDir = path.join(
    agentDir,
    "extensions",
    "dcp-prompts",
    "overrides",
  );
  promptStore = new PromptStore({ projectOverrideDir, globalOverrideDir });
  promptStore.reload();
  runtimePrompts = promptStore.getRuntimePrompts();

  // Write defaults for reference on first run
  const defaultsDir = path.join(
    agentDir,
    "extensions",
    "dcp-prompts",
    "defaults",
  );
  writeDefaultPrompts(defaultsDir);
}
```

- [ ] **Step 2: Hot-reload on context pass**

In the `context` handler, after config-related setup and before pipeline:

```typescript
if (promptStore) {
  promptStore.reload();
  runtimePrompts = promptStore.getRuntimePrompts();
}
```

- [ ] **Step 3: Use runtime prompts in system prompt injection**

In the `before_agent_start` handler, replace hardcoded `DCP_SYSTEM_PROMPT`:

```typescript
const systemPromptText = runtimePrompts?.system ?? DCP_SYSTEM_PROMPT;
return {
  systemPrompt: (event.systemPrompt ?? "") + systemPromptText,
};
```

- [ ] **Step 4: Pass runtime prompts to nudge injection**

This requires passing the prompt text to `injectCompressNudges` or using the store globally. Simplest approach: if `runtimePrompts` is set, import the nudge constants from the store instead of hardcoded.

Add an optional `prompts` parameter to `injectCompressNudges` or use a module-level getter. For minimal change, pass the store's prompts through the pipeline config:

In `src/messages/inject.ts`, update the nudge text selection to accept override text:

```typescript
// At the top of the nudge decision section:
const nudgeTexts = {
  contextLimit: runtimePrompts?.contextLimitNudge ?? CONTEXT_LIMIT_NUDGE,
  turn: runtimePrompts?.turnNudge ?? TURN_NUDGE,
  iteration: runtimePrompts?.iterationNudge ?? ITERATION_NUDGE,
};
```

This requires threading `runtimePrompts` through. The cleanest approach: add `runtimePrompts?: RuntimePrompts` to the `runPipeline` parameters or extend `DcpConfig` with a runtime prompts field. Choose the simplest approach that doesn't require large signature changes.

- [ ] **Step 5: Run full check**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npm run check`

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/index.ts src/messages/inject.ts
git commit -m "feat(prompts): wire PromptStore into extension lifecycle with hot-reload"
```

---

## Verification Checklist

- [ ] `npm run check` passes
- [ ] `experimental.customPrompts: false` (default) — zero filesystem access for prompts
- [ ] `experimental.customPrompts: true` — reads override files, writes defaults
- [ ] Project overrides take precedence over global
- [ ] Empty override files fall back to bundled defaults
- [ ] HTML comments stripped from override content
- [ ] Hot-reload picks up file changes on each context pass
- [ ] System prompt, nudge texts, and compress description all overridable
