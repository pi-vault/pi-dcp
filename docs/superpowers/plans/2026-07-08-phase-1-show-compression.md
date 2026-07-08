# Phase 1: Compression Notifications + showCompression

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-facing notifications for compression events and a `showCompression` config to control whether summary text is included in those notifications.

**Background:** pi-dcp currently only notifies users about strategy pruning (deduplication, error purge). When the model calls the `compress` tool, users see no notification. The opencode reference uses `showCompression` to control whether the actual compression summary text appears in the user notification — it does NOT affect what the model sees. The model always receives summaries at anchor points regardless of this setting.

**Architecture:**

1. Return structured result data from `handleCompress` instead of a plain string.
2. Build a compression notification formatter in `src/ui/notification.ts`.
3. Send notifications from the compress tool's `execute` callback using `ctx.ui`.
4. Add `showCompression: boolean` config (default: `false`) that controls whether the summary text appears in the notification.
5. Fix `messagesCompressed` stat counter (defined but never incremented).

**Tech Stack:** TypeScript, Vitest

**Reference:** `opencode-dynamic-context-pruning/lib/ui/notification.ts` — `sendCompressNotification` (lines 172-306)

---

### Task 1: Return structured result from handleCompress

**Files:**

- Modify: `src/compress/handler.ts`

- [ ] **Step 1: Define CompressResult interface**

Add above the `handleCompress` function:

```ts
export interface CompressResult {
  /** Text returned to the model as tool output. */
  text: string;
  /** Total messages compressed in this call. */
  messagesCompressed: number;
  /** Tokens removed by compression. */
  compressedTokens: number;
  /** Tokens in the replacement summaries. */
  summaryTokens: number;
  /** Block IDs created by this call. */
  blockIds: number[];
  /** Topic label provided by the model. */
  topic: string;
}
```

- [ ] **Step 2: Update handleCompress return type**

Change `handleCompress` to return `CompressResult` instead of `string`. Collect `blockIds` during the loop and return the struct:

```ts
export function handleCompress(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  args: CompressArgs,
): CompressResult {
  const entries = normalizeEntries(state, messages, args);
  const runId = allocateRunId(state);
  let totalCompressed = 0;
  let totalCompressedTokens = 0;
  let totalSummaryTokens = 0;
  const blockIds: number[] = [];

  for (const entry of entries) {
    const blockId = allocateBlockId(state);
    blockIds.push(blockId);
    // ... existing enrichment, wrapping, applyCompressionState logic ...

    totalCompressed += entry.messageCount;
    const block = state.prune.messages.blocksById.get(blockId);
    if (block) {
      totalCompressedTokens += block.compressedTokens;
      totalSummaryTokens += block.summaryTokens;
    }
  }

  // Update stats (fix: messagesCompressed was never incremented)
  state.stats.messagesCompressed += totalCompressed;

  const savings =
    totalCompressedTokens > 0
      ? ` (~${totalCompressedTokens} tokens replaced by ~${totalSummaryTokens} token summary)`
      : "";

  return {
    text: `Compressed ${totalCompressed} messages into ${COMPRESSED_BLOCK_HEADER}${savings}.`,
    messagesCompressed: totalCompressed,
    compressedTokens: totalCompressedTokens,
    summaryTokens: totalSummaryTokens,
    blockIds,
    topic: args.topic,
  };
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: FAIL — callers of `handleCompress` expect a string return. This is fixed in Task 3.

- [ ] **Step 4: Commit (defer until Task 3 makes it compile)**

---

### Task 2: Build compression notification formatter

**Files:**

- Modify: `src/ui/notification.ts`

- [ ] **Step 1: Write failing test**

Create `tests/compress-notification.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildCompressNotificationMinimal,
  buildCompressNotificationDetailed,
} from "../src/ui/notification.ts";

