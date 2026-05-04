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
 *   Codex with minimal/xhigh is rejected                    | "clamps minimal and xhigh"
 *   Opus 4.7 accepts adaptive + effort + max_tokens verbatim | "sets adaptive thinking, effort mapped from pi level..."
 *   Opus 4.7 rejects max_tokens > 128000                     | "OPUS_47_MODEL_MAX_TOKENS is exactly 128000"
 *   Opus 4.7 + max_tokens:128000 + effort:max intermittently | default max_tokens lowered to OPUS_47_DEFAULT_MAX_TOKENS
 *     triggers upstream api_error: Internal server error     |
 *   Anthropic rejects temperature != 1 with adaptive         | "strips temperature even though LiteLLM would forward it"
 *   Claude on OpenAI-compat auto-translates to thinking.enabled with
 *     budget_tokens derived from max_tokens (so budget caps output)      | documented via comment on
 *                                                                         applyOpus47MaxThinking
 */
import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_FINE_GRAINED_TOOL_STREAMING_BETA,
  OPUS_47_DEFAULT_MAX_TOKENS,
  OPUS_47_MODEL_MAX_TOKENS,
  allowReasoningEffortParam,
  applyOpus47MaxThinking,
  flattenCodexTools,
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
  resolveOpenAiReasoningEffort,
  resolveOpus47MaxTokensFloor,
  stripReasoningEffortForGpt55,
} from "../lib/transport.ts";

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
});

