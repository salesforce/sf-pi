/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Provider registration + model discovery for the gateway extension.
 *
 * Single-provider design (since R1·Unify):
 *
 *   sf-llm-gateway-internal   — one provider, one `/login` row
 *     top-level api:  "openai-completions"            (covers GPT / Gemini / Codex)
 *     baseUrl:        <gateway>/v1
 *     apiKey:         saved token | env var
 *     name:           "SF LLM Gateway (Salesforce Internal)"
 *     oauth:          paste-token flow via `onPrompt`
 *
 *   All models are registered under the provider-level api so pi always
 *   invokes this provider's custom `streamSimple` dispatcher. The dispatcher
 *   detects Claude by model id and delegates to `streamSfGatewayAnthropic`
 *   (our Opus 4.7 / robust-retry shim); non-Claude models stay on
 *   `streamSfGatewayOpenAI`. The `api` tag on each model is kept internal —
 *   only the gateway-root `baseUrl` is set on Anthropic models at
 *   registration time, which is why the dispatcher no longer needs to
 *   rewrite `baseUrl` at request time (honored since pi 0.72; pi-mono #4063).
 *
 *   Do not register Anthropic models with per-model `api: "anthropic-messages"`.
 *   That would route them to pi-ai's built-in Anthropic transport before our
 *   `streamSimple` sees the request, skipping the Opus 4.7 max_tokens shim
 *   and the SSE early-error retry wrapper in transport.ts.
 *
 * Why unify?
 *   The earlier two-provider layout showed `sf-llm-gateway-internal` and
 *   `sf-llm-gateway-internal-anthropic` as separate rows in `/login`, which
 *   confused users because both use the same token and the same gateway.
 *   Unification keeps `/login` to one row and unlocks a clean token-paste
 *   experience via `oauth.onPrompt` in pi >= 0.70.
 *
 * Why keep both streamers?
 *   Mixing Claude into openai-completions was the original source of the
 *   "empty assistant turn" / "continue to unstick" bug: LiteLLM's OpenAI-compat
 *   translator splits Claude thinking + text across multiple choices and
 *   occasionally drops the final text delta from choice[0]. Routing Claude
 *   natively avoids that entire class of failure.
 */
import type {
  AssistantMessageEventStream,
  Context,
  Model,
  OAuthCredentials,
  OAuthLoginCallbacks,
  SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ProviderConfig,
  ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
  API_KEY_ENV,
  PROVIDER_DISPLAY_NAME,
  PROVIDER_NAME,
  getGatewayConfig,
  getGlobalOnlyGatewayConfig,
  globalGatewayConfigPath,
  readGatewaySavedConfig,
  writeGatewaySavedConfig,
} from "./config.ts";
import { toGatewayOpenAiBaseUrl, toGatewayRootBaseUrl } from "./gateway-url.ts";
import {
  ALWAYS_INCLUDE_MODEL_IDS,
  buildBootstrapModelList,
  buildDiscoveredModelList,
  fetchGatewayModelIds,
  fetchGatewayModelInfoMap,
  isAnthropicModelId,
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

/**
 * Unified transport dispatcher.
 *
 * pi calls `streamSimple(model, ctx, opts)` for every request against our
 * provider. We keep every registered model on the provider-level api
 * (`openai-completions`) so pi always calls this dispatcher. Claude is
 * detected by model id and delegated to the Anthropic-native shim.
 *
 * Anthropic-family models are registered with a per-model `baseUrl` pinned
 * to the gateway root (see `registerProviders` below), so pi-ai's Anthropic
 * SDK hits `<gateway>/v1/messages` correctly without any runtime rewrite.
 * The dispatcher only needs to cast the api tag over to `"anthropic-messages"`
 * before handing the model to `streamSfGatewayAnthropic`.
 */
function unifiedStream(
  model: Model<"openai-completions"> | Model<"anthropic-messages">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  if (isAnthropicModelId(model.id)) {
    const anthropicModel = {
      ...model,
      api: "anthropic-messages",
    } as Model<"anthropic-messages">;
    return streamSfGatewayAnthropic(anthropicModel, context, options);
  }
  return streamSfGatewayOpenAI(model as Model<"openai-completions">, context, options);
}

/**
 * Build the OAuth block that drives the "paste your gateway token" flow in
 * `/login`. We do not run a real OAuth server — tokens are long-lived
 * gateway API keys that the user copies from the gateway's UI.
 *
 * The block writes the pasted token to the GLOBAL saved config file, which
 * is the same file `/sf-llm-gateway-internal setup global` writes to. That
 * keeps a single source of truth and means existing env-var / saved-config
 * users are never forced through this flow.
 *
 * `getApiKey` always re-reads global config so the env var (if set) still
 * takes precedence over the saved credential — matching the rest of the
 * extension's precedence rules.
 */
function buildOAuthBlock(
  pi: ExtensionAPI,
  runtimeBetaOverrides: Set<string> | null,
  runtimeExtraBetas: Set<string>,
): {
  name: string;
  login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
  refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
  getApiKey(credentials: OAuthCredentials): string;
} {
  return {
    name: PROVIDER_DISPLAY_NAME,

    async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
      const pasted = await callbacks.onPrompt({
        message: `Paste your ${PROVIDER_DISPLAY_NAME} API token`,
      });
      const trimmed = (pasted ?? "").trim();
      if (!trimmed) {
        throw new Error("No token provided.");
      }

      // Persist to the global saved config so both interactive and
      // non-interactive commands pick it up. No cwd required — project
      // scoping is handled by `/sf-llm-gateway-internal setup project`.
      const cfgPath = globalGatewayConfigPath();
      const saved = readGatewaySavedConfig(cfgPath);
      saved.apiKey = trimmed;
      writeGatewaySavedConfig(cfgPath, saved);

      // Re-register the provider so the new key takes effect immediately.
      // No reload required — pi's registerProvider is idempotent.
      registerProviderIfConfigured(pi, runtimeBetaOverrides, runtimeExtraBetas);

      // Return a minimal credential. pi persists it in ~/.pi/agent/auth.json
      // as a "yes, logged in" marker. getApiKey below always reads from the
      // unified config so the source of truth stays single.
      return { refresh: "", access: trimmed, expires: 0 };
    },

    // Tokens are long-lived gateway API keys — no rotation to do.
    async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
      return credentials;
    },

    getApiKey(_credentials: OAuthCredentials): string {
      // Always re-read from the extension's config so env-var overrides
      // and later `setup` updates stay authoritative.
      return getGlobalOnlyGatewayConfig().apiKey ?? "";
    },
  };
}

