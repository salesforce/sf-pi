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
 *   All models are registered under the provider-level api so pi always
 *   invokes this provider's custom `streamSimple` dispatcher. The dispatcher
 *   detects Claude by model id and delegates to `streamSfGatewayAnthropic`
 *   (our Opus 4.7 / early-stream retry shim); non-Claude models stay on
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
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ProviderConfig,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { createStateStore } from "../../../lib/common/state-store.ts";
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
  buildBootstrapModelList,
  buildDiscoveredModelList,
  diffModelGroupProviders,
  fetchGatewayModelGroupInfo,
  fetchGatewayModelIdDiscovery,
  fetchGatewayModelInfoMap,
  getStaticGatewayModelIds,
  isAnthropicModelId,
  type GatewayModelGroupInfoMap,
  type ModelGroupDrift,
  type TaggedGatewayModel,
} from "./models.ts";
import {
  filterCallableDiscoveredModelIds,
  hasNonCallableDiscoveredModelIds,
} from "./models-internal/discovery-sentinels.ts";
import { isGpt5FamilyResponsesModelId } from "./transport.ts";
import {
  streamSfGatewayAnthropic,
  streamSfGatewayOpenAI,
  streamSfGatewayResponses,
} from "./transport.ts";

export interface GatewayDiscoveryState {
  modelIds: string[];
  source: "gateway" | "static" | "disabled";
  error?: string;
  discoveredAt: string;
}

interface CachedDiscoveryState {
  modelIds?: string[];
  modelInfoMap?: import("./models.ts").GatewayModelInfoMap;
  modelGroupInfo?: GatewayModelGroupInfoMap;
  discoveredAt?: string;
  savedAt?: number;
}

const DISCOVERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const discoveryCacheStore = createStateStore<CachedDiscoveryState>({
  namespace: "sf-llm-gateway-internal",
  filename: "model-discovery-cache.json",
  schemaVersion: 1,
  defaults: {},
  migrate(raw, fromVersion) {
    if (fromVersion !== 0) return null;
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as CachedDiscoveryState)
      : null;
  },
});

function readDiscoveryCache(
  maxAgeMs: number = DISCOVERY_CACHE_MAX_AGE_MS,
): CachedDiscoveryState | null {
  try {
    const cache = discoveryCacheStore.read();
    if (!Array.isArray(cache.modelIds) || cache.modelIds.length === 0) return null;
    if (hasNonCallableDiscoveredModelIds(cache.modelIds)) return null;
    const modelIds = filterCallableDiscoveredModelIds(cache.modelIds);
    if (modelIds.length === 0) return null;
    if (typeof cache.savedAt !== "number") return null;
    if (Date.now() - cache.savedAt > maxAgeMs) return null;
    return { ...cache, modelIds };
  } catch {
    return null;
  }
}

function writeDiscoveryCache(
  modelIds: string[],
  modelInfoMap: import("./models.ts").GatewayModelInfoMap,
  modelGroupInfo: GatewayModelGroupInfoMap,
  discoveredAt: string,
): void {
  try {
    discoveryCacheStore.write({
      modelIds,
      modelInfoMap,
      modelGroupInfo,
      discoveredAt,
      savedAt: Date.now(),
    });
  } catch {
    // Best-effort. The static bootstrap catalog remains the fallback.
  }
}

let lastDiscovery: GatewayDiscoveryState | null = null;
let discoveryInFlight: Promise<GatewayDiscoveryState> | null = null;

/**
 * Most-recent `/model_group/info` snapshot. Captured at discovery time so
 * subsequent discoveries can diff against it without re-fetching. The
 * first snapshot seeds `lastModelGroupDrift = []` (no drift — baseline).
 */
let lastModelGroupInfo: GatewayModelGroupInfoMap | null = null;
let lastModelGroupDrift: ModelGroupDrift[] = [];

export function getLastDiscovery(): GatewayDiscoveryState | null {
  return lastDiscovery;
}

