/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for SF LLM Gateway request-shaping.
 *
 * Many assertions here correspond one-to-one with gateway behavior observed
 * via `POST /utils/transform_request` against the live internal gateway:
 *
 *   Observation                                             | Test
 *   --------------------------------------------------------|------------------------------
 *   GPT-5 + reasoning_effort without allow-list returns 400 | "allow-lists reasoning_effort on GPT-5"
 *   Codex without reasoning_effort returns 400              | "defaults missing values to high"
 *   Codex with nested tool shape returns 400                | "flattens Chat Completions..."
 *   Codex with minimal/xhigh is normalized                  | "clamps minimal and maps advanced levels"
 *   Opus 4.7 accepts adaptive + effort + max_tokens          | live transport regression tests
 *   Opus 4.7 rejects max_tokens > 128000                     | "OPUS_47_MODEL_MAX_TOKENS is exactly 128000"
 *   Opus 4.7 + max_tokens:128000 + effort:max intermittently | default max_tokens lowered to OPUS_47_DEFAULT_MAX_TOKENS
 *     triggers upstream api_error: Internal server error     |
 *   Anthropic adaptive-thinking payload shape                | pi-ai `compat.forceAdaptiveThinking`
 */
import { describe, expect, it } from "vitest";
import {
  GATEWAY_PROVIDER_DEFAULT_MAX_RETRIES,
  OPUS_47_DEFAULT_MAX_TOKENS,
  OPUS_47_MODEL_MAX_TOKENS,
  allowReasoningEffortParam,
  applyOpus47MaxThinking,
  formatAnthropicStreamError,
  injectCodexGatewayParams,
  injectOpenAiReasoningEffort,
  injectOpenAiServiceTier,
  isCodexModelId,
  isGpt55ModelId,
  isOpenAiModelId,
  isOpenAiReasoningModelId,
  isOpus47ModelId,
  normalizeCodexReasoningEffort,
  resolveGatewayProviderMaxRetries,
  resolveOpenAiReasoningEffort,
  resolveOpus47MaxTokensFloor,
  stripReasoningEffortForGpt55,
  withGatewayProviderRetryDefaults,
} from "../lib/transport.ts";

describe("Gateway provider retry defaults", () => {
  it("defaults to 3 retries when Pi has no retry.provider.maxRetries setting", () => {
    expect(GATEWAY_PROVIDER_DEFAULT_MAX_RETRIES).toBe(3);
    expect(resolveGatewayProviderMaxRetries(undefined)).toBe(3);
    expect(withGatewayProviderRetryDefaults(undefined).maxRetries).toBe(3);
  });

  it("honors explicit Pi provider retry overrides, including 0 to disable", () => {
    expect(resolveGatewayProviderMaxRetries(0)).toBe(0);
    expect(resolveGatewayProviderMaxRetries(5)).toBe(5);
    expect(withGatewayProviderRetryDefaults({ maxRetries: 0 }).maxRetries).toBe(0);
    expect(withGatewayProviderRetryDefaults({ maxRetries: 5 }).maxRetries).toBe(5);
  });

  it("normalizes invalid direct option values back to the Gateway default", () => {
    expect(resolveGatewayProviderMaxRetries(Number.NaN)).toBe(3);
    expect(resolveGatewayProviderMaxRetries(Number.POSITIVE_INFINITY)).toBe(3);
  });
});

describe("formatAnthropicStreamError", () => {
  it("renders Anthropic SSE error envelopes without dumping raw JSON", () => {
    const raw = JSON.stringify({
      type: "error",
      error: { details: null, type: "api_error", message: "Internal server error" },
      request_id: "req_123",
    });

    expect(formatAnthropicStreamError(raw)).toBe(
      "Anthropic api_error: Internal server error (request_id: req_123)",
    );
  });

  it("leaves non-Anthropic error strings unchanged", () => {
    expect(formatAnthropicStreamError("fetch failed")).toBe("fetch failed");
  });

  it("adds actionable guidance for model=v1 gateway routing errors", () => {
    const formatted = formatAnthropicStreamError(
      '400 {"error":{"message":"allm_passthrough_route: Invalid model name passed in model=v1. Call `/v1/models` to view available models for your key."}}',
    );

    expect(formatted).toContain("Invalid model name passed in model=v1");
    expect(formatted).toContain("base URL includes an OpenAI deployment path");
    expect(formatted).toContain("/sf-llm-gateway setup");
  });
});

