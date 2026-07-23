/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for model identification, inference, and catalog building.
 *
 * Covers: getModelFamily, isAnthropicModelId, inferModelDefinition,
 * bootstrap/discovered catalog building, preferred-model resolution,
 * and toProviderModelConfig.
 */
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  buildBootstrapModelList,
  buildDiscoveredModelList,
  getModelFamily,
  inferModelDefinition,
  isAnthropicModelId,
  isHaiku45ModelId,
  resolvePreferredModelId,
  shouldForceAdaptiveThinking,
  toProviderModelConfig,
} from "../lib/models.ts";

type GatewayCompat = NonNullable<ProviderModelConfig["compat"]> & {
  maxTokensField?: string;
  supportsReasoningEffort?: boolean;
};

function gatewayCompat(config: {
  compat?: ProviderModelConfig["compat"];
}): GatewayCompat | undefined {
  return config.compat as GatewayCompat | undefined;
}

function asPiModel(id: string): Model<Api> {
  return {
    ...toProviderModelConfig(id),
    provider: "sf-llm-gateway-internal",
  } as Model<Api>;
}

// -------------------------------------------------------------------------------------------------
// Family detection
// -------------------------------------------------------------------------------------------------

describe("getModelFamily", () => {
  it("detects Anthropic/Claude IDs", () => {
    expect(getModelFamily("claude-opus-4-6-v1")).toBe("anthropic");
    expect(getModelFamily("us.anthropic.claude-opus-4-6-v1")).toBe("anthropic");
  });

  it("detects Gemini IDs", () => {
    expect(getModelFamily("gemini-2.5-pro")).toBe("google");
  });

  it("detects GPT IDs", () => {
    expect(getModelFamily("gpt-5")).toBe("openai");
  });

  it("detects Codex IDs before generic GPT detection", () => {
    expect(getModelFamily("gpt-5.3-codex")).toBe("codex");
  });

  it("detects DeepSeek IDs returned by OpenAI-compatible gateways", () => {
    expect(getModelFamily("deepseek-r1")).toBe("deepseek");
    expect(getModelFamily("accounts/fireworks/models/deepseek-v3")).toBe("deepseek");
  });

  it("falls back to unknown for unmatched IDs", () => {
    expect(getModelFamily("llama-3.3-70b")).toBe("unknown");
  });
});

// -------------------------------------------------------------------------------------------------
// isAnthropicModelId
// -------------------------------------------------------------------------------------------------

