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
  /** Active model identifier (e.g. "claude-sonnet-4-20250514"). */
  modelId: string | undefined;
  /** Active model provider (e.g. "anthropic"). */
  modelProvider: string | undefined;
  /** Compression timing tracking. */
  compressionTiming: CompressionTimingState;
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
  /** Index of the assistant message containing this tool call. */
  assistantIndex: number | undefined;
  /** Index of the toolResult message for this tool call. */
  resultIndex: number | undefined;
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
  /** Reverse lookup: ref string -> message index. O(1) resolution. */
  byRef: Map<string, number>;
  nextRefIndex: number;
}

export interface CompressionTimingState {
  /** Start timestamps for in-flight compress calls. Keyed by toolCallId. */
  startTimes: Map<string, number>;
  /** Maps toolCallId to the blockId created by that call. */
  callIdToBlockId: Map<string, number>;
  /** Computed durations awaiting application to blocks. Keyed by toolCallId. */
  pendingDurations: Map<string, number>;
}

/**
 * Context usage snapshot from Pi's ctx.getContextUsage().
 * tokens and percent can be null when usage data is unavailable.
 */
export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}
