# Phase 5: Message Compression

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **IMPORTANT:** Read `plans/ERRATA.md` before implementing. It contains corrections to API signatures, type shapes, and import paths verified against Pi source.

**Prerequisite:** Phase 4 (Range Compression) completed and passing.

**Goal:** Add message-mode compression — an alternative to range compression where the model compresses individual messages based on a priority map. After this phase, pi-dcp supports both `range` and `message` compression modes, selectable via config.

**Usable result after this phase:** When `config.compress.mode` is `"message"`, the `compress` tool accepts per-message targets instead of ranges. The priority map (injected via `<dcp-message-id priority="N">` tags) guides the model toward high-priority compression targets. Both modes coexist; the config setting determines the tool schema and prompt.

**Architecture:**
- `src/messages/priority.ts` — Priority map computation (token-based ranking of messages)
- `src/compress/message.ts` — Message-mode compress tool handler
- `src/prompts/compress-message.ts` — Message-mode tool prompt
- Modified `src/index.ts` — Switch tool registration based on config mode

**Conventions:**
- Priority is an integer 1-5 (1 = highest priority for compression, 5 = lowest)
- The priority map is rebuilt on every context event
- Message-mode injects priority into `<dcp-message-id priority="N">` tags

---

## File Structure (additions to Phase 4)

```
src/
  messages/
    priority.ts                 # Priority map computation
  compress/
    message.ts                  # Message-mode compress handler
  prompts/
    compress-message.ts         # Message-mode tool prompt
```

---

### Task 1: Priority Map

**Files:**
- Create: `src/messages/priority.ts`
- Test: `tests/priority.test.ts`

Assigns compression priority (1-5) to each message based on age and estimated token count. Older, larger messages get higher priority (lower number = compress first).

- [ ] **Step 1: Write tests**

Create `tests/priority.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildPriorityMap } from "../src/messages/priority.ts";
import { createSessionState } from "../src/state/state.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

function makeUserMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

function makeAssistantMessage(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
    timestamp: Date.now(),
  } as AgentMessage;
}

describe("priority", () => {
  describe("buildPriorityMap", () => {
    it("assigns priorities to messages", () => {
      const state = createSessionState();
      state.messageIds.byIndex.set(0, "m0001");
      state.messageIds.byIndex.set(1, "m0002");
      state.messageIds.byIndex.set(2, "m0003");

      const messages = [
        makeUserMessage("a".repeat(400)),
        makeAssistantMessage("b".repeat(800)),
        makeUserMessage("c".repeat(100)),
      ];

      const map = buildPriorityMap(state, messages);
      expect(map.size).toBe(3);

      // Earlier, larger messages should have higher priority (lower number)
      const p0 = map.get(0);
      const p2 = map.get(2);
      expect(p0).toBeDefined();
      expect(p2).toBeDefined();
      // Older message should have equal or higher priority
      expect(p0!.priority).toBeLessThanOrEqual(p2!.priority);
    });

    it("returns empty map for empty messages", () => {
      const state = createSessionState();
      const map = buildPriorityMap(state, []);
      expect(map.size).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/priority.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement priority map**

Create `src/messages/priority.ts`:

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";
import { countMessageTokens } from "../utils/tokens.ts";

export interface MessagePriorityEntry {
  index: number;
  ref: string;
  priority: number;
  tokens: number;
}

export type PriorityMap = Map<number, MessagePriorityEntry>;

/**
 * Build a priority map for message-mode compression.
 * Priority 1 = highest (compress first), 5 = lowest (keep).
 *
 * Ranking factors:
 * - Position: earlier messages get higher priority
 * - Token count: larger messages get higher priority
 * - Role: tool results get slightly higher priority than user messages
 */
export function buildPriorityMap(
  state: SessionState,
  messages: AgentMessage[],
): PriorityMap {
  if (messages.length === 0) return new Map();

  const entries: Array<{ index: number; score: number; tokens: number }> = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const ref = state.messageIds.byIndex.get(i);
    if (!ref) continue;

    // Skip messages already covered by active blocks
    const pruneEntry = state.prune.messages.byMessageIndex.get(i);
    if (pruneEntry && pruneEntry.activeBlockIds.length > 0) continue;

    const tokens = countMessageTokens(msg);

    // Score: higher = compress first
    // Position weight: earlier messages score higher
    const positionScore = (messages.length - i) / messages.length;
    // Token weight: larger messages score higher
    const tokenScore = Math.min(tokens / 500, 1);
    // Role weight
    const roleWeight = msg.role === "toolResult" ? 0.2 : 0;

    const score = positionScore * 0.6 + tokenScore * 0.3 + roleWeight;
    entries.push({ index: i, score, tokens });
  }

  // Sort by score descending (highest score = highest priority)
  entries.sort((a, b) => b.score - a.score);

  // Assign priorities 1-5 based on quintiles
  const map: PriorityMap = new Map();
  const quintileSize = Math.max(1, Math.ceil(entries.length / 5));

  for (let rank = 0; rank < entries.length; rank++) {
    const entry = entries[rank];
    const priority = Math.min(5, Math.floor(rank / quintileSize) + 1);
    const ref = state.messageIds.byIndex.get(entry.index)!;

    map.set(entry.index, {
      index: entry.index,
      ref,
      priority,
      tokens: entry.tokens,
    });
  }

  return map;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm run typecheck
pnpm test -- tests/priority.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/messages/priority.ts tests/priority.test.ts
git commit -m "feat: add priority map for message-mode compression"
```

