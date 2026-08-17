/* SPDX-License-Identifier: Apache-2.0 */
/** Complete Pi Provider runtime for SF LLM Gateway. */
import {
  createProvider,
  type Model,
  type Provider,
  type ProviderStreams,
  type RefreshModelsContext,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import type {
  ExtensionContext,
  ExtensionUIContext,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { PROVIDER_DISPLAY_NAME, PROVIDER_NAME } from "./config.ts";
import { toGatewayOpenAiBaseUrl, toGatewayRootBaseUrl } from "./gateway-url.ts";
import {
  buildDiscoveredModelList,
  fetchGatewayModelIdDiscovery,
  fetchGatewayModelInfoMap,
  type GatewayModelInfoMap,
  type TaggedGatewayModel,
} from "./models.ts";
import {
  filterCallableDiscoveredModelIds,
  isNoDefaultModelsAccessState,
} from "./models-internal/discovery-sentinels.ts";
import {
  GatewayModelDiscoveryError,
  type GatewayModelIdDiscovery,
} from "./models-internal/fetchers.ts";
import {
  GATEWAY_RESOLVED_ROOT_ENV,
  createGatewayProviderAuth,
  type GatewayProviderAuthController,
} from "./provider-auth.ts";
import {
  streamSfGatewayAnthropic,
  streamSfGatewayAnthropicFull,
  streamSfGatewayOpenAI,
  streamSfGatewayOpenAIFull,
  streamSfGatewayResponses,
  streamSfGatewayResponsesFull,
} from "./transport.ts";

export type GatewayApi = "anthropic-messages" | "openai-completions" | "openai-responses";

const PLACEHOLDER_ROOT = "https://gateway.invalid";

export interface GatewayNativeDiscoveryState {
  modelIds: string[];
  source: "empty" | "cache" | "gateway";
  discoveredAt?: string;
  error?: string;
  filteredModelIds?: string[];
  /** Gateway-confirmed empty access; stale cached models were intentionally cleared. */
  accessState?: "no-default-models";
}

export interface GatewayFetchers {
  modelIds(baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<GatewayModelIdDiscovery>;
  modelInfo(baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<GatewayModelInfoMap>;
}

export interface GatewayStreamImplementations {
  anthropicFull: typeof streamSfGatewayAnthropicFull;
  chatFull: typeof streamSfGatewayOpenAIFull;
  responsesFull: typeof streamSfGatewayResponsesFull;
  anthropicSimple: typeof streamSfGatewayAnthropic;
  chatSimple: typeof streamSfGatewayOpenAI;
  responsesSimple: typeof streamSfGatewayResponses;
}

export interface GatewayProviderDependencies {
  authController?: GatewayProviderAuthController;
  fetchers?: GatewayFetchers;
  streams?: GatewayStreamImplementations;
  now?: () => Date;
  placeholderRoot?: string;
}

export interface GatewayProviderRuntime {
  provider: Provider<GatewayApi>;
  authController: GatewayProviderAuthController;
  bind(
    cwd: string,
    ui: ExtensionUIContext,
    mode: ExtensionContext["mode"],
    modelRegistry?: ModelRegistry,
  ): void;
  clear(): void;
  getLastDiscovery(): GatewayNativeDiscoveryState;
}

function defaultFetchers(): GatewayFetchers {
  return {
    modelIds: fetchGatewayModelIdDiscovery,
    modelInfo: fetchGatewayModelInfoMap,
  };
}

function defaultStreams(): GatewayStreamImplementations {
  return {
    anthropicFull: streamSfGatewayAnthropicFull,
    chatFull: streamSfGatewayOpenAIFull,
    responsesFull: streamSfGatewayResponsesFull,
    anthropicSimple: streamSfGatewayAnthropic,
    chatSimple: streamSfGatewayOpenAI,
    responsesSimple: streamSfGatewayResponses,
  };
}

function nativeModel(model: TaggedGatewayModel, root: string): Model<GatewayApi> {
  return {
    ...model,
    provider: PROVIDER_NAME,
    baseUrl:
      model.api === "openai-completions"
        ? toGatewayOpenAiBaseUrl(root)
        : toGatewayRootBaseUrl(root),
  } as Model<GatewayApi>;
}

function resolvedRoot(model: Model<GatewayApi>, options?: StreamOptions): string {
  const configured = options?.env?.[GATEWAY_RESOLVED_ROOT_ENV];
  return toGatewayRootBaseUrl(configured ?? model.baseUrl);
}

function withEndpoint<TApi extends GatewayApi>(
  model: Model<TApi>,
  options?: StreamOptions,
): Model<TApi> {
  const root = resolvedRoot(model, options);
  return {
    ...model,
    baseUrl: model.api === "openai-completions" ? toGatewayOpenAiBaseUrl(root) : root,
  };
}

function createApiMap(
  streams: GatewayStreamImplementations,
): Partial<Record<GatewayApi, ProviderStreams>> {
  return {
    "anthropic-messages": {
      stream(model, context, options) {
        const routed = withEndpoint(model as Model<"anthropic-messages">, options);
        return streams.anthropicFull(routed, context, options);
      },
      streamSimple(model, context, options) {
        const routed = withEndpoint(model as Model<"anthropic-messages">, options);
        return streams.anthropicSimple(routed, context, options);
      },
    },
    "openai-completions": {
      stream(model, context, options) {
        const routed = withEndpoint(model as Model<"openai-completions">, options);
        return streams.chatFull(routed, context, options);
      },
      streamSimple(model, context, options) {
        const routed = withEndpoint(model as Model<"openai-completions">, options);
        return streams.chatSimple(routed, context, options);
      },
    },
    "openai-responses": {
      stream(model, context, options) {
        const routed = withEndpoint(model as Model<"openai-responses">, options);
        return streams.responsesFull(routed, context, options);
      },
      streamSimple(model, context, options) {
        const routed = withEndpoint(model as Model<"openai-responses">, options);
        return streams.responsesSimple(routed, context, options);
      },
    },
  };
}

function requireRefreshConfig(context: RefreshModelsContext): {
  apiKey: string;
  root: string;
} {
  if (context.signal?.aborted) throw new Error("Gateway model refresh aborted.");
  const credential = context.credential;
  const apiKey = credential?.type === "api_key" ? credential.key?.trim() : undefined;
  const root = credential?.env?.[GATEWAY_RESOLVED_ROOT_ENV];
  if (!apiKey) throw new Error("Gateway model refresh requires a resolved API key.");
  if (!root) throw new Error("Gateway model refresh requires a resolved gateway root URL.");
  return { apiKey, root: toGatewayRootBaseUrl(root) };
}

function sanitizedRefreshError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof GatewayModelDiscoveryError) return message;
  if (message === "Gateway returned zero callable models.") return message;
  if (message === "Gateway model refresh requires a resolved API key.") return message;
  if (message === "Gateway model refresh requires a resolved gateway root URL.") return message;
  return "Gateway model refresh failed. Run /sf-llm-gateway doctor.";
}

export function createGatewayProviderRuntime(
  dependencies: GatewayProviderDependencies = {},
): GatewayProviderRuntime {
  const authController = dependencies.authController ?? createGatewayProviderAuth();
  const fetchers = dependencies.fetchers ?? defaultFetchers();
  const streams = dependencies.streams ?? defaultStreams();
  const now = dependencies.now ?? (() => new Date());
  const placeholderRoot = toGatewayRootBaseUrl(dependencies.placeholderRoot ?? PLACEHOLDER_ROOT);
  const baseline: Model<GatewayApi>[] = [];

  let lastDiscovery: GatewayNativeDiscoveryState = {
    modelIds: [],
    source: "empty",
  };
  const fetchModels = async (
    context: RefreshModelsContext,
  ): Promise<readonly Model<GatewayApi>[]> => {
    const { apiKey, root } = requireRefreshConfig(context);
    try {
      const [modelIdDiscovery, modelInfo] = await Promise.all([
        fetchers.modelIds(root, apiKey, context.signal),
        fetchers.modelInfo(root, apiKey, context.signal),
      ]);
      if (context.signal?.aborted) throw new Error("Gateway model refresh aborted.");
      const callableIds = filterCallableDiscoveredModelIds(modelIdDiscovery.ids);
      const filteredIds = [
        ...new Set([
          ...modelIdDiscovery.filteredIds,
          ...modelIdDiscovery.ids.filter((id) => !callableIds.includes(id)),
        ]),
      ];
      if (isNoDefaultModelsAccessState(callableIds, filteredIds)) {
        lastDiscovery = {
          modelIds: [],
          source: "gateway",
          discoveredAt: now().toISOString(),
          filteredModelIds: filteredIds,
          accessState: "no-default-models",
        };
        // createProvider publishes this successful empty result to both its
        // in-memory catalog and Pi's provider-scoped ModelsStore. Network,
        // protocol, and ambiguous empty failures still throw and retain cache.
        return [];
      }
      if (callableIds.length === 0) {
        throw new Error("Gateway returned zero callable models.");
      }

      const models = buildDiscoveredModelList(callableIds, modelInfo).map((model) =>
        nativeModel(model, placeholderRoot),
      );
      lastDiscovery = {
        modelIds: models.map((model) => model.id),
        source: "gateway",
        discoveredAt: now().toISOString(),
        ...(filteredIds.length > 0 ? { filteredModelIds: filteredIds } : {}),
      };
      return models;
    } catch (error) {
      if (context.signal?.aborted) throw error;
      const sanitized = sanitizedRefreshError(error);
      lastDiscovery = {
        ...lastDiscovery,
        error: sanitized,
      };
      // Upstream errors can contain configured hosts or credential-shaped text.
      // eslint-disable-next-line preserve-caught-error -- redaction intentionally drops the cause.
      throw new Error(sanitized);
    }
  };

  const nativeProvider = createProvider<GatewayApi>({
    id: PROVIDER_NAME,
    name: PROVIDER_DISPLAY_NAME,
    auth: { apiKey: authController.auth },
    models: baseline,
    fetchModels,
    api: createApiMap(streams),
  });
  const provider: Provider<GatewayApi> = nativeProvider;

  const resetSessionDiagnostics = () => {
    const currentIds = provider.getModels().map((model) => model.id);
    lastDiscovery = {
      modelIds: currentIds,
      source: currentIds.length === 0 ? "empty" : "cache",
    };
  };

  return {
    provider,
    authController,
    bind(cwd, ui, mode, modelRegistry) {
      resetSessionDiagnostics();
      authController.bind(cwd, ui, mode, modelRegistry);
    },
    clear() {
      authController.clear();
      resetSessionDiagnostics();
    },
    getLastDiscovery() {
      const currentIds = provider.getModels().map((model) => model.id);
      const source =
        lastDiscovery.source === "empty" && currentIds.length > 0 ? "cache" : lastDiscovery.source;
      return {
        ...lastDiscovery,
        source,
        modelIds: currentIds,
        ...(lastDiscovery.filteredModelIds
          ? { filteredModelIds: [...lastDiscovery.filteredModelIds] }
          : {}),
      };
    },
  };
}

/** Single production runtime registered by the extension factory. */
export const gatewayProviderRuntime = createGatewayProviderRuntime();
