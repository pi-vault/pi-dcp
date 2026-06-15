# pi-dcp Design Spec

> Dynamic Context Pruning extension for Pi

## Purpose

Port OpenCode's Dynamic Context Pruning logic to Pi as a standalone extension that incrementally prunes obsolete tool outputs, deduplicates tool calls, and compresses conversation ranges. Works alongside Pi's existing compaction system as a finer-grained context management layer.

## Mechanisms

1. **Strategy-based pruning** (automatic) — deduplicates repeated tool calls with identical signatures, purges stale error outputs older than N turns
2. **Model-driven compression** — registers a `compress` tool that the model uses to summarize conversation ranges or individual messages
3. **Proactive nudging** — injects a DCP system prompt and context-limit reminders that guide the model to compress before hitting limits

## Package Conventions

Aligned with the pi-vault extension family (pi-status, pi-usage, pi-subagents):

| Concern           | Value                                                    |
| ----------------- | -------------------------------------------------------- |
| Package manager   | pnpm + `pnpm-workspace.yaml`                             |
| Import extensions | `.ts` with `allowImportingTsExtensions: true`            |
| Linter/formatter  | biome (`@biomejs/biome`)                                 |
| Test directory    | `tests/`                                                 |
| tsconfig module   | `node16` / `Node16`                                      |
| TypeScript        | Erasable syntax only (no enums, no parameter properties) |
| Entry point       | `"pi": { "extensions": ["./src/index.ts"] }`             |
| Scripts           | format, lint, typecheck, test, check, pack:dry-run       |
| Engine            | `node >= 22.19`                                          |

## Dependencies

| Type | Package                                    | Purpose                              |
| ---- | ------------------------------------------ | ------------------------------------ |
| peer | `@earendil-works/pi-coding-agent: *`       | ExtensionAPI, getAgentDir, events    |
| peer | `@earendil-works/pi-agent-core: *`         | AgentMessage type union              |
| dep  | `typebox`                                  | Tool parameter schemas (TypeBox 1.x) |
| dev  | `@earendil-works/pi-coding-agent: ^0.79.3` | Type checking                        |
| dev  | `@earendil-works/pi-agent-core: ^0.79.3`   | Type checking                        |
| dev  | `@biomejs/biome: ^2.4.16`                  | Linting and formatting               |
| dev  | `typescript: ^6.0.3`                       | Type checking                        |
| dev  | `vitest: ^4.1.7`                           | Testing                              |
| dev  | `@types/node: ^25.9.1`                     | Node.js types                        |

## Configuration

- **Location**: `~/.pi/agent/extensions/dcp.json` (resolved via `getAgentDir()` from `@earendil-works/pi-coding-agent`)
- **Format**: Plain JSON (`JSON.parse`)
- **Pattern**: Same as pi-subagents — single global file, defaults on parse error or missing file
- **No project-level overrides**
- **No `jsonc-parser` dependency**

### Config Schema

```typescript
interface DcpConfig {
  enabled: boolean; // default: true
  debug: boolean; // default: false — enables file logging
  compress: {
    mode: "range" | "message"; // default: "range"
    permission: "allow" | "deny"; // default: "allow"
    maxContextPercent: number; // default: 80 — nudge above this
    minContextPercent: number; // default: 50 — target after compress
    nudgeFrequency: number; // default: 5 — turns between nudges
    iterationNudgeThreshold: number; // default: 15 — iterations before force nudge
    nudgeForce: "strong" | "soft"; // default: "soft"
    protectedTools: string[]; // default: ["compress"]
    protectUserMessages: boolean; // default: false
    protectTags: boolean; // default: false
  };
  manualMode: {
    default: false | "active"; // default: false (auto mode)
    automaticStrategies: boolean; // default: true
  };
  strategies: {
    deduplication: {
      enabled: boolean; // default: true
      protectedTools: string[]; // default: []
    };
    purgeErrors: {
      enabled: boolean; // default: true
      turns: number; // default: 4
      protectedTools: string[]; // default: []
    };
  };
  protectedFilePatterns: string[]; // default: []
  nudgeNotification: "off" | "minimal" | "detailed"; // default: "minimal"
}
```

Tools always protected from pruning (hardcoded, not configurable):
`compress`, `bash`, `read`, `write`, `edit`, `grep`, `find`, `ls`

## Architecture

### Extension Lifecycle Hooks

