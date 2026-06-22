import { describe, it, expect } from "vitest";
import {
  resolveContextTokenLimit,
  isContextOverLimits,
} from "../src/utils/context-limits.ts";
import { createSessionState } from "../src/state/state.ts";
import { makeDefaultConfig } from "./helpers.ts";

describe("resolveContextTokenLimit", () => {
  it("returns absolute number directly", () => {
    expect(resolveContextTokenLimit(200000, 200000)).toBe(200000);
  });

  it("resolves percentage string against context window", () => {
    expect(resolveContextTokenLimit("80%", 200000)).toBe(160000);
  });

  it("returns undefined when percentage string but no context window", () => {
    expect(resolveContextTokenLimit("80%", undefined)).toBeUndefined();
  });

  it("returns number even without context window", () => {
    expect(resolveContextTokenLimit(150000, undefined)).toBe(150000);
  });

  it("returns undefined for undefined input", () => {
    expect(resolveContextTokenLimit(undefined, 200000)).toBeUndefined();
  });
});

describe("isContextOverLimits", () => {
  it("uses maxContextLimit and minContextLimit when set", () => {
    const state = createSessionState();
    state.modelContextWindow = 1000000;
    const config = makeDefaultConfig({
      maxContextLimit: 200000,
      minContextLimit: 100000,
    });

    // tokens = 150000, between min (100K) and max (200K)
    const result = isContextOverLimits(config, state, {
      tokens: 150000,
      contextWindow: 1000000,
      percent: 15,
    });
    expect(result.overMaxLimit).toBe(false);
    expect(result.overMinLimit).toBe(true);
  });

  it("uses per-model overrides when provider/model matches", () => {
    const state = createSessionState();
    state.modelContextWindow = 1000000;
    state.modelId = "gemini-2.5-pro";
    state.modelProvider = "google";
    const config = makeDefaultConfig({
      maxContextLimit: 200000,
      minContextLimit: 100000,
      modelMaxLimits: { "google/gemini-2.5-pro": 400000 },
      modelMinLimits: { "google/gemini-2.5-pro": 200000 },
    });

    // tokens = 250000, between model-specific min (200K) and max (400K)
    const result = isContextOverLimits(config, state, {
      tokens: 250000,
      contextWindow: 1000000,
      percent: 25,
    });
    expect(result.overMaxLimit).toBe(false);
    expect(result.overMinLimit).toBe(true);
  });

  it("falls back to percentage when no absolute limits configured", () => {
    const state = createSessionState();
    state.modelContextWindow = 200000;
    const config = makeDefaultConfig({
      maxContextLimit: undefined,
      minContextLimit: undefined,
      maxContextPercent: 80,
      minContextPercent: 50,
    });

    // tokens = 170000 = 85% of 200K window
    const result = isContextOverLimits(config, state, {
      tokens: 170000,
      contextWindow: 200000,
      percent: 85,
    });
    expect(result.overMaxLimit).toBe(true);
    expect(result.overMinLimit).toBe(true);
  });

  it("uses contextUsage.contextWindow as fallback when state.modelContextWindow is undefined", () => {
    const state = createSessionState();
    // state.modelContextWindow intentionally left undefined
    const config = makeDefaultConfig({
      maxContextLimit: undefined,
      minContextLimit: undefined,
      maxContextPercent: 80,
      minContextPercent: 50,
    });

    // tokens = 170000 = 85% of 200K contextWindow from usage
    const result = isContextOverLimits(config, state, {
      tokens: 170000,
      contextWindow: 200000,
      percent: 85,
    });
    expect(result.overMaxLimit).toBe(true);
    expect(result.overMinLimit).toBe(true);
  });

  it("returns both false when tokens is null", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      maxContextLimit: 200000,
      minContextLimit: 100000,
    });

    const result = isContextOverLimits(config, state, {
      tokens: null,
      contextWindow: 200000,
      percent: null,
    });
    expect(result.overMaxLimit).toBe(false);
    expect(result.overMinLimit).toBe(false);
  });

  it("percentage string limits resolve correctly", () => {
    const state = createSessionState();
    state.modelContextWindow = 200000;
    const config = makeDefaultConfig({
      maxContextLimit: "80%",
      minContextLimit: "50%",
    });

    // tokens = 170000 = 85% → over 80% of 200K (160K)
    const result = isContextOverLimits(config, state, {
      tokens: 170000,
      contextWindow: 200000,
      percent: 85,
    });
    expect(result.overMaxLimit).toBe(true);
    expect(result.overMinLimit).toBe(true);
  });
});
