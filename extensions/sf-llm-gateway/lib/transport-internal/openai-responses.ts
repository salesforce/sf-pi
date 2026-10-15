/* SPDX-License-Identifier: Apache-2.0 */
/** Generic OpenAI Responses adapter for the configured gateway. */
import {
  type AssistantMessageEventStream,
  type Model,
  type OpenAIResponsesOptions,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { streamOpenAIResponses, streamSimpleOpenAIResponses } from "@earendil-works/pi-ai/compat";
import { omitGatewayPromptCacheKey } from "./prompt-cache-key.ts";
import { streamGatewayResponsesWithTerminalGuard } from "./responses-terminal-guard.ts";
import { withGatewayResponsesToolImageCompatibility } from "./responses-tool-images.ts";

/** Provider-scoped request metadata, not a process.env automation setting. */
export const GATEWAY_PRIORITY_ENV = "SF_PI_GATEWAY_PRIORITY";

const PRIORITY_MODEL_IDS = new Set(["gpt-5.6-sol", "gpt-6-sol", "gpt-6.1-sol"]);

// Pi's simple Responses stream does not forward serviceTier; samplingParams reaches both paths.
function withPriorityTraffic<T extends OpenAIResponsesOptions | SimpleStreamOptions>(
  model: Model<"openai-responses">,
  options?: T,
): T | undefined {
  if (model.provider !== "sf-llm-gateway" || !PRIORITY_MODEL_IDS.has(model.id)) return options;
  const tier = options?.env?.[GATEWAY_PRIORITY_ENV] === "off" ? "default" : "priority";
  return {
    ...options,
    samplingParams: { ...options?.samplingParams, service_tier: tier },
    async onPayload(payload: unknown, requestModel: Model<"openai-responses">) {
      const replacement = await options?.onPayload?.(payload, requestModel);
      const next = replacement === undefined ? payload : replacement;
      if (!next || typeof next !== "object") return replacement;
      // Apply the saved policy last so a caller hook cannot undo an explicit opt-out.
      return { ...next, service_tier: tier };
    },
  } as T;
}

export interface GatewayResponsesSimpleTestHooks {
  responsesStreamer?: (
    model: Model<"openai-responses">,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ) => AssistantMessageEventStream;
}

export interface GatewayResponsesFullTestHooks {
  responsesStreamer?: typeof streamOpenAIResponses;
}

export function streamSfGatewayResponsesFull(
  model: Model<"openai-responses">,
  context: TranscriptContext,
  options?: OpenAIResponsesOptions,
  hooks?: GatewayResponsesFullTestHooks,
): AssistantMessageEventStream {
  return streamGatewayResponsesWithTerminalGuard(
    model,
    context,
    withGatewayResponsesToolImageCompatibility(
      model,
      omitGatewayPromptCacheKey(model, withPriorityTraffic(model, options)),
    ),
    hooks?.responsesStreamer ?? streamOpenAIResponses,
  );
}

export function streamSfGatewayResponses(
  model: Model<"openai-responses">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
  hooks?: GatewayResponsesSimpleTestHooks,
): AssistantMessageEventStream {
  return streamGatewayResponsesWithTerminalGuard(
    model,
    context,
    withGatewayResponsesToolImageCompatibility(
      model,
      omitGatewayPromptCacheKey(model, withPriorityTraffic(model, options)),
    ),
    hooks?.responsesStreamer ?? streamSimpleOpenAIResponses,
  );
}
