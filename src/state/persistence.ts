import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import type { CompressionBlock, DcpSnapshotBlockV1, DcpSnapshotV1, SessionState } from "./types.ts";
import { resetSessionState } from "./state.ts";
import { parseMessageRef } from "../utils/message-ids.ts";

function sorted<T>(values: Iterable<T>, compare: (a: T, b: T) => number): T[] {
  return [...values].sort(compare);
}

function serializeBlock(block: CompressionBlock): DcpSnapshotBlockV1 | undefined {
  if (block.mode !== "range" && block.mode !== "message") return undefined;
  return {
    blockId: block.blockId,
    runId: block.runId,
    deactivatedByUser: block.deactivatedByUser,
    compressedTokens: block.compressedTokens,
    summaryTokens: block.summaryTokens,
    durationMs: block.durationMs,
    mode: block.mode,
    topic: block.topic,
    ...(block.batchTopic === undefined ? {} : { batchTopic: block.batchTopic }),
    compressToolCallId: block.compressToolCallId,
    startKey: block.startKey,
    endKey: block.endKey,
    anchorKey: block.anchorKey,
    consumedBlockIds: sorted(new Set(block.consumedBlockIds), (a, b) => a - b),
    createdAt: block.createdAt,
    summary: block.summary,
  };
}

/** Serialize only durable, stable facts for a Pi custom session entry. */
export function serializeDcpSnapshot(
  state: SessionState,
  ownerSessionId = state.sessionId,
): DcpSnapshotV1 | undefined {
  if (!ownerSessionId) return undefined;

  const blocks = sorted(
    [...state.prune.messages.blocksById.values()]
      .map(serializeBlock)
      .filter((block): block is DcpSnapshotBlockV1 => block !== undefined),
    (a, b) => a.blockId - b.blockId,
  );

  return {
    version: 1,
    ownerSessionId,
    manualMode: state.manualMode === "active" ? "active" : false,
    compressPermission: state.compressPermission === "deny" ? "deny" : "allow",
    stats: { ...state.stats },
    lastCompaction: state.lastCompaction,
    pruneTools: sorted(state.prune.tools, ([a], [b]) => a.localeCompare(b)),
    blocks,
    nextBlockId: state.prune.messages.nextBlockId,
    nextRunId: state.prune.messages.nextRunId,
    messageIds: {
      byRawId: sorted(state.messageIds.byRawId, ([a], [b]) => a.localeCompare(b)),
      nextRefIndex: state.messageIds.nextRefIndex,
    },
    nudges: {
      contextLimitAnchors: sorted(state.nudges.contextLimitAnchors, (a, b) => a.localeCompare(b)),
      turnAnchors: sorted(state.nudges.turnAnchors, (a, b) => a.localeCompare(b)),
      iterationAnchors: sorted(state.nudges.iterationAnchors, (a, b) => a.localeCompare(b)),
    },
  };
}

/** Stable comparison key for deciding whether a custom entry must be appended. */
export function durableStateFingerprint(state: SessionState): string | undefined {
  const snapshot = serializeDcpSnapshot(state, "owner");
  if (!snapshot) return undefined;
  const { messageIds: _messageIds, ...durable } = snapshot;
  return JSON.stringify(durable);
}

type SnapshotWarning = (message: string) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function parsePairs(value: unknown): Array<[string, string]> {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, string>();
  for (const entry of value) {
    if (
      Array.isArray(entry) &&
      entry.length === 2 &&
      isString(entry[0]) &&
      isString(entry[1]) &&
      (parseMessageRef(entry[1]) ?? 0) > 0
    ) {
      byKey.set(entry[0], entry[1]);
    }
  }
  const refs = new Set<string>();
  return sorted(byKey, ([a], [b]) => a.localeCompare(b)).filter(([, ref]) => {
    if (refs.has(ref)) return false;
    refs.add(ref);
    return true;
  });
}

function parseNumberPairs(value: unknown): Array<[string, number]> {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, number>();
  for (const entry of value) {
    if (
      Array.isArray(entry) &&
      entry.length === 2 &&
      isString(entry[0]) &&
      isNonNegativeInteger(entry[1])
    ) {
      byKey.set(entry[0], entry[1]);
    }
  }
  return sorted(byKey, ([a], [b]) => a.localeCompare(b));
}

function parseStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? sorted(new Set(value.filter(isString)), (a, b) => a.localeCompare(b))
    : [];
}

