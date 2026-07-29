import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DcpConfig } from "../config.ts";
import type { SessionState } from "../state/types.ts";

const TRIGGER =
  "Run the compress tool now on stale, completed context. Preserve details needed for active work.";

export function compressCommand(
  pi: ExtensionAPI,
  state: SessionState,
  config: DcpConfig,
  args: string,
): string {
  if (!config.enabled) return "DCP is disabled by configuration.";
  if ((state.compressPermission ?? config.compress.permission) === "deny") {
    return "Compression is denied by configuration.";
  }
  const focus = args.trim();
  pi.sendMessage(
    {
      customType: "dcp-compress-trigger",
      content: focus ? `${TRIGGER} Focus especially on: ${focus}` : TRIGGER,
      display: false,
    },
    { triggerTurn: true, deliverAs: "followUp" },
  );
  return "Compression triggered.";
}
