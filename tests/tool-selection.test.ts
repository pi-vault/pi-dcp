import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import type { DcpConfig } from "../src/config.ts";
import { createSessionState } from "../src/state/state.ts";
import {
  createCompressionToolSelection,
  type CompressionToolSelection,
} from "../src/tool-selection.ts";
import {
  createExtensionHarness,
  declaredLoadoutMessage,
  type ExtensionHarnessOptions,
} from "./extension-harness.ts";
import { makeDefaultConfig } from "./helpers.ts";

type Harness = ReturnType<typeof createExtensionHarness>;

/** Register the inert `compress` tool the way production does: inactive by default. */
function registerCompressTool(harness: Harness): void {
  harness.api.registerTool({
    name: "compress",
    label: "Compress",
    description: "test compress",
    defaultActive: false,
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text" as const, text: "" }], details: {} };
    },
  });
}

interface SetupOptions {
  activeTools?: string[];
  compress?: Partial<DcpConfig["compress"]>;
  config?: Partial<DcpConfig>;
  model?: { provider: string; id: string };
  branch?: unknown[];
  harness?: Partial<ExtensionHarnessOptions>;
  registerCompress?: boolean;
}

function setup(options: SetupOptions = {}) {
  const {
    activeTools,
    compress,
    config: configOverrides,
    branch,
    model,
    harness,
    ...rest
  } = options;
  const created = createExtensionHarness({
    activeTools: activeTools ?? ["read"],
    branch,
    model,
    ...harness,
    ...rest,
  });
  if (options.registerCompress !== false) registerCompressTool(created);
  const state = createSessionState();
  const config = makeDefaultConfig(compress);
  if (configOverrides) Object.assign(config, configOverrides);
  const selection = createCompressionToolSelection(created.api, state, config);
  return { harness: created, state, config, selection };
}

type RestoreHook = "branchRestored" | "sessionStartedResume";

function runRestoreHook(selection: CompressionToolSelection, harness: Harness, hook: RestoreHook) {
  if (hook === "branchRestored") selection.branchRestored(harness.context);
  else selection.sessionStarted("resume", harness.context);
}