function parseBlock(value: unknown): DcpSnapshotBlockV1 | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isPositiveInteger(value.blockId) ||
    !isPositiveInteger(value.runId) ||
    !isNonNegativeInteger(value.compressedTokens) ||
    !isNonNegativeInteger(value.summaryTokens) ||
    !isNonNegativeInteger(value.durationMs) ||
    !isNonNegativeInteger(value.createdAt) ||
    !isString(value.topic) ||
    !isString(value.compressToolCallId) ||
    !isString(value.startKey) ||
    !isString(value.endKey) ||
    !isString(value.anchorKey) ||
    !isString(value.summary) ||
    typeof value.deactivatedByUser !== "boolean" ||
    (value.mode !== "range" && value.mode !== "message")
  ) {
    return undefined;
  }
  if (value.batchTopic !== undefined && !isString(value.batchTopic)) return undefined;

  return {
    blockId: value.blockId,
    runId: value.runId,
    deactivatedByUser: value.deactivatedByUser,
    compressedTokens: value.compressedTokens,
    summaryTokens: value.summaryTokens,
    durationMs: value.durationMs,
    mode: value.mode,
    topic: value.topic,
    ...(value.batchTopic === undefined ? {} : { batchTopic: value.batchTopic }),
    compressToolCallId: value.compressToolCallId,
    startKey: value.startKey,
    endKey: value.endKey,
    anchorKey: value.anchorKey,
    consumedBlockIds: Array.isArray(value.consumedBlockIds)
      ? value.consumedBlockIds.filter(isPositiveInteger)
      : [],
    createdAt: value.createdAt,
    summary: value.summary,
  };
}

/** Validate an untrusted Pi custom-entry payload, retaining valid subentries. */
export function parseDcpSnapshot(
  value: unknown,
  warn: SnapshotWarning = () => {},
): DcpSnapshotV1 | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isString(value.ownerSessionId) ||
    !value.ownerSessionId
  ) {
    return undefined;
  }
  if (value.manualMode !== false && value.manualMode !== "active") return undefined;
  if (value.compressPermission !== "allow" && value.compressPermission !== "deny") return undefined;
  if (
    !isRecord(value.stats) ||
    !isNonNegativeInteger(value.stats.pruneTokenCounter) ||
    !isNonNegativeInteger(value.stats.totalPruneTokens) ||
    !isNonNegativeInteger(value.stats.toolsPruned) ||
    !isNonNegativeInteger(value.stats.messagesCompressed)
  )
    return undefined;
  if (
    !isNonNegativeInteger(value.lastCompaction) ||
    !isPositiveInteger(value.nextBlockId) ||
    !isPositiveInteger(value.nextRunId)
  ) {
    return undefined;
  }
  if (
    !isRecord(value.messageIds) ||
    !isPositiveInteger(value.messageIds.nextRefIndex) ||
    !isRecord(value.nudges)
  ) {
    return undefined;
  }
  if (!Array.isArray(value.blocks)) return undefined;

  const seenBlockIds = new Set<number>();
  const blocks: DcpSnapshotBlockV1[] = [];
  for (const candidate of value.blocks) {
    const block = parseBlock(candidate);
    if (!block || seenBlockIds.has(block.blockId)) {
      warn("Discarded invalid DCP snapshot block");
      continue;
    }
    seenBlockIds.add(block.blockId);
    blocks.push(block);
  }
  for (const block of blocks) {
    block.consumedBlockIds = sorted(
      new Set(block.consumedBlockIds.filter((id) => id !== block.blockId && seenBlockIds.has(id))),
      (a, b) => a - b,
    );
  }

  return {
    version: 1,
    ownerSessionId: value.ownerSessionId,
    manualMode: value.manualMode,
    compressPermission: value.compressPermission,
    stats: {
      pruneTokenCounter: value.stats.pruneTokenCounter as number,
      totalPruneTokens: value.stats.totalPruneTokens as number,
      toolsPruned: value.stats.toolsPruned as number,
      messagesCompressed: value.stats.messagesCompressed as number,
    },
    lastCompaction: value.lastCompaction,
    pruneTools: parseNumberPairs(value.pruneTools),
    blocks: sorted(blocks, (a, b) => a.blockId - b.blockId),
    nextBlockId: value.nextBlockId,
    nextRunId: value.nextRunId,
    messageIds: {
      byRawId: parsePairs(value.messageIds.byRawId),
      nextRefIndex: value.messageIds.nextRefIndex,
    },
    nudges: {
      contextLimitAnchors: parseStrings(value.nudges.contextLimitAnchors),
      turnAnchors: parseStrings(value.nudges.turnAnchors),
      iterationAnchors: parseStrings(value.nudges.iterationAnchors),
    },
  };
}

