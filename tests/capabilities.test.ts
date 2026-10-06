import { describe, expect, it } from "vitest";
import { getDcpCapabilities, getDcpPipelineDisabledMessage } from "../src/capabilities.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";

const provider = "anthropic";
const modelId = "claude-sonnet";

describe("getDcpCapabilities", () => {
  it("enables pipeline and compression by default", () => {
    expect(
      getDcpCapabilities(makeDefaultConfig(), createSessionState(), provider, modelId),
    ).toEqual({
      pipelineEnabled: true,
      compressionEnabled: true,
      reasons: [],
    });
  });

  it("reports global configuration suppression", () => {
    const config = { ...makeDefaultConfig(), enabled: false };
    expect(getDcpCapabilities(config, createSessionState(), provider, modelId)).toEqual({
      pipelineEnabled: false,
      compressionEnabled: false,
      reasons: ["config"],
    });
  });

  it("reports model suppression", () => {
    const config = { ...makeDefaultConfig(), disabledModels: [`${provider}/${modelId}`] };
    expect(getDcpCapabilities(config, createSessionState(), provider, modelId)).toEqual({
      pipelineEnabled: false,
      compressionEnabled: false,
      reasons: ["model"],
    });
  });

  it("reports sub-agent suppression", () => {
    const state = createSessionState();
    state.isSubAgent = true;
    expect(getDcpCapabilities(makeDefaultConfig(), state, provider, modelId)).toEqual({
      pipelineEnabled: false,
      compressionEnabled: false,
      reasons: ["subagent"],
    });
  });

  it("reports permission suppression while keeping the pipeline enabled", () => {
    const state = createSessionState();
    state.compressPermission = "deny";
    expect(getDcpCapabilities(makeDefaultConfig(), state, provider, modelId)).toEqual({
      pipelineEnabled: true,
      compressionEnabled: false,
      reasons: ["permission"],
    });
  });

  it("keeps compression enabled for the ask permission", () => {
    const state = createSessionState();
    state.compressPermission = "ask";
    expect(getDcpCapabilities(makeDefaultConfig(), state, provider, modelId)).toEqual({
      pipelineEnabled: true,
      compressionEnabled: true,
      reasons: [],
    });
  });

  it("treats a configured ask default as enabled when the session has no override", () => {
    const config = makeDefaultConfig({ permission: "ask" });
    expect(getDcpCapabilities(config, createSessionState(), provider, modelId)).toEqual({
      pipelineEnabled: true,
      compressionEnabled: true,
      reasons: [],
    });
  });

  it("lets the session permission override the configuration default", () => {
    const config = makeDefaultConfig({ permission: "deny" });
    const state = createSessionState();
    state.compressPermission = "allow";
    expect(getDcpCapabilities(config, state, provider, modelId)).toEqual({
      pipelineEnabled: true,
      compressionEnabled: true,
      reasons: [],
    });
  });

  it("allows sub-agents when explicitly configured", () => {
    const state = createSessionState();
    state.isSubAgent = true;
    const base = makeDefaultConfig();
    const config = { ...base, experimental: { ...base.experimental, allowSubAgents: true } };
    expect(getDcpCapabilities(config, state, provider, modelId).reasons).toEqual([]);
  });

  it("reports every applicable reason in deterministic order", () => {
    const base = makeDefaultConfig({ permission: "deny" });
    const config = {
      ...base,
      enabled: false,
      disabledModels: [`${provider}/${modelId}`],
    };
    const state = createSessionState();
    state.isSubAgent = true;
    state.compressPermission = "deny";

    expect(getDcpCapabilities(config, state, provider, modelId)).toEqual({
      pipelineEnabled: false,
      compressionEnabled: false,
      reasons: ["config", "model", "subagent", "permission"],
    });
  });

  it("does not mask the model reason behind global disablement", () => {
    const config = {
      ...makeDefaultConfig(),
      enabled: false,
      disabledModels: [`${provider}/${modelId}`],
    };
    expect(getDcpCapabilities(config, createSessionState(), provider, modelId).reasons).toEqual([
      "config",
      "model",
    ]);
  });

  it("treats missing model identity as enabled", () => {
    expect(
      getDcpCapabilities(makeDefaultConfig(), createSessionState(), undefined, undefined),
    ).toEqual({
      pipelineEnabled: true,
      compressionEnabled: true,
      reasons: [],
    });
  });
});

describe("getDcpPipelineDisabledMessage", () => {
  it("returns undefined for an eligible pipeline", () => {
    const state = createSessionState();
    state.compressPermission = "deny";
    const caps = getDcpCapabilities(makeDefaultConfig(), state, provider, modelId);
    expect(getDcpPipelineDisabledMessage(caps)).toBeUndefined();
  });

  it.each([
    {
      name: "config",
      build: () => ({
        config: { ...makeDefaultConfig(), enabled: false },
        state: createSessionState(),
      }),
      message: "DCP is disabled by configuration.",
    },
    {
      name: "subagent",
      build: () => {
        const state = createSessionState();
        state.isSubAgent = true;
        return { config: makeDefaultConfig(), state };
      },
      message: "DCP is disabled in sub-agent sessions.",
    },
    {
      name: "model",
      build: () => ({
        config: { ...makeDefaultConfig(), disabledModels: [`${provider}/${modelId}`] },
        state: createSessionState(),
      }),
      message: "DCP is disabled for the current model.",
    },
  ])("returns the $name suppression message", ({ build, message }) => {
    const { config, state } = build();
    expect(
      getDcpPipelineDisabledMessage(getDcpCapabilities(config, state, provider, modelId)),
    ).toBe(message);
  });

  it("keeps the config reason ahead of model suppression", () => {
    const config = {
      ...makeDefaultConfig(),
      enabled: false,
      disabledModels: [`${provider}/${modelId}`],
    };
    const caps = getDcpCapabilities(config, createSessionState(), provider, modelId);
    expect(getDcpPipelineDisabledMessage(caps)).toBe("DCP is disabled by configuration.");
  });

  it("keeps the sub-agent reason ahead of model suppression", () => {
    const config = { ...makeDefaultConfig(), disabledModels: [`${provider}/${modelId}`] };
    const state = createSessionState();
    state.isSubAgent = true;
    const caps = getDcpCapabilities(config, state, provider, modelId);
    expect(getDcpPipelineDisabledMessage(caps)).toBe("DCP is disabled in sub-agent sessions.");
  });
});