function registerProviders(
  pi: ExtensionAPI,
  models: TaggedGatewayModel[],
  runtimeBetaOverrides: Set<string> | null,
  runtimeExtraBetas: Set<string>,
  cwd?: string,
): boolean {
  // When called from the factory before session_start, cwd is undefined.
  // Fall back to global-only config (env vars + global Pi agent saved config).
  const config = cwd ? getGatewayConfig(cwd) : getGlobalOnlyGatewayConfig();
  if (!config.enabled || !config.baseUrl) {
    pi.unregisterProvider(PROVIDER_NAME);
    return false;
  }

  // Pin per-model `baseUrl` for Anthropic-id models to the gateway root so
  // pi-ai's Anthropic SDK, which appends `/v1/messages` itself, lands on
  // `<gateway>/v1/messages` instead of the broken `<gateway>/v1/v1/messages`.
  // Honored by `pi.registerProvider()` since pi 0.72 (pi-mono #4063).
  //
  // Keep the internal `api` tag off the Pi-facing model config: if Claude
  // were registered with per-model `api: "anthropic-messages"`, pi would
  // route it to pi-ai's built-in Anthropic transport and skip our Opus 4.7
  // / robust-retry shim in transport.ts.
  const gatewayOpenAiBaseUrl = toGatewayOpenAiBaseUrl(config.baseUrl);
  const gatewayRootBaseUrl = toGatewayRootBaseUrl(config.baseUrl);
  const providerModels: ProviderModelConfig[] = models.map(({ api, ...rest }) => ({
    ...rest,
    ...(api === "anthropic-messages" ? { baseUrl: gatewayRootBaseUrl } : {}),
  }));

  const providerConfig: ProviderConfig = {
    name: PROVIDER_DISPLAY_NAME,
    baseUrl: gatewayOpenAiBaseUrl,
    apiKey: config.apiKey ?? API_KEY_ENV,
    authHeader: true,
    api: "openai-completions",
    models: providerModels,
    streamSimple: unifiedStream,
    oauth: buildOAuthBlock(pi, runtimeBetaOverrides, runtimeExtraBetas),
  };
  pi.registerProvider(PROVIDER_NAME, providerConfig);

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
    runtimeBetaOverrides,
    runtimeExtraBetas,
    cwd,
  );
}

/**
 * Discover gateway models, then re-register the provider with the best
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
      pi.unregisterProvider(PROVIDER_NAME);
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
      registerProviders(pi, models, runtimeBetaOverrides, runtimeExtraBetas, cwd);
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