---

### Task 2: Message-Mode Compress Prompt

**Files:**
- Create: `src/prompts/compress-message.ts`
- Test: (no test — static string)

- [ ] **Step 1: Create message-mode compress prompt**

Create `src/prompts/compress-message.ts`:

```typescript
/**
 * Message-mode compress tool description.
 * Used when config.compress.mode === "message".
 */
export const COMPRESS_MESSAGE_PROMPT = `Compress specific messages identified by their priority tags.

Messages are tagged with <dcp-message-id priority="N"> where N is 1-5:
- Priority 1-2: Highest compression value (old, large, resolved content)
- Priority 3: Moderate compression value
- Priority 4-5: Low compression value (recent, small, active content)

TARGET SELECTION
Focus on priority 1-2 messages first. These are the best candidates for compression.
Only compress priority 3+ messages when context pressure is severe.

SUMMARY REQUIREMENTS
Each summary must be self-contained and capture all essential information from the target message.
Preserve exact error messages, file paths, function names, and user instructions.
`;
```

- [ ] **Step 2: Commit**

```bash
git add src/prompts/compress-message.ts
git commit -m "feat: add message-mode compress prompt"
```

---

### Task 3: Message-Mode Compress Handler

**Files:**
- Create: `src/compress/message.ts`
- Test: `tests/compress-message.test.ts`

Handles message-mode compress calls where the model targets specific messages by ID.

- [ ] **Step 1: Write tests**