/**
 * Register the last successful gateway-discovered catalog from disk.
 *
 * Startup already has a static bootstrap catalog, but a cached discovered
 * catalog is better: it preserves any new gateway model IDs from the previous
 * run without doing live network discovery on the boot path. A later
 * fire-and-forget `discoverAndRegister` refreshes this cache and corrects any
 * drift. Explicit `/sf-llm-gateway refresh` remains live/awaited.
 */
export function registerCachedDiscoveryIfAvailable(
  pi: ExtensionAPI,
  runtimeBetaOverrides: Set<string> | null,
  runtimeExtraBetas: Set<string>,
  cwd?: string,
): boolean {
  const config = cwd ? getGatewayConfig(cwd) : getGlobalOnlyGatewayConfig();
  if (!config.enabled || !config.baseUrl) return false;

  const cache = readDiscoveryCache();
  if (!cache?.modelIds?.length) return false;

  const models = buildDiscoveredModelList(
    cache.modelIds,
    runtimeBetaOverrides,
    runtimeExtraBetas,
    cache.modelInfoMap,
  );
  registerProviders(pi, models, runtimeBetaOverrides, runtimeExtraBetas, cwd);

  if (cache.modelGroupInfo) {
    lastModelGroupInfo = cache.modelGroupInfo;
    lastModelGroupDrift = [];
  }

  lastDiscovery = {
    modelIds: models.map((model) => model.id),
    source: "gateway",
    discoveredAt: cache.discoveredAt ?? new Date(cache.savedAt ?? Date.now()).toISOString(),
  };
  return true;
}

/** Current provider-drift snapshot. Empty on the first discovery. */
export function getLastModelGroupDrift(): ModelGroupDrift[] {
  return lastModelGroupDrift;
}

/** Test-only: reset drift state between cases. */
export function __resetModelGroupDriftForTests(): void {
  lastModelGroupInfo = null;
  lastModelGroupDrift = [];
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
  model: Model<"openai-completions"> | Model<"anthropic-messages"> | Model<"openai-responses">,
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
  if (isGpt5FamilyResponsesModelId(model.id)) {
    // gpt-5, gpt-5-mini, gpt-5.5 route through `POST /responses`. Build a
    // `openai-responses` model clone for pi-ai and a chat-completions
    // fallback clone for our Responses shim's error-recovery path. Both
    // share the gateway root baseUrl so the OpenAI SDK hits
    // `<root>/responses` (not `<root>/v1/responses`, which 302s to SSO on
    // this gateway).
    const responsesModel = {
      ...model,
      api: "openai-responses",
    } as Model<"openai-responses">;
    const chatFallbackModel = {
      ...model,
      api: "openai-completions",
    } as Model<"openai-completions">;
    return streamSfGatewayResponses(responsesModel, context, options, {
      chatModel: chatFallbackModel,
    });
  }
  return streamSfGatewayOpenAI(model as Model<"openai-completions">, context, options);
}