// `flattenCodexTools` was removed in v0.71.x. The gateway now correctly
// accepts pi-ai's native Chat Completions tool shape
// `{ type: "function", function: {...} }` on /v1/chat/completions for
// Codex models and HTTP 500s on the previously-required Responses-API
// flattened shape (`'NoneType' object is not subscriptable`). The shim and
// its unit tests were deleted; the live codex-regression test exercises
// the Chat Completions shape end-to-end.

describe("normalizeCodexReasoningEffort", () => {
  it("defaults missing values to high (gateway rejects 'reasoning.effort=none')", () => {
    expect(normalizeCodexReasoningEffort(undefined)).toBe("high");
    expect(normalizeCodexReasoningEffort("")).toBe("high");
    expect(normalizeCodexReasoningEffort(null)).toBe("high");
  });

  it("clamps minimal and maps advanced levels to gateway-safe values", () => {
    // Live gateway probe on 2026-07-12: Codex accepts reasoning_effort=max.
    // Keep minimal clamped upward, and map xhigh to max for compatibility.
    expect(normalizeCodexReasoningEffort("minimal")).toBe("low");
    expect(normalizeCodexReasoningEffort("xhigh")).toBe("max");
    expect(normalizeCodexReasoningEffort("max")).toBe("max");
  });

  it("passes through low/medium/high unchanged", () => {
    expect(normalizeCodexReasoningEffort("low")).toBe("low");
    expect(normalizeCodexReasoningEffort("medium")).toBe("medium");
    expect(normalizeCodexReasoningEffort("high")).toBe("high");
  });

  it("coerces unknown string values to the default", () => {
    expect(normalizeCodexReasoningEffort("maximum")).toBe("high");
    expect(normalizeCodexReasoningEffort("   ")).toBe("high");
  });
});

describe("injectCodexGatewayParams", () => {
  it("injects a default reasoning effort and allow-lists it", () => {
    const payload: Record<string, unknown> = {};

    injectCodexGatewayParams(payload);

    expect(payload.reasoning_effort).toBe("high");
    expect(payload.allowed_openai_params).toEqual(["reasoning_effort"]);
  });

  it("preserves existing allow-listed params while normalizing reasoning", () => {
    const payload: Record<string, unknown> = {
      reasoning_effort: "minimal",
      allowed_openai_params: ["parallel_tool_calls", "reasoning_effort"],
    };

    injectCodexGatewayParams(payload);

    expect(payload.reasoning_effort).toBe("low");
    expect(payload.allowed_openai_params).toEqual(["parallel_tool_calls", "reasoning_effort"]);
  });

  it("deduplicates reasoning_effort if already present in allow-list", () => {
    const payload: Record<string, unknown> = {
      allowed_openai_params: ["reasoning_effort"],
    };
    injectCodexGatewayParams(payload);
    expect(payload.allowed_openai_params).toEqual(["reasoning_effort"]);
  });

  it("is idempotent (safe to call twice without exploding the allow-list)", () => {
    const payload: Record<string, unknown> = { reasoning_effort: "high" };
    injectCodexGatewayParams(payload);
    injectCodexGatewayParams(payload);
    expect(payload.allowed_openai_params).toEqual(["reasoning_effort"]);
  });
});

describe("allowReasoningEffortParam (GPT-5, not just Codex)", () => {
  it("adds reasoning_effort to the allow-list so LiteLLM does not 400 on gpt-5", () => {
    // Live gateway: POST gpt-5 with reasoning_effort and without
    // allowed_openai_params yields:
    //   "openai does not support parameters: ['reasoning_effort']"
    const payload: Record<string, unknown> = { reasoning_effort: "high" };
    allowReasoningEffortParam(payload);
    expect(payload.allowed_openai_params).toEqual(["reasoning_effort"]);
  });

  it("preserves existing allow-list entries and dedupes", () => {
    const payload: Record<string, unknown> = {
      reasoning_effort: "high",
      allowed_openai_params: ["parallel_tool_calls", "reasoning_effort"],
    };
    allowReasoningEffortParam(payload);
    expect(payload.allowed_openai_params).toEqual(["parallel_tool_calls", "reasoning_effort"]);
  });

  it("ignores non-string allow-list entries to avoid corrupting the array", () => {
    const payload: Record<string, unknown> = {
      allowed_openai_params: ["keep_me", 1, null, "drop_by_filter"],
    };
    allowReasoningEffortParam(payload);
    expect(payload.allowed_openai_params).toEqual([
      "keep_me",
      "drop_by_filter",
      "reasoning_effort",
    ]);
  });
});

