import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getDcpCapabilities } from "../capabilities.ts";
import { type DcpConfig, isDcpEnabledForModel } from "../config.ts";
import type { SessionState } from "../state/types.ts";
import { compressCommand } from "./compress.ts";
import { contextCommand } from "./context.ts";
import { decompressCommand } from "./decompress.ts";
import { helpCommand } from "./help.ts";
import { lifetimeCommand } from "./lifetime.ts";
import { manualCommand } from "./manual.ts";
import { permissionCommand } from "./permission.ts";
import { recompressCommand } from "./recompress.ts";
import { statsCommand } from "./stats.ts";
import { sweepCommand } from "./sweep.ts";

export function registerDcpCommands(
  pi: ExtensionAPI,
  state: SessionState,
  config: DcpConfig,
  onStateChange: (ctx: ExtensionCommandContext) => void,
): void {
  const capabilities = (ctx: ExtensionCommandContext) =>
    getDcpCapabilities(
      config,
      state,
      ctx.model?.provider ?? state.modelProvider,
      ctx.model?.id ?? state.modelId,
    );

  const rejectWhenDisabled = (ctx: ExtensionCommandContext): boolean => {
    const { pipelineEnabled, reasons } = capabilities(ctx);
    if (pipelineEnabled) return false;
    if (reasons.includes("config")) {
      ctx.ui.notify("DCP is disabled by configuration.", "info");
    } else if (reasons.includes("subagent")) {
      ctx.ui.notify("DCP is disabled in sub-agent sessions.", "info");
    } else {
      ctx.ui.notify("DCP is disabled for the current model.", "info");
    }
    return true;
  };

  pi.registerCommand("dcp:compress", {
    description: "Trigger manual compression, optionally focused on a topic",
    handler: async (args, ctx) => {
      if (rejectWhenDisabled(ctx)) return;
      const { compressionEnabled } = capabilities(ctx);
      if (!compressionEnabled) {
        ctx.ui.notify("Compression is denied by configuration.", "info");
        return;
      }
      if (!pi.getActiveTools().includes("compress")) {
        ctx.ui.notify("Compression is unavailable while the compress tool is inactive.", "info");
        return;
      }
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
      onStateChange(ctx);
      ctx.ui.notify(message, "info");
    },
  });

  pi.registerCommand("dcp:manual", {
    description: "Toggle manual compression mode",
    handler: async (args, ctx) => {
      if (rejectWhenDisabled(ctx)) return;
      const message = manualCommand(state, args);
      onStateChange(ctx);
      ctx.ui.notify(message, "info");
    },
  });

  pi.registerCommand("dcp:decompress", {
    description: "Deactivate a compression block",
    handler: async (args, ctx) => {
      if (rejectWhenDisabled(ctx)) return;
      const message = decompressCommand(state, args);
      onStateChange(ctx);
      ctx.ui.notify(message, "info");
    },
  });

  pi.registerCommand("dcp:recompress", {
    description: "Reactivate a deactivated compression block",
    handler: async (args, ctx) => {
      if (rejectWhenDisabled(ctx)) return;
      const message = recompressCommand(state, args);
      onStateChange(ctx);
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
    description: "Cycle compress permission (allow/ask/deny)",
    handler: async (_args, ctx) => {
      if (rejectWhenDisabled(ctx)) return;
      const message = permissionCommand(state, config.compress.permission);
      onStateChange(ctx);
      ctx.ui.notify(message, "info");
    },
  });
}
