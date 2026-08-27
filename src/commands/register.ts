import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SessionState } from "../state/types.ts";
import { isDcpEnabledForModel, type DcpConfig } from "../config.ts";
import { helpCommand } from "./help.ts";
import { contextCommand } from "./context.ts";
import { statsCommand } from "./stats.ts";
import { sweepCommand } from "./sweep.ts";
import { manualCommand } from "./manual.ts";
import { decompressCommand } from "./decompress.ts";
import { recompressCommand } from "./recompress.ts";
import { lifetimeCommand } from "./lifetime.ts";
import { permissionCommand } from "./permission.ts";
import { compressCommand } from "./compress.ts";

export function registerDcpCommands(
  pi: ExtensionAPI,
  state: SessionState,
  config: DcpConfig,
  onStateChange: () => void,
): void {
  const rejectWhenDisabled = (ctx: ExtensionCommandContext): boolean => {
    if (!config.enabled) {
      ctx.ui.notify("DCP is disabled by configuration.", "info");
      return true;
    }
    if (!isDcpEnabledForModel(config, ctx.model?.provider, ctx.model?.id)) {
      ctx.ui.notify("DCP is disabled for the current model.", "info");
      return true;
    }
    return false;
  };

  pi.registerCommand("dcp:compress", {
    description: "Trigger manual compression, optionally focused on a topic",
    handler: async (args, ctx) => {
      if (rejectWhenDisabled(ctx)) return;
      ctx.ui.notify(compressCommand(pi, state, config, args), "info");
    },
  });

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
      const modelDisabled =
        config.enabled && !isDcpEnabledForModel(config, ctx.model?.provider, ctx.model?.id);
      ctx.ui.notify(contextCommand(state, usage ?? undefined, modelDisabled), "info");
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
      if (rejectWhenDisabled(ctx)) return;
      const message = sweepCommand(state, config);
      onStateChange();
      ctx.ui.notify(message, "info");
    },
  });

  pi.registerCommand("dcp:manual", {
    description: "Toggle manual compression mode",
    handler: async (args, ctx) => {
      if (rejectWhenDisabled(ctx)) return;
      const message = manualCommand(state, args);
      onStateChange();
      ctx.ui.notify(message, "info");
    },
  });

  pi.registerCommand("dcp:decompress", {
    description: "Deactivate a compression block",
    handler: async (args, ctx) => {
      if (rejectWhenDisabled(ctx)) return;
      const message = decompressCommand(state, args);
      onStateChange();
      ctx.ui.notify(message, "info");
    },
  });

  pi.registerCommand("dcp:recompress", {
    description: "Reactivate a deactivated compression block",
    handler: async (args, ctx) => {
      if (rejectWhenDisabled(ctx)) return;
      const message = recompressCommand(state, args);
      onStateChange();
      ctx.ui.notify(message, "info");
    },
  });

  pi.registerCommand("dcp:lifetime", {
    description: "Show aggregate statistics across all sessions",
    handler: async (_args, ctx) => {
      const parentDir = path.resolve(ctx.sessionManager.getSessionDir(), "..");
      ctx.ui.notify(await lifetimeCommand(parentDir), "info");
    },
  });

  pi.registerCommand("dcp:permission", {
    description: "Toggle compress permission (allow/deny)",
    handler: async (_args, ctx) => {
      if (rejectWhenDisabled(ctx)) return;
      const message = permissionCommand(state);
      onStateChange();
      ctx.ui.notify(message, "info");
    },
  });
}
