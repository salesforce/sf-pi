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
  return (hooks?.responsesStreamer ?? streamOpenAIResponses)(model, context, options);
}

export function streamSfGatewayResponses(
  model: Model<"openai-responses">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
  hooks?: GatewayResponsesSimpleTestHooks,
): AssistantMessageEventStream {
  return (hooks?.responsesStreamer ?? streamSimpleOpenAIResponses)(model, context, options);
}