| Event                | Purpose                                                 |
| -------------------- | ------------------------------------------------------- |
| `session_start`      | Reset state, reload config, cache model context window  |
| `session_compact`    | Clear pruning state (Pi's compaction rewrites messages) |
| `session_shutdown`   | Persist state, log session end                          |
| `before_agent_start` | Inject DCP system prompt into model context             |
| `context`            | Run the pruning/compression pipeline                    |

### Context Pipeline

The `context` handler runs this pipeline on every LLM call. The input is Pi's `structuredClone`'d `AgentMessage[]` — mutations are safe.

```
1. stripHallucinations      — remove hallucinated DCP tags from assistant messages
2. syncToolCache            — populate tool parameter cache from messages
3. buildToolIdList          — collect ordered tool call IDs
4. assignMessageRefs        — assign sequential refs (m0001, m0002, ...)
5. syncCompressionBlocks    — reconcile block state with current messages
6. runStrategies            — dedup + purge-errors → mark tools for pruning
7. applyPruning             — replace marked tool outputs with placeholders
8. injectCompressNudges     — inject nudge tags when context exceeds thresholds
9. injectMessageIds         — inject <dcp-message-id> tags into message content
10. filterCompressedRanges  — replace compressed ranges with summary messages
11. return { messages }
```

### Registered Tool: `compress`

TypeBox-schemaed tool registered via `pi.registerTool()`. Schema varies by mode:

**Range mode** (`config.compress.mode === "range"`):

- Parameters: `startId` (string), `endId` (string), `summary` (string), `topic` (string)
- Compresses all messages between two boundary refs into a single summary

**Message mode** (`config.compress.mode === "message"`):

- Parameters: `messages` (array of `{ id: string, summary: string }`), `topic` (string)
- Compresses individual messages by their ref IDs

### Registered Command: `/dcp`

Subcommands:

| Subcommand   | Purpose                                          |
| ------------ | ------------------------------------------------ |
| `help`       | Show available commands                          |
| `context`    | Display context usage breakdown                  |
| `stats`      | Show session/lifetime compression statistics     |
| `sweep`      | Bulk-prune all eligible tool outputs now         |
| `manual`     | Toggle manual compression mode                   |
| `decompress` | Deactivate compression blocks (restore original) |
| `recompress` | Reactivate previously deactivated blocks         |

### State Model

Single `SessionState` object held in-memory per session:

- `sessionId` — current session identifier
- `manualMode` — auto / active / compress-pending
- `prune.tools` — Map<toolCallId, estimatedTokens> marked for output replacement
- `prune.messages` — compression blocks, per-message metadata, active block tracking
- `toolParameters` — Map<toolCallId, ToolParameterEntry> for signature-based dedup
- `toolIdList` — ordered list of tool call IDs in current context
- `messageIds` — Map<arrayIndex, ref> + nextRefIndex counter
- `nudges` — anchor Sets for context-limit/turn/iteration nudges
- `stats` — token counters (pruneTokenCounter, totalPruneTokens, toolsPruned, messagesCompressed)
- `lastCompaction` — timestamp of last detected compaction
- `currentTurn` — conversation turn counter
- `modelContextWindow` — cached from `ctx.getContextUsage().contextWindow`

### Persistence (Phase 7)

State saved to `{sessionDir}/dcp/state.json` alongside Pi's session data (resolved via `ctx.sessionManager.getSessionDir()`). Fallback when no session dir is available: `~/.pi/agent/sessions/{encodedCwd}/dcp/state.json` (same `encodedCwd` helper as pi-subagents). Saved on significant events; loaded on `session_start` if previous state exists for the session.

## Module Structure

```
pi-dcp/
  src/
    index.ts                      # Extension entry point — only file touching ExtensionAPI
    config.ts                     # Config loading, validation, defaults
    logger.ts                     # File-based debug logger (~/.pi/agent/extensions/dcp/logs/daily/)
    state/
      types.ts                    # SessionState, CompressionBlock, Prune, etc.
      state.ts                    # createSessionState(), resetSessionState()
      tool-cache.ts               # syncToolCache(), buildToolIdList()
      persistence.ts              # saveSessionState(), loadSessionState()
    utils/
      tokens.ts                   # countTokens (char/4 estimation), extractMessageText
      message-ids.ts              # formatMessageRef, parseMessageRef, formatBlockRef, etc.
    strategies/
      protected-patterns.ts       # matchesGlob, isToolNameProtected, isFilePathProtected
      deduplication.ts            # deduplicate() — signature-based, marks older dupes
      purge-errors.ts             # purgeErrors() — age-gated error input removal
    messages/
      strip.ts                    # stripHallucinations() — remove fake DCP tags
      prune.ts                    # applyPruning() + filterCompressedRanges()
      inject.ts                   # assignMessageRefs(), injectCompressNudges(), injectMessageIds()
      priority.ts                 # buildPriorityMap() — token-based ranking for message mode
      sync.ts                     # syncCompressionBlocks() — reconcile blocks with messages
    prompts/
      system.ts                   # DCP system prompt text
      nudges.ts                   # Context-limit, turn, and iteration nudge templates
      compress-message.ts         # Message-mode tool prompt additions
    compress/
      state.ts                    # allocateBlock(), applyCompression(), wrapSummary()
      search.ts                   # resolveBoundary(), collectSelection()
      range.ts                    # handleRangeCompress() — range-mode tool handler
      message.ts                  # handleMessageCompress() — message-mode tool handler
    commands/
      index.ts                    # Router: parse subcommand, dispatch
      help.ts                     # /dcp help
      context.ts                  # /dcp context
      stats.ts                    # /dcp stats
      sweep.ts                    # /dcp sweep
      manual.ts                   # /dcp manual
      decompress.ts               # /dcp decompress [blockId]
      recompress.ts               # /dcp recompress [blockId]
  tests/
    smoke.test.ts
    logger.test.ts
    config.test.ts
    state.test.ts
    message-ids.test.ts
    tokens.test.ts
    protected-patterns.test.ts
    deduplication.test.ts
    purge-errors.test.ts
    tool-cache.test.ts
    strip.test.ts
    prune.test.ts
    inject.test.ts
    priority.test.ts
    sync.test.ts
    compress-state.test.ts
    compress-search.test.ts
    compress-range.test.ts
    compress-message.test.ts
    commands-help.test.ts
    commands-context.test.ts
    commands-stats.test.ts
    commands-sweep.test.ts
    commands-manual.test.ts
    commands-decompress.test.ts
    persistence.test.ts
    integration.test.ts
  package.json
  tsconfig.json
  vitest.config.ts
  biome.json
  pnpm-workspace.yaml
  .gitignore
```

## Design Principles

1. **Pure functions** for strategies and message transforms — testable without Pi mocks
2. **State mutations concentrated** in `state/` and `compress/state.ts`
3. **Minimal Pi surface** — only `index.ts` interacts with `ExtensionAPI`
4. **Immutable message processing** — context handler returns new array, never mutates Pi's input
5. **Graceful degradation** — if config is missing/invalid, use defaults; if `enabled: false`, early return
6. **Idempotent operations** — nudge injection skips if tags already present, message IDs are cached

## Build Phases

Seven atomic phases, each producing a usable, testable result:

| Phase | Name                   | Delivers                                                                    |
| ----- | ---------------------- | --------------------------------------------------------------------------- |
| 1     | Scaffold + Foundation  | Working extension skeleton, config, logger, state, token utils, message IDs |
| 2     | Strategy-Based Pruning | Auto dedup + error purging in the context pipeline                          |
| 3     | Nudges + Message IDs   | System prompt, nudge injection, message ref tags                            |
| 4     | Range Compression      | `compress` tool (range mode), block state, summary filtering                |
| 5     | Message Compression    | Priority map, message-mode compress handler                                 |
| 6     | Commands               | `/dcp` command router with 7 subcommands                                    |
| 7     | Polish                 | State persistence, status bar, config validation, integration test          |

Each phase builds on the previous. Implementation plans exist for each phase in the `plans/` directory (phase-1 through phase-7 markdown files) with an errata document (`ERRATA.md`) correcting API discrepancies. The implementation plans will need convention updates applied (pnpm, biome, .ts imports, tests/ dir, plain JSON config, updated dep versions) during the writing-plans phase.

## Adaptation Notes

### Pi vs OpenCode DCP differences

| Concern           | OpenCode DCP                             | pi-dcp                                                                 |
| ----------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| Message model     | `WithParts[]` with `.parts[].callID`     | `AgentMessage` union (discriminated on `role`)                         |
| Tool calls        | In message parts                         | In `assistant` messages as `content[].type === "toolCall"`             |
| Tool results      | In message parts                         | Separate `toolResult` messages with `toolCallId`                       |
| Message identity  | `message.info.id` (stable UUID)          | Array indices (recomputed each context event)                          |
| Pruning approach  | Mutates `part.state.output` in-place     | Returns new message array with replaced content                        |
| Context usage     | Manual token counting from message parts | `ctx.getContextUsage()` returning `{ tokens, contextWindow, percent }` |
| System prompt     | Custom hook injection                    | `before_agent_start` event return value                                |
| Tool registration | Plugin SDK `tool()` builder with Zod     | `pi.registerTool()` with TypeBox schema                                |
| Config format     | JSONC with layered project/global        | Plain JSON at `~/.pi/agent/extensions/dcp.json`                        |

### ContextUsage nullable fields

```typescript
interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}
```

Guard with `usage.percent != null` before comparing to thresholds.

### UserMessage.content polymorphism

```typescript
content: string | (TextContent | ImageContent)[]
```

Normalize early in any code processing user message content.

### AgentMessage roles to handle

`user | assistant | toolResult | custom | bashExecution | compactionSummary | branchSummary`

Use `if (msg.role === ...)` guards rather than exhaustive switches to gracefully skip unknown roles.
