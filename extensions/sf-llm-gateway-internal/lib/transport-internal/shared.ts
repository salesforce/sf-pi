/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared transport primitives for the SF LLM Gateway.
 *
 * Holds constants, types, model-id detection, error formatters, provider retry
 * defaults, and the early-stream retry wrapper used by the Anthropic transport.
 * Per-transport streamers live next to this file in
 * `./anthropic.ts`, `./openai-chat.ts`, and `./openai-responses.ts`.
 *
 * The historical `lib/transport.ts` is now a re-export barrel — every
 * symbol declared here is also re-exported from there for backwards
 * compatibility.
 */
import {
  createAssistantMessageEventStream,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { emitRetryEvent } from "../retry-telemetry.ts";
import { formatRetryGuidanceFooter } from "../retry-telemetry.ts";

// -------------------------------------------------------------------------------------------------
// Constants + types
// -------------------------------------------------------------------------------------------------

export const DEFAULT_CODEX_REASONING_EFFORT = "high";
export const DEFAULT_OPENAI_REASONING_EFFORT = "high";
// The gateway's LiteLLM tightened its OpenAI reasoning_effort validator to
// {low,medium,high,max}; "xhigh" is now rejected with HTTP 400
// (`reasoning_effort=xhigh is not supported for this model`). "max" is
// accepted on every reasoning-capable family probed (gpt-5.x, codex). Keep
// the constant name for callers that want "strongest safe effort" semantics.
export const MAX_OPENAI_REASONING_EFFORT = "max";

/**
 * Gateway-specific provider retry default when Pi has not supplied
 * `retry.provider.maxRetries`. Pi 0.76 passes the user's provider retry value
 * through `SimpleStreamOptions.maxRetries`; SF Pi only fills the default for
 * this provider so the transport has one retry budget for SDK-level retries,
 * Responses fallback, and Anthropic early-stream SSE retries.
 */
export const GATEWAY_PROVIDER_DEFAULT_MAX_RETRIES = 3;

/**
 * How many additional attempts to make after the initial upstream request when
 * Anthropic returns a retryable SSE error envelope before any user-visible
 * content has been emitted. Total attempts = 1 + ANTHROPIC_EARLY_STREAM_RETRIES.
 * Kept as a backwards-compatible alias for tests and older imports; new code
 * should use GATEWAY_PROVIDER_DEFAULT_MAX_RETRIES.
 */
export const ANTHROPIC_EARLY_STREAM_RETRIES = GATEWAY_PROVIDER_DEFAULT_MAX_RETRIES;

/** Exponential-backoff delays applied between inner stream retry attempts. */
export const ANTHROPIC_EARLY_STREAM_RETRY_DELAYS_MS = [500, 1500, 4000] as const;

/**
 * Default max_tokens floor scaled by pi reasoning level. See the file
 * header in `lib/transport.ts` for the failure mode that drove this.
 */
export const OPUS_47_MAX_TOKENS_FLOOR_BY_LEVEL: Record<PiReasoningLevel, number> = {
  minimal: 16_000,
  low: 24_000,
  medium: 32_000,
  high: 48_000,
  xhigh: 64_000,
};

/**
 * Anthropic beta header pi-ai sets by default on the Anthropic Messages path.
 * Re-exported from `lib/models.ts` via resolveEffectiveBetas().
 */
export const ANTHROPIC_FINE_GRAINED_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";

/** Default OpenAI service tier for gateway requests. */
export const DEFAULT_OPENAI_SERVICE_TIER = "priority";

/**
 * Anthropic pi-ai reasoning level. Keep in sync with pi-ai's ThinkingLevel.
 * Duplicated here instead of importing because pi-ai only exports it as a
 * type, and we need the literal set at runtime for validation.
 */
export type PiReasoningLevel = "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * Default cap for Opus 4.7 output tokens when no pi reasoning level is set.
 */
export const OPUS_47_DEFAULT_MAX_TOKENS = 64_000;

/**
 * Hard upstream ceiling for Opus 4.7. Gateway returns 400 above this.
 */
export const OPUS_47_MODEL_MAX_TOKENS = 128_000;

/**
 * Return the max_tokens floor that applies to an Opus 4.7 turn at a given
 * pi reasoning level. Exported for tests and for the `/debug` command.
 */
export function resolveOpus47MaxTokensFloor(level: PiReasoningLevel | undefined): number {
  if (!level) return OPUS_47_DEFAULT_MAX_TOKENS;
  return OPUS_47_MAX_TOKENS_FLOOR_BY_LEVEL[level] ?? OPUS_47_DEFAULT_MAX_TOKENS;
}

// -------------------------------------------------------------------------------------------------
// Model-id detection
// -------------------------------------------------------------------------------------------------

export function isCodexModelId(modelId: string): boolean {
  return modelId.toLowerCase().includes("codex");
}

/**
 * True for OpenAI-family model IDs the gateway routes through its OpenAI
 * proxy. Codex is a subset — `isCodexModelId` is the finer check.
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
 * LiteLLM. Do not set it on GPT-4o / ChatGPT aliases.
 */
export function isOpenAiReasoningModelId(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return isOpenAiModelId(modelId) && lower.includes("gpt-5");
}

/**
 * True for any gpt-5 family model the extension routes through
 * `POST /responses` instead of `/v1/chat/completions`.
 */
export function isGpt5FamilyResponsesModelId(modelId: string): boolean {
  if (modelId.toLowerCase().includes("codex")) return false;
  return /^(?:openai\/)?gpt-5(?:-mini|\.5)?$/i.test(modelId.trim());
}

export function isGpt55ModelId(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return /(^|\/)gpt-5\.5(?!\d)/.test(lower);
}

/**
 * Return the strongest reasoning effort this gateway should request for an
 * OpenAI-family model. Returns undefined when the model should not carry
 * `reasoning_effort` at all (gpt-5.5 + non-reasoning OpenAI variants).
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

/** True for Claude Opus 4.7 variants. */
export function isOpus47ModelId(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.includes("opus-4-7") || lower.includes("opus-4.7");
}

// -------------------------------------------------------------------------------------------------
// Anthropic error envelope formatting
// -------------------------------------------------------------------------------------------------

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
 * envelope string. Render a user-facing message that preserves the request id
 * without dumping the whole envelope. Exported for unit tests.
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

// -------------------------------------------------------------------------------------------------
// Gateway provider retry defaults
// -------------------------------------------------------------------------------------------------

export function resolveGatewayProviderMaxRetries(maxRetries: number | undefined): number {
  if (maxRetries === undefined) return GATEWAY_PROVIDER_DEFAULT_MAX_RETRIES;
  if (!Number.isFinite(maxRetries)) return GATEWAY_PROVIDER_DEFAULT_MAX_RETRIES;
  return Math.max(0, Math.floor(maxRetries));
}

export function withGatewayProviderRetryDefaults(
  options: SimpleStreamOptions | undefined,
): SimpleStreamOptions {
  const maxRetries = resolveGatewayProviderMaxRetries(options?.maxRetries);
  if (options?.maxRetries === maxRetries) return options;
  return { ...options, maxRetries };
}

// -------------------------------------------------------------------------------------------------
// Early-stream retry wrapper for Anthropic streams
// -------------------------------------------------------------------------------------------------

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
 * Options exposed for tests. Production callers usually pass the Pi provider
 * retry budget through `maxRetries`; tests can override delays and sleep.
 */
export interface RobustRetryTestHooks {
  maxRetries?: number;
  retryDelaysMs?: readonly number[];
  /** Awaited between attempts. Defaults to a real timer. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Anthropic can return transient failures as SSE `event: error` after HTTP 200.
 * The SDK's request-level retries do not see those frames. This wrapper uses
 * the same provider retry budget Pi passes as `maxRetries` and retries the
 * upstream call only when the error arrives before any user-visible content has
 * been forwarded downstream.
 */
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

          if (!userVisibleStarted) {
            for (const buffered of prelude) outer.push(buffered);
          }
          outer.push(annotateErrorWithGuidance(sanitized));
          if (attempt > 0) {
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

      if (!userVisibleStarted) {
        for (const buffered of prelude) outer.push(buffered);
      }
      outer.end();
      return;
    }

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
