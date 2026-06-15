import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionState, SessionStats } from "./types.ts";

/**
 * Serializable subset of session state for persistence.
 */
interface SerializedState {
  sessionId: string | null;
  currentTurn: number;
  stats: SessionStats;
  lastCompaction: number;
}

/**
 * Save session state to {sessionDir}/dcp/state.json.
 * No-op if state.sessionId is null.
 */
export function saveSessionState(state: SessionState, sessionDir: string): void {
  if (!state.sessionId) return;

  const dcpDir = path.join(sessionDir, "dcp");
  fs.mkdirSync(dcpDir, { recursive: true });

  const serialized: SerializedState = {
    sessionId: state.sessionId,
    currentTurn: state.currentTurn,
    stats: { ...state.stats },
    lastCompaction: state.lastCompaction,
  };

  fs.writeFileSync(
    path.join(dcpDir, "state.json"),
    JSON.stringify(serialized, null, 2),
  );
}

/**
 * Load session state from {sessionDir}/dcp/state.json.
 * Returns undefined if the file doesn't exist or is corrupt.
 */
export function loadSessionState(
  sessionDir: string,
): Pick<SessionState, "currentTurn" | "stats" | "lastCompaction"> | undefined {
  const filePath = path.join(sessionDir, "dcp", "state.json");

  try {
    if (!fs.existsSync(filePath)) return undefined;
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as SerializedState;

    return {
      currentTurn: parsed.currentTurn ?? 0,
      stats: {
        pruneTokenCounter: parsed.stats?.pruneTokenCounter ?? 0,
        totalPruneTokens: parsed.stats?.totalPruneTokens ?? 0,
        toolsPruned: parsed.stats?.toolsPruned ?? 0,
        messagesCompressed: parsed.stats?.messagesCompressed ?? 0,
      },
      lastCompaction: parsed.lastCompaction ?? 0,
    };
  } catch {
    return undefined;
  }
}

/**
 * Load aggregate stats from all saved sessions under a parent directory.
 * Expects structure: {parentDir}/{sessionName}/dcp/state.json
 * Used by dcp:lifetime command.
 */
export function loadAllSessionStats(parentDir: string): {
  totalTokensSaved: number;
  totalToolsPruned: number;
  totalMessagesCompressed: number;
  sessionCount: number;
} {
  const result = {
    totalTokensSaved: 0,
    totalToolsPruned: 0,
    totalMessagesCompressed: 0,
    sessionCount: 0,
  };

  try {
    if (!fs.existsSync(parentDir)) return result;
    const entries = fs.readdirSync(parentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const stateFile = path.join(parentDir, entry.name, "dcp", "state.json");
      try {
        if (!fs.existsSync(stateFile)) continue;
        const content = fs.readFileSync(stateFile, "utf-8");
        const parsed = JSON.parse(content) as SerializedState;
        if (parsed.stats) {
          result.totalTokensSaved += parsed.stats.totalPruneTokens ?? 0;
          result.totalToolsPruned += parsed.stats.toolsPruned ?? 0;
          result.totalMessagesCompressed += parsed.stats.messagesCompressed ?? 0;
          result.sessionCount++;
        }
      } catch {
        // Skip corrupt files
      }
    }
  } catch {
    // Dir not accessible
  }

  return result;
}
