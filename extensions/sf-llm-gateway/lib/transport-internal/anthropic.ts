/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Anthropic Messages transport for the SF LLM Gateway.
 *
 * Pi owns Messages streaming, retry attempts, backoff, cancellation, and
 * lifecycle visibility. This adapter only sanitizes error envelopes and appends
 * bounded terminal guidance; it applies no model-specific payload policy.
 */
import {
  type AnthropicOptions,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { streamAnthropic, streamSimpleAnthropic } from "@earendil-works/pi-ai/compat";
import { sanitizeAnthropicStream } from "./shared.ts";

export interface GatewayAnthropicFullTestHooks {
  streamer?: typeof streamAnthropic;
}

/** Gateway-aware full Anthropic stream used by complete native Providers. */
export function streamSfGatewayAnthropicFull(
  model: Model<"anthropic-messages">,
  context: TranscriptContext,
  options?: AnthropicOptions,
  hooks?: GatewayAnthropicFullTestHooks,
): AssistantMessageEventStream {
  const streamer = hooks?.streamer ?? streamAnthropic;
  return sanitizeAnthropicStream(model, streamer(model, context, options), options?.signal);
}

export function streamSfGatewayAnthropic(
  model: Model<"anthropic-messages">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  return sanitizeAnthropicStream(
    model,
    streamSimpleAnthropic(model, context, options),
    options?.signal,
  );
}
