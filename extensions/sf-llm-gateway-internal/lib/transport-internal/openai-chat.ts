/* SPDX-License-Identifier: Apache-2.0 */
/**
 * OpenAI Chat Completions transport for the SF LLM Gateway.
 *
 * Wraps pi-ai's `streamSimpleOpenAICompletions` with the gateway's quirks:
 *
 *   - Codex tools must be flattened to Responses-flat shape.
 *   - Codex `reasoning_effort` must be in `low|medium|high`.
 *   - Any OpenAI-family model with `reasoning_effort` set needs it
 *     allow-listed via `allowed_openai_params`.
 *   - If gpt-5.5 is forced onto this fallback chat path, strip
 *     `reasoning_effort` because the gateway rejects it when combined with
 *     function tools on `/v1/chat/completions`.
 *
 * Non-OpenAI-family models pass through untouched.
 */
import {
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamSimpleOpenAICompletions } from "@earendil-works/pi-ai/compat";
import {
  injectCodexGatewayParams,
  injectOpenAiReasoningEffort,
  injectOpenAiServiceTier,
} from "./payloads.ts";
import { isCodexModelId, isOpenAiModelId, withGatewayProviderRetryDefaults } from "./shared.ts";

export function streamSfGatewayOpenAI(
  model: Model<"openai-completions">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const gatewayOptions = withGatewayProviderRetryDefaults(options);
  const existingOnPayload = gatewayOptions.onPayload;

  const wrappedOptions: SimpleStreamOptions = {
    ...gatewayOptions,
    onPayload: async (payload, payloadModel) => {
      let nextPayload = payload;

      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const objectPayload = payload as Record<string, unknown>;

        if (isCodexModelId(model.id)) {
          // The gateway now accepts pi-ai's native Chat Completions tool
          // shape `{ type: "function", function: {...} }` directly. The old
          // `flattenCodexTools` workaround that produced the Responses-API
          // shape was removed in v0.71.x — it now triggers HTTP 500 from
          // LiteLLM.
          injectCodexGatewayParams(objectPayload);
          // Codex is an OpenAI-family model — honor the gateway's priority
          // tier the same way gpt-5 does, even though Codex's Responses
          // response shape does not echo `service_tier` back.
          injectOpenAiServiceTier(objectPayload, model.id);
        } else if (isOpenAiModelId(model.id)) {
          // GPT-5 reasoning models get the strongest safe effort by default
          // and LiteLLM needs the param allow-listed when it is present.
          injectOpenAiReasoningEffort(objectPayload, model.id);
          injectOpenAiServiceTier(objectPayload, model.id);
        }

        nextPayload = objectPayload;
      }

      return existingOnPayload ? existingOnPayload(nextPayload, payloadModel) : nextPayload;
    },
  };

  return streamSimpleOpenAICompletions(model, context, wrappedOptions);
}
