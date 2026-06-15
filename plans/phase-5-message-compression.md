# Phase 5: Message Compression

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **IMPORTANT:** Read `plans/ERRATA.md` before implementing. It contains corrections to API signatures, type shapes, and import paths verified against Pi source.

**Prerequisite:** Phase 4 (Range Compression) completed and passing.

**Goal:** Add message-mode compression — an alternative to range compression where the model compresses individual messages based on a priority map. After this phase, pi-dcp supports both `range` and `message` compression modes, selectable via config.

**Usable result after this phase:** When `config.compress.mode` is `"message"`, the `compress` tool accepts per-message targets instead of ranges. The priority map (injected via `<dcp-message-id priority="N">` tags) guides the model toward high-priority compression targets. Both modes coexist; the config setting determines the tool schema and prompt.

**Architecture:**

- `src/messages/priority.ts` — Priority map computation (token-based ranking of messages)
- `src/messages/inject.ts` — Modified to inject priority attributes into message ID tags
- `src/compress/message.ts` — Message-mode compress tool handler
- `src/prompts/compress-message.ts` — Message-mode tool prompt
- `src/index.ts` — Switch tool registration based on config mode; build priority map in context pipeline

**Conventions:**

- Priority is an integer 1-5 (1 = highest priority for compression, 5 = lowest)
- The priority map is rebuilt on every context event
- Message-mode injects priority into `<dcp-message-id priority="N">` tags
- Tests import shared helpers from `tests/helpers.ts` (do not inline duplicates)

---

## File Structure (additions to Phase 4)

```
src/
  messages/
    priority.ts                 # Priority map computation
    inject.ts                   # Modified: accept optional PriorityMap
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

Create `tests/priority.test.ts`. Use shared helpers from `tests/helpers.ts` and `assignMessageRefs` to populate both `byIndex` and `byRef` maps correctly:

```typescript
import { describe, expect, it } from "vitest";
import { buildPriorityMap } from "../src/messages/priority.ts";
import { createSessionState } from "../src/state/state.ts";
import { assignMessageRefs } from "../src/messages/inject.ts";
import { makeUserMessage, makeAssistantMessage } from "./helpers.ts";

