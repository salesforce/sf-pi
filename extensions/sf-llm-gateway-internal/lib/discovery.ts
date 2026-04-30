/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Provider registration + model discovery for the gateway extension.
 *
 * Two providers are registered so each model family runs on the pi-ai
 * transport it was designed for:
 *
 *   sf-llm-gateway-internal            → openai-completions (Gemini, GPT, Codex)
 *       baseUrl = <gateway>/v1   (pi-ai appends /chat/completions)
 *
 *   sf-llm-gateway-internal-anthropic  → anthropic-messages (Claude)
 *       baseUrl = <gateway>      (Anthropic SDK appends /v1/messages)
 *
 * Mixing Claude into openai-completions was the original source of the
 * "empty assistant turn" / "continue to unstick" bug: LiteLLM's OpenAI-compat
 * translator splits Claude thinking + text across multiple choices and
 * occasionally drops the final text delta from choice[0]. Routing Claude
 * natively avoids that entire class of failure.
 *
 * The Anthropic provider uses a custom `streamSimple` to normalize Anthropic
 * SSE error envelopes and to send Opus 4.7 adaptive thinking with the
 * gateway-safe output cap. See lib/transport.ts.
 */
import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import {
  API_KEY_ENV,
  PROVIDER_NAME,
  PROVIDER_NAME_ANTHROPIC,
  getGatewayConfig,
  getGlobalOnlyGatewayConfig,
} from "./config.ts";
import { toGatewayOpenAiBaseUrl, toGatewayRootBaseUrl } from "./gateway-url.ts";
import {
  ALWAYS_INCLUDE_MODEL_IDS,
  buildBootstrapModelList,
  buildDiscoveredModelList,
  fetchGatewayModelIds,
  fetchGatewayModelInfoMap,
  type TaggedGatewayModel,
} from "./models.ts";
import { streamSfGatewayAnthropic, streamSfGatewayOpenAI } from "./transport.ts";

export interface GatewayDiscoveryState {
  modelIds: string[];
  source: "gateway" | "static" | "disabled";
  error?: string;
  discoveredAt: string;
}

let lastDiscovery: GatewayDiscoveryState | null = null;
let discoveryInFlight: Promise<GatewayDiscoveryState> | null = null;

export function getLastDiscovery(): GatewayDiscoveryState | null {
  return lastDiscovery;
}

/** Split a tagged catalog into the two provider-specific lists. */
function splitByApi(models: TaggedGatewayModel[]): {
  openaiModels: ProviderModelConfig[];
  anthropicModels: ProviderModelConfig[];
} {
  const openaiModels: ProviderModelConfig[] = [];
  const anthropicModels: ProviderModelConfig[] = [];
  for (const model of models) {
    // Strip the internal `api` tag before handing the config to Pi — each
    // provider registration pins a single api, which Pi applies uniformly.
    const { api, ...rest } = model;
    if (api === "anthropic-messages") {
      anthropicModels.push(rest);
    } else {
      openaiModels.push(rest);
    }
  }
  return { openaiModels, anthropicModels };
}

function unregisterAll(pi: ExtensionAPI): void {
  pi.unregisterProvider(PROVIDER_NAME);
  pi.unregisterProvider(PROVIDER_NAME_ANTHROPIC);
}

function registerProviders(pi: ExtensionAPI, models: TaggedGatewayModel[], cwd?: string): boolean {
  // When called from the factory before session_start, cwd is undefined.
  // Fall back to global-only config (env vars + global Pi agent saved config).
  const config = cwd ? getGatewayConfig(cwd) : getGlobalOnlyGatewayConfig();
  if (!config.enabled || !config.baseUrl) {
    unregisterAll(pi);
    return false;
  }

  const { openaiModels, anthropicModels } = splitByApi(models);

  // OpenAI-compat provider — always registered so Gemini/GPT/Codex work even
  // when the catalog happens to contain zero Claude entries.
  pi.registerProvider(PROVIDER_NAME, {
    baseUrl: toGatewayOpenAiBaseUrl(config.baseUrl),
    apiKey: config.apiKey ?? API_KEY_ENV,
    authHeader: true,
    api: "openai-completions",
    models: openaiModels,
    streamSimple: streamSfGatewayOpenAI,
  });

  if (anthropicModels.length > 0) {
    pi.registerProvider(PROVIDER_NAME_ANTHROPIC, {
      // Anthropic SDK appends `/v1/messages`, so baseUrl must be the gateway
      // root. If the user configured `.../v1`, strip it back to the root here.
      baseUrl: toGatewayRootBaseUrl(config.baseUrl),
      apiKey: config.apiKey ?? API_KEY_ENV,
      authHeader: true,
      api: "anthropic-messages",
      models: anthropicModels,
      streamSimple: streamSfGatewayAnthropic,
    });
  } else {
    // No Claude models in this catalog — make sure a stale registration from
    // a previous catalog does not linger.
    pi.unregisterProvider(PROVIDER_NAME_ANTHROPIC);
  }

  return true;
}

