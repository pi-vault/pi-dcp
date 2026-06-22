# DCP Feature Port: 10-Phase Design Spec

Port selected features from `opencode-dynamic-context-pruning` to `pi-dcp`. Each phase is atomic — its result is independently usable. Phases are ordered from simplest to most complex.

**Selected items (from gap analysis):** #1, #4, #5, #7, #10, #12, #13, #17, #18, #23

**Dependency chain:** Phase 5 (message ID by raw ID) must precede Phase 6 (anchored nudges). All other phases are independent.

---

## Resolved Design Decisions

| Decision                                  | Resolution                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Phase 1: strip-then-inject redundancy     | Keep "belt-and-suspenders" approach for defense-in-depth                                                 |
| Phase 4: default limits                   | `maxContextLimit: 200000`, `minContextLimit: 100000` (absolute tokens, not percentages)                  |
| Phase 4: cap derivation                   | No formula from contextWindow — fixed absolute ceiling independent of window size                        |
| Phase 5: stable ID strategy               | Content-derived keys: `user:${timestamp}`, `assistant:${timestamp}`, `toolResult:${toolCallId}`          |
| Phase 7: size bounds on protected content | None — follow opencode (append verbatim, user config is the size control)                                |
| Phase 9: sub-agent architecture           | Use `pi-subagents` system (env-var detection, read child `.jsonl` sessions, cache on tool_execution_end) |
| Phase 10: prompt override paths           | Project: `.pi/dcp-prompts/overrides/`, Global: `getAgentDir()/extensions/dcp-prompts/overrides/`         |

---

## Phase 1: Strip Hallucinations on `message_end`

**Problem:** Truncated DCP tags like `<dcp-message-id>m0093</dcp` persist because (a) the strip regex requires a closing `>`, and (b) the marker-based idempotency in `appendText` matches the partial tag and skips re-injection.

**Changes:**

1. **Fix `stripHallucinationsFromString`** — Add regex coverage for incomplete/truncated DCP tags (no closing `>`):
   - `/<\/?dcp[^>]*$/gim` — partial tags at end of string
   - `/<dcp[^>]*>[^<]*<\/dcp[^>]*/gi` — paired tags missing final `>`

2. **Register a `message_end` handler** in `index.ts` — For assistant messages, strip DCP tags from all text content parts before the message is stored:

   ```ts
   pi.on("message_end", async (event, _ctx) => {
     if (event.message.role !== "assistant") return;
     const stripped = mapText(event.message, stripHallucinationsFromString);
     if (stripped !== event.message) return { message: stripped };
   });
   ```

3. **Remove marker-based idempotency** from `injectMessageIds` — Strip all existing DCP tags from the message text before injecting fresh ones. This makes injection always clean regardless of stale/partial tags.

**Files touched:** `src/messages/strip.ts`, `src/index.ts`, `src/messages/inject.ts`, `src/utils/message-content.ts`

**Result:** Hallucinated/truncated DCP tags are stripped both on output (before storage) and on input (before injection). The reported truncation bug is fully resolved.

---

## Phase 2: Compression Timing

**Problem:** No visibility into how long compress tool calls take.

**Changes:**

1. **Add `CompressionTimingState` to `SessionState`:**

   ```ts
   compressionTiming: {
     startsByCallId: Map<string, number>;
     pendingByCallId: Map<string, { callId: string; durationMs: number }>;
   }
   ```

2. **Register `tool_execution_start` handler** — When `toolName === "compress"`, record start timestamp keyed by `toolCallId`.

3. **Register `tool_execution_end` handler** — When `toolName === "compress"`, compute duration and store as pending. On next `context` pass, attach duration to matching compression blocks via `applyPendingCompressionDurations`.

4. **Persist `durationMs`** on `CompressionBlock` (field already exists in the type but is always 0).

**Files touched:** `src/state/types.ts`, `src/state/state.ts`, `src/index.ts`, `src/compress/state.ts`

**Result:** Each compression block records how long it took. Useful for stats and debugging.

---

## Phase 3: Summary Buffer

**Problem:** Active compression summaries consume context tokens, pushing usage over the threshold and potentially triggering cascading compressions.

**Changes:**

1. **Add `summaryBuffer: boolean` to `CompressConfig`** (default: `true`).

2. **Add `getActiveSummaryTokenUsage(state)` utility** — Sum `summaryTokens` across all active blocks.

