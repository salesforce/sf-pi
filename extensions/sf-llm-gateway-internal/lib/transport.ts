/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Gateway transport barrel.
 *
 * Historically all gateway transport code lived in this single file
 * (~1200 LOC). It now re-exports from the focused modules under
 * `./transport-internal/`:
 *
 *   - `transport-internal/shared.ts`       constants, types, model-id detection,
 *                                          error formatting, early-stream retry
 *   - `transport-internal/payloads.ts`     payload mutators (codex tools, OpenAI
 *                                          service tier, reasoning effort,
 *                                          Opus 4.7 max-token policy)
 *   - `transport-internal/anthropic.ts`    streamSfGatewayAnthropic
 *   - `transport-internal/openai-chat.ts`  streamSfGatewayOpenAI
 *   - `transport-internal/openai-responses.ts`  streamSfGatewayResponses + fallback
 *
 * Existing consumers (`./provider.ts`, `./models.ts`, every test file)
 * keep importing from `./transport.ts`. Internal callers should prefer the
 * focused modules so the dependency graph stays minimal.
 *
 * See the file-level doc-comment in `./transport-internal/shared.ts` for
 * the gateway-quirk rationale that drove each shim.
 */

export {
  OPUS_47_DEFAULT_MAX_TOKENS,
  OPUS_47_MODEL_MAX_TOKENS,
  GATEWAY_PROVIDER_DEFAULT_MAX_RETRIES,
  annotateErrorWithGuidance,
  extractOpusMinorVersion,
  formatAnthropicStreamError,
  isCodexModelId,
  isGpt55ModelId,
  isGpt56BedrockResponsesModelId,
  isGpt56FamilyResponsesModelId,
  isGpt5BedrockResponsesModelId,
  isGpt5FamilyResponsesModelId,
  isOpenAiModelId,
  isOpenAiReasoningModelId,
  isOpus46OrNewerModelId,
  isOpus47ModelId,
  isOpus47OrNewerModelId,
  resolveGatewayProviderMaxRetries,
  resolveOpenAiReasoningEffort,
  resolveOpus47MaxTokensFloor,
  streamAnthropicWithRobustRetry,
  withGatewayProviderRetryDefaults,
  type RobustRetryTestHooks,
} from "./transport-internal/shared.ts";

export {
  allowReasoningEffortParam,
  applyOpus47MaxThinking,
  injectCodexGatewayParams,
  injectOpenAiReasoningEffort,
  injectOpenAiServiceTier,
  normalizeCodexReasoningEffort,
  stripReasoningEffortForGpt55,
} from "./transport-internal/payloads.ts";

export {
  streamSfGatewayAnthropic,
  streamSfGatewayAnthropicFull,
  type GatewayAnthropicFullTestHooks,
} from "./transport-internal/anthropic.ts";
export {
  streamSfGatewayOpenAI,
  streamSfGatewayOpenAIFull,
  type GatewayOpenAIFullTestHooks,
} from "./transport-internal/openai-chat.ts";
export {
  GPT5_BEDROCK_EARLY_DONE_GRACE_MS,
  GPT5_FORCE_CHAT_ENV,
  GPT55_FORCE_CHAT_ENV,
  streamSfGatewayResponses,
  streamSfGatewayResponsesFull,
  type Gpt55ResponsesTestHooks,
  type Gpt5ResponsesFullTestHooks,
} from "./transport-internal/openai-responses.ts";
