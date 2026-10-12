import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { getDcpCapabilities } from "./capabilities.ts";
import type { DcpConfig } from "./config.ts";
import type { SessionState } from "./state/types.ts";

export type CompressionModelIdentity = { provider: string; id: string };

export type CompressionToolHost = Pick<
  ExtensionAPI,
  "getActiveTools" | "setActiveTools" | "getAllTools"
>;

export interface CompressionToolSelection {
  refreshModel(model: CompressionModelIdentity | undefined): void;
  reconcile(ctx?: Pick<ExtensionContext, "model">): void;
  sessionStarted(reason: SessionStartEvent["reason"], ctx: ExtensionContext): void;
  branchRestored(ctx: ExtensionContext): void;
}

interface StructuredSystemFields {
  role?: unknown;
  sections?: unknown;
  toolsAdded?: unknown;
  toolsRemoved?: unknown;
}

/** A system message declaring a tool loadout declares the host's selected tools. */
function declaresToolLoadout(message: AgentMessage): boolean {
  const candidate = message as unknown as StructuredSystemFields;
  if (candidate.role !== "system") return false;
  return (
    candidate.sections !== undefined ||
    candidate.toolsAdded !== undefined ||
    candidate.toolsRemoved !== undefined
  );
}

/**
 * Owns DCP's compression-tool selection transitions.
 *
 * Pi owns the restored loadout and host exclusions; this owner only remembers a
 * temporary suppression within the current branch and performs the one-time
 * fresh-session selection. It reads the live root `state`/`config` at call time
 * because reload and restoration can replace nested values.
 */
export function createCompressionToolSelection(
  host: CompressionToolHost,
  state: SessionState,
  config: DcpConfig,
): CompressionToolSelection {
  let compressWasActiveBeforeSuppression: boolean | undefined;
  let hasProcessedSessionStart = false;

  /** Adopt the supplied model identity; leave the stored identity untouched when absent. */
  function refreshModel(model: CompressionModelIdentity | undefined): void {
    if (!model) return;
    state.modelProvider = model.provider;
    state.modelId = model.id;
  }

  /** Current policy suppression reasons for the stored model identity. */
  function suppressionReasons(): ReturnType<typeof getDcpCapabilities>["reasons"] {
    return getDcpCapabilities(config, state, state.modelProvider, state.modelId).reasons;
  }

  /** Whether the active branch already declares a tool loadout. */
  function branchDeclaresToolLoadout(ctx: ExtensionContext): boolean {
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      if (declaresToolLoadout(entry.message)) return true;
    }
    return false;
  }

  /**
   * Select `compress` for a genuinely fresh session, respecting reload,
   * declared loadouts, and host exclusions.
   */
  function initializeFreshSelection(
    reason: SessionStartEvent["reason"],
    ctx: ExtensionContext,
  ): void {
    if (reason === "reload") return;
    if (branchDeclaresToolLoadout(ctx)) return;
    if (!host.getAllTools().some((tool) => tool.name === "compress")) return;
    const activeTools = host.getActiveTools();
    if (activeTools.includes("compress")) return;
    host.setActiveTools([...activeTools, "compress"]);
  }

  /** Forget the current branch's pre-suppression selection. */
  function resetSuppressionMemory(): void {
    compressWasActiveBeforeSuppression = undefined;
  }

  /**
   * Reconcile the active `compress` tool with DCP policy.
   *
   * Selection is recorded at the first suppression transition and restored only
   * when every policy reason clears. Restoration retains other active tools and
   * delegates acceptance of `compress` to the host.
   */
  function reconcile(ctx?: Pick<ExtensionContext, "model">): void {
    refreshModel(ctx?.model);
    const reasons = suppressionReasons();
    const activeTools = host.getActiveTools();
    const compressActive = activeTools.includes("compress");

    if (reasons.length > 0) {
      if (compressWasActiveBeforeSuppression === undefined) {
        compressWasActiveBeforeSuppression = compressActive;
      }
      if (compressActive) {
        host.setActiveTools(activeTools.filter((name) => name !== "compress"));
      }
      return;
    }

    if (compressWasActiveBeforeSuppression === true && !compressActive) {
      host.setActiveTools([...activeTools, "compress"]);
    }
    compressWasActiveBeforeSuppression = undefined;
  }

  /** First session-start handling, then policy reconciliation. */
  function sessionStarted(reason: SessionStartEvent["reason"], ctx: ExtensionContext): void {
    const isFirstSessionStart = !hasProcessedSessionStart;
    hasProcessedSessionStart = true;
    resetSuppressionMemory();
    refreshModel(ctx.model);
    if (isFirstSessionStart) initializeFreshSelection(reason, ctx);
    reconcile();
  }

  /** Tree navigation: restore policy without repeating implicit selection. */
  function branchRestored(ctx: ExtensionContext): void {
    resetSuppressionMemory();
    refreshModel(ctx.model);
    reconcile();
  }

  return { refreshModel, reconcile, sessionStarted, branchRestored };
}