describe("compression tool selection owner", () => {
  describe("fresh session selection", () => {
    it.each(["startup", "new", "resume", "fork"] as const)(
      "selects compress on the first non-reload start for reason %s without a declaration",
      (reason) => {
        const { harness, selection } = setup({ activeTools: ["read"] });
        const setActiveTools = vi.spyOn(harness.api, "setActiveTools");

        selection.sessionStarted(reason, harness.context);

        expect(harness.activeTools()).toEqual(["read", "compress"]);
        expect(setActiveTools).toHaveBeenCalledTimes(1);
      },
    );

    it("does not write when compress is already active on the first start", () => {
      const { harness, selection } = setup({ activeTools: ["read", "compress"] });
      const setActiveTools = vi.spyOn(harness.api, "setActiveTools");

      selection.sessionStarted("new", harness.context);

      expect(harness.activeTools()).toEqual(["read", "compress"]);
      expect(setActiveTools).toHaveBeenCalledTimes(0);
    });
  });

  describe("later session starts", () => {
    it("never repeats implicit selection after the first start", () => {
      const { harness, selection } = setup({ activeTools: ["read"] });
      selection.sessionStarted("new", harness.context);
      expect(harness.activeTools()).toEqual(["read", "compress"]);

      harness.setActiveTools(["read"]);
      const setActiveTools = vi.spyOn(harness.api, "setActiveTools");
      for (const reason of ["startup", "new", "resume", "fork", "reload"] as const) {
        selection.sessionStarted(reason, harness.context);
        expect(harness.activeTools()).toEqual(["read"]);
      }
      expect(setActiveTools).toHaveBeenCalledTimes(0);
    });

    it("consumes the one-time opportunity when the first start is a reload", () => {
      const { harness, selection } = setup({ activeTools: ["read"] });

      selection.sessionStarted("reload", harness.context);
      expect(harness.activeTools()).toEqual(["read"]);

      selection.sessionStarted("new", harness.context);
      expect(harness.activeTools()).toEqual(["read"]);
    });
  });

  describe("loadout declarations and reload", () => {
    it("does not implicitly activate on reload even without a declaration", () => {
      const { harness, selection } = setup({ activeTools: ["read"] });

      selection.sessionStarted("reload", harness.context);

      expect(harness.activeTools()).toEqual(["read"]);
    });

    it.each([
      {
        name: "system sections",
        message: { role: "system", content: "", sections: {}, timestamp: 1 },
      },
      {
        name: "empty toolsAdded",
        message: { role: "system", content: "", toolsAdded: [], timestamp: 1 },
      },
      {
        name: "empty toolsRemoved",
        message: { role: "system", content: "", toolsRemoved: [], timestamp: 1 },
      },
    ])("honors a $name declaration", ({ message }) => {
      const { harness, selection } = setup({
        activeTools: ["read"],
        branch: [{ type: "message", message }],
      });

      selection.sessionStarted("new", harness.context);

      expect(harness.activeTools()).toEqual(["read"]);
    });

    it("honors the declared loadout fixture", () => {
      const { harness, selection } = setup({
        activeTools: ["read"],
        branch: [{ type: "message", message: declaredLoadoutMessage(["read"]) }],
      });

      selection.sessionStarted("new", harness.context);

      expect(harness.activeTools()).toEqual(["read"]);
    });

    it("treats plain system text as no declaration and still activates", () => {
      const { harness, selection } = setup({
        activeTools: ["read"],
        branch: [{ type: "message", message: { role: "system", content: "plain", timestamp: 1 } }],
      });

      selection.sessionStarted("new", harness.context);

      expect(harness.activeTools()).toEqual(["read", "compress"]);
    });

    it("ignores non-message branch entries", () => {
      const { harness, selection } = setup({
        activeTools: ["read"],
        branch: [{ type: "custom", customType: "pi-dcp-state", data: {} }],
      });

      selection.sessionStarted("new", harness.context);

      expect(harness.activeTools()).toEqual(["read", "compress"]);
    });
  });

  describe("host exclusions and registration", () => {
    it.each([
      { name: "allowlist", harness: { allowedTools: ["read"] } },
      { name: "denylist", harness: { excludedTools: ["compress"] } },
      { name: "noTools all", harness: { noTools: "all" as const } },
    ])(
      "makes no write when the host excludes compress via $name",
      ({ harness: harnessOptions }) => {
        const { harness, selection } = setup({ activeTools: ["read"], harness: harnessOptions });
        expect(harness.api.getAllTools().some((tool) => tool.name === "compress")).toBe(false);
        const setActiveTools = vi.spyOn(harness.api, "setActiveTools");

        selection.sessionStarted("new", harness.context);

        expect(harness.activeTools()).toEqual(["read"]);
        expect(setActiveTools).toHaveBeenCalledTimes(0);
      },
    );

    it("makes no write when compress is not registered", () => {
      const { harness, selection } = setup({ activeTools: ["read"], registerCompress: false });
      const setActiveTools = vi.spyOn(harness.api, "setActiveTools");

      selection.sessionStarted("new", harness.context);

      expect(harness.activeTools()).toEqual(["read"]);
      expect(setActiveTools).toHaveBeenCalledTimes(0);
    });
  });

  describe("suppression memory", () => {
    it.each([
      { name: "permission first", clearPermissionFirst: true },
      { name: "model first", clearPermissionFirst: false },
    ])(
      "remembers the initial selection across overlapping suppression reasons ($name)",
      ({ clearPermissionFirst }) => {
        const { harness, state, config, selection } = setup({
          activeTools: ["read", "bash", "compress"],
        });
        const setActiveTools = vi.spyOn(harness.api, "setActiveTools");

        expect(harness.activeTools()).toEqual(["read", "bash", "compress"]);
        state.compressPermission = "deny";
        state.modelProvider = "test";
        state.modelId = "blocked";
        config.disabledModels = ["test/blocked"];

        selection.reconcile();
        expect(harness.activeTools()).toEqual(["read", "bash"]);
        expect(setActiveTools).toHaveBeenCalledTimes(1);

        selection.reconcile();
        expect(setActiveTools).toHaveBeenCalledTimes(1);

        if (clearPermissionFirst) {
          state.compressPermission = "allow";
          selection.reconcile();
          expect(harness.activeTools()).toEqual(["read", "bash"]);
          expect(setActiveTools).toHaveBeenCalledTimes(1);

          config.disabledModels = [];
          selection.reconcile();
        } else {
          config.disabledModels = [];
          selection.reconcile();
          expect(harness.activeTools()).toEqual(["read", "bash"]);
          expect(setActiveTools).toHaveBeenCalledTimes(1);

          state.compressPermission = "allow";
          selection.reconcile();
        }
        expect(harness.activeTools()).toEqual(["read", "bash", "compress"]);
        expect(setActiveTools).toHaveBeenCalledTimes(2);

        selection.reconcile();
        expect(setActiveTools).toHaveBeenCalledTimes(2);
      },
    );

    it("remembers an implicit selection through initial denial", () => {
      const { harness, state, selection } = setup({ activeTools: ["read"] });
      state.compressPermission = "deny";
      const setActiveTools = vi.spyOn(harness.api, "setActiveTools");

      selection.sessionStarted("new", harness.context);
      expect(harness.activeTools()).toEqual(["read"]);
      expect(setActiveTools).toHaveBeenCalledTimes(2);

      state.compressPermission = "allow";
      selection.reconcile();
      expect(harness.activeTools()).toEqual(["read", "compress"]);
      expect(setActiveTools).toHaveBeenCalledTimes(3);
    });

    it("preserves deselection through suppression and allowance under a declared loadout", () => {
      const { harness, state, selection } = setup({
        activeTools: ["read"],
        branch: [{ type: "message", message: declaredLoadoutMessage(["read"]) }],
      });
      const setActiveTools = vi.spyOn(harness.api, "setActiveTools");

      selection.sessionStarted("new", harness.context);
      expect(harness.activeTools()).toEqual(["read"]);

      state.compressPermission = "deny";
      selection.reconcile();
      expect(harness.activeTools()).toEqual(["read"]);

      state.compressPermission = "allow";
      selection.reconcile();
      expect(harness.activeTools()).toEqual(["read"]);
      expect(setActiveTools).toHaveBeenCalledTimes(0);
    });

    it("does not reactivate a host-deselected tool after the old memory is cleared", () => {
      const { harness, state, selection } = setup({ activeTools: ["read", "compress"] });
      selection.sessionStarted("new", harness.context);

      state.compressPermission = "deny";
      selection.reconcile();
      expect(harness.activeTools()).toEqual(["read"]);

      state.compressPermission = "allow";
      selection.reconcile();
      expect(harness.activeTools()).toEqual(["read", "compress"]);

      harness.setActiveTools(["read"]);
      const setActiveTools = vi.spyOn(harness.api, "setActiveTools");
      selection.reconcile();
      expect(harness.activeTools()).toEqual(["read"]);
      expect(setActiveTools).toHaveBeenCalledTimes(0);
    });
  });

  describe("session starts and tree navigation clear branch memory", () => {
    it.each<RestoreHook>(["branchRestored", "sessionStartedResume"])(
      "%s does not repeat fresh activation for a restored inactive selection",
      (hook) => {
        const { harness, state, selection } = setup({ activeTools: ["read", "compress"] });
        selection.sessionStarted("new", harness.context);

        state.compressPermission = "deny";
        selection.reconcile();
        expect(harness.activeTools()).toEqual(["read"]);

        harness.setBranch([]);
        harness.setActiveTools(["read"]);
        const setActiveTools = vi.spyOn(harness.api, "setActiveTools");

        runRestoreHook(selection, harness, hook);
        expect(harness.activeTools()).toEqual(["read"]);
        expect(setActiveTools).toHaveBeenCalledTimes(0);

        state.compressPermission = "allow";
        selection.reconcile();
        expect(harness.activeTools()).toEqual(["read"]);
        expect(setActiveTools).toHaveBeenCalledTimes(0);
      },
    );

    it.each<RestoreHook>(["branchRestored", "sessionStartedResume"])(
      "%s suppresses then restores the new branch's active selection",
      (hook) => {
        const { harness, state, selection } = setup({ activeTools: ["read", "compress"] });
        selection.sessionStarted("new", harness.context);

        state.compressPermission = "deny";
        selection.reconcile();
        expect(harness.activeTools()).toEqual(["read"]);

        harness.setBranch([
          { type: "message", message: declaredLoadoutMessage(["read", "compress"]) },
        ]);
        harness.setActiveTools(["read", "compress"]);
        const setActiveTools = vi.spyOn(harness.api, "setActiveTools");

        runRestoreHook(selection, harness, hook);
        expect(harness.activeTools()).toEqual(["read"]);
        expect(setActiveTools).toHaveBeenCalledTimes(1);

        state.compressPermission = "allow";
        selection.reconcile();
        expect(harness.activeTools()).toEqual(["read", "compress"]);
        expect(setActiveTools).toHaveBeenCalledTimes(2);
      },
    );
  });

  describe("live config reads", () => {
    it("reads replaced nested config after construction", () => {
      const { harness, state, config, selection } = setup({ activeTools: ["read", "compress"] });
      selection.sessionStarted("new", harness.context);
      expect(state.compressPermission).toBeUndefined();

      const setActiveTools = vi.spyOn(harness.api, "setActiveTools");
      config.compress = { ...config.compress, permission: "deny" };
      selection.reconcile();
      expect(harness.activeTools()).toEqual(["read"]);
      expect(setActiveTools).toHaveBeenCalledTimes(1);

      config.compress = { ...config.compress, permission: "allow" };
      selection.reconcile();
      expect(harness.activeTools()).toEqual(["read", "compress"]);
      expect(setActiveTools).toHaveBeenCalledTimes(2);
    });

    it("gives an explicit session permission precedence over configured denial", () => {
      const { harness, state, config, selection } = setup({ activeTools: ["read", "compress"] });
      config.compress = { ...config.compress, permission: "deny" };
      state.compressPermission = "allow";
      const setActiveTools = vi.spyOn(harness.api, "setActiveTools");

      selection.reconcile();

      expect(harness.activeTools()).toEqual(["read", "compress"]);
      expect(setActiveTools).toHaveBeenCalledTimes(0);
    });

    it("reads current global and subagent policy on every transition", () => {
      const { harness, state, config, selection } = setup({
        activeTools: ["read", "bash", "compress"],
      });
      selection.sessionStarted("new", harness.context);
      const setActiveTools = vi.spyOn(harness.api, "setActiveTools");

      config.enabled = false;
      selection.reconcile();
      expect(harness.activeTools()).toEqual(["read", "bash"]);

      config.enabled = true;
      selection.reconcile();
      expect(harness.activeTools()).toEqual(["read", "bash", "compress"]);

      state.isSubAgent = true;
      config.experimental = { ...config.experimental, allowSubAgents: false };
      selection.reconcile();
      expect(harness.activeTools()).toEqual(["read", "bash"]);

      config.experimental = { ...config.experimental, allowSubAgents: true };
      selection.reconcile();
      expect(harness.activeTools()).toEqual(["read", "bash", "compress"]);

      expect(setActiveTools.mock.calls).toEqual([
        [["read", "bash"]],
        [["read", "bash", "compress"]],
        [["read", "bash"]],
        [["read", "bash", "compress"]],
      ]);
    });
  });

  describe("model identity", () => {
    it("refreshes identity without reconciling tools", () => {
      const { harness, state, config, selection } = setup({
        activeTools: ["read", "compress"],
      });
      config.disabledModels = ["test/blocked"];
      selection.sessionStarted("new", harness.context);
      const setActiveTools = vi.spyOn(harness.api, "setActiveTools");

      selection.refreshModel({ provider: "test", id: "blocked" });
      expect(state.modelProvider).toBe("test");
      expect(state.modelId).toBe("blocked");
      expect(harness.activeTools()).toEqual(["read", "compress"]);
      expect(setActiveTools).toHaveBeenCalledTimes(0);

      selection.reconcile();
      expect(harness.activeTools()).toEqual(["read"]);
      expect(setActiveTools).toHaveBeenCalledTimes(1);

      selection.reconcile({ model: harness.model });
      expect(state.modelProvider).toBe("test");
      expect(state.modelId).toBe("test-model");
      expect(harness.activeTools()).toEqual(["read", "compress"]);
      expect(setActiveTools).toHaveBeenCalledTimes(2);
    });

    it("retains identity when the model is unavailable", () => {
      const { harness, state, config, selection } = setup({
        activeTools: ["read", "compress"],
      });
      config.disabledModels = ["test/blocked"];
      state.modelProvider = "test";
      state.modelId = "blocked";

      selection.refreshModel(undefined);
      selection.reconcile({ model: undefined });

      expect(state.modelProvider).toBe("test");
      expect(state.modelId).toBe("blocked");
      expect(harness.activeTools()).toEqual(["read"]);
    });
  });
});