describe("isAnthropicModelId", () => {
  it("matches 'claude' in any position", () => {
    expect(isAnthropicModelId("claude-opus-4-6-v1")).toBe(true);
    expect(isAnthropicModelId("my-claude-model")).toBe(true);
  });

  it("matches explicit Anthropic prefixes", () => {
    expect(isAnthropicModelId("us.anthropic.claude-opus-4-6-v1")).toBe(true);
    expect(isAnthropicModelId("anthropic.claude-3")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isAnthropicModelId("CLAUDE-OPUS-4")).toBe(true);
    expect(isAnthropicModelId("US.ANTHROPIC.MODEL")).toBe(true);
  });

  it("rejects non-Anthropic models", () => {
    expect(isAnthropicModelId("gpt-4o")).toBe(false);
    expect(isAnthropicModelId("gemini-pro")).toBe(false);
    expect(isAnthropicModelId("llama-3")).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------
// inferModelDefinition
// -------------------------------------------------------------------------------------------------

describe("inferModelDefinition", () => {
  it("infers Anthropic 1M context for Opus 4.6", () => {
    const def = inferModelDefinition("claude-opus-4-6-custom");
    expect(def.family).toBe("anthropic");
    expect(def.contextWindow).toBe(1_000_000);
    expect(def.maxTokens).toBe(128_000);
    expect(def.reasoning).toBe(true);
  });

  it("infers Gemini defaults", () => {
    const def = inferModelDefinition("gemini-2.5-pro");
    expect(def.family).toBe("google");
    expect(def.contextWindow).toBe(1_000_000);
    expect(def.maxTokens).toBe(65_536);
    expect(def.input).toEqual(["text", "image"]);
  });

  it("infers GPT defaults", () => {
    const def = inferModelDefinition("gpt-4o");
    expect(def.family).toBe("openai");
    expect(def.contextWindow).toBe(128_000);
    expect(def.maxTokens).toBe(16_384);
    expect(def.reasoning).toBe(false);
  });

  it("infers Codex defaults", () => {
    const def = inferModelDefinition("gpt-5.3-codex");
    expect(def.family).toBe("codex");
    expect(def.input).toEqual(["text"]);
    // Gateway /v1/model/info confirms GPT-5 family codex runs at 272K/128K.
    expect(def.contextWindow).toBe(272_000);
    expect(def.maxTokens).toBe(128_000);
    expect(def.reasoning).toBe(true);
  });

  it("infers DeepSeek defaults", () => {
    const def = inferModelDefinition("deepseek-r1");
    expect(def.family).toBe("deepseek");
    expect(def.input).toEqual(["text"]);
    expect(def.contextWindow).toBe(128_000);
    expect(def.reasoning).toBe(true);
  });

  it("falls back to generic defaults for unknown model families", () => {
    const def = inferModelDefinition("llama-3.3-70b");
    expect(def.family).toBe("unknown");
    expect(def.contextWindow).toBe(200_000);
    expect(def.maxTokens).toBe(16_384);
    expect(def.reasoning).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------
// bootstrap/discovered catalog building
// -------------------------------------------------------------------------------------------------

describe("buildBootstrapModelList", () => {
  it("includes the default, previous default, fallback, and curated static model IDs", () => {
    const models = buildBootstrapModelList();
    const ids = models.map((model) => model.id);
    expect(ids).toContain("gpt-5.6-sol");
    expect(ids).toContain("claude-opus-4-8");
    expect(ids).toContain("claude-opus-4-7");
    expect(ids).toContain("claude-sonnet-5");
    expect(ids).toContain("gpt-5.5");
  });

  it("puts the default model first", () => {
    const models = buildBootstrapModelList();
    expect(models[0]?.id).toBe("gpt-5.6-sol");
  });

  // Regression: before live discovery lands, the bootstrap must contain at
  // least one non-Claude model so the `sf-llm-gateway-internal/*` wildcard
  // in Pi's enabledModels resolves to something non-empty and does not emit
  // `Warning: No models match pattern "sf-llm-gateway-internal/*"`.
  it("includes at least one OpenAI-compat model so both provider wildcards resolve at startup", () => {
    const models = buildBootstrapModelList();
    const openAiCompat = models.filter((model) => model.api !== "anthropic-messages");
    const anthropic = models.filter((model) => model.api === "anthropic-messages");
    expect(openAiCompat.length).toBeGreaterThan(0);
    expect(anthropic.length).toBeGreaterThan(0);
  });
});

describe("buildDiscoveredModelList", () => {
  it("keeps only the model IDs returned by the gateway", () => {
    const models = buildDiscoveredModelList(["gemini-2.5-pro", "gpt-5"]);
    const ids = models.map((model) => model.id);
    expect(ids).toEqual(["gemini-2.5-pro", "gpt-5"]);
    expect(ids).not.toContain("claude-opus-4-7");
    expect(ids).not.toContain("claude-opus-4-7-v1");
  });

  it("deduplicates discovered IDs", () => {
    const models = buildDiscoveredModelList([
      "claude-opus-4-7",
      "claude-opus-4-7",
      "claude-sonnet-4-6",
    ]);
    expect(models.filter((model) => model.id === "claude-opus-4-7")).toHaveLength(1);
  });

  it("keeps the fallback model ahead of later discovered families when both are returned", () => {
    const models = buildDiscoveredModelList(["gemini-2.5-pro", "gpt-5", "claude-sonnet-5"]);
    const ids = models.map((model) => model.id);
    expect(ids.indexOf("claude-sonnet-5")).toBeLessThan(ids.indexOf("gemini-2.5-pro"));
  });
});

// -------------------------------------------------------------------------------------------------
// preferred model resolution
// -------------------------------------------------------------------------------------------------

describe("resolvePreferredModelId", () => {
  it("returns an exact match when available", () => {
    expect(resolvePreferredModelId(["claude-opus-4-7", "gpt-5"], ["gpt-5"])).toBe("gpt-5");
  });

  it("maps the stale Opus 4.7 v1 alias to the current gateway model ID", () => {
    expect(resolvePreferredModelId(["claude-opus-4-7", "gpt-5"], ["claude-opus-4-7-v1"])).toBe(
      "claude-opus-4-7",
    );
  });

  it("prefers the default family fallback sequence when the first choice is unavailable", () => {
    expect(
      resolvePreferredModelId(
        ["claude-opus-4-6-v1", "claude-sonnet-4-6", "gpt-5"],
        ["claude-opus-4-7", "claude-opus-4-6-v1", "claude-sonnet-4-6"],
      ),
    ).toBe("claude-opus-4-6-v1");
  });
});

// -------------------------------------------------------------------------------------------------
// toProviderModelConfig
// -------------------------------------------------------------------------------------------------

describe("toProviderModelConfig", () => {
  it("returns a valid config for a known preset model", () => {
    const config = toProviderModelConfig("claude-opus-4-6-v1");
    expect(config.id).toBe("claude-opus-4-6-v1");
    expect(config.reasoning).toBe(true);
    expect(config.contextWindow).toBe(1_000_000);
    expect(config.maxTokens).toBe(128_000);
    expect(config.cost.input).toBe(0);
  });

  it("returns 1M context / 64K max for Opus 4.7 without Gateway-owned beta headers", () => {
    // Opus 4.7 now advertises 1M input natively through the gateway, and live
    // probes confirm >200K-token requests work without Gateway-owned beta headers. maxTokens is
    // 128K confirmed stable via live probes (May 2026).
    const config = toProviderModelConfig("claude-opus-4-7");
    expect(config.id).toBe("claude-opus-4-7");
    expect(config.reasoning).toBe(true);
    expect(config.contextWindow).toBe(1_000_000);
    expect(config.maxTokens).toBe(128_000);
    expect(config.headers).toBeUndefined();
  });

  it("uses the same no-beta-header preset for unknown Opus 4.7 model IDs via inference", () => {
    const config = toProviderModelConfig("claude-opus-4-7-preview");
    expect(config.contextWindow).toBe(1_000_000);
    expect(config.maxTokens).toBe(128_000);
    expect(config.headers).toBeUndefined();
  });

  it("does not attach Gateway-owned Anthropic beta headers to model configs", () => {
    for (const id of ["claude-opus-4-6-v1", "claude-opus-4-7", "claude-sonnet-5"]) {
      expect(toProviderModelConfig(id).headers).toBeUndefined();
    }
  });

  it("returns a valid config for a generic Gemini model", () => {
    const config = toProviderModelConfig("gemini-2.5-pro");
    expect(config.id).toBe("gemini-2.5-pro");
    expect(config.reasoning).toBe(true);
    expect(config.input).toEqual(["text", "image"]);
    expect(gatewayCompat(config)?.maxTokensField).toBe("max_tokens");
  });

  it("tags Claude models with the native anthropic-messages API", () => {
    // Claude runs on pi-ai's native Anthropic transport. Adaptive Claude ids
    // use compat.forceAdaptiveThinking so pi-ai owns the generic adaptive
    // payload shape; Haiku 4.5 has a separate eager-streaming override below.
    for (const id of [
      "claude-opus-4-6-v1",
      "claude-opus-4-7-v1",
      "claude-sonnet-4-6",
      "claude-sonnet-5",
    ]) {
      const config = toProviderModelConfig(id);
      expect(config.api).toBe("anthropic-messages");
      expect(config.compat).toMatchObject({ forceAdaptiveThinking: true });
    }
  });

  it("disables per-tool eager_input_streaming for Haiku 4.5 (gateway issue #166)", () => {
    // Haiku 4.5 rejects per-tool `eager_input_streaming`. Setting
    // `supportsEagerToolInputStreaming: false` makes pi-ai's Anthropic
    // transport drop the field and switch to pi-ai's legacy tool-streaming
    // compatibility path for tool-enabled requests. Opus / Sonnet keep the
    // default fast path.
    for (const id of [
      "claude-haiku-4-5-20251001",
      "claude-haiku-4-5",
      "claude-haiku-4.5",
      "anthropic.claude-haiku-4.5",
      "us.anthropic.claude-haiku-4-5-v1",
    ]) {
      const config = toProviderModelConfig(id);
      expect(config.api).toBe("anthropic-messages");
      expect(
        (config.compat as { supportsEagerToolInputStreaming?: boolean } | undefined)
          ?.supportsEagerToolInputStreaming,
      ).toBe(false);
    }
  });

  it("does not set the eager-streaming override on Opus/Sonnet", () => {
    for (const id of ["claude-opus-4-7-20250416", "claude-sonnet-4-6", "claude-opus-4-6-v1"]) {
      const config = toProviderModelConfig(id);
      expect(
        (config.compat as { supportsEagerToolInputStreaming?: boolean } | undefined)
          ?.supportsEagerToolInputStreaming,
      ).toBeUndefined();
    }
  });

  describe("isHaiku45ModelId", () => {
    it("matches dash and dot spellings, dated and bedrock-prefixed ids", () => {
      expect(isHaiku45ModelId("claude-haiku-4-5")).toBe(true);
      expect(isHaiku45ModelId("claude-haiku-4.5")).toBe(true);
      expect(isHaiku45ModelId("claude-haiku-4-5-20251001")).toBe(true);
      expect(isHaiku45ModelId("anthropic.claude-haiku-4.5")).toBe(true);
      expect(isHaiku45ModelId("us.anthropic.claude-haiku-4-5-v1")).toBe(true);
    });

    it("does not match Opus / Sonnet / older Haiku", () => {
      expect(isHaiku45ModelId("claude-opus-4-7")).toBe(false);
      expect(isHaiku45ModelId("claude-opus-4-6-v1")).toBe(false);
      expect(isHaiku45ModelId("claude-sonnet-4-6")).toBe(false);
      expect(isHaiku45ModelId("claude-3-5-haiku-20241022")).toBe(false);
      expect(isHaiku45ModelId("gpt-5")).toBe(false);
    });
  });

  describe("shouldForceAdaptiveThinking", () => {
    it("matches adaptive Claude gateway models", () => {
      for (const id of [
        "claude-opus-4-7",
        "claude-opus-4.7",
        "claude-opus-4-6-v1",
        "claude-sonnet-4-6",
        "claude-sonnet-5",
      ]) {
        expect(shouldForceAdaptiveThinking(id)).toBe(true);
      }
    });

    it("does not match older Claude or non-Claude models", () => {
      for (const id of ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5", "gpt-5.5"]) {
        expect(shouldForceAdaptiveThinking(id)).toBe(false);
      }
    });
  });

  it("tags non-Claude, non-gpt-5-family models with openai-completions", () => {
    expect(toProviderModelConfig("gemini-2.5-pro").api).toBe("openai-completions");
    expect(toProviderModelConfig("gpt-4o").api).toBe("openai-completions");
    expect(toProviderModelConfig("gpt-5.3-codex").api).toBe("openai-completions");
  });

  it("routes gpt-5 and gpt-5-mini through openai-responses with the native clamp", () => {
    // gpt-5 / gpt-5-mini support `minimal | low | medium | high` on the
    // Responses path but reject `xhigh` upstream. Map passes `minimal`
    // through (unlike gpt-5.5, which rejects it) and clamps `xhigh → high`.
    for (const id of ["gpt-5", "gpt-5-mini"]) {
      const cfg = toProviderModelConfig(id);
      expect(cfg.api).toBe("openai-responses");
      expect(cfg.thinkingLevelMap).toEqual({
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "high",
      });
    }
  });

  it("uses the updated GPT-5 272K/128K preset", () => {
    const gpt5 = toProviderModelConfig("gpt-5");
    expect(gpt5.contextWindow).toBe(272_000);
    expect(gpt5.maxTokens).toBe(128_000);
    const gpt5Mini = toProviderModelConfig("gpt-5-mini");
    expect(gpt5Mini.contextWindow).toBe(272_000);
    expect(gpt5Mini.maxTokens).toBe(128_000);
  });

  it("uses GPT-5.6 Sol as the max-capable gateway default preset", () => {
    const cfg = toProviderModelConfig("gpt-5.6-sol");
    expect(cfg.contextWindow).toBe(1_000_000);
    expect(cfg.maxTokens).toBe(128_000);
    expect(cfg.reasoning).toBe(true);
    expect(cfg.api).toBe("openai-responses");
    expect(cfg.thinkingLevelMap).toEqual({
      minimal: "low",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    });
  });

  it("uses GPT-5.6 Bedrock presets with Bedrock-safe thinking and 272K context", () => {
    const cfg = toProviderModelConfig("gpt-5.6-sol-bedrock");
    expect(cfg.contextWindow).toBe(272_000);
    expect(cfg.maxTokens).toBe(128_000);
    expect(cfg.reasoning).toBe(true);
    expect(cfg.api).toBe("openai-responses");
    expect(cfg.thinkingLevelMap).toEqual({
      minimal: "medium",
      low: "medium",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    });
  });

  it("routes gpt-5.5 through the OpenAI Responses API with the clamped thinking map", () => {
    // Gateway /v1/model/info reports 1,050,000 / 128,000 for gpt-5.5. The
    // preset rounds the context window to 1M so the selector math is clean.
    // Phase 3: the model is tagged `openai-responses` internally so the
    // dispatcher in lib/discovery.ts routes it through `POST /responses`.
    // `thinkingLevelMap` clamps pi's thinking scale to the {low, medium,
    // high} window — the only values that both LiteLLM's Pydantic validator
    // and upstream OpenAI accept on the Responses path for this model.
    const cfg = toProviderModelConfig("gpt-5.5");
    expect(cfg.contextWindow).toBe(1_000_000);
    expect(cfg.maxTokens).toBe(128_000);
    expect(cfg.reasoning).toBe(true);
    expect(cfg.api).toBe("openai-responses");
    expect(cfg.thinkingLevelMap).toEqual({
      minimal: "low",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "xhigh",
    });
  });

  it("keeps gateway-specific gpt-5.5 context larger than Codex while Codex stays capped", () => {
    const gpt55 = toProviderModelConfig("gpt-5.5");
    const codex = toProviderModelConfig("gpt-5.3-codex");

    expect(gpt55.contextWindow).toBe(1_000_000);
    expect(gpt55.maxTokens).toBe(128_000);
    expect(codex.contextWindow).toBe(272_000);
    expect(codex.maxTokens).toBe(128_000);
  });

  it("uses the updated Codex 272K/128K preset", () => {
    const codex = toProviderModelConfig("gpt-5.3-codex");
    expect(codex.contextWindow).toBe(272_000);
    expect(codex.maxTokens).toBe(128_000);
  });

  it("preserves the preset when /v1/model/info reports a lower context window", () => {
    // Some LiteLLM metadata snapshots reported max_input_tokens=200000 for
    // Opus 4.7 even though the current gateway serves 1M natively. The
    // preset must win so pi-ai does not silently treat 4.7 as a 200K model.
    const cfg = toProviderModelConfig("claude-opus-4-7", {
      id: "claude-opus-4-7",
      maxInputTokens: 200_000,
      maxOutputTokens: 64_000,
      supportsVision: true,
    });
    expect(cfg.contextWindow).toBe(1_000_000);
    expect(cfg.maxTokens).toBe(128_000);
    expect(cfg.compat).toMatchObject({ forceAdaptiveThinking: true });
  });

  it("applies /v1/model/info to non-preset discovered models", () => {
    const cfg = toProviderModelConfig("unknown-new-model-v42", {
      id: "unknown-new-model-v42",
      maxInputTokens: 500_000,
      maxOutputTokens: 40_000,
      supportsReasoning: true,
      supportsVision: false,
    });
    expect(cfg.contextWindow).toBe(500_000);
    expect(cfg.maxTokens).toBe(40_000);
    expect(cfg.reasoning).toBe(true);
    expect(cfg.input).toEqual(["text"]);
  });

  it("enables Codex reasoning effort with gateway-safe clamping", () => {
    const config = toProviderModelConfig("gpt-5.3-codex");
    expect(gatewayCompat(config)?.supportsReasoningEffort).toBe(true);
    // Migrated from compat.reasoningEffortMap to model-level
    // thinkingLevelMap in pi >= 0.72 (pi-mono #3208).
    expect(config.thinkingLevelMap?.minimal).toBe("low");
    expect(config.thinkingLevelMap?.xhigh).toBe("max");
    expect(config.thinkingLevelMap?.high).toBe("high");
    expect(config.thinkingLevelMap?.max).toBe("max");
  });

  it("exposes max through Pi's real capability API only for proven model families", () => {
    for (const id of [
      "claude-opus-4-8",
      "claude-sonnet-5",
      "gpt-5.3-codex",
      "gpt-5.5",
      "gpt-5.6-sol",
      "gpt-5.6-sol-bedrock",
    ]) {
      expect(getSupportedThinkingLevels(asPiModel(id)), `${id} should expose max`).toContain("max");
    }

    for (const id of ["gpt-5", "gpt-5-mini"]) {
      const levels = getSupportedThinkingLevels(asPiModel(id));
      expect(levels, `${id} should retain xhigh compatibility`).toContain("xhigh");
      expect(levels, `${id} should not expose max`).not.toContain("max");
    }

    expect(getSupportedThinkingLevels(asPiModel("gpt-4o"))).toEqual(["off"]);
  });

  it("opts live-proven max-capable gateway models into max via thinkingLevelMap", () => {
    // Live probes on 2026-07-12 verified these gateway routes accept max.
    // Pi hides advanced thinking levels from the /thinking selector unless
    // the model's thinkingLevelMap explicitly opts into them, so both Pi's
    // `xhigh` and `max` selectors map to each model's native max tier.
    for (const id of [
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-7-v1",
      "claude-opus-4-7-20250416",
      "us.anthropic.claude-opus-4-7-v1",
      "claude-opus-4-6-v1",
      "claude-sonnet-4-6",
      "claude-sonnet-5",
      "gpt-5.3-codex",
    ]) {
      const config = toProviderModelConfig(id);
      expect(config.thinkingLevelMap?.xhigh, `${id} should opt into xhigh→max`).toBe("max");
      expect(config.thinkingLevelMap?.max, `${id} should opt into max→max`).toBe("max");
      if (id.includes("codex")) {
        expect(gatewayCompat(config)?.supportsReasoningEffort).toBe(true);
      } else {
        expect(config.compat, `${id} should use Pi-native adaptive thinking`).toMatchObject({
          forceAdaptiveThinking: true,
        });
      }
    }
  });

  it("does not expose max on gateway models whose ceiling is high", () => {
    for (const id of ["gpt-5", "gpt-5-mini"]) {
      const config = toProviderModelConfig(id);
      expect(config.thinkingLevelMap?.max, `${id} should not expose max`).toBeUndefined();
    }
  });

  it("uses Pi-native adaptive thinking for Opus 4.6 with live-proven max support", () => {
    const config = toProviderModelConfig("claude-opus-4-6-v1");
    expect(config.thinkingLevelMap).toMatchObject({ xhigh: "max", max: "max" });
    expect(config.compat).toMatchObject({ forceAdaptiveThinking: true });
  });

  it("does not enable reasoning effort for non-reasoning providers like Gemini or OpenAI", () => {
    const gemini = toProviderModelConfig("gemini-2.5-pro");
    const openai = toProviderModelConfig("gpt-4o");
    expect(gatewayCompat(gemini)?.supportsReasoningEffort).toBe(false);
    expect(gatewayCompat(openai)?.supportsReasoningEffort).toBe(false);
  });
});