describe("injectOpenAiServiceTier", () => {
  it("defaults to priority when the payload has no service_tier set", () => {
    // Live gateway: gpt-5 + service_tier:"priority" responds with
    // "service_tier": "priority" in the body; accepted values on this
    // gateway's OpenAI path are auto|default|flex|priority.
    const payload: Record<string, unknown> = {};
    injectOpenAiServiceTier(payload);
    expect(payload.service_tier).toBe("priority");
  });

  it("respects a caller-provided service_tier (allows runtime overrides to win)", () => {
    const payload: Record<string, unknown> = { service_tier: "flex" };
    injectOpenAiServiceTier(payload);
    expect(payload.service_tier).toBe("flex");
  });

  it("does not default priority for GPT-5 Bedrock Responses model IDs", () => {
    const payload: Record<string, unknown> = {};
    injectOpenAiServiceTier(payload, "gpt-5.6-sol-bedrock");
    expect(payload.service_tier).toBeUndefined();
  });

  it("strips caller-provided service_tier for GPT-5 Bedrock Responses model IDs", () => {
    const payload: Record<string, unknown> = { service_tier: "priority" };
    injectOpenAiServiceTier(payload, "gpt-5.6-sol-bedrock");
    expect(payload.service_tier).toBeUndefined();
  });

  it("overwrites blank / non-string service_tier with the default", () => {
    for (const bogus of ["", "   ", null, 0, {}]) {
      const payload: Record<string, unknown> = { service_tier: bogus };
      injectOpenAiServiceTier(payload);
      expect(payload.service_tier).toBe("priority");
    }
  });
});

describe("isOpenAiModelId", () => {
  it("matches GPT and ChatGPT families", () => {
    expect(isOpenAiModelId("gpt-5")).toBe(true);
    expect(isOpenAiModelId("gpt-4o-mini")).toBe(true);
    expect(isOpenAiModelId("gpt-5.3-codex")).toBe(true);
    expect(isOpenAiModelId("openai/gpt-5")).toBe(true);
    expect(isOpenAiModelId("chatgpt-4o-latest")).toBe(true);
  });

  it("does not match Claude or Gemini", () => {
    expect(isOpenAiModelId("claude-opus-4-7")).toBe(false);
    expect(isOpenAiModelId("gemini-2.5-pro")).toBe(false);
  });
});

