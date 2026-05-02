/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for model identification, inference, and catalog building.
 *
 * Covers: getModelFamily, isAnthropicModelId, inferModelDefinition,
 * bootstrap/discovered catalog building, preferred-model resolution,
 * and toProviderModelConfig.
 */
import { describe, expect, it } from "vitest";
import {
  buildBootstrapModelList,
  buildDiscoveredModelList,
  getModelFamily,
  inferModelDefinition,
  isAnthropicModelId,
  resolvePreferredModelId,
  toProviderModelConfig,
} from "../lib/models.ts";

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
  it("includes the default, previous default, and fallback model IDs", () => {
    const models = buildBootstrapModelList(null, new Set());
    const ids = models.map((model) => model.id);
    expect(ids).toContain("claude-opus-4-7");
    expect(ids).toContain("claude-opus-4-6-v1");
    expect(ids).toContain("claude-sonnet-4-6");
  });

  it("puts the default model first", () => {
    const models = buildBootstrapModelList(null, new Set());
    expect(models[0]?.id).toBe("claude-opus-4-7");
  });

  // Regression: before live discovery lands, the bootstrap must contain at
  // least one non-Claude model so the `sf-llm-gateway-internal/*` wildcard
  // in Pi's enabledModels resolves to something non-empty and does not emit
  // `Warning: No models match pattern "sf-llm-gateway-internal/*"`.
  it("includes at least one OpenAI-compat model so both provider wildcards resolve at startup", () => {
    const models = buildBootstrapModelList(null, new Set());
    const openAiCompat = models.filter((model) => model.api !== "anthropic-messages");
    const anthropic = models.filter((model) => model.api === "anthropic-messages");
    expect(openAiCompat.length).toBeGreaterThan(0);
    expect(anthropic.length).toBeGreaterThan(0);
  });
});

