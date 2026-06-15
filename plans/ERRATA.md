# Plan Errata — Corrections from Pi Source Verification

> **Read this before implementing any phase.** These corrections override the corresponding code in the phase plans. All issues were identified by verifying plans against the actual Pi source at `pi/packages/coding-agent/src/core/extensions/types.ts` and `pi/packages/ai/src/types.ts`.

---

## E1: `pi.registerTool()` takes a single object (not name + options)

**Affects:** Phase 4 Task 6, Phase 5 Task 4, Phase 7 Task 5

**Wrong (in plans):**

```typescript
pi.registerTool("compress", {
  description: "...",
  parameters: Type.Object({...}),
  execute: async (args) => {
    return "Compressed N messages";
  },
});
```

**Correct:**

```typescript
pi.registerTool({
  name: "compress",
  label: "Compress",
  description: "...",
  parameters: Type.Object({...}),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const typedArgs = params as unknown as RangeCompressArgs;
    const resultText = handleRangeCompress(state, config, latestMessages, typedArgs);
    return {
      content: [{ type: "text" as const, text: resultText }],
      details: {},
    };
  },
});
```

**Key differences:**

- `name` and `label` are required fields inside the object
- `execute` signature: `(toolCallId: string, params, signal, onUpdate, ctx) => Promise<AgentToolResult>`
- Return type is `{ content: TextContent[], details: T }`, not a plain string

---

## E2: TypeBox import path

**Affects:** Phase 1 (conventions text), Phase 4 Task 6, Phase 5 Task 4

**Wrong:** `import { Type } from "@earendil-works/pi-ai"`
**Correct:** `import { Type } from "typebox"`

Pi migrated from `@sinclair/typebox` to `typebox` 1.x. The `@earendil-works/pi-ai` package re-exports it, but the canonical import is `"typebox"`.

Add `"typebox"` to `peerDependencies` and `devDependencies` in `package.json`.

---

## E3: `stopReason` values in test helpers

**Affects:** All test files creating `AssistantMessage` fixtures (Phase 2-7)

**Wrong:** `stopReason: "end"` or `stopReason: "tool"`
**Correct:** `stopReason: "stop"` or `stopReason: "toolUse"`

Full enum: `"stop" | "length" | "toolUse" | "error" | "aborted"`

---

## E4: `AssistantMessage` fields

**Affects:** All test files creating assistant message fixtures

**Wrong (in test helpers):**

```typescript
{
  role: "assistant",
  content: [...],
  stopReason: "end",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  timestamp: Date.now(),
}
```

**Correct:**

```typescript
{
  role: "assistant",
  content: [...],
  api: "messages",
  provider: "test",
  model: "test-model",
  stopReason: "stop",
  usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, totalTokens: 0 },
  timestamp: Date.now(),
}
```

`AssistantMessage` requires `api`, `provider`, `model` fields. The `Usage` type uses `inputTokens`/`outputTokens` (not `input`/`output`). Since test helpers cast `as AgentMessage`, this won't cause type errors at compile time, but the field names should match reality for correctness.

**Pragmatic shortcut:** Since all strategies and pruning functions only check `msg.role`, `msg.toolCallId`, `msg.content`, and `msg.isError`, the extra fields don't affect test correctness. Just fix `stopReason` values.

---

## E5: `ContextUsage` fields can be null

**Affects:** Phase 3 (nudge injection), Phase 6 (context command)

```typescript
interface ContextUsage {
  tokens: number | null; // null if unknown
  contextWindow: number;
  percent: number | null; // null if unknown
}
```

Guard with `usage.percent != null` before comparing to thresholds.

---

## E6: Entry point strategy

**Affects:** Phase 1 (package.json)

The reference extension (thinkscape-pi-status) uses `"./src/index.ts"` directly — Pi loads TypeScript via Bun. The plans use `"dist/index.js"` requiring compilation.

**Both work.** The compiled approach is fine for distribution. For development convenience, consider adding an alternative entry point:

```json
"pi": {
  "extensions": ["./src/index.ts"]
}
```

This eliminates the build step during development. Switch to `dist/index.js` for publishing.

---

## E7: `pi.registerCommand()` handler context

**Affects:** Phase 6 Task 7

The handler receives `(args: string, ctx: ExtensionCommandContext)`. `ExtensionCommandContext` extends `ExtensionContext` with extra methods like `waitForIdle()`, `newSession()`, etc. The plans' usage pattern is correct.

Note: `ctx.ui.notify` levels are `"info" | "warning" | "error"` (no `"success"`).

---

## E8: `before_agent_start` return shape

**Affects:** Phase 3 Task 4

The plans' pattern is **correct**:

```typescript
pi.on("before_agent_start", async (event, _ctx) => {
  return { systemPrompt: (event.systemPrompt ?? "") + DCP_SYSTEM_PROMPT };
});
```

The event provides `event.systemPrompt` (current system prompt) and `event.prompt` (user's input text). Return `{ systemPrompt?: string }` to replace it. Multiple extensions chain.

---

## E9: `UserMessage.content` can be a plain string

**Affects:** Test helpers, message processing code

```typescript
interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}
```

Any code accessing `msg.content` on user messages must handle both forms. Normalize early:

```typescript
const parts =
  typeof msg.content === "string"
    ? [{ type: "text" as const, text: msg.content }]
    : msg.content;
```

---

## E10: `AgentMessage` includes additional roles

**Affects:** All message processing code

```typescript
type AgentMessage =
  | UserMessage // role: "user"
  | AssistantMessage // role: "assistant"
  | ToolResultMessage // role: "toolResult"
  | CustomMessage // role: "custom"
  | BashExecutionMessage // role: "bashExecution" (if present)
  | CompactionSummaryMessage
  | BranchSummaryMessage;
```

Message processing loops should use `if (msg.role === "toolResult")` guards rather than exhaustive switches, to gracefully skip unknown roles.
