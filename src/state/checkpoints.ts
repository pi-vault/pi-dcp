import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DcpConfig } from "../config.ts";
import {
  durableStateFingerprint,
  parseDcpSnapshot,
  restoreDcpSnapshot,
  serializeDcpSnapshot,
} from "./persistence.ts";
import { resetSessionState } from "./state.ts";
import type { SessionState } from "./types.ts";

/** The host surface the checkpoint owner needs to append durable state. */
export type DcpCheckpointHost = Pick<ExtensionAPI, "appendEntry">;

/** The branch surface the owner reads to locate and identify native state. */
export type DcpBranchContext = Pick<ExtensionContext, "sessionManager">;

/** Which lifecycle event triggered restoration. */
export type DcpRestoreSource = "session-start" | "branch-navigation";

/** Warning sink for codec problems and append failures. */
export type DcpCheckpointWarning = (message: string, details?: Record<string, unknown>) => void;

export interface DcpCheckpoints {
  restoreAndCheckpoint(
    source: DcpRestoreSource,
    ctx: DcpBranchContext,
    afterRestore: () => void,
  ): void;
  persist(): void;
}

const CUSTOM_TYPE = "pi-dcp-state";

/**
 * Owns DCP's branch restoration and checkpoint decisions.
 *
 * The adapter supplies the current branch/identity and the append behavior; the
 * owner keeps the last successfully persisted fingerprint and, for one
 * restoration event, a local force decision. A scoped restoration runs the
 * caller's synchronous host work before its checkpoint attempt, so a thrown
 * callback drops the force decision with the stack rather than leaking it into
 * a later, unrelated persistence call.
 */
export function createDcpCheckpoints(
  host: DcpCheckpointHost,
  state: SessionState,
  config: DcpConfig,
  warn: DcpCheckpointWarning,
): DcpCheckpoints {
  let lastPersistedFingerprint: string | undefined;

  /** Serialize, deduplicate, and append; advance memory only on success. */
  function attemptPersist(force: boolean): void {
    const snapshot = serializeDcpSnapshot(state);
    if (!snapshot) return;
    const fingerprint = durableStateFingerprint(state);
    if (!fingerprint) return;
    if (!force && fingerprint === lastPersistedFingerprint) return;
    try {
      host.appendEntry(CUSTOM_TYPE, snapshot);
      lastPersistedFingerprint = fingerprint;
    } catch (error) {
      warn("failed to persist native session state", { error: String(error) });
    }
  }

  /**
   * Reset, apply current defaults, and restore the newest valid snapshot.
   * Returns whether this event's checkpoint must be forced.
   */
  function restoreBranch(ctx: DcpBranchContext): boolean {
    const branch = ctx.sessionManager.getBranch();
    const currentSessionId = ctx.sessionManager.getSessionId();
    let skippedInvalidSnapshot = false;

    for (let index = branch.length - 1; index >= 0; index--) {
      const entry = branch[index];
      if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE) continue;
      const snapshot = parseDcpSnapshot(entry.data, (message) => warn(message));
      if (!snapshot) {
        skippedInvalidSnapshot = true;
        continue;
      }
      const restored = restoreDcpSnapshot(snapshot, state, currentSessionId, (message) =>
        warn(message),
      );
      const inheritedOwner = snapshot.ownerSessionId !== currentSessionId;
      if (restored && !inheritedOwner && !skippedInvalidSnapshot) {
        lastPersistedFingerprint = durableStateFingerprint(state);
      }
      return !restored || inheritedOwner || skippedInvalidSnapshot;
    }

    state.sessionId = currentSessionId;
    return true;
  }

  return {
    restoreAndCheckpoint(source, ctx, afterRestore) {
      resetSessionState(state);
      if (source === "session-start") lastPersistedFingerprint = undefined;
      state.manualMode = config.manualMode.default;
      state.compressPermission = config.compress.permission;

      const force = restoreBranch(ctx);
      afterRestore();
      attemptPersist(force);
    },

    persist() {
      attemptPersist(false);
    },
  };
}