describe("buildDiscoveredModelList", () => {
  it("keeps only the model IDs returned by the gateway", () => {
    const models = buildDiscoveredModelList(["gemini-2.5-pro", "gpt-5"], null, new Set());
    const ids = models.map((model) => model.id);
    expect(ids).toEqual(["gemini-2.5-pro", "gpt-5"]);
    expect(ids).not.toContain("claude-opus-4-7");
    expect(ids).not.toContain("claude-opus-4-7-v1");
  });

  it("deduplicates discovered IDs", () => {
    const models = buildDiscoveredModelList(
      ["claude-opus-4-7", "claude-opus-4-7", "claude-sonnet-4-6"],
      null,
      new Set(),
    );
    expect(models.filter((model) => model.id === "claude-opus-4-7")).toHaveLength(1);
  });

  it("keeps the fallback model ahead of later discovered families when both are returned", () => {
    const models = buildDiscoveredModelList(
      ["gemini-2.5-pro", "gpt-5", "claude-sonnet-4-6"],
      null,
      new Set(),
    );
    const ids = models.map((model) => model.id);
    expect(ids.indexOf("claude-sonnet-4-6")).toBeLessThan(ids.indexOf("gemini-2.5-pro"));
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
    const config = toProviderModelConfig("claude-opus-4-6-v1", null, new Set());
    expect(config.id).toBe("claude-opus-4-6-v1");
    expect(config.reasoning).toBe(true);
    expect(config.contextWindow).toBe(1_000_000);
    expect(config.maxTokens).toBe(128_000);
    expect(config.cost.input).toBe(0);
  });

  it("returns 1M context / 64K max for Opus 4.7 with the context-1m beta header", () => {
    // Opus 4.7 runs on the 1M-context path; we surface contextWindow=1M and
    // keep `anthropic-beta: context-1m-2025-08-07` in headers so the request
    // is on the documented large-context route. maxTokens is 64K because live
    // repros showed 128K + effort=max intermittently surfaces
    // `api_error: Internal server error` from upstream; the model hard
    // ceiling is 128K and callers can raise per request.
    //
    // The anthropic-beta header also carries fine-grained-tool-streaming
    // because pi-ai's Object.assign-based header merge would otherwise
    // replace pi-ai's default value with ours. See the note in
    // toProviderModelConfig().
    const config = toProviderModelConfig("claude-opus-4-7", null, new Set());
    expect(config.id).toBe("claude-opus-4-7");
    expect(config.reasoning).toBe(true);
    expect(config.contextWindow).toBe(1_000_000);
    expect(config.maxTokens).toBe(64_000);
    const beta = config.headers?.["anthropic-beta"] ?? "";
    expect(beta.split(",")).toContain("context-1m-2025-08-07");
    expect(beta.split(",")).toContain("fine-grained-tool-streaming-2025-05-14");
  });

  it("uses the same preset for unknown Opus 4.7 model IDs via inference", () => {
    const config = toProviderModelConfig("claude-opus-4-7-preview", null, new Set());
    expect(config.contextWindow).toBe(1_000_000);
    expect(config.maxTokens).toBe(64_000);
    const beta = config.headers?.["anthropic-beta"] ?? "";
    expect(beta.split(",")).toContain("context-1m-2025-08-07");
    expect(beta.split(",")).toContain("fine-grained-tool-streaming-2025-05-14");
  });

  it("sends the full beta stack for Opus 4.6 and context-1m + fine-grained-tool-streaming for Opus 4.7", () => {
    const opus46 = toProviderModelConfig("claude-opus-4-6-v1", null, new Set());
    const opus47 = toProviderModelConfig("claude-opus-4-7", null, new Set());
    expect(opus46.headers?.["anthropic-beta"]).toContain("context-1m-2025-08-07");
    expect(opus46.headers?.["anthropic-beta"]).toContain("interleaved-thinking-2025-05-14");
    expect(opus46.headers?.["anthropic-beta"]).toContain("fine-grained-tool-streaming-2025-05-14");
    const opus47Betas = (opus47.headers?.["anthropic-beta"] ?? "").split(",");
    expect(opus47Betas).toContain("context-1m-2025-08-07");
    expect(opus47Betas).toContain("fine-grained-tool-streaming-2025-05-14");
  });

  it("always merges fine-grained-tool-streaming into the anthropic-beta list (workaround for pi-ai Object.assign header replace)", () => {
    // pi-ai sets anthropic-beta to fine-grained-tool-streaming by default and
    // then merges model.headers on top with Object.assign. Object.assign
    // replaces the whole anthropic-beta value instead of comma-merging — so
    // any custom value here silently drops pi-ai's default. We work around
    // that by always including fine-grained-tool-streaming in our header,
    // with deduplication so it never appears twice.
    for (const id of [
      "claude-opus-4-7",
      "claude-opus-4-6-v1",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001", // non-reasoning, typically empty beta list
    ]) {
      const beta = toProviderModelConfig(id, null, new Set()).headers?.["anthropic-beta"] ?? "";
      const parts = beta.split(",").filter(Boolean);
      expect(parts).toContain("fine-grained-tool-streaming-2025-05-14");
      // No duplicates.
      expect(new Set(parts).size).toBe(parts.length);
    }
  });

  it("returns a valid config for a generic Gemini model", () => {
    const config = toProviderModelConfig("gemini-2.5-pro", null, new Set());
    expect(config.id).toBe("gemini-2.5-pro");
    expect(config.reasoning).toBe(true);
    expect(config.input).toEqual(["text", "image"]);
    expect((config.compat as any)?.maxTokensField).toBe("max_tokens");
  });

  it("tags Claude models with the native anthropic-messages API", () => {
    const config = toProviderModelConfig("claude-opus-4-6-v1", null, new Set());
    expect(config.api).toBe("anthropic-messages");
    // Claude runs on pi-ai's native Anthropic transport, which does not take
    // an OpenAI `compat` block. Leaving compat undefined also prevents a stale
    // shim from ever reshaping Claude payloads into OpenAI-compat form.
    expect(config.compat).toBeUndefined();
  });

  it("tags non-Claude models with openai-completions", () => {
    expect(toProviderModelConfig("gemini-2.5-pro", null, new Set()).api).toBe("openai-completions");
    expect(toProviderModelConfig("gpt-5", null, new Set()).api).toBe("openai-completions");
    expect(toProviderModelConfig("gpt-5.3-codex", null, new Set()).api).toBe("openai-completions");
  });

  it("uses the updated GPT-5 272K/128K preset", () => {
    const gpt5 = toProviderModelConfig("gpt-5", null, new Set());
    expect(gpt5.contextWindow).toBe(272_000);
    expect(gpt5.maxTokens).toBe(128_000);
    const gpt5Mini = toProviderModelConfig("gpt-5-mini", null, new Set());
    expect(gpt5Mini.contextWindow).toBe(272_000);
    expect(gpt5Mini.maxTokens).toBe(128_000);
  });

  it("uses the updated Codex 272K/128K preset", () => {
    const codex = toProviderModelConfig("gpt-5.3-codex", null, new Set());
    expect(codex.contextWindow).toBe(272_000);
    expect(codex.maxTokens).toBe(128_000);
  });

  it("preserves the preset when /v1/model/info reports a lower context window", () => {
    // LiteLLM's metadata reports max_input_tokens=200000 for Opus 4.7 even
    // though the upstream serves 1M with the context-1m beta header. The
    // preset must win so pi-ai does not silently treat 4.7 as a 200K model.
    const cfg = toProviderModelConfig("claude-opus-4-7", null, new Set(), {
      id: "claude-opus-4-7",
      maxInputTokens: 200_000,
      maxOutputTokens: 64_000,
      supportsVision: true,
    });
    expect(cfg.contextWindow).toBe(1_000_000);
    expect(cfg.maxTokens).toBe(64_000);
  });

  it("applies /v1/model/info to non-preset discovered models", () => {
    const cfg = toProviderModelConfig("unknown-new-model-v42", null, new Set(), {
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
    const config = toProviderModelConfig("gpt-5.3-codex", null, new Set());
    expect((config.compat as any)?.supportsReasoningEffort).toBe(true);
    // Migrated from compat.reasoningEffortMap to model-level
    // thinkingLevelMap in pi >= 0.72 (pi-mono #3208).
    expect((config as any).thinkingLevelMap?.minimal).toBe("low");
    expect((config as any).thinkingLevelMap?.xhigh).toBe("high");
    expect((config as any).thinkingLevelMap?.high).toBe("high");
  });

  it("opts Opus 4.7 into the pi xhigh thinking level via thinkingLevelMap", () => {
    // pi 0.72 hides `xhigh` from the /thinking selector unless the model's
    // thinkingLevelMap.xhigh is explicitly set. Opus 4.7 supports xhigh as a
    // real Anthropic effort tier, and DEFAULT_THINKING_LEVEL = "xhigh"
    // silently clamps down to `high` without this opt-in. Regression test
    // pins the opt-in for every Opus 4.7 preset id.
    for (const id of [
      "claude-opus-4-7",
      "claude-opus-4-7-v1",
      "claude-opus-4-7-20250416",
      "us.anthropic.claude-opus-4-7-v1",
    ]) {
      const config = toProviderModelConfig(id, null, new Set());
      expect((config as any).thinkingLevelMap?.xhigh, `${id} should opt into xhigh`).toBe("xhigh");
    }
  });

  it("does not leak the Opus 4.7 xhigh opt-in to Opus 4.6", () => {
    // Opus 4.6 uses pi-ai's default effort mapping (high/medium/low). It has
    // no `xhigh` effort tier in the extension's transport.ts, so we
    // deliberately leave thinkingLevelMap unset — adding xhigh here without
    // a live probe would silently route 4.6 traffic to an unmapped tier.
    const config = toProviderModelConfig("claude-opus-4-6-v1", null, new Set());
    expect((config as any).thinkingLevelMap).toBeUndefined();
  });

  it("does not enable reasoning effort for non-reasoning providers like Gemini or OpenAI", () => {
    const gemini = toProviderModelConfig("gemini-2.5-pro", null, new Set());
    const openai = toProviderModelConfig("gpt-4o", null, new Set());
    expect((gemini.compat as any)?.supportsReasoningEffort).toBe(false);
    expect((openai.compat as any)?.supportsReasoningEffort).toBe(false);
  });

  it("adds Anthropic beta headers only for Anthropic models", () => {
    const anthropic = toProviderModelConfig("claude-opus-4-6-v1", null, new Set());
    const gemini = toProviderModelConfig(
      "gemini-2.5-pro",
      null,
      new Set(["prompt-caching-2024-07-31"]),
    );

    expect(anthropic.headers?.["anthropic-beta"]).toBeDefined();
    expect(gemini.headers).toBeUndefined();
  });

  it("can inject extra Anthropic betas on top of defaults", () => {
    const config = toProviderModelConfig(
      "claude-sonnet-4-6",
      null,
      new Set(["prompt-caching-2024-07-31"]),
    );

    expect(config.headers?.["anthropic-beta"]).toContain("interleaved-thinking-2025-05-14");
    expect(config.headers?.["anthropic-beta"]).toContain("prompt-caching-2024-07-31");
  });
});
