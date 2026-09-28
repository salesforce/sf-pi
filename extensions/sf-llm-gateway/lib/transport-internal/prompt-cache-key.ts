/* SPDX-License-Identifier: Apache-2.0 */
/** Omit an optional OpenAI cache-affinity field on Gateway-compatible requests. */
import type { Api, Model, StreamOptions } from "@earendil-works/pi-ai";

export function omitGatewayPromptCacheKey<T extends StreamOptions>(
  model: Model<Api>,
  options?: T,
): T | undefined {
  if (model.provider !== "sf-llm-gateway") return options;

  return {
    ...options,
    async onPayload(payload: unknown, requestModel: Model<Api>) {
      const replacement = await options?.onPayload?.(payload, requestModel);
      const next = replacement === undefined ? payload : replacement;
      if (!next || typeof next !== "object" || !Object.hasOwn(next, "prompt_cache_key")) {
        return replacement;
      }
      const filtered = { ...next } as Record<string, unknown>;
      delete filtered.prompt_cache_key;
      return filtered;
    },
  } as T;
}