describe("OpenAI reasoning effort defaults", () => {
  it("only treats GPT-5-family OpenAI models as reasoning models", () => {
    expect(isOpenAiReasoningModelId("gpt-5")).toBe(true);
    expect(isOpenAiReasoningModelId("gpt-5.5")).toBe(true);
    expect(isOpenAiReasoningModelId("gpt-5.3-codex")).toBe(true);
    expect(isOpenAiReasoningModelId("gpt-4o")).toBe(false);
    expect(isOpenAiReasoningModelId("chatgpt-4o-latest")).toBe(false);
  });

  it("uses max only on GPT-5.2+ non-5.5 models, high elsewhere, and undefined for 5.5 (gateway forbids tools+effort)", () => {
    expect(resolveOpenAiReasoningEffort("gpt-5")).toBe("high");
    expect(resolveOpenAiReasoningEffort("gpt-5-mini")).toBe("high");
    // The gateway's reasoning_effort validator was tightened to
    // {low,medium,high,max}; `xhigh` is rejected with HTTP 400. `max` is
    // the strongest accepted tier on GPT-5.2+ models.
    expect(resolveOpenAiReasoningEffort("gpt-5.2")).toBe("max");
    expect(resolveOpenAiReasoningEffort("gpt-5.6-sol")).toBe("max");
    // gpt-5.5 is intentionally undefined — the gateway rejects
    // reasoning_effort + function tools on /v1/chat/completions for this
    // model; gpt-5.5 normally routes through the root /responses path instead.
    expect(resolveOpenAiReasoningEffort("gpt-5.5")).toBeUndefined();
    expect(resolveOpenAiReasoningEffort("gpt-5.3-codex")).toBe("high");
    expect(resolveOpenAiReasoningEffort("gpt-4o")).toBeUndefined();
  });

  it("does not inject reasoning_effort for gpt-5.5 (gateway rejects the tools+effort combo)", () => {
    const payload: Record<string, unknown> = {};
    injectOpenAiReasoningEffort(payload, "gpt-5.5");
    expect(payload.reasoning_effort).toBeUndefined();
    expect(payload.allowed_openai_params).toBeUndefined();
  });

  it("strips a caller-provided reasoning_effort on gpt-5.5 (pi thinking selector can pre-populate it)", () => {
    const payload: Record<string, unknown> = {
      reasoning_effort: "high",
      allowed_openai_params: ["reasoning_effort"],
    };
    injectOpenAiReasoningEffort(payload, "gpt-5.5");
    expect(payload.reasoning_effort).toBeUndefined();
    expect(payload.allowed_openai_params).toBeUndefined();
  });

  it("preserves unrelated allow-list entries when stripping reasoning_effort on gpt-5.5", () => {
    const payload: Record<string, unknown> = {
      reasoning_effort: "high",
      allowed_openai_params: ["reasoning_effort", "service_tier"],
    };
    injectOpenAiReasoningEffort(payload, "gpt-5.5");
    expect(payload.reasoning_effort).toBeUndefined();
    expect(payload.allowed_openai_params).toEqual(["service_tier"]);
  });

  it("injects max on GPT-5.2+ non-5.5 variants and allow-lists it", () => {
    const payload: Record<string, unknown> = {};
    injectOpenAiReasoningEffort(payload, "gpt-5.2");
    // `max` was `xhigh` before the gateway tightened its validator;
    // see resolveOpenAiReasoningEffort tests above for the upstream
    // change that drove the remap.
    expect(payload.reasoning_effort).toBe("max");
    expect(payload.allowed_openai_params).toEqual(["reasoning_effort"]);
  });

  it("normalizes a caller-provided xhigh to max (gateway rejects xhigh upstream)", () => {
    const payload: Record<string, unknown> = { reasoning_effort: "xhigh" };
    injectOpenAiReasoningEffort(payload, "gpt-5");
    expect(payload.reasoning_effort).toBe("max");
    expect(payload.allowed_openai_params).toEqual(["reasoning_effort"]);
  });

  it("does not inject reasoning effort for non-reasoning OpenAI chat models", () => {
    const payload: Record<string, unknown> = {};
    injectOpenAiReasoningEffort(payload, "gpt-4o");
    expect(payload.reasoning_effort).toBeUndefined();
    expect(payload.allowed_openai_params).toBeUndefined();
  });

  it("respects caller-provided reasoning effort while still allow-listing it", () => {
    const payload: Record<string, unknown> = { reasoning_effort: "low" };
    injectOpenAiReasoningEffort(payload, "gpt-5");
    expect(payload.reasoning_effort).toBe("low");
    expect(payload.allowed_openai_params).toEqual(["reasoning_effort"]);
  });
});

describe("isGpt55ModelId", () => {
  it("matches canonical gpt-5.5 ids", () => {
    expect(isGpt55ModelId("gpt-5.5")).toBe(true);
    expect(isGpt55ModelId("openai/gpt-5.5")).toBe(true);
    expect(isGpt55ModelId("GPT-5.5")).toBe(true);
  });

  it("does not match sibling GPT-5 variants", () => {
    expect(isGpt55ModelId("gpt-5")).toBe(false);
    expect(isGpt55ModelId("gpt-5.2")).toBe(false);
    expect(isGpt55ModelId("gpt-5.3-codex")).toBe(false);
    expect(isGpt55ModelId("gpt-5-mini")).toBe(false);
    // Guard against accidental prefix collisions with hypothetical future ids.
    expect(isGpt55ModelId("gpt-5.55")).toBe(false);
    expect(isGpt55ModelId("gpt-5.50")).toBe(false);
  });
});