function restoreBlock(block: DcpSnapshotBlockV1): CompressionBlock {
  return {
    ...block,
    active: false,
    batchTopic: block.batchTopic,
    startIndex: -1,
    endIndex: -1,
    anchorIndex: -1,
    parentBlockIds: [],
    directMessageIndices: [],
    directToolIds: [],
    effectiveMessageIndices: [],
    effectiveToolIds: [],
    deactivatedAt: undefined,
    deactivatedByBlockId: undefined,
  };
}

/** Restore a valid snapshot into the existing session state. */
export function restoreDcpSnapshot(
  rawSnapshot: unknown,
  state: SessionState,
  currentSessionId: string,
  warn?: SnapshotWarning,
): boolean {
  const snapshot = parseDcpSnapshot(rawSnapshot, warn);
  if (!snapshot) return false;

  resetSessionState(state);
  state.sessionId = currentSessionId;
  state.manualMode = snapshot.manualMode;
  state.compressPermission = snapshot.compressPermission;
  state.lastCompaction = snapshot.lastCompaction;
  state.prune.tools = new Map(snapshot.pruneTools);
  state.messageIds.byRawId = new Map(snapshot.messageIds.byRawId);
  state.messageIds.byRef = new Map(snapshot.messageIds.byRawId.map(([key, ref]) => [ref, key]));
  state.messageIds.nextRefIndex = Math.max(
    snapshot.messageIds.nextRefIndex,
    ...snapshot.messageIds.byRawId.map(([, ref]) => (parseMessageRef(ref) ?? 0) + 1),
  );
  state.nudges.contextLimitAnchors = new Set(snapshot.nudges.contextLimitAnchors);
  state.nudges.turnAnchors = new Set(snapshot.nudges.turnAnchors);
  state.nudges.iterationAnchors = new Set(snapshot.nudges.iterationAnchors);
  for (const block of snapshot.blocks) {
    state.prune.messages.blocksById.set(block.blockId, restoreBlock(block));
  }
  state.prune.messages.nextBlockId = Math.max(
    snapshot.nextBlockId,
    ...snapshot.blocks.map((block) => block.blockId + 1),
  );
  state.prune.messages.nextRunId = Math.max(
    snapshot.nextRunId,
    ...snapshot.blocks.map((block) => block.runId + 1),
  );
  if (snapshot.ownerSessionId === currentSessionId) {
    Object.assign(state.stats, snapshot.stats);
  }
  return true;
}

/** Aggregate each owner's newest native snapshot from Pi session JSONL files. */
export async function loadAllSessionStats(parentDir: string): Promise<{
  totalTokensSaved: number;
  totalToolsPruned: number;
  totalMessagesCompressed: number;
  sessionCount: number;
}> {
  const snapshots = new Map<string, { snapshot: DcpSnapshotV1; timestamp: number }>();

  async function scanFile(file: string): Promise<void> {
    let hasHeader = false;
    try {
      const input = fs.createReadStream(file, { encoding: "utf8" });
      for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
        let entry: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(line);
          if (!isRecord(parsed)) continue;
          entry = parsed;
        } catch {
          continue;
        }
        if (
          entry.type === "session" &&
          isString(entry.id) &&
          entry.id.length > 0 &&
          isString(entry.timestamp) &&
          Number.isFinite(Date.parse(entry.timestamp)) &&
          isString(entry.cwd)
        ) {
          hasHeader = true;
          continue;
        }
        if (!hasHeader || entry.type !== "custom" || entry.customType !== "pi-dcp-state") continue;
        const snapshot = parseDcpSnapshot(entry.data);
        if (!snapshot) continue;
        const timestamp =
          typeof entry.timestamp === "number"
            ? entry.timestamp
            : typeof entry.timestamp === "string"
              ? Date.parse(entry.timestamp)
              : Number.NaN;
        if (!Number.isFinite(timestamp)) continue;
        const existing = snapshots.get(snapshot.ownerSessionId);
        if (!existing || timestamp >= existing.timestamp)
          snapshots.set(snapshot.ownerSessionId, { snapshot, timestamp });
      }
    } catch {
      // Skip inaccessible or malformed streams.
    }
  }

  try {
    for await (const file of fs.promises.glob("**/*.jsonl", { cwd: parentDir })) {
      await scanFile(path.join(parentDir, file));
    }
  } catch {
    // A missing or inaccessible sessions directory has no lifetime stats.
  }
  const result = {
    totalTokensSaved: 0,
    totalToolsPruned: 0,
    totalMessagesCompressed: 0,
    sessionCount: 0,
  };
  for (const { snapshot } of snapshots.values()) {
    result.totalTokensSaved += snapshot.stats.totalPruneTokens;
    result.totalToolsPruned += snapshot.stats.toolsPruned;
    result.totalMessagesCompressed += snapshot.stats.messagesCompressed;
    result.sessionCount++;
  }
  return result;
}