/**
 * Build the OAuth block that drives the "paste your gateway token" flow in
 * `/login`. We do not run a real OAuth server — tokens are long-lived
 * gateway API keys that the user copies from the gateway's UI.
 *
 * The block writes the pasted token to the GLOBAL saved config file, which
 * is the same file `/sf-llm-gateway setup global` writes to. That
 * makes `/login` the key-rotation path for normal users. Saved config is
 * intentionally primary over env vars so stale shell/Keychain exports cannot
 * shadow a freshly pasted token.
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
      // scoping is handled by `/sf-llm-gateway setup project`.
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

    getApiKey(): string {
      // Always re-read from the extension's config so /login and later setup
      // updates take effect immediately without a shell restart.
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
  // Fall back to global-only config (global saved config, then env fallback).
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
  // / early-stream retry shim in transport.ts.
  const gatewayOpenAiBaseUrl = toGatewayOpenAiBaseUrl(config.baseUrl);
  const gatewayRootBaseUrl = toGatewayRootBaseUrl(config.baseUrl);
  //
  // Per-model baseUrl overrides
  //   - Anthropic models: pin to gateway root because pi-ai's SDK appends
  //     `/v1/messages` itself. Without this override the call lands on
  //     `<gateway>/v1/v1/messages` which 404s.
  //   - gpt-5.5 (openai-responses): pin to gateway root because the usable
  //     Responses endpoint on this gateway is `POST /responses` (not
  //     `/v1/responses`, which 302s to SSO). pi-ai's OpenAI SDK calls
  //     `POST <baseUrl>/responses` so rooting at `<gateway>` produces the
  //     right URL.
  // In both cases we strip the internal `api` tag before handing the model
  // to pi. Without that, pi bypasses our `streamSimple` dispatcher and
  // calls pi-ai's built-in transport directly — skipping the Opus 4.7
  // early-stream retry, the Codex fixups, and the Responses fallback-to-chat.
  const providerModels: ProviderModelConfig[] = models.map(({ api, ...rest }) => ({
    ...rest,
    ...(api === "anthropic-messages" || api === "openai-responses"
      ? { baseUrl: gatewayRootBaseUrl }
      : {}),
  }));

  const providerConfig: ProviderConfig = {
    name: PROVIDER_DISPLAY_NAME,
    baseUrl: gatewayOpenAiBaseUrl,
    apiKey: config.apiKey ?? `$${API_KEY_ENV}`,
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
        modelIds: getStaticGatewayModelIds(),
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
      // Pull /v1/models, /v1/model/info and /model_group/info in parallel.
      // The info endpoints are optional enrichment — failures resolve to an
      // empty map and the catalog keeps working with inference defaults.
      // `/model_group/info` powers provider-drift detection in status.ts;
      // its result is compared to the previous session's snapshot so a
      // silent admin reroute surfaces as a warning line.
      const [modelIdDiscovery, modelInfoMap, modelGroupInfo] = await Promise.all([
        fetchGatewayModelIdDiscovery(config.baseUrl, config.apiKey),
        fetchGatewayModelInfoMap(config.baseUrl, config.apiKey),
        fetchGatewayModelGroupInfo(config.baseUrl, config.apiKey),
      ]);

      // Diff against the previous snapshot (same-session or restored from
      // the previous `discoverAndRegister`). First run seeds the baseline
      // with an empty drift array.
      lastModelGroupDrift = lastModelGroupInfo
        ? diffModelGroupProviders(lastModelGroupInfo, modelGroupInfo)
        : [];
      lastModelGroupInfo = modelGroupInfo;

      if (modelIdDiscovery.ids.length === 0 || modelIdDiscovery.filteredIds.length > 0) {
        registerProviderIfConfigured(pi, runtimeBetaOverrides, runtimeExtraBetas, cwd);
        const state: GatewayDiscoveryState = {
          modelIds: getStaticGatewayModelIds(),
          source: "static",
          error:
            modelIdDiscovery.filteredIds.length > 0
              ? `Gateway returned non-callable model id(s): ${modelIdDiscovery.filteredIds.join(", ")}; using static catalog.`
              : "Gateway returned zero valid models; using static catalog.",
          discoveredAt: new Date().toISOString(),
        };
        lastDiscovery = state;
        return state;
      }

      const models = buildDiscoveredModelList(
        modelIdDiscovery.ids,
        runtimeBetaOverrides,
        runtimeExtraBetas,
        modelInfoMap,
      );
      registerProviders(pi, models, runtimeBetaOverrides, runtimeExtraBetas, cwd);
      const discoveredAt = new Date().toISOString();
      const discoveredModelIds = models.map((model) => model.id);
      writeDiscoveryCache(discoveredModelIds, modelInfoMap, modelGroupInfo, discoveredAt);
      const state: GatewayDiscoveryState = {
        modelIds: discoveredModelIds,
        source: "gateway",
        discoveredAt,
      };
      lastDiscovery = state;
      return state;
    } catch (error) {
      registerProviderIfConfigured(pi, runtimeBetaOverrides, runtimeExtraBetas, cwd);
      const state: GatewayDiscoveryState = {
        modelIds: getStaticGatewayModelIds(),
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
