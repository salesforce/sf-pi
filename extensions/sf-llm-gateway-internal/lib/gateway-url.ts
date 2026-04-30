/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Gateway endpoint URL helpers.
 *
 * The public OpenAI-compatible API is rooted at `/v1`, while gateway admin
 * routes such as `/user/info` live at the gateway root. Users may configure
 * either form, so normalize at the call site instead of requiring one exact
 * input shape.
 */

const V1_SUFFIX_PATTERN = /\/v1$/i;

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

  return normalized.replace(V1_SUFFIX_PATTERN, "");
}
