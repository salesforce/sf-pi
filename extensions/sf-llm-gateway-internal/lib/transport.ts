/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Gateway transport shims.
 *
 * Two small shims live in this module:
 *
 * 1. streamSfGatewayOpenAI — wraps pi-ai's OpenAI Chat Completions transport
 *    for two gateway quirks, both live-verified against the gateway's
 *    /utils/transform_request endpoint:
 *
 *    a. LiteLLM rejects `reasoning_effort` on ANY OpenAI-family model
 *       unless it is explicitly allow-listed via `allowed_openai_params`.
 *       This affects gpt-5, gpt-5-mini, AND the Codex models. Without the
 *       allow-list, the gateway returns 400 with
 *       "openai does not support parameters: ['reasoning_effort']".
 *
 *    b. Codex tools must be in Responses-flat shape
 *       (`{type: "function", name, description, parameters}`) not the nested
 *       Chat Completions shape (`{type: "function", function: {...}}`), and
 *       Codex `reasoning_effort` must be in `low|medium|high` — the gateway
 *       rejects `minimal`/`xhigh`. Both quirks only apply to Codex.
 *
 *    c. gpt-5.5 rejects ANY request that combines `reasoning_effort` with
 *       function tools on `/v1/chat/completions` ("Function tools with
 *       reasoning_effort are not supported for gpt-5.5 in
 *       /v1/chat/completions. Please use /v1/responses instead."). Pi is an
 *       agentic harness and always carries tools, and this gateway does NOT
 *       expose `/v1/responses` (the route 302s to an SSO login page). So the
 *       shim force-strips `reasoning_effort` for gpt-5.5. The model still
 *       performs implicit reasoning.
 *
 *    Non-reasoning OpenAI models (gpt-4o, gpt-4o-mini) and non-OpenAI
 *    families pass through untouched.
 *
 * 2. streamSfGatewayAnthropic — wraps pi-ai's native Anthropic Messages
 *    transport for Gateway-specific Opus 4.7 policy. Pi 0.73+ owns the
 *    native adaptive-thinking / xhigh effort mapping; this extension only
 *    fills missing thinking controls for safety, raises the max_tokens floor
 *    before pi-ai's conservative default can clamp it, and strips incompatible
 *    temperature values.
 *
 *    For 4.7 we ensure:
 *      - thinking defaults to { type: "adaptive" } only when Pi did not set it
 *      - output_config defaults to { effort: <pi level> } only when Pi did not set it
 *      - max_tokens: <defaulted to 64K, user can raise>
 *      - temperature stripped (Anthropic rejects any value != 1 with adaptive)
 *
 *    Effort mapping (pi thinking level → Anthropic effort):
 *      minimal/low → low, medium → medium, high → high, xhigh → xhigh
 *
 *    GATEWAY CAVEAT — live-verified against /v1/messages:
 *      Opus 4.7 routes through Bedrock Converse on this gateway, which
 *      silently drops `output_config.effort`. Probes with `low` / `high` /
 *      `xhigh` / `max` / `invalid_xyz` all returned HTTP 200 with
 *      statistically indistinguishable thinking budgets. Turning thinking
 *      on still works via `thinking: {type: "adaptive"}` (no-thinking
 *      baseline ~2700 out-tokens vs adaptive ~3800–5200). The effort
 *      mapping above is therefore cosmetic on this gateway today — the
 *      real lever the user has is the `max_tokens` floor, which scales
 *      with pi reasoning level in `OPUS_47_MAX_TOKENS_FLOOR_BY_LEVEL` below.
 *      Keep the effort field so this extension is already correct once the
 *      gateway starts forwarding it to Bedrock.
 *
 *    Background on the defaults, live-verified against the gateway:
 *      - The model's hard output ceiling is 128000 (>128000 returns 400).
 *      - `max_tokens: 128000` + `effort: "max"` on heavier prompts
 *        intermittently surfaces `api_error: Internal server error`
 *        from Anthropic upstream (streaming mid-request failure).
 *      - `max_tokens: 64000` + `effort: "max"` showed no failures in
 *        the same repro harness. 64K matches what the gateway advertises
 *        for 4.7 via /v1/model/info.
 *      - effort `max` is no longer forced — instead the caller's pi
 *        reasoning level flows through, so only users on xhigh get the
 *        heaviest request profile. `xhigh` is a real Anthropic effort
 *        level on 4.7 (between `high` and `max`).
 *      - temperature is stripped because Anthropic returns 400
 *        "`temperature` may only be set to 1 when thinking is enabled or
 *        in adaptive mode" for any value != 1.
 *
 *    Older Claude models still follow pi-ai's built-in per-model behavior.
 */
import {
  createAssistantMessageEventStream,
  streamSimpleAnthropic,
  streamSimpleOpenAICompletions,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { emitRetryEvent, formatRetryGuidanceFooter } from "./retry-telemetry.ts";

const DEFAULT_CODEX_REASONING_EFFORT = "high";
const DEFAULT_OPENAI_REASONING_EFFORT = "high";
const MAX_OPENAI_REASONING_EFFORT = "xhigh";

/**
 * How many additional attempts to make after the initial upstream request when
 * Anthropic returns a retryable SSE error envelope before any user-visible
 * content has been emitted. Total attempts = 1 + ANTHROPIC_EARLY_STREAM_RETRIES.
 *
 * Bumped from 1 → 3 because a single inner retry was not enough to cover the
 * Anthropic 500 window on Opus 4.7 heavy-workload turns; the outer pi session
 * retry then re-ran the entire agent.continue() cycle (re-sending full context),
 * which is strictly more expensive and more error-prone than a quick upstream
 * retry with the same payload. Three attempts at 500/1500/4000 ms cover roughly
 * 6 seconds of upstream instability, which matches the typical duration of
 * Anthropic's transient `api_error: Internal server error` window.
 */
const ANTHROPIC_EARLY_STREAM_RETRIES = 3;

/** Exponential-backoff delays applied between inner stream retry attempts. */
const ANTHROPIC_EARLY_STREAM_RETRY_DELAYS_MS = [500, 1500, 4000] as const;

/**
 * Default max_tokens floor scaled by pi reasoning level.
 *
 * pi-ai's buildBaseOptions clamps max_tokens to `min(model.maxTokens, 32_000)`
 * when no explicit value is set. For Opus 4.7 that is 32K, which is too
 * conservative for xhigh/high agentic turns — but 64K on every request pushes
 * every low-effort turn into the same heavy-workload profile that correlates
 * with Anthropic's intermittent 500 window.
 *
 * Scaling the floor by pi reasoning level keeps the generous headroom for
 * users who actually asked for it while stopping us from silently inflating
 * cheap turns into the failure window. All values stay at or below the
 * model hard ceiling (OPUS_47_MODEL_MAX_TOKENS = 128K).
 */
const OPUS_47_MAX_TOKENS_FLOOR_BY_LEVEL: Record<PiReasoningLevel, number> = {
  minimal: 16_000,
  low: 24_000,
  medium: 32_000,
  high: 48_000,
  xhigh: 64_000,
};

/**
 * Anthropic beta header pi-ai sets by default on the Anthropic Messages path.
 *
 * pi-ai builds the request with `defaultHeaders["anthropic-beta"] = "fine-grained-tool-streaming-2025-05-14"`
 * and then merges `model.headers` on top via `Object.assign`. `Object.assign`
 * replaces the entire `anthropic-beta` value instead of comma-merging, so any
 * custom value on `model.headers` silently drops pi-ai's default.
 *
 * We work around this by always appending fine-grained-tool-streaming to the
 * extension-level `anthropic-beta` list; see resolveEffectiveBetas() in
 * lib/models.ts for the wire-up.
 */
export const ANTHROPIC_FINE_GRAINED_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";

/**
 * Default OpenAI-compat `service_tier` value for gateway traffic.
 *
 * Live-verified against the gateway:
 *   gpt-5, gpt-5-mini, gpt-5.5, gpt-4o, gpt-4o-mini all echo
 *   `"service_tier": "priority"` when the request body sets
 *   `service_tier: "priority"`. Accepted values on this gateway's OpenAI path
 *   are `auto|default|flex|priority` (`scale` is rejected with 400). Codex
 *   accepts the parameter without error but the Responses-shaped response does
 *   not echo `service_tier`, so we cannot confirm honoring — still safe to send
 *   because LiteLLM does not 400 on it.
 *
 * Claude models on this gateway route through Bedrock Converse, which
 * silently drops `service_tier` (live probes always come back with
 * `"service_tier": "standard"` regardless of what we send), and Bedrock
 * `performanceConfig.latency: "optimized"` is rejected upstream for every
 * Claude currently in us-east-2 — so there is no fast tier to reach for the
 * Anthropic path from this gateway. This shim therefore only applies to
 * OpenAI-family models.
 */
const DEFAULT_OPENAI_SERVICE_TIER = "priority";

/**
 * Anthropic pi-ai reasoning level. Keep in sync with pi-ai's ThinkingLevel.
 * Duplicated here instead of importing because pi-ai only exports it as a
 * type, and we need the literal set at runtime for validation.
 */
type PiReasoningLevel = "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * Default cap for Opus 4.7 output tokens when no pi reasoning level is set.
 * Matches the highest floor (xhigh) so callers without a level still get
 * headroom; applyOpus47MaxThinking() narrows this per-level when a level
 * is provided. Callers can always raise it by passing `maxTokens` explicitly.
 *
 * Historical note: this used to be applied unconditionally to every request,
 * which inflated every low-effort turn into a 64K-output profile. See the
 * block comment at the top of this file for the failure mode that drove the
 * level-scaled floor.
 */
export const OPUS_47_DEFAULT_MAX_TOKENS = 64_000;

/**
 * Return the max_tokens floor that applies to an Opus 4.7 turn at a given
 * pi reasoning level. Exported for tests and for the `/debug` command.
 */
export function resolveOpus47MaxTokensFloor(level: PiReasoningLevel | undefined): number {
  if (!level) return OPUS_47_DEFAULT_MAX_TOKENS;
  return OPUS_47_MAX_TOKENS_FLOOR_BY_LEVEL[level] ?? OPUS_47_DEFAULT_MAX_TOKENS;
}

/**
 * Hard upstream ceiling. Gateway returns 400 with
 * "max_tokens: N > 128000, which is the maximum allowed number of output
 * tokens for anthropic.claude-opus-4-7" for values above this.
 */
export const OPUS_47_MODEL_MAX_TOKENS = 128_000;

export function isCodexModelId(modelId: string): boolean {
  return modelId.toLowerCase().includes("codex");
}

/**
 * True for OpenAI-family model IDs the gateway routes through its OpenAI
 * proxy (gpt-*, chatgpt-*, plus any future `openai/...` variants). Codex is
 * a subset — isCodexModelId() is a finer check used for the Codex-only tool
 * and reasoning_effort quirks.
 */
export function isOpenAiModelId(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return (
    lower.startsWith("gpt-") ||
    lower.includes("/gpt-") ||
    lower.startsWith("openai/") ||
    lower.includes("chatgpt")
  );
}

/**
 * True for OpenAI-family models that accept `reasoning_effort` through
 * LiteLLM. Do not set it on GPT-4o / ChatGPT aliases — LiteLLM advertises
 * those as non-reasoning chat models and they either ignore or reject the
 * knob depending on gateway version.
 */
export function isOpenAiReasoningModelId(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return isOpenAiModelId(modelId) && lower.includes("gpt-5");
}

/**
 * True for gpt-5.5 variants.
 *
 * gpt-5.5 is a special case on this gateway: LiteLLM rejects ANY request that
 * combines `reasoning_effort` with function tools on `/v1/chat/completions`
 * with a 400 "Function tools with reasoning_effort are not supported for
 * gpt-5.5 in /v1/chat/completions. Please use /v1/responses instead." Pi is
 * an agentic harness and always sends function tools, so sending any
 * reasoning_effort at all against this model on this gateway is guaranteed
 * to fail. The gateway does not expose `/v1/responses` — that route 302s to
 * an SSO login page — so we cannot pivot transports either. The only safe
 * path is to omit `reasoning_effort` entirely for gpt-5.5; the model still
 * performs implicit reasoning (live probes show ~30-100 reasoning_tokens on
 * non-trivial prompts even without an explicit effort).
 */
export function isGpt55ModelId(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return /(^|\/)gpt-5\.5(?!\d)/.test(lower);
}

/**
 * Return the strongest reasoning effort this gateway should request for an
 * OpenAI-family model.
 *
 * Rules:
 *  - gpt-5.5: never send reasoning_effort — gateway rejects the
 *    reasoning_effort + tools combo on `/v1/chat/completions` and the
 *    suggested `/v1/responses` route is not exposed here.
 *    See `isGpt55ModelId` above for the full context.
 *  - Codex: capped at `high` (gateway rejects `xhigh`/`minimal`).
 *  - Older GPT-5 / GPT-5-mini: `high`.
 *  - GPT-5.2+ non-5.5 variants: `xhigh` (LiteLLM's documented max).
 */
export function resolveOpenAiReasoningEffort(modelId: string): string | undefined {
  if (!isOpenAiReasoningModelId(modelId)) {
    return undefined;
  }

  if (isGpt55ModelId(modelId)) {
    return undefined;
  }

  const lower = modelId.toLowerCase();
  if (lower.includes("codex")) {
    return DEFAULT_CODEX_REASONING_EFFORT;
  }

  if (/gpt-5\.(?:[2-9]|\d{2,})/.test(lower)) {
    return MAX_OPENAI_REASONING_EFFORT;
  }

  return DEFAULT_OPENAI_REASONING_EFFORT;
}

/**
 * True for Claude Opus 4.7 variants. Pi 0.73+ treats these as native
 * adaptive-thinking models; this check scopes the Gateway-specific token
 * floor and retry policy.
 */
export function isOpus47ModelId(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.includes("opus-4-7") || lower.includes("opus-4.7");
}

/**
 * Map a pi-ai thinking level to the Anthropic `output_config.effort` value
 * for Opus 4.7. Opus 4.7 accepts all of low/medium/high/xhigh/max; we mirror
 * the pi level so downgrading pi's reasoning level actually downgrades the
 * Anthropic effort tier (previously we always forced "max").
 *
 * xhigh → "xhigh" is intentional: Opus 4.7 introduced a new `xhigh` effort
 * level between `high` and `max`, so pi's xhigh flows through as 4.7 xhigh
 * rather than being promoted to max.
 */
export function mapPiLevelToOpus47Effort(
  level: PiReasoningLevel | undefined,
): "low" | "medium" | "high" | "xhigh" {
  switch (level) {
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "xhigh":
      return "xhigh";
    case "high":
    default:
      // Anthropic's default when effort is unset is "high"; mirror it so
      // unset / unrecognized levels land on the documented default.
      return "high";
  }
}

/**
 * LiteLLM expects Codex tools in Responses API format even when the gateway
 * entrypoint is `/chat/completions`. Live-verified: without this flatten, the
 * gateway returns "Missing required parameter: tools[0].name".
 */
export function flattenCodexTools(payload: Record<string, unknown>): void {
  const tools = payload.tools as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(tools) || tools.length === 0) {
    return;
  }

  payload.tools = tools.map((tool) => {
    if (tool.type !== "function") {
      return tool;
    }

    const fn = tool.function as Record<string, unknown> | undefined;
    if (!fn || typeof fn !== "object") {
      return tool;
    }

    const { name, description, parameters } = fn;
    return {
      type: "function",
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(parameters !== undefined ? { parameters } : {}),
    };
  });
}

/**
 * The gateway's Codex path rejects missing reasoning_effort and currently
 * mishandles `minimal`/`xhigh`. Clamp to the values the gateway accepts.
 * Live-verified: `reasoning_effort: 'none'` yields
 * "reasoning.effort Input should be 'minimal', 'low', 'medium' or 'high'".
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
 * already specify one. Leaves an existing value alone so future /sf-llm-gateway
 * tier command overrides stay intact.
 *
 * Live-verified: passing `service_tier: "priority"` without allow-listing is
 * accepted by the gateway for every OpenAI-family model (gpt-5, gpt-5-mini,
 * gpt-4o, gpt-4o-mini, gpt-5.3-codex). The response echoes `service_tier:
 * "priority"` for Chat-Completions-shaped models; Codex accepts but does not
 * echo it back.
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
 * Live-verified: without this, gpt-5 + reasoning_effort yields
 * "openai does not support parameters: ['reasoning_effort']".
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
 * tools on `/v1/chat/completions` with a hard 400 — see `isGpt55ModelId`.
 * pi-ai may have set the field via thinking-level mapping before this shim
 * saw the payload, so we have to actively strip it, not just skip injection.
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
 *
 * gpt-5.5 is a hard exception: the gateway rejects `reasoning_effort` on
 * any request that carries function tools (pi always does). Force-strip any
 * value pi-ai may have injected via the thinking-level selector.
 */
export function injectOpenAiReasoningEffort(
  payload: Record<string, unknown>,
  modelId: string,
): void {
  if (isGpt55ModelId(modelId)) {
    stripReasoningEffortForGpt55(payload);
    return;
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
 * Rewrite an Anthropic Messages request so Opus 4.7 runs with adaptive
 * thinking at the effort level derived from pi's reasoning setting.
 *
 * Caller responsibilities:
 *  - `level` should be the pi reasoning level for the current turn, which
 *    this shim maps 1:1 to Anthropic's effort tiers (low / medium / high /
 *    xhigh). When undefined or unrecognized we fall back to Anthropic's
 *    documented default ("high").
 *  - `payload.max_tokens` is left untouched when already set by pi-ai; if
 *    absent, the shim fills in the conservative default. The streaming
 *    wrapper above adjusts `options.maxTokens` so pi-ai's buildBaseOptions
 *    doesn't clamp to its 32K default before the payload reaches us.
 *
 * Exported so unit tests can pin the exact payload shape.
 */
export function applyOpus47MaxThinking(
  payload: Record<string, unknown>,
  level?: PiReasoningLevel,
): void {
  // Default to the level-scaled floor only when the caller did not specify
  // one. This preserves explicit higher/lower caps set upstream (e.g. tests).
  if (typeof payload.max_tokens !== "number" || payload.max_tokens <= 0) {
    payload.max_tokens = resolveOpus47MaxTokensFloor(level);
  }

  // Pi 0.73+ owns the native Opus 4.7 adaptive/xhigh mapping. Preserve
  // thinking/output_config if Pi already supplied them; fill only when absent
  // so older serialized sessions and direct tests still get a safe payload.
  const thinking = payload.thinking as { type?: unknown } | undefined;
  if (!thinking || thinking.type !== "adaptive") {
    payload.thinking = { type: "adaptive" };
  }
  if (!payload.output_config) {
    payload.output_config = { effort: mapPiLevelToOpus47Effort(level) };
  }

  // Anthropic rejects any `temperature` != 1 with extended thinking
  // ("`temperature` may only be set to 1 when thinking is enabled or in
  //  adaptive mode"). Strip it so the upstream default (1) is used.
  delete payload.temperature;
}

type AnthropicErrorEnvelope = {
  type?: string;
  error?: {
    type?: string;
    message?: string;
  };
  request_id?: string;
};

function parseAnthropicErrorEnvelope(message: string): AnthropicErrorEnvelope | undefined {
  const trimmed = message.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as AnthropicErrorEnvelope;
    if (parsed.type !== "error" || !parsed.error) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Pi-ai currently turns Anthropic SSE `event: error` frames into the raw JSON
 * envelope string. Keep the retryable words, but render a user-facing message
 * that preserves the request id without dumping the whole envelope.
 * Exported for unit tests.
 */
export function formatAnthropicStreamError(message: string): string {
  const envelope = parseAnthropicErrorEnvelope(message);
  if (!envelope?.error) {
    if (/Invalid model name passed in model=v1/i.test(message)) {
      return [
        message,
        "This usually means the gateway base URL includes an OpenAI deployment path (for example /bedrock) while Claude is using the native Anthropic /v1/messages route. Re-run /sf-llm-gateway-internal setup and use the gateway root URL, then /sf-llm-gateway-internal refresh.",
      ].join("\n");
    }
    return message;
  }

  const type = envelope.error.type ?? "api_error";
  const text = envelope.error.message ?? "Unknown Anthropic stream error";
  const requestId = envelope.request_id ? ` (request_id: ${envelope.request_id})` : "";
  return `Anthropic ${type}: ${text}${requestId}`;
}

function isRetryableAnthropicStreamError(message: string): boolean {
  const formatted = formatAnthropicStreamError(message);
  return /api_error|overloaded|rate.?limit|429|500|502|503|504|internal.?error|server.?error|service.?unavailable|timeout|timed? out/i.test(
    formatted,
  );
}

function sanitizeAnthropicErrorEvent(
  event: Extract<AssistantMessageEvent, { type: "error" }>,
): Extract<AssistantMessageEvent, { type: "error" }> {
  return {
    ...event,
    error: {
      ...event.error,
      errorMessage: event.error.errorMessage
        ? formatAnthropicStreamError(event.error.errorMessage)
        : event.error.errorMessage,
    },
  };
}

/**
 * Append the one-line retry-guidance footer to a sanitized error event's
 * message so users see actionable next steps (settings path, /compact, the
 * Anthropic status URL) inline with the failure.
 *
 * Idempotent: if the message already ends with the guidance footer, returns
 * the event unchanged so pi's outer retry loop does not stack duplicates
 * when the same error bubbles up multiple times.
 */
export function annotateErrorWithGuidance(
  event: Extract<AssistantMessageEvent, { type: "error" }>,
): Extract<AssistantMessageEvent, { type: "error" }> {
  const footer = formatRetryGuidanceFooter();
  const message = event.error.errorMessage ?? "";
  if (!message || message.includes(footer)) {
    return event;
  }
  return {
    ...event,
    error: {
      ...event.error,
      errorMessage: `${message}\n${footer}`,
    },
  };
}

/**
 * True for event types that put user-visible text/tool output on the screen.
 * Once any of these has been forwarded to the downstream stream, we can no
 * longer transparently retry — the TUI has already committed partial output.
 *
 * `start` and `thinking_*` events are deliberately excluded: they are either
 * lifecycle markers (`start`) or buffered-until-first-visible in
 * streamAnthropicWithRobustRetry below, so retrying after only those have
 * arrived is still safe.
 */
function isUserVisibleStreamEvent(event: AssistantMessageEvent): boolean {
  switch (event.type) {
    case "text_start":
    case "text_delta":
    case "text_end":
    case "toolcall_start":
    case "toolcall_delta":
    case "toolcall_end":
      return true;
    default:
      return false;
  }
}

function sleepForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Anthropic can return transient failures as SSE `event: error` after HTTP 200.
 * The SDK's request-level retries do not see those frames. Pi's outer
 * agent-session retry does see them, but by that point the full agent loop has
 * to re-run, re-sending the entire context.
 *
 * This wrapper transparently retries the upstream call when:
 *   - The error arrives before any user-visible content (text / tool call)
 *     has been forwarded downstream, AND
 *   - The error message matches the retryable-error signature
 *     (api_error / overloaded / rate limit / 5xx / timeouts), AND
 *   - We still have retry budget remaining, AND
 *   - The caller has not aborted the request.
 *
 * Behavior details:
 *   - `start` and `thinking_*` events are buffered until the first
 *     user-visible event. This widens the retry window to cover the common
 *     pattern where Opus 4.7 emits thinking, then upstream 500s before any
 *     text arrives. Without this, the early-retry window was effectively
 *     "0 events" because `thinking_start` fires almost immediately.
 *   - On a successful stream, the buffered prelude is flushed in order,
 *     then the stream passes through live deltas unchanged.
 *   - On a non-retryable error or after exhausting retries, the last
 *     sanitized error is forwarded so pi's outer retry / UI can handle it.
 *   - Retry delays follow ANTHROPIC_EARLY_STREAM_RETRY_DELAYS_MS.
 */
/**
 * Options exposed for tests. Production callers never pass these — the
 * defaults come from the module-level ANTHROPIC_EARLY_STREAM_* constants.
 */
export interface RobustRetryTestHooks {
  maxRetries?: number;
  retryDelaysMs?: readonly number[];
  /** Awaited between attempts. Defaults to a real timer. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function streamAnthropicWithRobustRetry(
  model: Model<"anthropic-messages">,
  createInner: () => AssistantMessageEventStream,
  signal?: AbortSignal,
  hooks?: RobustRetryTestHooks,
): AssistantMessageEventStream {
  const maxRetries = hooks?.maxRetries ?? ANTHROPIC_EARLY_STREAM_RETRIES;
  const delays = hooks?.retryDelaysMs ?? ANTHROPIC_EARLY_STREAM_RETRY_DELAYS_MS;
  const sleep = hooks?.sleep ?? sleepForRetry;
  const outer = createAssistantMessageEventStream();

  (async () => {
    let lastSanitizedError: Extract<AssistantMessageEvent, { type: "error" }> | undefined;
    let lastReasonForEmit: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (signal?.aborted) break;

      if (attempt > 0) {
        const delay = delays[attempt - 1] ?? delays[delays.length - 1] ?? 500;
        // Surface the fact that pi is retrying so the user knows something
        // happened — before this, the robust retry was fully silent and users
        // saw "pi is thinking" with no indication the inner retry kicked in.
        emitRetryEvent({
          type: "retry_attempt",
          attempt: attempt + 1,
          maxAttempts: maxRetries + 1,
          delayMs: delay,
          reason: lastReasonForEmit ?? "transient upstream error",
          modelId: model.id,
        });
        await sleep(delay, signal);
        if (signal?.aborted) break;
      }

      // Buffer prelude + thinking events until the first user-visible event
      // arrives. That widens the "transparent retry" window compared with the
      // old "start-only" prelude.
      const prelude: AssistantMessageEvent[] = [];
      let userVisibleStarted = false;
      let retry = false;

      for await (const event of createInner()) {
        if (!userVisibleStarted && event.type === "start") {
          prelude.push(event);
          continue;
        }

        if (event.type === "error") {
          const sanitized = sanitizeAnthropicErrorEvent(event);
          const message = sanitized.error.errorMessage ?? "";
          lastSanitizedError = sanitized;
          lastReasonForEmit = message;

          const canRetry =
            !userVisibleStarted &&
            !signal?.aborted &&
            attempt < maxRetries &&
            isRetryableAnthropicStreamError(message);

          if (canRetry) {
            retry = true;
            break;
          }

          // No retry — flush any buffered prelude (so downstream sees a
          // coherent `start → error` sequence) and forward the error. Append
          // the guidance footer to the error message so users see actionable
          // next steps without scraping docs for settings paths.
          if (!userVisibleStarted) {
            for (const buffered of prelude) outer.push(buffered);
          }
          outer.push(annotateErrorWithGuidance(sanitized));
          if (attempt > 0) {
            // Only report "exhausted" when at least one retry was attempted;
            // first-try non-retryable errors reach this path and we don't
            // want to confuse them with a retry-exhaustion story.
            emitRetryEvent({
              type: "retry_exhausted",
              attempts: attempt + 1,
              reason: message,
              modelId: model.id,
            });
          }
          outer.end();
          return;
        }

        // Thinking events + start are buffered until a user-visible event
        // arrives. After that, everything passes through.
        if (!userVisibleStarted && !isUserVisibleStreamEvent(event)) {
          prelude.push(event);
          continue;
        }

        if (!userVisibleStarted) {
          for (const buffered of prelude) outer.push(buffered);
          userVisibleStarted = true;
        }
        outer.push(event);

        if (event.type === "done") {
          // A successful `done` on attempt > 0 means we recovered via retry.
          // Tell the listener so the UI can reassure the user it worked out.
          if (attempt > 0) {
            emitRetryEvent({
              type: "retry_recovered",
              attempts: attempt + 1,
              modelId: model.id,
            });
          }
          outer.end();
          return;
        }
      }

      if (retry) {
        continue;
      }

      // Stream ended with no terminal `done`/`error`. Flush any buffered
      // prelude (e.g. just `start` + thinking) and close — this matches
      // pi-ai's own behavior for a truncated upstream.
      if (!userVisibleStarted) {
        for (const buffered of prelude) outer.push(buffered);
      }
      outer.end();
      return;
    }

    // Retry budget exhausted (or aborted mid-loop) — forward the last
    // sanitized error so pi's outer retry / UI can decide what to do.
    if (lastSanitizedError) {
      outer.push(annotateErrorWithGuidance(lastSanitizedError));
      if (!signal?.aborted) {
        emitRetryEvent({
          type: "retry_exhausted",
          attempts: maxRetries + 1,
          reason: lastSanitizedError.error.errorMessage ?? "upstream error",
          modelId: model.id,
        });
      }
    }
    outer.end();
  })().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const stopReason = signal?.aborted ? "aborted" : "error";
    outer.push({
      type: "error",
      reason: stopReason,
      error: {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason,
        timestamp: Date.now(),
        errorMessage: formatAnthropicStreamError(message),
      },
    });
    outer.end();
  });

  return outer;
}

/**
 * Use Pi's built-in OpenAI Chat Completions transport, but patch payloads
 * for two gateway quirks:
 *
 *   - Any OpenAI-family model with `reasoning_effort` set needs it
 *     allow-listed via `allowed_openai_params`.
 *   - Codex additionally needs its tools flattened and reasoning_effort
 *     clamped to `low|medium|high`.
 *
 * Non-OpenAI-family models and OpenAI models without reasoning_effort pass
 * straight through.
 */
export function streamSfGatewayOpenAI(
  model: Model<"openai-completions">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const existingOnPayload = options?.onPayload;

  const wrappedOptions: SimpleStreamOptions = {
    ...options,
    onPayload: async (payload, payloadModel) => {
      let nextPayload = payload;

      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const objectPayload = payload as Record<string, unknown>;

        if (isCodexModelId(model.id)) {
          flattenCodexTools(objectPayload);
          injectCodexGatewayParams(objectPayload);
          // Codex is an OpenAI-family model — honor the gateway's priority
          // tier the same way gpt-5 does, even though Codex's Responses
          // response shape does not echo `service_tier` back.
          injectOpenAiServiceTier(objectPayload);
        } else if (isOpenAiModelId(model.id)) {
          // GPT-5 reasoning models get the strongest safe effort by default
          // (`xhigh` on GPT-5.2+ / GPT-5.5, `high` on older GPT-5 variants),
          // and LiteLLM needs the param allow-listed when it is present.
          injectOpenAiReasoningEffort(objectPayload, model.id);
          // Default every OpenAI-family request to the gateway's priority
          // service tier. Verified live: gpt-5 / gpt-5-mini / gpt-5.5 /
          // gpt-4o / gpt-4o-mini all echo `"service_tier": "priority"` when sent.
          injectOpenAiServiceTier(objectPayload);
        }

        nextPayload = objectPayload;
      }

      return existingOnPayload ? existingOnPayload(nextPayload, payloadModel) : nextPayload;
    },
  };

  return streamSimpleOpenAICompletions(model, context, wrappedOptions);
}

/**
 * Use pi-ai's native Anthropic Messages transport, but for Opus 4.7 also:
 *   - Pre-set options.maxTokens to 128K so pi-ai's buildBaseOptions does not
 *     clamp to 32K before we ever see the payload.
 *   - Force adaptive thinking @ effort: "max" via onPayload.
 *
 * Older Claude models pass straight through — pi-ai already handles 4.6
 * adaptive thinking (xhigh→max) and budget-based thinking for earlier ones.
 */
export function streamSfGatewayAnthropic(
  model: Model<"anthropic-messages">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  if (!isOpus47ModelId(model.id)) {
    return streamAnthropicWithRobustRetry(
      model,
      () => streamSimpleAnthropic(model, context, options),
      options?.signal,
    );
  }

  const existingOnPayload = options?.onPayload;
  const piLevel = options?.reasoning as PiReasoningLevel | undefined;

  const wrappedOptions: SimpleStreamOptions = {
    ...options,
    // Raise the buildBaseOptions ceiling before pi-ai clamps to 32K. Use a
    // floor scaled by the pi reasoning level so low-effort turns do not get
    // silently inflated into the Opus 4.7 64K-output profile that correlates
    // with Anthropic's intermittent `api_error: Internal server error`
    // window. Keep the caller's explicit value when it is already above the
    // level-scaled floor. Never exceed the model's hard 128K output ceiling —
    // the gateway returns 400 above that.
    maxTokens: Math.min(
      Math.max(options?.maxTokens ?? 0, resolveOpus47MaxTokensFloor(piLevel)),
      OPUS_47_MODEL_MAX_TOKENS,
    ),
    onPayload: async (payload, payloadModel) => {
      let nextPayload = payload;

      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const objectPayload = payload as Record<string, unknown>;
        applyOpus47MaxThinking(objectPayload, piLevel);
        nextPayload = objectPayload;
      }

      return existingOnPayload ? existingOnPayload(nextPayload, payloadModel) : nextPayload;
    },
  };

  return streamAnthropicWithRobustRetry(
    model,
    () => streamSimpleAnthropic(model, context, wrappedOptions),
    options?.signal,
  );
}
