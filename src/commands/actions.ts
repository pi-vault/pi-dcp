import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getDcpCapabilities, getDcpPipelineDisabledMessage } from "../capabilities.ts";
import type { DcpConfig } from "../config.ts";
import type { SessionState } from "../state/types.ts";
import { decompressBlock, recompressBlock, toggleBlock } from "../compress/blocks.ts";
import { manualCommand } from "./manual.ts";
import { permissionCommand } from "./permission.ts";
import { sweepCommand } from "./sweep.ts";

/** Guarded DCP action requested by a command or the TUI panel. */
export type DcpAction =
  | { type: "manual"; args: string }
  | { type: "toggle-manual" }
  | { type: "cycle-permission" }
  | { type: "sweep" }
  | { type: "decompress"; args: string }
  | { type: "recompress"; args: string }
  | { type: "toggle-block"; blockId: number };

export interface DcpActionDependencies {
  state: SessionState;
  config: DcpConfig;
  onStateChange: (ctx: ExtensionCommandContext) => void;
}

export interface DcpActionResult {
  permitted: boolean;
  message: string;
}

/**
 * Check current policy, run one guarded action, and invoke the state-change
 * callback exactly once after normal completion. Policy rejection returns
 * before dispatch; an implementation or callback throw propagates untouched.
 */
export function executeDcpAction(
  action: DcpAction,
  ctx: ExtensionCommandContext,
  dependencies: DcpActionDependencies,
): DcpActionResult {
  const { state, config, onStateChange } = dependencies;
  const capabilities = getDcpCapabilities(
    config,
    state,
    ctx.model?.provider ?? state.modelProvider,
    ctx.model?.id ?? state.modelId,
  );
  const disabled = getDcpPipelineDisabledMessage(capabilities);
  if (disabled !== undefined) return { permitted: false, message: disabled };

  const message = dispatchDcpAction(action, state, config);
  onStateChange(ctx);
  return { permitted: true, message };
}

function dispatchDcpAction(action: DcpAction, state: SessionState, config: DcpConfig): string {
  switch (action.type) {
    case "manual":
      return manualCommand(state, action.args);
    case "toggle-manual":
      return manualCommand(state, state.manualMode === "active" ? "off" : "on");
    case "cycle-permission":
      return permissionCommand(state, config.compress.permission);
    case "sweep":
      return sweepCommand(state, config);
    case "decompress":
      return decompressBlock(state, action.args);
    case "recompress":
      return recompressBlock(state, action.args);
    case "toggle-block":
      return toggleBlock(state, action.blockId);
  }
}
