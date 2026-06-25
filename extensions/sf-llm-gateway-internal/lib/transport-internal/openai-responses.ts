/* SPDX-License-Identifier: Apache-2.0 */
/**
 * OpenAI Responses transport for gpt-5 family models on the SF LLM Gateway.
 *
 * Why this exists: gpt-5.5 rejects `reasoning_effort` + function tools on
 * the chat path (and pi is an agentic harness so tools are always present).
 * `POST /responses` at the gateway root is exposed and returns a clean
 * Responses-shaped body, so we route gpt-5 family models there with a
 * one-shot fallback to the chat path if the upstream errors before
 * streaming any visible content.
 *
 * The `SF_LLM_GATEWAY_INTERNAL_GPT5_FORCE_CHAT` env var is a kill-switch
 * that forces gpt-5 family back to the chat path. `GPT55_FORCE_CHAT_ENV`
 * is a backward-compat alias from the first Responses PR.
 */
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamSimpleOpenAIResponses } from "@earendil-works/pi-ai/compat";
import { streamSfGatewayOpenAI } from "./openai-chat.ts";
import { injectOpenAiServiceTier } from "./payloads.ts";
import { isGpt5BedrockResponsesModelId, withGatewayProviderRetryDefaults } from "./shared.ts";

/**
 * Wrap stream options with an `onPayload` hook that sets the gateway's
 * priority service tier on the Responses request body when the selected model
 * accepts it.
 *
 * The chat transport (`streamSfGatewayOpenAI`) already injects
 * `service_tier` for every compatible OpenAI-family model, but gpt-5 family
 * models route through `/responses` and bypassed that injection entirely —
 * live probes confirmed direct OpenAI requests ran at `service_tier: default`
 * instead of `priority`. Applying the same idempotent injection here closes
 * that gap. GPT-5 Bedrock model groups reject `service_tier: priority`, so
 * `injectOpenAiServiceTier` leaves those payloads unchanged. Caller-provided
 * values still win, so the chat fallback path can reuse these options without
 * double-setting.
 */
function withPriorityServiceTier(
  options: SimpleStreamOptions,
  modelId: string,
): SimpleStreamOptions {
  const existingOnPayload = options.onPayload;
  return {
    ...options,
    onPayload: async (payload, payloadModel) => {
      let nextPayload = payload;
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const objectPayload = payload as Record<string, unknown>;
        injectOpenAiServiceTier(objectPayload, modelId);
        nextPayload = objectPayload;
      }
      return existingOnPayload ? existingOnPayload(nextPayload, payloadModel) : nextPayload;
    },
  };
}

export const GPT5_FORCE_CHAT_ENV = "SF_LLM_GATEWAY_INTERNAL_GPT5_FORCE_CHAT";
export const GPT55_FORCE_CHAT_ENV = "SF_LLM_GATEWAY_INTERNAL_GPT55_FORCE_CHAT";

// Exported for unit tests. Some GPT-5 Bedrock Responses streams delay the
// final `response.completed` event long after the last visible block is done;
// this keeps pi from showing an active thinking state for that idle tail.
export const GPT5_BEDROCK_EARLY_DONE_GRACE_MS = 50;

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const lower = value.trim().toLowerCase();
  return lower === "1" || lower === "true" || lower === "yes" || lower === "on";
}

function shouldForceGpt5Chat(): boolean {
  return (
    isTruthyEnv(process.env[GPT5_FORCE_CHAT_ENV]) || isTruthyEnv(process.env[GPT55_FORCE_CHAT_ENV])
  );
}

/**
 * Test hook. Production code never passes this; tests use it to stand in
 * fake streamers without touching ESM imports.
 */
export interface Gpt55ResponsesTestHooks {
  responsesStreamer?: (
    model: Model<"openai-responses">,
    context: Context,
    options?: SimpleStreamOptions,
  ) => AssistantMessageEventStream;
  chatStreamer?: (
    model: Model<"openai-completions">,
    context: Context,
    options?: SimpleStreamOptions,
  ) => AssistantMessageEventStream;
}

export function streamSfGatewayResponses(
  model: Model<"openai-responses">,
  context: Context,
  options?: SimpleStreamOptions,
  fallback?: {
    chatModel: Model<"openai-completions">;
    onFallback?: (reason: string) => void;
  },
  hooks?: Gpt55ResponsesTestHooks,
): AssistantMessageEventStream {
  const gatewayOptions = withPriorityServiceTier(
    withGatewayProviderRetryDefaults(options),
    model.id,
  );
  const responsesStreamer = hooks?.responsesStreamer ?? streamSimpleOpenAIResponses;
  const chatStreamer = hooks?.chatStreamer ?? ((m, c, o) => streamSfGatewayOpenAI(m, c, o));

  if (shouldForceGpt5Chat()) {
    if (fallback) {
      const envName = isTruthyEnv(process.env[GPT5_FORCE_CHAT_ENV])
        ? GPT5_FORCE_CHAT_ENV
        : GPT55_FORCE_CHAT_ENV;
      fallback.onFallback?.(`${envName}=1 — using chat completions path`);
      return chatStreamer(fallback.chatModel, context, gatewayOptions);
    }
  }

  const rawUpstream = responsesStreamer(model, context, gatewayOptions);
  const upstream = isGpt5BedrockResponsesModelId(model.id)
    ? finishBedrockResponsesAfterVisibleOutput(rawUpstream)
    : rawUpstream;

  if (!fallback) return upstream;

  return wrapWithChatFallback(upstream, context, gatewayOptions, fallback, chatStreamer);
}

