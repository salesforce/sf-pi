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
  streamSimpleOpenAIResponses,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamSfGatewayOpenAI } from "./openai-chat.ts";
import { withGatewayProviderRetryDefaults } from "./shared.ts";

export const GPT5_FORCE_CHAT_ENV = "SF_LLM_GATEWAY_INTERNAL_GPT5_FORCE_CHAT";
export const GPT55_FORCE_CHAT_ENV = "SF_LLM_GATEWAY_INTERNAL_GPT55_FORCE_CHAT";

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
  const gatewayOptions = withGatewayProviderRetryDefaults(options);
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

  const upstream = responsesStreamer(model, context, gatewayOptions);

  if (!fallback) return upstream;

  return wrapWithChatFallback(upstream, context, gatewayOptions, fallback, chatStreamer);
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