describe("buildPriorityMap", () => {
  it("assigns priorities to messages", () => {
    const state = createSessionState();
    const messages = [
      makeUserMessage("a".repeat(400)),
      makeAssistantMessage("b".repeat(800)),
      makeUserMessage("c".repeat(100)),
    ];
    assignMessageRefs(state, messages);

    const map = buildPriorityMap(state, messages);
    expect(map.size).toBe(3);

    // Earlier, larger messages should have higher priority (lower number)
    const p0 = map.get(0);
    const p2 = map.get(2);
    expect(p0).toBeDefined();
    expect(p2).toBeDefined();
    expect(p0!.priority).toBeLessThanOrEqual(p2!.priority);
  });

  it("returns empty map for empty messages", () => {
    const state = createSessionState();
    const map = buildPriorityMap(state, []);
    expect(map.size).toBe(0);
  });

  it("skips messages already covered by active compression blocks", () => {
    const state = createSessionState();
    const messages = [
      makeUserMessage("old message"),
      makeAssistantMessage("response"),
      makeUserMessage("new message"),
    ];
    assignMessageRefs(state, messages);

    // Mark message 0 as covered by an active block
    state.prune.messages.byMessageIndex.set(0, {
      tokenCount: 25,
      blockIds: [1],
      activeBlockIds: [1],
    });

    const map = buildPriorityMap(state, messages);
    expect(map.has(0)).toBe(false);
    expect(map.has(1)).toBe(true);
    expect(map.has(2)).toBe(true);
  });

  it("assigns priorities in range 1-5", () => {
    const state = createSessionState();
    const messages = [makeUserMessage("a"), makeAssistantMessage("b")];
    assignMessageRefs(state, messages);

    const map = buildPriorityMap(state, messages);
    for (const [, entry] of map) {
      expect(entry.priority).toBeGreaterThanOrEqual(1);
      expect(entry.priority).toBeLessThanOrEqual(5);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/priority.test.ts
```

Expected: FAIL (module not found).

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

### Task 2: Priority Injection in Message IDs

**Files:**

- Modify: `src/messages/inject.ts`
- Test: `tests/inject.test.ts` (add new tests)

Extend `injectMessageIds` to accept an optional `PriorityMap`. When provided, the injected `<dcp-message-id>` tags include a `priority` attribute. `formatMessageIdTag` in `src/utils/message-ids.ts` already supports the `{ priority?: number }` attrs parameter.

**Idempotency fix:** The existing check `text.includes("<dcp-message-id>")` fails when a priority attribute is present (tag becomes `<dcp-message-id priority="3">` which does not contain the exact substring `<dcp-message-id>`). Change to `text.includes("<dcp-message-id")` (without closing `>`) to match both variants.

- [ ] **Step 1: Add tests for priority injection**

Append to `tests/inject.test.ts`, inside the `describe("injectMessageIds")` block. Add the import for `PriorityMap` at the top of the file:

```typescript
// Add to imports at top of file:
import { buildPriorityMap } from "../src/messages/priority.ts";

// Add inside describe("injectMessageIds"):

it("injects priority attribute when priorityMap is provided", () => {
  const state = createSessionState();
  const messages = [
    makeUserMessage("a".repeat(400)),
    makeAssistantMessage("b".repeat(100)),
  ];
  assignMessageRefs(state, messages);

  const priorityMap = buildPriorityMap(state, messages);
  const result = injectMessageIds(state, messages, priorityMap);

  const userText = (result[0] as any).content[0].text as string;
  expect(userText).toMatch(
    /<dcp-message-id priority="\d">m0001<\/dcp-message-id>/,
  );

  const assistantText = (result[1] as any).content[0].text as string;
  expect(assistantText).toMatch(
    /<dcp-message-id priority="\d">m0002<\/dcp-message-id>/,
  );
});

it("omits priority attribute when priorityMap is undefined", () => {
  const state = createSessionState();
  const messages = [makeUserMessage("hello")];
  assignMessageRefs(state, messages);

  const result = injectMessageIds(state, messages);

  const text = (result[0] as any).content[0].text as string;
  expect(text).toContain("<dcp-message-id>m0001</dcp-message-id>");
  expect(text).not.toContain("priority=");
});

it("is idempotent with priority attributes", () => {
  const state = createSessionState();
  const messages = [makeUserMessage("hello")];
  assignMessageRefs(state, messages);

  const priorityMap = buildPriorityMap(state, messages);
  const first = injectMessageIds(state, messages, priorityMap);
  const second = injectMessageIds(state, first, priorityMap);

  const text = (second[0] as any).content[0].text as string;
  const matches = text.match(/<dcp-message-id/g);
  expect(matches).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify the new tests fail**

```bash
pnpm test -- tests/inject.test.ts
```

Expected: New priority tests fail (third argument not yet accepted; idempotency check breaks with priority tags).

- [ ] **Step 3: Modify `injectMessageIds` in `src/messages/inject.ts`**

Changes to make:

1. Add import at top:

   ```typescript
   import type { PriorityMap } from "./priority.ts";
   ```

2. Update function signature to accept optional priority map:

   ```typescript
   export function injectMessageIds(
     state: SessionState,
     messages: AgentMessage[],
     priorityMap?: PriorityMap,
   ): AgentMessage[] {
   ```

3. Inside the `.map()` callback, after resolving `ref`, look up priority and generate the tag:

   ```typescript
   const priorityEntry = priorityMap?.get(i);
   const tag = formatMessageIdTag(
     ref,
     priorityEntry ? { priority: priorityEntry.priority } : undefined,
   );
   ```

4. Fix idempotency checks — change all `.includes("<dcp-message-id>")` to `.includes("<dcp-message-id")` (drop closing `>`) so the check matches both `<dcp-message-id>ref</...>` and `<dcp-message-id priority="N">ref</...>`.

The full updated function body (replacing the existing `injectMessageIds`):

```typescript
export function injectMessageIds(
  state: SessionState,
  messages: AgentMessage[],
  priorityMap?: PriorityMap,
): AgentMessage[] {
  return messages.map((msg, i) => {
    const ref = state.messageIds.byIndex.get(i);
    if (!ref) return msg;

    if (msg.role !== "user" && msg.role !== "assistant") return msg;

    const priorityEntry = priorityMap?.get(i);
    const tag = formatMessageIdTag(
      ref,
      priorityEntry ? { priority: priorityEntry.priority } : undefined,
    );

    // E9: UserMessage.content can be a plain string
    if (typeof msg.content === "string") {
      if (msg.content.includes("<dcp-message-id")) return msg;
      return {
        ...msg,
        content: [{ type: "text" as const, text: `${msg.content}\n\n${tag}` }],
      } as AgentMessage;
    }

    if (!Array.isArray(msg.content)) return msg;

    const textPartIndex = msg.content.findIndex(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        (p as unknown as Record<string, unknown>).type === "text",
    );
    if (textPartIndex === -1) return msg;

    const textPart = msg.content[textPartIndex] as {
      type: "text";
      text: string;
    };
    if (textPart.text.includes("<dcp-message-id")) return msg;

    const newContent = [...msg.content];
    newContent[textPartIndex] = {
      ...textPart,
      text: `${textPart.text}\n\n${tag}`,
    } as (typeof newContent)[number];

    return { ...msg, content: newContent } as AgentMessage;
  });
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
pnpm run typecheck
pnpm test -- tests/inject.test.ts
```

Expected: All existing + new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/messages/inject.ts tests/inject.test.ts
git commit -m "feat: support priority attributes in message ID injection"
```

---

### Task 3: Message-Mode Compress Prompt

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

### Task 4: Message-Mode Compress Handler

**Files:**

- Create: `src/compress/message.ts`
- Test: `tests/compress-message.test.ts`

Handles message-mode compress calls where the model targets specific messages by ID.

- [ ] **Step 1: Write tests**

Create `tests/compress-message.test.ts`. Use shared helpers from `tests/helpers.ts`. Important: `resolveBoundaryIndex` looks up refs in `state.messageIds.byRef`, so tests must populate both `byIndex` and `byRef` (use `assignMessageRefs` or set both maps manually):

```typescript
import { describe, expect, it } from "vitest";
import { handleMessageCompress } from "../src/compress/message.ts";
import { createSessionState } from "../src/state/state.ts";
import { assignMessageRefs } from "../src/messages/inject.ts";
import {
  makeUserMessage,
  makeAssistantMessage,
  makeDefaultConfig,
} from "./helpers.ts";

describe("handleMessageCompress", () => {
  it("compresses targeted messages", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });
    const messages = [
      makeUserMessage("hello"),
      makeAssistantMessage("long response..."),
      makeUserMessage("next"),
    ];
    assignMessageRefs(state, messages);

    const result = handleMessageCompress(state, config, messages, {
      topic: "Greeting",
      targets: [
        { messageId: "m0001", summary: "User greeted" },
        { messageId: "m0002", summary: "Assistant responded with greeting" },
      ],
    });

    expect(result).toContain("Compressed 2 messages");
    expect(state.prune.messages.blocksById.size).toBe(2);

    // Verify blocks have mode "message" and startIndex === endIndex
    for (const [, block] of state.prune.messages.blocksById) {
      expect(block.mode).toBe("message");
      expect(block.startIndex).toBe(block.endIndex);
    }
  });

  it("throws for unknown message ID", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });
    const messages = [makeUserMessage("hello")];
    assignMessageRefs(state, messages);

    expect(() =>
      handleMessageCompress(state, config, messages, {
        topic: "test",
        targets: [{ messageId: "m9999", summary: "text" }],
      }),
    ).toThrow("m9999 is not available");
  });

  it("throws for empty targets array", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });

    expect(() =>
      handleMessageCompress(state, config, [], {
        topic: "test",
        targets: [],
      }),
    ).toThrow("targets array is required");
  });

  it("marks compressed messages in prune state", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({ mode: "message" });
    const messages = [makeUserMessage("hello"), makeAssistantMessage("world")];
    assignMessageRefs(state, messages);

    handleMessageCompress(state, config, messages, {
      topic: "test",
      targets: [{ messageId: "m0001", summary: "User said hello" }],
    });

    const entry = state.prune.messages.byMessageIndex.get(0);
    expect(entry).toBeDefined();
    expect(entry!.activeBlockIds.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/compress-message.test.ts
```

Expected: FAIL (module not found).

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
  _config: DcpConfig,
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

### Task 5: Wire Message Mode into Extension

**Files:**

- Modify: `src/index.ts`

Switch tool schema and handler based on `config.compress.mode`. Build priority map in context pipeline for message mode and pass it to `injectMessageIds`.

**Note:** `pi.registerTool()` is called once at extension load time. The config is already loaded by that point (line 25), so conditional registration based on `config.compress.mode` works. If the user changes config between sessions, the tool schema won't hot-reload — this is acceptable (matches Pi extension lifecycle).

- [ ] **Step 1: Add imports to `src/index.ts`**

Add after existing imports:

```typescript
import {
  handleMessageCompress,
  type MessageCompressArgs,
} from "./compress/message.ts";
import { buildPriorityMap, type PriorityMap } from "./messages/priority.ts";
import { COMPRESS_MESSAGE_PROMPT } from "./prompts/compress-message.ts";
```

- [ ] **Step 2: Make tool registration conditional**

Replace the current unconditional `pi.registerTool({...})` block (the range-mode tool registration) with a conditional branch:

```typescript
if (config.compress.mode === "message") {
  pi.registerTool({
    name: "compress",
    label: "Compress",
    description: COMPRESS_MESSAGE_PROMPT,
    parameters: Type.Object({
      topic: Type.String({
        description: "Short label (3-5 words) for display",
      }),
      targets: Type.Array(
        Type.Object({
          messageId: Type.String({
            description: "Message ID to compress (e.g. m0001)",
          }),
          summary: Type.String({
            description: "Complete technical summary replacing message content",
          }),
        }),
        { description: "Messages to compress" },
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const typedArgs = params as unknown as MessageCompressArgs;
      const resultText = handleMessageCompress(
        state,
        config,
        latestMessages,
        typedArgs,
      );
      return {
        content: [{ type: "text" as const, text: resultText }],
        details: {},
      };
    },
  });
} else {
  pi.registerTool({
    name: "compress",
    label: "Compress",
    description:
      "Compress conversation ranges into summaries. Use message IDs (m0001, m0002...) visible in context as boundaries.",
    parameters: Type.Object({
      topic: Type.String({
        description: "Short label (3-5 words) for display",
      }),
      content: Type.Array(
        Type.Object({
          startId: Type.String({
            description:
              "Message or block ID marking range start (e.g. m0001, b2)",
          }),
          endId: Type.String({
            description:
              "Message or block ID marking range end (e.g. m0012, b5)",
          }),
          summary: Type.String({
            description:
              "Complete technical summary replacing all content in range",
          }),
        }),
        {
          description:
            "Ranges to compress, each with start/end boundaries and summary",
        },
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const typedArgs = params as unknown as RangeCompressArgs;
      const resultText = handleRangeCompress(
        state,
        config,
        latestMessages,
        typedArgs,
      );
      return {
        content: [{ type: "text" as const, text: resultText }],
        details: {},
      };
    },
  });
}
```

- [ ] **Step 3: Update context pipeline to build priority map**

In the `context` event handler, between `assignMessageRefs` (Step 4) and `injectMessageIds` (Step 5), add priority map construction and pass it through:

```typescript
// Step 4: Assign message refs to raw messages (before filtering, so refs are stable raw indices)
assignMessageRefs(state, messages);

// Step 4.5: Build priority map for message-mode compression
let priorityMap: PriorityMap | undefined;
if (config.compress.mode === "message") {
  priorityMap = buildPriorityMap(state, messages);
}

// Step 5: Inject message IDs into raw messages (with priority attrs if message mode)
messages = injectMessageIds(state, messages, priorityMap);
```

- [ ] **Step 4: Verify typecheck and full test suite**

```bash
pnpm run typecheck
pnpm test
```

Expected: All pass (existing range-mode tests unaffected; new message-mode tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire message-mode compression into extension"
```
