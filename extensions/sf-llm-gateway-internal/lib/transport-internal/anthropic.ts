/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Anthropic Messages transport for the SF LLM Gateway.
 *
 * All Claude models go through the same path: pi-ai's `streamSimpleAnthropic`
 * wrapped in the early-stream retry wrapper (`streamAnthropicWithRobustRetry`).
 *
 * Pi owns the generic adaptive-thinking payload via the model's
 * `compat.forceAdaptiveThinking` flag. The gateway now accepts `effort=max`
 * and `max_tokens=128000` for Opus 4.7+ without instability, so no
 * transport-level payload shaping is needed.
 *
 * The Anthropic-specific early-stream retry wrapper
 * (`streamAnthropicWithRobustRetry`) lives in `./shared.ts` and uses the same
 * provider retry budget Pi passes through `options.maxRetries`.
 */
import {
  type AnthropicOptions,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamAnthropic, streamSimpleAnthropic } from "@earendil-works/pi-ai/compat";
import { streamAnthropicWithRobustRetry, withGatewayProviderRetryDefaults } from "./shared.ts";

export interface GatewayAnthropicFullTestHooks {
  streamer?: typeof streamAnthropic;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Gateway-aware full Anthropic stream used by complete native Providers. */
export function streamSfGatewayAnthropicFull(
  model: Model<"anthropic-messages">,
  context: Context,
  options?: AnthropicOptions,
  hooks?: GatewayAnthropicFullTestHooks,
): AssistantMessageEventStream {
  const gatewayOptions = withGatewayProviderRetryDefaults(options);
  const streamer = hooks?.streamer ?? streamAnthropic;
  return streamAnthropicWithRobustRetry(
    model,
    () => streamer(model, context, gatewayOptions),
    gatewayOptions.signal,
    { maxRetries: gatewayOptions.maxRetries, ...(hooks?.sleep ? { sleep: hooks.sleep } : {}) },
  );
}

export function streamSfGatewayAnthropic(
  model: Model<"anthropic-messages">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const gatewayOptions = withGatewayProviderRetryDefaults(options);
  return streamAnthropicWithRobustRetry(
    model,
    () => streamSimpleAnthropic(model, context, gatewayOptions),
    gatewayOptions.signal,
    { maxRetries: gatewayOptions.maxRetries },
  );
}