Create `tests/compress-message.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { handleMessageCompress } from "../src/compress/message.ts";
import { createSessionState } from "../src/state/state.ts";
import type { DcpConfig } from "../src/config.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

function makeDefaultConfig(): DcpConfig {
  return {
    enabled: true,
    debug: false,
    compress: {
      mode: "message",
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

describe("handleMessageCompress", () => {
  it("compresses targeted messages", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();

    state.messageIds.byIndex.set(0, "m0001");
    state.messageIds.byIndex.set(1, "m0002");
    state.messageIds.byIndex.set(2, "m0003");
    state.messageIds.nextRefIndex = 4;

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 0 } as AgentMessage,
      { role: "assistant", content: [{ type: "text", text: "long response..." }], stopReason: "stop", usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 }, timestamp: 0 } as AgentMessage,
      { role: "user", content: [{ type: "text", text: "next" }], timestamp: 0 } as AgentMessage,
    ];

    const result = handleMessageCompress(state, config, messages, {
      topic: "Greeting",
      targets: [
        { messageId: "m0001", summary: "User greeted" },
        { messageId: "m0002", summary: "Assistant responded with greeting" },
      ],
    });

    expect(result).toContain("Compressed");
    expect(state.prune.messages.blocksById.size).toBeGreaterThan(0);
  });

  it("throws for unknown message ID", () => {
    const state = createSessionState();
    const config = makeDefaultConfig();
    const messages: AgentMessage[] = [];

    expect(() => handleMessageCompress(state, config, messages, {
      topic: "test",
      targets: [{ messageId: "m9999", summary: "text" }],
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/compress-message.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement message-mode handler**

Create `src/compress/message.ts`:

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { resolveBoundaryIndex } from "./search.ts";
import {
  allocateBlockId,
  allocateRunId,
  applyCompressionState,
  wrapCompressedSummary,
  COMPRESSED_BLOCK_HEADER,
} from "./state.ts";
import { countTokens } from "../utils/tokens.ts";

export interface MessageCompressArgs {
  topic: string;
  targets: Array<{
    messageId: string;
    summary: string;
  }>;
}

/**
 * Handle a message-mode compress tool call.
 * Each target compresses a single message by its ref ID.
 */
export function handleMessageCompress(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  args: MessageCompressArgs,
): string {
  if (!args.targets || args.targets.length === 0) {
    throw new Error("targets array is required and must not be empty");
  }

  const runId = allocateRunId(state);
  let totalCompressed = 0;

  for (const target of args.targets) {
    if (!target.messageId || !target.summary) {
      throw new Error("Each target requires messageId and summary");
    }

    const index = resolveBoundaryIndex(state, target.messageId);
    if (index === undefined) {
      throw new Error(
        `messageId ${target.messageId} is not available in the current conversation context.`,
      );
    }

    const blockId = allocateBlockId(state);
    const wrappedSummary = wrapCompressedSummary(blockId, target.summary);
    const summaryTokens = countTokens(wrappedSummary);
    const compressMessageIndex = messages.length - 1;

    applyCompressionState(state, {
      blockId,
      runId,
      topic: args.topic,
      batchTopic: args.topic,
      mode: "message",
      startIndex: index,
      endIndex: index,
      anchorIndex: index,
      compressMessageIndex,
      summary: wrappedSummary,
      summaryTokens,
      consumedBlockIds: [],
    });

    totalCompressed++;
  }

  return `Compressed ${totalCompressed} messages into ${COMPRESSED_BLOCK_HEADER}.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm run typecheck
pnpm test -- tests/compress-message.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/compress/message.ts tests/compress-message.test.ts
git commit -m "feat: add message-mode compression handler"
```

---

### Task 4: Wire Message Mode into Extension

**Files:**
- Modify: `src/index.ts`

Switch tool schema and handler based on `config.compress.mode`. Add priority map to context pipeline for message mode.

- [ ] **Step 1: Update index.ts**

Add imports:

```typescript
import { handleMessageCompress, type MessageCompressArgs } from "./compress/message.ts";
import { buildPriorityMap } from "./messages/priority.ts";
import { COMPRESS_MESSAGE_PROMPT } from "./prompts/compress-message.ts";
```

Update tool registration to handle both modes:

```typescript
if (config.compress.mode === "message") {
  pi.registerTool({
    name: "compress",
    label: "Compress",
    description: COMPRESS_MESSAGE_PROMPT,
    parameters: Type.Object({
      topic: Type.String({ description: "Short label (3-5 words)" }),
      targets: Type.Array(
        Type.Object({
          messageId: Type.String({ description: "Message ID to compress (e.g. m0001)" }),
          summary: Type.String({ description: "Summary replacing message content" }),
        }),
        { description: "Messages to compress" }
      ),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const typedArgs = params as unknown as MessageCompressArgs;
      const resultText = handleMessageCompress(state, config, latestMessages, typedArgs);
      return {
        content: [{ type: "text" as const, text: resultText }],
        details: {},
      };
    },
  });
} else {
  // Range mode tool registration (from Phase 4)
  // ...
}
```

Update context pipeline to build priority map and inject priorities into message IDs:

```typescript
// After assignMessageRefs, before injectMessageIds:
let priorityMap: PriorityMap | undefined;
if (config.compress.mode === "message") {
  priorityMap = buildPriorityMap(state, messages);
}
// Pass priorityMap to injectMessageIds for priority attribute injection
```

- [ ] **Step 2: Verify typecheck and tests**

```bash
pnpm run typecheck
pnpm test
```

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire message-mode compression into extension"
```