describe("stripReasoningEffortForGpt55", () => {
  it("removes reasoning_effort and scrubs allowed_openai_params", () => {
    const payload: Record<string, unknown> = {
      reasoning_effort: "high",
      allowed_openai_params: ["reasoning_effort"],
    };
    stripReasoningEffortForGpt55(payload);
    expect(payload.reasoning_effort).toBeUndefined();
    expect(payload.allowed_openai_params).toBeUndefined();
  });

  it("is a no-op when neither field is present", () => {
    const payload: Record<string, unknown> = { model: "gpt-5.5" };
    stripReasoningEffortForGpt55(payload);
    expect(payload).toEqual({ model: "gpt-5.5" });
  });
});

describe("isCodexModelId subset of isOpenAiModelId", () => {
  it("everything isCodexModelId matches is also isOpenAiModelId", () => {
    for (const id of ["gpt-5.2-codex", "gpt-5.3-codex"]) {
      expect(isCodexModelId(id)).toBe(true);
      expect(isOpenAiModelId(id)).toBe(true);
    }
  });

  it("non-Codex OpenAI models are OpenAI but not Codex", () => {
    expect(isCodexModelId("gpt-5")).toBe(false);
    expect(isOpenAiModelId("gpt-5")).toBe(true);
  });
});

describe("isOpus47ModelId", () => {
  it("matches canonical Opus 4.7 ids", () => {
    expect(isOpus47ModelId("claude-opus-4-7")).toBe(true);
    expect(isOpus47ModelId("claude-opus-4-7-v1")).toBe(true);
    expect(isOpus47ModelId("claude-opus-4-7-20250416")).toBe(true);
    expect(isOpus47ModelId("us.anthropic.claude-opus-4-7-v1")).toBe(true);
    expect(isOpus47ModelId("claude-opus-4.7-preview")).toBe(true);
  });

  it("does not match other Claude models", () => {
    expect(isOpus47ModelId("claude-opus-4-6-v1")).toBe(false);
    expect(isOpus47ModelId("claude-sonnet-4-6")).toBe(false);
    expect(isOpus47ModelId("claude-haiku-4-5-20241022")).toBe(false);
    expect(isOpus47ModelId("gpt-5")).toBe(false);
  });
});

describe("applyOpus47GatewayPolicy", () => {
  it("is a no-op — gateway restrictions that motivated level-scaled floors have been lifted", () => {
    const payload: Record<string, unknown> = {
      model: "claude-opus-4-7",
      max_tokens: 32_000,
      thinking: { type: "adaptive" },
      output_config: { effort: "max" },
      messages: [{ role: "user", content: "solve 1+1" }],
    };
    const original = { ...payload, output_config: { ...(payload.output_config as object) } };
    applyOpus47MaxThinking(payload, "high");
    // Function is a no-op: payload is unchanged
    expect(payload).toEqual(original);
  });

  it("does not fill max_tokens — the preset handles that via pi-ai", () => {
    const payload: Record<string, unknown> = {};
    applyOpus47MaxThinking(payload, "xhigh");
    expect(payload).toEqual({});
  });

  it("does not normalize effort — max and xhigh pass through to the gateway", () => {
    const payload: Record<string, unknown> = {
      output_config: { effort: "max" },
    };
    applyOpus47MaxThinking(payload, "high");
    expect(payload.output_config).toEqual({ effort: "max" });

    const xhighPayload: Record<string, unknown> = {
      output_config: { effort: "xhigh" },
    };
    applyOpus47MaxThinking(xhighPayload, "medium");
    expect(xhighPayload.output_config).toEqual({ effort: "xhigh" });
  });

  it("model max is exactly 128000 — gateway returns 400 above this", () => {
    expect(OPUS_47_MODEL_MAX_TOKENS).toBe(128_000);
  });

  it("deprecated constants return 128_000 for backwards compat", () => {
    expect(OPUS_47_DEFAULT_MAX_TOKENS).toBe(128_000);
    expect(resolveOpus47MaxTokensFloor("high")).toBe(128_000);
    expect(resolveOpus47MaxTokensFloor("xhigh")).toBe(128_000);
    expect(resolveOpus47MaxTokensFloor(undefined)).toBe(128_000);
  });
});
