/* SPDX-License-Identifier: Apache-2.0 */
/**
 * HTTP fetchers for gateway model discovery.
 *
 * Callable IDs and neutral client-facing metadata live here so the rest of
 * `models.ts` can stay focused on model-shape logic. Metadata enrichment is
 * optional and never exposes backend placement.
 */
import type { GatewayModelInfoMap } from "../models.ts";
import { toGatewayOpenAiBaseUrl } from "../gateway-url.ts";
import { isCallableDiscoveredModelId } from "./discovery-sentinels.ts";

const MODEL_FETCH_TIMEOUT_MS = 10_000;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const MAX_DISCOVERED_MODELS = 64;

export interface GatewayModelIdDiscovery {
  ids: string[];
  filteredIds: string[];
}

/** Safe, public diagnostic produced by the required model-discovery request. */
export class GatewayModelDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayModelDiscoveryError";
  }
}

function modelDiscoveryHttpError(status: number): GatewayModelDiscoveryError {
  if (status === 401 || status === 403) {
    return new GatewayModelDiscoveryError(
      `Gateway model discovery authentication failed (${status}). Run /sf-llm-gateway doctor.`,
    );
  }
  if (status === 404) {
    return new GatewayModelDiscoveryError(
      "Gateway model discovery endpoint was not found (404). Run /sf-llm-gateway doctor.",
    );
  }
  if (status >= 500) {
    return new GatewayModelDiscoveryError(
      `Gateway model discovery service failed (${status}). Run /sf-llm-gateway doctor.`,
    );
  }
  return new GatewayModelDiscoveryError(
    `Gateway model discovery request failed (${status}). Run /sf-llm-gateway doctor.`,
  );
}

export async function fetchGatewayModelIdDiscovery(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<GatewayModelIdDiscovery> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${toGatewayOpenAiBaseUrl(baseUrl)}/models`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal,
      },
      MODEL_FETCH_TIMEOUT_MS,
    );
  } catch (error) {
    // Pi-owned cancellation must retain its original abort reason. Internal
    // timeout/network failures are converted to public-safe guidance.
    if (signal?.aborted) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GatewayModelDiscoveryError(
        "Gateway model discovery timed out after 10 seconds. Run /sf-llm-gateway doctor.",
      );
    }
    throw new GatewayModelDiscoveryError(
      "Gateway model discovery request failed. Run /sf-llm-gateway doctor.",
    );
  }

  if (!response.ok) {
    throw modelDiscoveryHttpError(response.status);
  }

  let json: { data?: Array<{ id?: string }> };
  try {
    json = (await response.json()) as { data?: Array<{ id?: string }> };
  } catch {
    throw new GatewayModelDiscoveryError(
      "Gateway model discovery returned an invalid response. Run /sf-llm-gateway doctor.",
    );
  }

  const ids: string[] = [];
  const filteredIds: string[] = [];
  const seen = new Set<string>();
  const seenFiltered = new Set<string>();
  for (const entry of json.data || []) {
    const id = (entry.id || "").trim();
    if (!MODEL_ID_PATTERN.test(id)) continue;
    if (!isCallableDiscoveredModelId(id)) {
      if (!seenFiltered.has(id)) {
        seenFiltered.add(id);
        filteredIds.push(id);
      }
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_DISCOVERED_MODELS) break;
  }
  return { ids, filteredIds };
}

export async function fetchGatewayModelIds(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  return (await fetchGatewayModelIdDiscovery(baseUrl, apiKey, signal)).ids;
}

/**
 * Fetch richer per-model metadata from `/v1/model/info` and return a map
 * keyed by `model_name`. Failures are swallowed because enrichment is
 * strictly optional — the extension must keep working even when the info
 * endpoint times out or 500s.
 */
export async function fetchGatewayModelInfoMap(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<GatewayModelInfoMap> {
  try {
    const response = await fetchWithTimeout(
      `${toGatewayOpenAiBaseUrl(baseUrl)}/model/info`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal,
      },
      MODEL_FETCH_TIMEOUT_MS,
    );

    if (!response.ok) {
      return {};
    }

    const json = (await response.json()) as {
      data?: Array<{
        model_name?: string;
        model_info?: Record<string, unknown>;
        litellm_params?: Record<string, unknown>;
      }>;
    };

    const map: GatewayModelInfoMap = {};
    for (const entry of json.data || []) {
      const id = typeof entry.model_name === "string" ? entry.model_name.trim() : "";
      if (!id || !MODEL_ID_PATTERN.test(id)) continue;
      if (!isCallableDiscoveredModelId(id)) continue;
      const mi = entry.model_info ?? {};
      map[id] = {
        id,
        mode: typeof mi.mode === "string" ? (mi.mode as string) : undefined,
        maxInputTokens: typeof mi.max_input_tokens === "number" ? mi.max_input_tokens : undefined,
        maxOutputTokens:
          typeof mi.max_output_tokens === "number" ? mi.max_output_tokens : undefined,
        supportsReasoning:
          typeof mi.supports_reasoning === "boolean" ? mi.supports_reasoning : undefined,
        supportsVision: typeof mi.supports_vision === "boolean" ? mi.supports_vision : undefined,
        supportsFunctionCalling:
          typeof mi.supports_function_calling === "boolean"
            ? mi.supports_function_calling
            : undefined,
        supportsPromptCaching:
          typeof mi.supports_prompt_caching === "boolean" ? mi.supports_prompt_caching : undefined,
      };
    }
    return map;
  } catch (error) {
    if (signal?.aborted) throw error;
    return {};
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;

  try {
    return await fetch(url, { ...init, signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
