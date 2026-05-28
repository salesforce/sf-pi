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
  streamSimpleAnthropic,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamAnthropicWithRobustRetry, withGatewayProviderRetryDefaults } from "./shared.ts";

export function streamSfGatewayAnthropic(
  model: Model<"anthropic-messages">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const gatewayOptions = withGatewayProviderRetryDefaults(options);
  const maxRetries = gatewayOptions.maxRetries;

  return streamAnthropicWithRobustRetry(
    model,
    () => streamSimpleAnthropic(model, context, gatewayOptions),
    gatewayOptions.signal,
    { maxRetries },
  );
}
