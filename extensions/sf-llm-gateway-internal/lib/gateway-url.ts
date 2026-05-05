/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Gateway endpoint URL helpers.
 *
 * The public OpenAI-compatible API is rooted at `/v1`, while gateway admin
 * routes such as `/user/info` live at the gateway root. Users may configure
 * either form, so normalize at the call site instead of requiring one exact
 * input shape.
 *
 * Some gateway URLs are shared as OpenAI-compatible deployment routes such as
 * `<gateway>/bedrock`. That route works for `/v1/chat/completions` and
 * `/v1/models`, but Claude-native Anthropic traffic must go to the gateway
 * root because the Anthropic SDK appends `/v1/messages` itself. If we leave
 * `/bedrock` in the root URL, the gateway can interpret the next path segment
 * (`v1`) as a model name and return `Invalid model name ... model=v1`.
 */

const V1_SUFFIX_PATTERN = /\/v1$/i;
const OPENAI_DEPLOYMENT_SUFFIX_PATTERN = /\/bedrock$/i;

function trimTrailingSlashes(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function toGatewayOpenAiBaseUrl(baseUrl: string): string {
  const normalized = trimTrailingSlashes(baseUrl);
  if (!normalized) {
    return "";
  }

  return V1_SUFFIX_PATTERN.test(normalized) ? normalized : `${normalized}/v1`;
}

export function toGatewayRootBaseUrl(baseUrl: string): string {
  const normalized = trimTrailingSlashes(baseUrl);
  if (!normalized) {
    return "";
  }

  return normalized.replace(V1_SUFFIX_PATTERN, "").replace(OPENAI_DEPLOYMENT_SUFFIX_PATTERN, "");
}