3. **Adjust threshold calculation in `injectCompressNudges`** — When `summaryBuffer` is enabled, extend the effective max threshold by the active summary token count (converted to percentage of context window, or added as absolute tokens in Phase 4's refactored logic).

**Files touched:** `src/config.ts`, `src/messages/inject.ts` (or new utility file), `src/state/types.ts`

**Result:** Summaries don't count against the compression threshold, preventing feedback loops.

---

## Phase 4: Absolute Token Limits + Per-Model Overrides

**Problem:** Percentage-only thresholds are broken for large context windows. 40% of 1M = 400K tokens before nudging starts — far too late for effective compression.

**Changes:**

1. **Extend `CompressConfig`** with new fields:

   ```ts
   maxContextLimit: number | `${number}%`;  // default: 200000
   minContextLimit: number | `${number}%`;  // default: 100000
   modelMaxLimits?: Record<string, number | `${number}%`>;
   modelMinLimits?: Record<string, number | `${number}%`>;
   ```

   Keep `maxContextPercent` / `minContextPercent` as legacy fallback — if new fields are absent AND no percentage fields set, use the hardcoded defaults (200000/100000). If only percentage fields are set, derive from percentage \* modelContextWindow.

2. **Automatic context window detection** — On every `context` event and `model_select` event, cache the model's context window from `ctx.model.contextWindow` and the model identifier as `${ctx.model.provider}/${ctx.model.id}` in state. This drives percentage-to-absolute conversion and per-model override lookups.

3. **Add `resolveContextTokenLimit(config, state, threshold)` utility** — Resolves the effective limit:
   - Check `modelMaxLimits[provider/modelId]` first (per-model override)
   - Fall back to `maxContextLimit` (global)
   - If value is a percentage string (e.g. `"80%"`), compute against `state.modelContextWindow`
   - If value is a number, use directly as absolute token count
   - If neither new field is set, derive from `maxContextPercent` \* `modelContextWindow`

4. **Refactor `injectCompressNudges`** — Replace percentage-based comparison with:

   ```ts
   const { overMaxLimit, overMinLimit } = isContextOverLimits(
     config,
     state,
     contextUsage,
   );
   ```

   Uses `contextUsage.tokens` (absolute), adds summaryBuffer extension to max limit.

5. **Track model info in state** — Add `modelId: string | undefined` and `modelProvider: string | undefined` to `SessionState`. Updated from `ctx.model` on `context` and `model_select` events.

6. **Config validation** — Add new keys to known compress keys set. Warn on unknown keys.

**Files touched:** `src/config.ts`, `src/messages/inject.ts`, `src/state/types.ts`, `src/index.ts`

**Backward compatibility:** If neither `maxContextLimit` nor `minContextLimit` is configured, the resolver derives them from existing `maxContextPercent`/`minContextPercent` \* detected context window. Zero config change required for existing users.

**Result:** Users can set `maxContextLimit: 200000` to cap at 200K tokens regardless of window size. Per-model overrides let you tune differently for Gemini (1M) vs Claude (200K). The extension auto-detects the active model's context window via Pi's API.

---

## Phase 5: Message ID by Raw ID (Stable Mapping)

**Problem:** pi-dcp maps message refs (m0001, m0002) by array index. When messages are compacted or removed, indices shift, breaking the mapping.

**Changes:**

1. **Refactor `MessageIdState`** from index-based to ID-based:

   ```ts
   // New (stable):
   byRawId: Map<string, string>; // message.id -> ref (e.g. "abc123" -> "m0001")
   byRef: Map<string, string>; // ref -> message.id (e.g. "m0001" -> "abc123")
   nextRefIndex: number;
   ```

2. **Derive stable message keys from Pi's message format** — Pi's `AgentMessage` type (`UserMessage | AssistantMessage | ToolResultMessage`) doesn't carry a stable `id` field directly. Strategy uses content-derived keys that are stable across array reordering and compaction:
   - `getMessageKey(msg: AgentMessage): string` — derives a stable key:
     - User messages: `user:${msg.timestamp}`
     - Assistant messages: `assistant:${msg.timestamp}`
     - Tool result messages: `toolResult:${msg.toolCallId}`
   - These keys are deterministic from message content alone — no dependency on `ctx.sessionManager.getEntries()` or external lookups within the pipeline.
   - Use the content-derived key as the raw ID for the `byRawId` map.

3. **Refactor `assignMessageRefs`** — Iterate messages by stable ID instead of array index. Check `byRawId` for existing assignment.

4. **Refactor `injectMessageIds`** — Look up ref by message ID instead of index.

5. **Update `CompressionBlock`** — Replace index-based fields (`startIndex`, `endIndex`, `anchorIndex`, `compressMessageIndex`, `directMessageIndices`, `effectiveMessageIndices`) with ID-based equivalents (`startId`, `endId`, `anchorMessageId`, `compressMessageId`, `directMessageIds`, `effectiveMessageIds`).

6. **Update `compress/search.ts`** — `resolveBoundaryIndex` resolves IDs to runtime indices dynamically when needed for range operations.

7. **Update `session_compact` handler** — Retain `byRawId`/`byRef` mappings (stable across compactions since entry IDs survive compaction). Only prune entries for messages that no longer appear in the session.

8. **Migration** — Existing persisted state uses index-based fields. Add one-time migration in `loadSessionState`.

**Files touched:** `src/state/types.ts`, `src/state/state.ts`, `src/state/persistence.ts`, `src/messages/inject.ts`, `src/compress/handler.ts`, `src/compress/search.ts`, `src/compress/state.ts`, `src/messages/sync.ts`, `src/utils/message-ids.ts`, `src/pipeline.ts`

**Note:** Content-derived keys (`user:${timestamp}`, `assistant:${timestamp}`, `toolResult:${toolCallId}`) are computed purely from message properties — no `ctx.sessionManager` dependency in the pipeline. The pipeline signature remains unchanged.

**Result:** Message refs remain stable across compactions and message reordering. Foundation for Phase 6.

---

## Phase 6: Anchored Nudge System

**Problem:** Current nudge injection appends to the last text-bearing message. The nudge moves around as messages are added, and there's no deduplication across turns.

**Depends on:** Phase 5 (message ID by raw ID)

**Changes:**

1. **Refactor `Nudges` state** to message-ID-based sets:

   ```ts
   nudges: {
     contextLimitAnchors: Set<string>; // message IDs
     turnNudgeAnchors: Set<string>;
     iterationNudgeAnchors: Set<string>;
   }
   ```

2. **Add `addAnchor(anchorSet, messageId, messageIndex, messages, interval)` utility** — Checks if the last anchor in the set is far enough away (by message distance) before adding. Prevents nudge spam.

3. **Refactor `injectCompressNudges`** into two stages:
   - **Decision stage:** Determine which nudge type applies. If triggered, add the target message ID to the appropriate anchor set using `addAnchor` with `nudgeFrequency` as the interval.
   - **Application stage:** `applyAnchoredNudges` — For each anchor in each set, locate the message by ID and inject nudge text.

4. **Activate `nudgeFrequency` config** — Currently reserved but unused. This phase makes it the minimum message distance between anchors.

5. **Nudge text injection** — Use `injectAnchoredNudge` which handles user/assistant messages differently:
   - User: append to last text part or create synthetic text part
   - Assistant: insert before first tool part

6. **Persistence** — Anchor sets are persisted as arrays of message IDs. On compaction, anchors referencing removed messages are pruned.

**Files touched:** `src/state/types.ts`, `src/messages/inject.ts` (major rewrite of nudge section), `src/state/state.ts`, `src/state/persistence.ts`

**Result:** Nudges are persistent, deduplicated, and anchored to specific messages. The model sees them in stable positions across turns.

---

## Phase 7: Protected Content in Summaries

**Problem:** When messages are compressed, protected user messages, `<protect>` tag content, and protected tool outputs are lost from context.

**Changes:**

1. **`appendProtectedUserMessages(summary, messages, config)`** — For each user message in the compressed range (not already covered by another active block), extract text and append verbatim.

2. **`appendProtectedPromptInfo(summary, messages)`** — Scan user messages for `<protect>...</protect>` tags, extract content, append to summary.

3. **`appendProtectedToolOutputs(summary, messages, config)`** — For tool calls whose name matches `compress.protectedTools` or file paths match `protectedFilePatterns`, append output verbatim.

4. **Integrate into `handleCompress`** — After receiving the model-generated summary, run the append functions to produce enriched summary before storing.

5. **Config gate** — `compress.protectUserMessages` and `compress.protectTags` booleans control user message and tag protection. Protected tool outputs always append when matching `compress.protectedTools`.

**Files touched:** New `src/compress/protected-content.ts`, `src/compress/handler.ts`

**Result:** Critical information survives compression. Prevents semantic drift in long sessions.

---

## Phase 8: UI Notifications

**Problem:** No user-visible feedback on pruning/compression beyond the status bar counter.

**Changes:**

1. **Add `src/ui/notification.ts`** — Two modes:
   - **toast:** `ctx.ui.notify()` for short messages
   - **status:** `ctx.ui.setStatus()` for persistent status line

2. **Notification content builders:**
   - `buildMinimalMessage(stats)` — "DCP: ~12.4K tokens saved (3 items pruned)"
   - `buildDetailedMessage(stats, prunedToolIds, toolMetadata)` — Adds pruned item list

3. **Config:** Existing `nudgeNotification: "off" | "minimal" | "detailed"` controls verbosity. Add `nudgeNotificationType: "toast" | "status"` (default: `"status"`).

4. **Emit notifications** after strategy runs and compression completions. Notification emission happens in the `context` event handler after pipeline returns.

**Files touched:** New `src/ui/notification.ts`, `src/config.ts`, `src/index.ts`

**Result:** Users see real-time DCP feedback. Configurable from silent to detailed.

---

## Phase 9: Sub-Agent Support

**Problem:** DCP doesn't recognize sub-agent sessions, can't access their results for enriched compression, and may interfere with sub-agent context management.

**Architecture note:** Pi's sub-agent system (`pi-subagents`) spawns child `pi` processes with `--session <childSessionPath>`. Sub-agents have persistent `.jsonl` session files. The parent knows the child's session path via `result.details.childSessionPath`. Detection uses `process.env.PI_SUBAGENT_CHILD === "1"`.

**Changes:**

1. **Detect sub-agent sessions** — Add `isSubAgent: boolean` to `SessionState`. On `session_start`, check `process.env.PI_SUBAGENT_CHILD === "1"`. If true, mark as sub-agent.

2. **Add `experimental.allowSubAgents: boolean` config** (default: `false`) — When `false` and `isSubAgent`, skip all DCP processing (early return from `context` handler).

3. **Sub-agent result caching** — `subAgentResultCache: Map<string, string>` in state. On `tool_execution_end` when `toolName === "subagent"`:
   - Read the child session `.jsonl` file from `result.details.childSessionPath`
   - Parse entries to extract assistant message history
   - Build result text and cache keyed by `toolCallId`
   - This preserves pipeline purity (no filesystem I/O during pipeline execution)

4. **Enriched compression in parent** — When compressing messages containing `subagent` tool results, read cached result text and merge into the summary (via Phase 7's `appendProtectedToolOutputs`).

5. **Add `"subagent"` to `BASE_PROTECTED_TOOLS`** — Sub-agent results are never pruned by strategies.

**Files touched:** New `src/subagents/subagent-results.ts`, `src/config.ts`, `src/state/types.ts`, `src/state/state.ts`, `src/index.ts`

**Result:** DCP gracefully handles sub-agent sessions (skipping when running as a child, enriching results in parent compression).

---

## Phase 10: Custom Prompts (PromptStore)

**Problem:** Users can't customize DCP's system prompt, nudge text, or compress tool descriptions without modifying source.

**Changes:**

1. **Add `PromptStore` class** (`src/prompts/store.ts`) — Override precedence:
   - Project: `.pi/dcp-prompts/overrides/`
   - Global: `getAgentDir()/extensions/dcp-prompts/overrides/` (typically `~/.pi/agent/extensions/dcp-prompts/overrides/`)
   - Bundled defaults (current hardcoded prompts)

2. **Prompt files:**
   - `system.md` — DCP system prompt extension
   - `compress-range.md` — Range-mode tool description
   - `compress-message.md` — Message-mode tool description
   - `context-limit-nudge.md` — Urgent nudge text
   - `turn-nudge.md` — Turn boundary nudge
   - `iteration-nudge.md` — Iteration threshold nudge

3. **`RuntimePrompts` interface** — All prompt consumers read from `store.getRuntimePrompts()` instead of importing constants.

4. **Defaults directory** — On first run with `experimental.customPrompts: true`, write bundled prompts to `getAgentDir()/extensions/dcp-prompts/defaults/` as reference.

5. **Hot-reload** — `store.reload()` on each `context` pass re-reads override files.

6. **Config gate** — `experimental.customPrompts: boolean` (default: `false`). When disabled, bundled prompts used directly with zero filesystem access.

7. **Normalization** — Strip HTML comments, handle `<dcp-system-reminder>` wrapping/unwrapping, validate non-empty.

**Files touched:** New `src/prompts/store.ts`, `src/config.ts`, `src/index.ts`, `src/prompts/system.ts`, `src/prompts/nudges.ts`, `src/prompts/compress-message.ts`

**Result:** Power users customize DCP behavior through plain-text prompt files without touching code.

---

## Summary

| Phase | Feature                                     | Key dependency                                 |
| ----- | ------------------------------------------- | ---------------------------------------------- |
| 1     | Strip hallucinations on `message_end`       | None                                           |
| 2     | Compression timing                          | None                                           |
| 3     | Summary buffer                              | None                                           |
| 4     | Absolute token limits + per-model overrides | Phase 3 (summaryBuffer consumed by limit calc) |
| 5     | Message ID by raw ID                        | None                                           |
| 6     | Anchored nudge system                       | Phase 5                                        |
| 7     | Protected content in summaries              | None                                           |
| 8     | UI notifications                            | None                                           |
| 9     | Sub-agent support                           | None                                           |
| 10    | Custom prompts (PromptStore)                | None                                           |
