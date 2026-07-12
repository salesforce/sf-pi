/* SPDX-License-Identifier: Apache-2.0 */
import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THINKING_LEVEL, DEFAULT_MODEL_ID, PROVIDER_NAME } from "../lib/config.ts";
import { resolveGatewayDefaultModelWithPi } from "../lib/model-resolution.ts";

function model(id: string): Model<any> {
  return {
    id,
    provider: PROVIDER_NAME,
    api: "openai-completions",
    name: id,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  } as Model<any>;
}

function registry(models: Model<any>[]) {
  return {
    getAll: vi.fn(() => models),
    hasConfiguredAuth: vi.fn(() => true),
    find: vi.fn((provider: string, id: string) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === id),
    ),
  };
}

describe("resolveGatewayDefaultModelWithPi", () => {
  it("uses Pi's resolver for the first registered preferred gateway model", () => {
    const opus48 = model("claude-opus-4-8");
    const reg = registry([opus48, model("claude-opus-4-7")]);

    const resolved = resolveGatewayDefaultModelWithPi({
      modelRegistry: reg as never,
      providerName: PROVIDER_NAME,
      availableModelIds: ["claude-opus-4-8", "claude-opus-4-7"],
      preferredModelIds: ["claude-opus-4-8", "claude-opus-4-7"],
      fallbackModelId: DEFAULT_MODEL_ID,
      defaultThinkingLevel: DEFAULT_THINKING_LEVEL,
    });

    expect(resolved).toMatchObject({
      source: "pi",
      provider: PROVIDER_NAME,
      modelId: "claude-opus-4-8",
      model: opus48,
      thinkingLevel: DEFAULT_THINKING_LEVEL,
    });
  });

  it("uses Pi's resolver against the canonical available alias", () => {
    const opus47 = model("claude-opus-4-7");
    const reg = registry([opus47]);

    const resolved = resolveGatewayDefaultModelWithPi({
      modelRegistry: reg as never,
      providerName: PROVIDER_NAME,
      availableModelIds: ["claude-opus-4-7"],
      preferredModelIds: ["claude-opus-4-7-v1"],
      fallbackModelId: DEFAULT_MODEL_ID,
      defaultThinkingLevel: DEFAULT_THINKING_LEVEL,
    });

    expect(resolved.source).toBe("pi");
    expect(resolved.modelId).toBe("claude-opus-4-7");
    expect(resolved.model).toBe(opus47);
  });

  it("does not accept Pi's custom fallback model when the gateway model is not registered", () => {
    const reg = registry([model("claude-opus-4-7")]);

    const resolved = resolveGatewayDefaultModelWithPi({
      modelRegistry: reg as never,
      providerName: PROVIDER_NAME,
      availableModelIds: ["claude-opus-4-8", "claude-opus-4-7"],
      preferredModelIds: ["claude-opus-4-8"],
      fallbackModelId: DEFAULT_MODEL_ID,
      defaultThinkingLevel: DEFAULT_THINKING_LEVEL,
    });

    expect(resolved.source).toBe("fallback");
    expect(resolved.modelId).toBe("claude-opus-4-8");
    expect(resolved.model).toBeUndefined();
  });

  it("falls back to the configured default id when no gateway ids are available", () => {
    const reg = registry([]);

    const resolved = resolveGatewayDefaultModelWithPi({
      modelRegistry: reg as never,
      providerName: PROVIDER_NAME,
      availableModelIds: [],
      preferredModelIds: ["missing-model"],
      fallbackModelId: DEFAULT_MODEL_ID,
      defaultThinkingLevel: DEFAULT_THINKING_LEVEL,
    });

    expect(resolved).toMatchObject({
      source: "fallback",
      provider: PROVIDER_NAME,
      modelId: DEFAULT_MODEL_ID,
      thinkingLevel: DEFAULT_THINKING_LEVEL,
    });
  });
});
