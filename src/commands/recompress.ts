import type { SessionState } from "../state/types.ts";

export function recompressCommand(state: SessionState, args: string): string {
  const blockIdStr = args.trim();
  if (!blockIdStr) return "Usage: dcp:recompress <blockId>";

  const blockId = Number.parseInt(blockIdStr, 10);
  if (Number.isNaN(blockId)) return `Invalid block ID: ${blockIdStr}`;

  const block = state.prune.messages.blocksById.get(blockId);
  if (!block) return `Block ${blockId} not found.`;
  if (block.active) return `Block ${blockId} is already active.`;
  if (!block.deactivatedByUser) return `Block ${blockId} was not deactivated by user. Cannot reactivate.`;

  block.active = true;
  block.deactivatedByUser = false;
  block.deactivatedAt = undefined;
  state.prune.messages.activeBlockIds.add(blockId);
  state.prune.messages.activeByAnchorIndex.set(block.anchorIndex, blockId);

  return `Block ${blockId} reactivated. Compression will apply on next context pass.`;
}