function finishBedrockResponsesAfterVisibleOutput(
  upstream: AssistantMessageEventStream,
): AssistantMessageEventStream {
  const wrapped = createAssistantMessageEventStream();
  let latestPartial: AssistantMessage | undefined;
  let doneTimer: NodeJS.Timeout | undefined;
  let ended = false;

  const clearDoneTimer = () => {
    if (doneTimer) {
      clearTimeout(doneTimer);
      doneTimer = undefined;
    }
  };

  const finishEarly = () => {
    if (ended || !latestPartial) return;
    ended = true;
    const message = cloneAssistantMessage(latestPartial);
    const hasToolCall = message.content.some((block) => block.type === "toolCall");
    wrapped.push({
      type: "done",
      reason: hasToolCall ? "toolUse" : message.stopReason === "length" ? "length" : "stop",
      message,
    });
    wrapped.end();
  };

  const scheduleDone = (partial: AssistantMessage) => {
    latestPartial = partial;
    clearDoneTimer();
    doneTimer = setTimeout(finishEarly, GPT5_BEDROCK_EARLY_DONE_GRACE_MS);
  };

  (async () => {
    try {
      for await (const event of upstream) {
        if (ended) return;
        if (event.type === "done" || event.type === "error") {
          clearDoneTimer();
          ended = true;
          wrapped.push(event);
          wrapped.end();
          return;
        }

        if (isProgressEvent(event)) {
          latestPartial = event.partial;
        }
        if (event.type === "text_end" || event.type === "toolcall_end") {
          scheduleDone(event.partial);
        } else if (event.type.endsWith("_start") || event.type.endsWith("_delta")) {
          clearDoneTimer();
        }
        wrapped.push(event);
      }
      clearDoneTimer();
      if (!ended) wrapped.end();
    } catch (error) {
      clearDoneTimer();
      if (ended) return;
      ended = true;
      wrapped.push({
        type: "error",
        reason: "error",
        error: {
          ...(latestPartial ?? emptyErrorMessage()),
          stopReason: "error",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      wrapped.end();
    }
  })();

  return wrapped;
}

function isProgressEvent(
  event: AssistantMessageEvent,
): event is Exclude<AssistantMessageEvent, { type: "done" } | { type: "error" }> {
  return "partial" in event;
}

function cloneAssistantMessage(message: AssistantMessage): AssistantMessage {
  return structuredClone(message) as AssistantMessage;
}

function emptyErrorMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-responses" as const,
    provider: "sf-llm-gateway-internal",
    model: "gpt-5-bedrock",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    timestamp: Date.now(),
  };
}

function wrapWithChatFallback(
  upstream: AssistantMessageEventStream,
  context: Context,
  options: SimpleStreamOptions | undefined,
  fallback: {
    chatModel: Model<"openai-completions">;
    onFallback?: (reason: string) => void;
  },
  chatStreamer: (
    model: Model<"openai-completions">,
    context: Context,
    options?: SimpleStreamOptions,
  ) => AssistantMessageEventStream,
): AssistantMessageEventStream {
  const wrapped = createAssistantMessageEventStream();
  let sawContent = false;
  let fallbackTriggered = false;

  (async () => {
    try {
      for await (const event of upstream) {
        if (event.type !== "start" && event.type !== "error") {
          sawContent = true;
        }
        if (event.type === "error" && !sawContent && !fallbackTriggered) {
          fallbackTriggered = true;
          const reason =
            event.error?.errorMessage ?? "Responses request failed before streaming content";
          fallback.onFallback?.(`falling back to chat: ${reason}`);
          const chatStream = chatStreamer(fallback.chatModel, context, options);
          for await (const fb of chatStream) {
            wrapped.push(fb);
          }
          wrapped.end();
          return;
        }
        wrapped.push(event);
      }
      wrapped.end();
    } catch (error) {
      if (!sawContent && !fallbackTriggered) {
        fallbackTriggered = true;
        const reason = error instanceof Error ? error.message : String(error);
        fallback.onFallback?.(`falling back to chat: ${reason}`);
        const chatStream = chatStreamer(fallback.chatModel, context, options);
        try {
          for await (const fb of chatStream) {
            wrapped.push(fb);
          }
        } catch {
          // If chat also fails, surface the original Responses error below.
        }
        wrapped.end();
        return;
      }
      wrapped.push({
        type: "error",
        reason: "error",
        error: {
          role: "assistant",
          content: [],
          api: "openai-responses" as const,
          provider: "sf-llm-gateway-internal",
          model: "gpt-5.5",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "error",
          errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        },
      });
      wrapped.end();
    }
  })();

  return wrapped;
}
