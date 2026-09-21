/* SPDX-License-Identifier: Apache-2.0 */
/** Generic OpenAI Chat Completions adapter for the configured gateway. */
import {
  type AssistantMessageEventStream,
  type Model,
  type OpenAICompletionsOptions,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
  streamOpenAICompletions,
  streamSimpleOpenAICompletions,
} from "@earendil-works/pi-ai/compat";

export interface GatewayOpenAIFullTestHooks {
  streamer?: typeof streamOpenAICompletions;
}

export function streamSfGatewayOpenAIFull(
  model: Model<"openai-completions">,
  context: TranscriptContext,
  options?: OpenAICompletionsOptions,
  hooks?: GatewayOpenAIFullTestHooks,
): AssistantMessageEventStream {
  return (hooks?.streamer ?? streamOpenAICompletions)(model, context, options);
}

export function streamSfGatewayOpenAI(
  model: Model<"openai-completions">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  return streamSimpleOpenAICompletions(model, context, options);
}
