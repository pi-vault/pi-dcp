import type { SessionState } from "../state/types.ts";
import { getEligibleCompressionBlockIds, rebuildCompressionState } from "../compress/state.ts";

export function decompressCommand(state: SessionState, args: string): string {
  const blockIdStr = args.trim();
  if (!blockIdStr) return "Usage: dcp:decompress <blockId>";

  const blockId = Number.parseInt(blockIdStr, 10);
  if (Number.isNaN(blockId)) return `Invalid block ID: ${blockIdStr}`;

  const block = state.prune.messages.blocksById.get(blockId);
  if (!block) return `Block ${blockId} not found.`;
  if (!block.active) return `Block ${blockId} is already inactive.`;

  const eligibleBlockIds = getEligibleCompressionBlockIds(state);
  block.active = false;
  block.deactivatedByUser = true;
  block.deactivatedAt = Date.now();
  rebuildCompressionState(state, eligibleBlockIds);

  return `Block ${blockId} deactivated. Original messages will be restored on next context pass.`;
}
