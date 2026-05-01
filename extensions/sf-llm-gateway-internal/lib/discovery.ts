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
 *     name:           "SF LLM Gateway"
 *     oauth:          paste-token flow via `onPrompt`
 *
 *   Claude models register under the same provider but carry
 *   `api: "anthropic-messages"` at the per-model level, which overrides the
 *   provider-level api in pi's model registry. A single `streamSimple`
 *   dispatcher routes each request to the matching transport — the existing
 *   `streamSfGatewayOpenAI` / `streamSfGatewayAnthropic` shims are unchanged.
 *
 *   The anthropic transport needs the gateway root URL (`<gateway>`) because
 *   the Anthropic SDK appends `/v1/messages` itself, while OpenAI-compat needs
 *   `<gateway>/v1`. The dispatcher rewrites `model.baseUrl` on Claude routes
 *   before delegating.
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

// pi >= 0.71 added `name` to ProviderConfig (shown in `/login`). Our
// peerDependencies floor is 0.70.3, whose types omit the field. Registering
// with `name` works on both: pi 0.70 silently ignores the extra key, pi 0.71
// uses it for the friendly display label. The cast narrows the structural
// type assertion to one line so the rest of the config object stays typed.
type ProviderConfigWithName = ProviderConfig & { name?: string };
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
 * provider. Because Claude models carry `api: "anthropic-messages"` at the
 * per-model level, we read `model.api` and delegate accordingly. Both
 * streamers are identical to the pre-unification behavior.
 *
 * The baseUrl rewrite: the provider is registered with `<gateway>/v1` because
 * OpenAI-compat needs it, but Anthropic's SDK appends `/v1/messages` itself
 * and expects the gateway root. We forward a shallow clone of the model with
 * `baseUrl` adjusted so both SDKs hit the correct URL.
 */
function unifiedStream(
  model: Model<"openai-completions"> | Model<"anthropic-messages">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  if (model.api === "anthropic-messages") {
    const anthropicModel = {
      ...model,
      baseUrl: toGatewayRootBaseUrl(model.baseUrl),
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

  // Strip the internal `api` tag into `ProviderModelConfig.api` — pi's model
  // registry uses the per-model api to pick the API surface at request time.
  const providerModels: ProviderModelConfig[] = models.map(({ api, ...rest }) => ({
    ...rest,
    api,
  }));

  const providerConfig: ProviderConfigWithName = {
    name: PROVIDER_DISPLAY_NAME,
    baseUrl: toGatewayOpenAiBaseUrl(config.baseUrl),
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