describe("compression notification", () => {
  it("minimal: shows tokens and message count", () => {
    const msg = buildCompressNotificationMinimal({
      compressedTokens: 12400,
      summaryTokens: 2100,
      messagesCompressed: 5,
      topic: "Auth System",
    });
    expect(msg).toContain("~12.4K");
    expect(msg).toContain("~2.1K");
    expect(msg).toContain("5 messages");
  });

  it("minimal: singular message", () => {
    const msg = buildCompressNotificationMinimal({
      compressedTokens: 500,
      summaryTokens: 100,
      messagesCompressed: 1,
      topic: "Setup",
    });
    expect(msg).toContain("1 message");
    expect(msg).not.toContain("1 messages");
  });

  it("detailed: includes topic", () => {
    const msg = buildCompressNotificationDetailed({
      compressedTokens: 12400,
      summaryTokens: 2100,
      messagesCompressed: 5,
      topic: "Auth System",
    });
    expect(msg).toContain("Auth System");
    expect(msg).toContain("~12.4K");
  });

  it("detailed: includes summary when showCompression is true", () => {
    const msg = buildCompressNotificationDetailed({
      compressedTokens: 12400,
      summaryTokens: 2100,
      messagesCompressed: 5,
      topic: "Auth System",
      summary: "User explored authentication flows and decided on JWT.",
      showCompression: true,
    });
    expect(msg).toContain("Auth System");
    expect(msg).toContain("JWT");
  });

  it("detailed: omits summary when showCompression is false", () => {
    const msg = buildCompressNotificationDetailed({
      compressedTokens: 12400,
      summaryTokens: 2100,
      messagesCompressed: 5,
      topic: "Auth System",
      summary: "User explored authentication flows and decided on JWT.",
      showCompression: false,
    });
    expect(msg).toContain("Auth System");
    expect(msg).not.toContain("JWT");
  });

  it("detailed: omits summary when showCompression not provided", () => {
    const msg = buildCompressNotificationDetailed({
      compressedTokens: 12400,
      summaryTokens: 2100,
      messagesCompressed: 5,
      topic: "Auth System",
      summary: "User explored authentication flows.",
    });
    expect(msg).not.toContain("authentication flows");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/compress-notification.test.ts`
Expected: FAIL — functions don't exist yet.

- [ ] **Step 3: Add CompressNotificationParams interface**

In `src/ui/notification.ts`, add:

```ts
export interface CompressNotificationParams {
  compressedTokens: number;
  summaryTokens: number;
  messagesCompressed: number;
  topic: string;
  summary?: string;
  showCompression?: boolean;
}
```

- [ ] **Step 4: Add buildCompressNotificationMinimal**

```ts
/**
 * Build minimal compression notification.
 * Format: "DCP: ~12.4K tokens compressed (~2.1K summary, 5 messages)"
 */
export function buildCompressNotificationMinimal(
  params: CompressNotificationParams,
): string {
  const plural = params.messagesCompressed === 1 ? "message" : "messages";
  return `DCP: ${formatTokens(params.compressedTokens)} tokens compressed (${formatTokens(params.summaryTokens)} summary, ${params.messagesCompressed} ${plural})`;
}
```

- [ ] **Step 5: Add buildCompressNotificationDetailed**

```ts
/**
 * Build detailed compression notification with topic and optional summary.
 * Summary text is only included when showCompression is true.
 */
export function buildCompressNotificationDetailed(
  params: CompressNotificationParams,
): string {
  let msg = buildCompressNotificationMinimal(params);
  msg += `\nTopic: ${params.topic}`;
  if (params.showCompression && params.summary) {
    msg += `\nSummary (${formatTokens(params.summaryTokens)}): ${params.summary}`;
  }
  return msg;
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run tests/compress-notification.test.ts`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/ui/notification.ts tests/compress-notification.test.ts
git commit -m "feat(ui): add compression notification formatters"
```

---

### Task 3: Wire notifications from compress tool execute

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Update tool execute callbacks to use CompressResult**

Both tool registrations (range and message mode) call `handleCompress` and use the return value. Update them to use the `CompressResult` struct and send notifications.

For the range-mode tool (around line 107):

```ts
async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
  const result = handleCompress(state, config, latestMessages, {
    ...(params as Record<string, unknown>),
    mode: "range",
  } as CompressArgs);

  // Send compression notification
  if (ctx.hasUI && config.nudgeNotification !== "off") {
    const notifParams = {
      compressedTokens: result.compressedTokens,
      summaryTokens: result.summaryTokens,
      messagesCompressed: result.messagesCompressed,
      topic: result.topic,
      summary: buildCombinedSummary(state, result.blockIds),
      showCompression: config.compress.showCompression,
    };
    const message =
      config.nudgeNotification === "detailed"
        ? buildCompressNotificationDetailed(notifParams)
        : buildCompressNotificationMinimal(notifParams);
    if (config.nudgeNotificationType === "toast") {
      ctx.ui.notify(message, "info");
    } else {
      ctx.ui.setStatus("dcp", message);
    }
  }

  return {
    content: [{ type: "text" as const, text: result.text }],
    details: {},
  };
},
```

Apply the same pattern to the message-mode tool (around line 73).

- [ ] **Step 2: Add buildCombinedSummary helper**

Add near the top of `src/index.ts` (or in a shared utility) a helper to extract raw summary text from blocks, stripping the block delimiters:

```ts
function buildCombinedSummary(state: SessionState, blockIds: number[]): string {
  return blockIds
    .map((id) => {
      const block = state.prune.messages.blocksById.get(id);
      if (!block?.summary) return "";
      // Strip [Compressed Block bN] and [End Block bN] delimiters
      return block.summary
        .replace(/^\[Compressed Block b\d+\]\n/, "")
        .replace(/\n\[End Block b\d+\]$/, "");
    })
    .filter(Boolean)
    .join("\n\n");
}
```

- [ ] **Step 3: Update imports**

Add `CompressResult` to the `handleCompress` import and add the new notification imports:

```ts
import {
  handleCompress,
  type CompressArgs,
  type CompressResult,
} from "./compress/handler.ts";
import {
  buildMinimalMessage,
  buildDetailedMessage,
  buildCompressNotificationMinimal,
  buildCompressNotificationDetailed,
} from "./ui/notification.ts";
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — all callers now use `CompressResult` correctly.

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: All tests pass including new compress notification tests.

- [ ] **Step 6: Commit**

```bash
git add src/compress/handler.ts src/index.ts
git commit -m "feat: wire compression notifications from tool execute"
```

---

### Task 4: Add showCompression config

**Files:**

- Modify: `src/config.ts`
- Modify: `tests/helpers.ts`

- [ ] **Step 1: Add showCompression to CompressConfig interface**

In `src/config.ts`, add `showCompression` to the `CompressConfig` interface after `protectTags: boolean;`:

```ts
/** When true, include the compression summary text in user notifications. Does not affect model context. */
showCompression: boolean;
```

- [ ] **Step 2: Add default value**

In `DEFAULT_CONFIG.compress`, add `showCompression: false` after `protectTags: false`:

```ts
  protectTags: false,
  showCompression: false,
  summaryBuffer: true,
```

- [ ] **Step 3: Add to KNOWN_COMPRESS_KEYS**

Add `"showCompression"` to the `KNOWN_COMPRESS_KEYS` set:

```ts
const KNOWN_COMPRESS_KEYS = new Set([
  "mode",
  "permission",
  "maxContextPercent",
  "minContextPercent",
  "nudgeFrequency",
  "iterationNudgeThreshold",
  "nudgeForce",
  "protectedTools",
  "protectUserMessages",
  "protectTags",
  "showCompression",
  "summaryBuffer",
  "maxContextLimit",
  "minContextLimit",
  "modelMaxLimits",
  "modelMinLimits",
]);
```

- [ ] **Step 4: Add merge logic**

In the `mergeConfig` function, inside the compress block, add after the `protectTags` check:

```ts
if (typeof c.showCompression === "boolean")
  target.compress.showCompression = c.showCompression;
```

- [ ] **Step 5: Update test helpers**

In `tests/helpers.ts`, add `showCompression: false` to the `makeDefaultConfig` compress object after `protectTags: false`:

```ts
  protectTags: false,
  showCompression: false,
  summaryBuffer: true,
```

- [ ] **Step 6: Run full check**

Run: `pnpm check`
Expected: All tests pass. The config field is now threaded through the notification system (wired in Task 3).

- [ ] **Step 7: Commit**

```bash
git add src/config.ts tests/helpers.ts
git commit -m "feat(config): add showCompression toggle for notification summary text"
```

---

### Task 5: Integration test

**Files:**

- Create: `tests/show-compression.test.ts`

- [ ] **Step 1: Write integration tests**

Create `tests/show-compression.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { handleCompress } from "../src/compress/handler.ts";
import { createSessionState } from "../src/state/state.ts";
import {
  buildCompressNotificationMinimal,
  buildCompressNotificationDetailed,
} from "../src/ui/notification.ts";
import {
  makeUserMessage,
  makeAssistantMessage,
  makeDefaultConfig,
  resetTestTimestamp,
} from "./helpers.ts";

describe("showCompression integration", () => {
  beforeEach(() => {
    resetTestTimestamp();
  });

  function compressAndNotify(showCompression: boolean) {
    const state = createSessionState();
    const config = makeDefaultConfig({ showCompression });
    const messages = [
      makeUserMessage("hello"),
      makeAssistantMessage("world"),
      makeUserMessage("more"),
    ];

    // Populate tool cache message indices for token counting
    state.prune.messages.byMessageIndex.set(0, {
      tokenCount: 50,
      blockIds: [],
      activeBlockIds: [],
    });
    state.prune.messages.byMessageIndex.set(1, {
      tokenCount: 50,
      blockIds: [],
      activeBlockIds: [],
    });

    const result = handleCompress(state, config, messages, {
      topic: "Setup",
      mode: "range",
      content: [
        {
          startId: "m0001",
          endId: "m0002",
          summary: "Initial setup discussion",
        },
      ],
    });

    // Build summary from blocks
    const summary = result.blockIds
      .map((id) => {
        const block = state.prune.messages.blocksById.get(id);
        return (
          block?.summary
            ?.replace(/^\[Compressed Block b\d+\]\n/, "")
            .replace(/\n\[End Block b\d+\]$/, "") ?? ""
        );
      })
      .filter(Boolean)
      .join("\n\n");

    const notifParams = {
      compressedTokens: result.compressedTokens,
      summaryTokens: result.summaryTokens,
      messagesCompressed: result.messagesCompressed,
      topic: result.topic,
      summary,
      showCompression,
    };

    return {
      result,
      state,
      minimal: buildCompressNotificationMinimal(notifParams),
      detailed: buildCompressNotificationDetailed(notifParams),
    };
  }

  it("returns structured CompressResult", () => {
    const { result } = compressAndNotify(false);
    expect(result.messagesCompressed).toBe(2);
    expect(result.blockIds).toHaveLength(1);
    expect(result.topic).toBe("Setup");
    expect(result.text).toContain("Compressed 2 messages");
  });

  it("increments messagesCompressed stat", () => {
    const { state } = compressAndNotify(false);
    expect(state.stats.messagesCompressed).toBe(2);
  });

  it("minimal notification excludes summary regardless", () => {
    const { minimal } = compressAndNotify(true);
    expect(minimal).toContain("DCP:");
    expect(minimal).not.toContain("Initial setup");
  });

  it("detailed notification includes summary when showCompression=true", () => {
    const { detailed } = compressAndNotify(true);
    expect(detailed).toContain("Setup");
    expect(detailed).toContain("Initial setup");
  });

  it("detailed notification excludes summary when showCompression=false", () => {
    const { detailed } = compressAndNotify(false);
    expect(detailed).toContain("Setup");
    expect(detailed).not.toContain("Initial setup");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm check`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/show-compression.test.ts
git commit -m "test: add showCompression integration tests"
```
