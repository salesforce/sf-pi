/* SPDX-License-Identifier: Apache-2.0 */
/**
 * HTTP fetchers for gateway model discovery.
 *
 * All four fetchers (`/v1/models`, `/v1/model/info`, `/model_group/info`,
 * plus the bare `fetchWithTimeout` helper) live here so the rest of
 * `models.ts` can stay focused on model-shape logic. The drift comparator
 * `diffModelGroupProviders` is colocated because it consumes the
 * `/model_group/info` response shape.
 *
 * Failures in the optional enrichment endpoints (`/v1/model/info` and
 * `/model_group/info`) are deliberately swallowed — the extension must
 * keep working when the gateway admin disables them or they time out.
 */
import type { GatewayModelGroupInfoMap, GatewayModelInfoMap } from "../models.ts";
import { toGatewayOpenAiBaseUrl, toGatewayRootBaseUrl } from "../gateway-url.ts";
import { isCallableDiscoveredModelId } from "./discovery-sentinels.ts";

const MODEL_FETCH_TIMEOUT_MS = 10_000;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const MAX_DISCOVERED_MODELS = 64;

export interface GatewayModelIdDiscovery {
  ids: string[];
  filteredIds: string[];
}

export async function fetchGatewayModelIdDiscovery(
  baseUrl: string,
  apiKey: string,
): Promise<GatewayModelIdDiscovery> {
  const response = await fetchWithTimeout(
    `${toGatewayOpenAiBaseUrl(baseUrl)}/models`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    },
    MODEL_FETCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`Gateway model fetch failed (${response.status}).`);
  }

  let json: { data?: Array<{ id?: string }> };
  try {
    json = (await response.json()) as { data?: Array<{ id?: string }> };
  } catch {
    throw new Error("Gateway model response could not be parsed.");
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

export async function fetchGatewayModelIds(baseUrl: string, apiKey: string): Promise<string[]> {
  return (await fetchGatewayModelIdDiscovery(baseUrl, apiKey)).ids;
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
        litellmProvider:
          typeof mi.litellm_provider === "string" ? (mi.litellm_provider as string) : undefined,
        maxInputTokens: typeof mi.max_input_tokens === "number" ? mi.max_input_tokens : undefined,
        maxOutputTokens:
          typeof mi.max_output_tokens === "number" ? mi.max_output_tokens : undefined,
        inputCostPerToken:
          typeof mi.input_cost_per_token === "number" ? mi.input_cost_per_token : undefined,
        outputCostPerToken:
          typeof mi.output_cost_per_token === "number" ? mi.output_cost_per_token : undefined,
        cacheReadCostPerToken:
          typeof mi.cache_read_input_token_cost === "number"
            ? mi.cache_read_input_token_cost
            : undefined,
        cacheWriteCostPerToken:
          typeof mi.cache_creation_input_token_cost === "number"
            ? mi.cache_creation_input_token_cost
            : undefined,
        supportsReasoning:
          typeof mi.supports_reasoning === "boolean" ? mi.supports_reasoning : undefined,
        supportsVision: typeof mi.supports_vision === "boolean" ? mi.supports_vision : undefined,
        supportsFunctionCalling:
          typeof mi.supports_function_calling === "boolean"
            ? mi.supports_function_calling
            : undefined,
        supportsPromptCaching:
          typeof mi.supports_prompt_caching === "boolean" ? mi.supports_prompt_caching : undefined,
        rpm: typeof mi.rpm === "number" ? mi.rpm : undefined,
        tpm: typeof mi.tpm === "number" ? mi.tpm : undefined,
      };
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Fetch the `/model_group/info` snapshot, collapsed to `{group -> providers[]}`.
 * Failures are swallowed so this enrichment is strictly optional.
 */
export async function fetchGatewayModelGroupInfo(
  baseUrl: string,
  apiKey: string,
): Promise<GatewayModelGroupInfoMap> {
  try {
    const response = await fetchWithTimeout(
      `${toGatewayRootBaseUrl(baseUrl)}/model_group/info`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
      MODEL_FETCH_TIMEOUT_MS,
    );

    if (!response.ok) return {};

    const json = (await response.json()) as {
      data?: Array<{
        model_group?: string;
        providers?: unknown;
      }>;
    };

    const map: GatewayModelGroupInfoMap = {};
    for (const entry of json.data || []) {
      const group = typeof entry.model_group === "string" ? entry.model_group.trim() : "";
      if (!group) continue;
      const providers = Array.isArray(entry.providers)
        ? entry.providers.filter((p): p is string => typeof p === "string").sort()
        : [];
      map[group] = { modelGroup: group, providers };
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Compare two model-group snapshots and return the set of groups whose
 * providers changed. Pure function, exported for unit tests.
 */
export interface ModelGroupDrift {
  modelGroup: string;
  previousProviders: string[];
  currentProviders: string[];
}

export function diffModelGroupProviders(
  previous: GatewayModelGroupInfoMap,
  current: GatewayModelGroupInfoMap,
): ModelGroupDrift[] {
  const groups = new Set<string>([...Object.keys(previous), ...Object.keys(current)]);
  const drift: ModelGroupDrift[] = [];
  for (const group of groups) {
    const prev = previous[group]?.providers ?? [];
    const curr = current[group]?.providers ?? [];
    if (prev.length !== curr.length || prev.some((p, i) => p !== curr[i])) {
      drift.push({ modelGroup: group, previousProviders: prev, currentProviders: curr });
    }
  }
  return drift.sort((a, b) => a.modelGroup.localeCompare(b.modelGroup));
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
