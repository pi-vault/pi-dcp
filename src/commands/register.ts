import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SessionState } from "../state/types.ts";
import type { DcpConfig } from "../config.ts";
import { helpCommand } from "./help.ts";
import { contextCommand } from "./context.ts";
import { statsCommand } from "./stats.ts";
import { sweepCommand } from "./sweep.ts";
import { manualCommand } from "./manual.ts";
import { decompressCommand } from "./decompress.ts";
import { recompressCommand } from "./recompress.ts";
import { lifetimeCommand } from "./lifetime.ts";
import { permissionCommand } from "./permission.ts";

export function registerDcpCommands(
  pi: ExtensionAPI,
  state: SessionState,
  config: DcpConfig,
): void {
  pi.registerCommand("dcp:help", {
    description: "Show DCP command help",
    handler: async (_args, ctx) => {
      ctx.ui.notify(helpCommand(), "info");
    },
  });

  pi.registerCommand("dcp:context", {
    description: "Show context usage breakdown",
    handler: async (_args, ctx) => {
      const usage = ctx.getContextUsage();
      ctx.ui.notify(
        contextCommand(state, usage ?? undefined),
        "info",
      );
    },
  });

  pi.registerCommand("dcp:stats", {
    description: "Show compression statistics",
    handler: async (_args, ctx) => {
      ctx.ui.notify(statsCommand(state), "info");
    },
  });

  pi.registerCommand("dcp:sweep", {
    description: "Force-prune all eligible tool outputs",
    handler: async (_args, ctx) => {
      ctx.ui.notify(sweepCommand(state, config), "info");
    },
  });

  pi.registerCommand("dcp:manual", {
    description: "Toggle manual compression mode",
    handler: async (args, ctx) => {
      ctx.ui.notify(manualCommand(state, args), "info");
    },
  });

  pi.registerCommand("dcp:decompress", {
    description: "Deactivate a compression block",
    handler: async (args, ctx) => {
      ctx.ui.notify(decompressCommand(state, args), "info");
    },
  });

  pi.registerCommand("dcp:recompress", {
    description: "Reactivate a deactivated compression block",
    handler: async (args, ctx) => {
      ctx.ui.notify(recompressCommand(state, args), "info");
    },
  });

  pi.registerCommand("dcp:lifetime", {
    description: "Show aggregate statistics across all sessions",
    handler: async (_args, ctx) => {
      const parentDir = path.resolve(ctx.sessionManager.getSessionDir(), "..");
      ctx.ui.notify(lifetimeCommand(parentDir), "info");
    },
  });

  pi.registerCommand("dcp:permission", {
    description: "Toggle compress permission (allow/deny)",
    handler: async (_args, ctx) => {
      ctx.ui.notify(permissionCommand(state), "info");
    },
  });
}