/** Register the static bootstrap catalog only — no network calls. */
export function registerProviderIfConfigured(
  pi: ExtensionAPI,
  runtimeBetaOverrides: Set<string> | null,
  runtimeExtraBetas: Set<string>,
  cwd?: string,
): boolean {
  return registerProviders(
    pi,
    buildBootstrapModelList(runtimeBetaOverrides, runtimeExtraBetas),
    cwd,
  );
}

/**
 * Discover gateway models, then re-register the providers with the best
 * available catalog. All failure paths fall back to the static catalog so the
 * extension keeps working during outages.
 */
export async function discoverAndRegister(
  pi: ExtensionAPI,
  runtimeBetaOverrides: Set<string> | null,
  runtimeExtraBetas: Set<string>,
  cwd: string,
): Promise<GatewayDiscoveryState> {
  if (discoveryInFlight) {
    return discoveryInFlight;
  }

  discoveryInFlight = (async (): Promise<GatewayDiscoveryState> => {
    const config = getGatewayConfig(cwd);

    if (!config.enabled) {
      unregisterAll(pi);
      const state: GatewayDiscoveryState = {
        modelIds: [],
        source: "disabled",
        error: "Provider disabled via saved config.",
        discoveredAt: new Date().toISOString(),
      };
      lastDiscovery = state;
      return state;
    }

    if (!config.baseUrl || !config.apiKey) {
      registerProviderIfConfigured(pi, runtimeBetaOverrides, runtimeExtraBetas, cwd);
      const state: GatewayDiscoveryState = {
        modelIds: ALWAYS_INCLUDE_MODEL_IDS,
        source: config.baseUrl ? "static" : "disabled",
        error: !config.baseUrl
          ? "Missing base URL configuration."
          : `Missing ${API_KEY_ENV} or saved API key; using static catalog.`,
        discoveredAt: new Date().toISOString(),
      };
      lastDiscovery = state;
      return state;
    }

    try {
      // Pull /v1/models and /v1/model/info in parallel. The info endpoint is
      // optional enrichment — failures resolve to an empty map and the
      // catalog keeps working with inference defaults.
      const [allIds, modelInfoMap] = await Promise.all([
        fetchGatewayModelIds(config.baseUrl, config.apiKey),
        fetchGatewayModelInfoMap(config.baseUrl, config.apiKey),
      ]);

      if (allIds.length === 0) {
        registerProviderIfConfigured(pi, runtimeBetaOverrides, runtimeExtraBetas, cwd);
        const state: GatewayDiscoveryState = {
          modelIds: ALWAYS_INCLUDE_MODEL_IDS,
          source: "static",
          error: "Gateway returned zero valid models; using static catalog.",
          discoveredAt: new Date().toISOString(),
        };
        lastDiscovery = state;
        return state;
      }

      const models = buildDiscoveredModelList(
        allIds,
        runtimeBetaOverrides,
        runtimeExtraBetas,
        modelInfoMap,
      );
      registerProviders(pi, models, cwd);
      const state: GatewayDiscoveryState = {
        modelIds: models.map((model) => model.id),
        source: "gateway",
        discoveredAt: new Date().toISOString(),
      };
      lastDiscovery = state;
      return state;
    } catch (error) {
      registerProviderIfConfigured(pi, runtimeBetaOverrides, runtimeExtraBetas, cwd);
      const state: GatewayDiscoveryState = {
        modelIds: ALWAYS_INCLUDE_MODEL_IDS,
        source: "static",
        error: error instanceof Error ? error.message : String(error),
        discoveredAt: new Date().toISOString(),
      };
      lastDiscovery = state;
      return state;
    }
  })();

  try {
    return await discoveryInFlight;
  } finally {
    discoveryInFlight = null;
  }
}