describe("flattenCodexTools", () => {
  it("flattens Chat Completions function tools into Responses-style tools (gateway rejects nested shape with 'Missing required parameter: tools[0].name')", () => {
    const payload: Record<string, unknown> = {
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
            strict: true,
          },
        },
      ],
    };

    flattenCodexTools(payload);

    expect(payload.tools).toEqual([
      {
        type: "function",
        name: "read_file",
        description: "Read a file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ]);
  });

  it("is a no-op on a payload with no tools (avoids injecting an empty array)", () => {
    const payload: Record<string, unknown> = { model: "gpt-5.3-codex" };
    flattenCodexTools(payload);
    expect(payload).toEqual({ model: "gpt-5.3-codex" });
  });

  it("preserves multiple tools and flattens each", () => {
    const payload: Record<string, unknown> = {
      tools: [
        { type: "function", function: { name: "a", parameters: {} } },
        { type: "function", function: { name: "b", parameters: {} } },
      ],
    };
    flattenCodexTools(payload);
    expect((payload.tools as Array<{ name: string }>).map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("leaves non-function tools untouched", () => {
    const webSearchTool = { type: "web_search_preview", name: "search" };
    const payload: Record<string, unknown> = { tools: [webSearchTool] };

    flattenCodexTools(payload);

    expect(payload.tools).toEqual([webSearchTool]);
  });
});

describe("normalizeCodexReasoningEffort", () => {
  it("defaults missing values to high (gateway rejects 'reasoning.effort=none')", () => {
    expect(normalizeCodexReasoningEffort(undefined)).toBe("high");
    expect(normalizeCodexReasoningEffort("")).toBe("high");
    expect(normalizeCodexReasoningEffort(null)).toBe("high");
  });

  it("clamps minimal and xhigh to gateway-safe values", () => {
    // Live gateway: reasoning.effort must be one of minimal|low|medium|high
    // and LiteLLM's Codex path specifically rejects 'minimal' and 'xhigh'.
    expect(normalizeCodexReasoningEffort("minimal")).toBe("low");
    expect(normalizeCodexReasoningEffort("xhigh")).toBe("high");
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

  it("uses xhigh only on GPT-5.2+ non-5.5 models, high elsewhere, and undefined for 5.5 (gateway forbids tools+effort)", () => {
    expect(resolveOpenAiReasoningEffort("gpt-5")).toBe("high");
    expect(resolveOpenAiReasoningEffort("gpt-5-mini")).toBe("high");
    expect(resolveOpenAiReasoningEffort("gpt-5.2")).toBe("xhigh");
    // gpt-5.5 is intentionally undefined — the gateway rejects
    // reasoning_effort + function tools on /v1/chat/completions for this
    // model, and /v1/responses is not exposed on this gateway.
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

  it("injects xhigh on GPT-5.2+ non-5.5 variants and allow-lists it", () => {
    const payload: Record<string, unknown> = {};
    injectOpenAiReasoningEffort(payload, "gpt-5.2");
    expect(payload.reasoning_effort).toBe("xhigh");
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
  it("does not overwrite Pi-native adaptive effort mapping when Pi already supplied output_config", () => {
    const payload: Record<string, unknown> = {
      max_tokens: 32_000,
      thinking: { type: "adaptive" },
      output_config: { effort: "xhigh" },
      temperature: 0.7,
    };

    applyOpus47MaxThinking(payload, "medium");

    expect(payload.max_tokens).toBe(32_000);
    expect(payload.thinking).toEqual({ type: "adaptive" });
    expect(payload.output_config).toEqual({ effort: "xhigh" });
    expect(payload.temperature).toBeUndefined();
  });

  it("only fills adaptive thinking when Pi did not already supply thinking controls", () => {
    const payload: Record<string, unknown> = {};

    applyOpus47MaxThinking(payload, "xhigh");

    expect(payload.thinking).toEqual({ type: "adaptive" });
    expect(payload.output_config).toEqual({ effort: "xhigh" });
    expect(payload.max_tokens).toBe(64_000);
  });

  it("maps pi reasoning level to effort and sets adaptive thinking", () => {
    const payload: Record<string, unknown> = {
      max_tokens: 32_000,
      temperature: 0.7,
      messages: [{ role: "user", content: "hi" }],
    };

    applyOpus47MaxThinking(payload, "high");

    expect(payload.max_tokens).toBe(32_000); // caller's explicit value preserved
    expect(payload.thinking).toEqual({ type: "adaptive" });
    expect(payload.output_config).toEqual({ effort: "high" });
    // Anthropic rejects temperature != 1 under adaptive thinking.
    expect(payload.temperature).toBeUndefined();
    // Non-thinking fields pass through untouched.
    expect(payload.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("fills in the level-scaled max_tokens floor when the caller did not set one", () => {
    const payload: Record<string, unknown> = {};
    applyOpus47MaxThinking(payload, "high");
    // high → 48K floor. This is intentionally lower than the xhigh 64K
    // floor so that running pi at high does not inflate every turn into
    // the heavy-workload request profile that correlates with Anthropic's
    // intermittent api_error window.
    expect(payload.max_tokens).toBe(resolveOpus47MaxTokensFloor("high"));
    expect(payload.max_tokens).toBe(48_000);
  });

  it("falls back to OPUS_47_DEFAULT_MAX_TOKENS when no pi reasoning level is known", () => {
    const payload: Record<string, unknown> = {};
    applyOpus47MaxThinking(payload);
    expect(payload.max_tokens).toBe(OPUS_47_DEFAULT_MAX_TOKENS);
  });

  it("uses per-level floors: minimal/low/medium/high/xhigh do not all collapse to 64K", () => {
    // The whole point of this fix is that low-effort turns no longer inherit
    // the 64K xhigh profile. Assert the distinct floors in one place so any
    // future regression flips this test immediately.
    const floors = {
      minimal: resolveOpus47MaxTokensFloor("minimal"),
      low: resolveOpus47MaxTokensFloor("low"),
      medium: resolveOpus47MaxTokensFloor("medium"),
      high: resolveOpus47MaxTokensFloor("high"),
      xhigh: resolveOpus47MaxTokensFloor("xhigh"),
    };
    expect(floors).toEqual({
      minimal: 16_000,
      low: 24_000,
      medium: 32_000,
      high: 48_000,
      xhigh: 64_000,
    });
    // And every floor stays at or below the model hard ceiling so the
    // gateway never 400s on our own default.
    for (const value of Object.values(floors)) {
      expect(value).toBeLessThanOrEqual(OPUS_47_MODEL_MAX_TOKENS);
    }
  });

  it("xhigh pi level maps to xhigh Anthropic effort (not promoted to max)", () => {
    const payload: Record<string, unknown> = {};
    applyOpus47MaxThinking(payload, "xhigh");
    expect(payload.output_config).toEqual({ effort: "xhigh" });
  });

  it("overrides a caller-provided budget-based thinking block with adaptive (4.7 rejects budget-based)", () => {
    const payload: Record<string, unknown> = {
      thinking: { type: "enabled", budget_tokens: 16_384 },
    };

    applyOpus47MaxThinking(payload, "high");

    expect(payload.thinking).toEqual({ type: "adaptive" });
    expect(payload.output_config).toEqual({ effort: "high" });
  });

  it("model max is exactly 128000 — gateway returns 400 for 200000 with 'max_tokens: 200000 > 128000'", () => {
    expect(OPUS_47_MODEL_MAX_TOKENS).toBe(128_000);
  });

  it("default max is 64000 — matches what the gateway advertises and avoids the 128K+max api_error window", () => {
    expect(OPUS_47_DEFAULT_MAX_TOKENS).toBe(64_000);
  });

  it("produces the byte-exact payload shape the gateway echoes for 4.7 at pi level=high", () => {
    // Live probe via /utils/transform_request showed the gateway passes this
    // payload through verbatim to https://api.anthropic.com/v1/messages.
    const payload: Record<string, unknown> = {
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "solve 1+1" }],
    };
    applyOpus47MaxThinking(payload, "high");

    expect(payload).toEqual({
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "solve 1+1" }],
      max_tokens: resolveOpus47MaxTokensFloor("high"),
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
    });
  });

  it("produces the byte-exact payload shape for 4.7 at pi level=xhigh (heavy-workload profile)", () => {
    const payload: Record<string, unknown> = {
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "multi-step reasoning" }],
    };
    applyOpus47MaxThinking(payload, "xhigh");

    expect(payload).toEqual({
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "multi-step reasoning" }],
      max_tokens: 64_000,
      thinking: { type: "adaptive" },
      output_config: { effort: "xhigh" },
    });
  });

  it("respects a caller-provided max_tokens above the level-scaled floor", () => {
    const payload: Record<string, unknown> = { max_tokens: 80_000 };
    applyOpus47MaxThinking(payload, "medium");
    expect(payload.max_tokens).toBe(80_000);
  });

  it("exposes ANTHROPIC_FINE_GRAINED_TOOL_STREAMING_BETA so lib/models.ts can merge it", () => {
    // This constant is consumed by lib/models.ts to work around a beta-merge
    // bug in pi-ai's header handling — keep it stable.
    expect(ANTHROPIC_FINE_GRAINED_TOOL_STREAMING_BETA).toBe(
      "fine-grained-tool-streaming-2025-05-14",
    );
  });

  it("strips temperature even though LiteLLM silently forwards it — Anthropic upstream rejects any value != 1 with adaptive", () => {
    const payload: Record<string, unknown> = { temperature: 0.5 };
    applyOpus47MaxThinking(payload, "high");
    expect(payload.temperature).toBeUndefined();
  });
});
