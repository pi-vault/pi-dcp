import { describe, expect, it } from "vitest";
import { getDcpCapabilities } from "../src/capabilities.ts";
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
