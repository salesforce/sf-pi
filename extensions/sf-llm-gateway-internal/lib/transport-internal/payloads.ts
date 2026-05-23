/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Payload mutators applied to gateway transport requests.
 *
 * Each function modifies a parsed JSON payload in place to satisfy a
 * Salesforce-LLM-Gateway-specific quirk. These all live together so the
 * transport streamers (`./openai-chat.ts`, `./openai-responses.ts`,
 * `./anthropic.ts`) can pick the exact set they need without colocating
 * unrelated streaming concerns.
 *
 * See `lib/transport.ts` (file header) for the live-verified rationale
 * behind each shape.
 */
import {
  DEFAULT_CODEX_REASONING_EFFORT,
  DEFAULT_OPENAI_SERVICE_TIER,
  isGpt55ModelId,
  resolveOpenAiReasoningEffort,
  resolveOpus47MaxTokensFloor,
  type PiReasoningLevel,
} from "./shared.ts";

// `flattenCodexTools` was removed in v0.71.x. The gateway used to require
// Responses-API-shaped tools on `/v1/chat/completions` for Codex; live
// probes confirm the gateway now correctly accepts the Chat Completions
// `{ type: "function", function: {...} }` shape that pi-ai emits natively
// and returns the flattened `Responses-API` shape with HTTP 500
// (`'NoneType' object is not subscriptable`). Sending Chat Completions
// shape unchanged is now the correct behavior.

/**
 * The gateway's Codex path rejects missing reasoning_effort and currently
 * mishandles `minimal`/`xhigh`. Clamp to the values the gateway accepts.
 */
export function normalizeCodexReasoningEffort(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return DEFAULT_CODEX_REASONING_EFFORT;
  }

  switch (value) {
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
      return "high";
    default:
      return DEFAULT_CODEX_REASONING_EFFORT;
  }
}

/**
 * Set OpenAI-compat `service_tier` on the payload when the caller did not
 * already specify one. Leaves an existing value alone so future overrides
 * stay intact.
 */
export function injectOpenAiServiceTier(payload: Record<string, unknown>): void {
  const existing = payload.service_tier;
  if (typeof existing === "string" && existing.trim().length > 0) {
    return;
  }
  payload.service_tier = DEFAULT_OPENAI_SERVICE_TIER;
}

/**
 * Ensure `reasoning_effort` is allow-listed through LiteLLM. Required for
 * any OpenAI-family model (not just Codex) that sets reasoning_effort.
 */
export function allowReasoningEffortParam(payload: Record<string, unknown>): void {
  const allowed = Array.isArray(payload.allowed_openai_params)
    ? (payload.allowed_openai_params as unknown[]).filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    : [];
  payload.allowed_openai_params = [...new Set([...allowed, "reasoning_effort"])];
}

/**
 * Codex-only payload shaping: normalize reasoning_effort, allow-list it, and
 * flatten tools. Kept as a thin wrapper so individual pieces can be unit
 * tested in isolation.
 */
export function injectCodexGatewayParams(payload: Record<string, unknown>): void {
  payload.reasoning_effort = normalizeCodexReasoningEffort(payload.reasoning_effort);
  allowReasoningEffortParam(payload);
}

/**
 * Drop `reasoning_effort` (and its allow-list entry) from the payload.
 *
 * Used for gpt-5.5 because the gateway rejects `reasoning_effort` + function
 * tools on `/v1/chat/completions` with a hard 400.
 */
export function stripReasoningEffortForGpt55(payload: Record<string, unknown>): void {
  delete payload.reasoning_effort;
  const allowed = payload.allowed_openai_params;
  if (Array.isArray(allowed)) {
    const filtered = allowed.filter(
      (value): value is string => typeof value === "string" && value !== "reasoning_effort",
    );
    if (filtered.length > 0) {
      payload.allowed_openai_params = filtered;
    } else {
      delete payload.allowed_openai_params;
    }
  }
}

/**
 * Default OpenAI reasoning models to the strongest safe effort for their
 * family. Caller-provided values still win, but are allow-listed so LiteLLM
 * passes them through instead of raising UnsupportedParamsError.
 */
export function injectOpenAiReasoningEffort(
  payload: Record<string, unknown>,
  modelId: string,
): void {
  if (isGpt55ModelId(modelId)) {
    stripReasoningEffortForGpt55(payload);
    return;
  }

  // Defensive: if a caller (older pi-ai, direct override) pre-set the
  // gateway-rejected `xhigh` value, normalize to the gateway-accepted
  // `max` tier before LiteLLM sees it. The gateway's reasoning_effort
  // validator now rejects xhigh with HTTP 400.
  if (payload.reasoning_effort === "xhigh") {
    payload.reasoning_effort = "max";
  }

  if (typeof payload.reasoning_effort !== "string" || !payload.reasoning_effort.trim()) {
    const effort = resolveOpenAiReasoningEffort(modelId);
    if (effort) {
      payload.reasoning_effort = effort;
    }
  }

  if (typeof payload.reasoning_effort === "string" && payload.reasoning_effort.trim()) {
    allowReasoningEffortParam(payload);
  }
}

/**
 * Apply the gateway-specific Opus 4.7 payload policy.
 *
 * Pi owns the generic Anthropic adaptive-thinking shape via
 * `compat.forceAdaptiveThinking` (`thinking: { type: "adaptive" }`,
 * `output_config.effort`, and omitting temperature while thinking is on).
 * SF Pi only keeps the gateway-specific output-token floor/cap policy and a
 * defensive cleanup for legacy/pre-shaped payloads that still contain an
 * effort value this gateway rejects for Opus 4.7.
 */
export function applyOpus47MaxThinking(
  payload: Record<string, unknown>,
  level?: PiReasoningLevel,
): void {
  if (typeof payload.max_tokens !== "number" || payload.max_tokens <= 0) {
    payload.max_tokens = resolveOpus47MaxTokensFloor(level);
  }

  if (typeof payload.output_config === "object" && payload.output_config !== null) {
    const outputConfig = payload.output_config as Record<string, unknown>;
    if (outputConfig.effort === "xhigh" || outputConfig.effort === "max") {
      // The gateway rejects raw xhigh, and its model-specific guard restricts
      // max to Opus 4.6. The strongest tier Opus 4.7 accepts is high.
      outputConfig.effort = "high";
    }
  }
}
