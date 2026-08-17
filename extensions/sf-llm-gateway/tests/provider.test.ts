/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proofs for the complete native SF LLM Gateway Provider. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type Api,
  type ApiKeyAuth,
  type AssistantMessage,
  type Context,
  type Model,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import { ModelRuntime, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { compareVersions, getInstalledPiVersion } from "../../../lib/common/pi-compat.ts";
import { PROVIDER_NAME } from "../lib/config.ts";
import type { GatewayModelInfoMap } from "../lib/models.ts";
import type { GatewayModelIdDiscovery } from "../lib/models-internal/fetchers.ts";
import {
  GATEWAY_RESOLVED_ROOT_ENV,
  type GatewayProviderAuthController,
} from "../lib/provider-auth.ts";
import {
  createGatewayProviderRuntime,
  type GatewayApi,
  type GatewayFetchers,
  type GatewayStreamImplementations,
} from "../lib/provider.ts";

const EMPTY_CONTEXT: Context = { systemPrompt: "", messages: [], tools: [] };
const UNUSED_UI = {} as ExtensionUIContext;

function completedStream(model: Model<Api>, text = "ok") {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "stop", message });
    stream.end();
  });
  return stream;
}

function authController(root = "https://active.example.test/v1"): GatewayProviderAuthController {
  const auth: ApiKeyAuth = {
    name: "test",
    async resolve({ credential }) {
      return credential?.key
        ? {
            auth: { apiKey: credential.key },
            env: { [GATEWAY_RESOLVED_ROOT_ENV]: root },
            source: "test credential",
          }
        : undefined;
    },
  };
  return {
    auth,
    bind: vi.fn(),
    clear: vi.fn(),
    getActiveCwd: vi.fn(() => undefined),
    hasConfiguredCredential: vi.fn(async () => false),
    resolveRuntimeAuth: vi.fn(async () => undefined),
  };
}

function fetchers(
  ids: GatewayModelIdDiscovery = {
    ids: ["example-chat-model", "example-claude-model", "example-responses-model"],
    filteredIds: [],
  },
  modelInfo: GatewayModelInfoMap = {
    "example-responses-model": { id: "example-responses-model", mode: "responses" },
  },
): GatewayFetchers {
  return {
    modelIds: vi.fn(async () => ids),
    modelInfo: vi.fn(async () => modelInfo),
  };
}

interface StreamCall {
  kind: "stream" | "simple";
  api: string;
  modelId: string;
  baseUrl: string;
  apiKey?: string;
  resolvedRoot?: string;
}

function streams(calls: StreamCall[]): GatewayStreamImplementations {
  return {
    anthropicFull(model, _context, options) {
      calls.push(call("stream", "anthropic-messages", model, options));
      return completedStream(model);
    },
    chatFull(model, _context, options) {
      calls.push(call("stream", "openai-completions", model, options));
      return completedStream(model);
    },
    responsesFull(model, _context, options) {
      calls.push(call("stream", "openai-responses", model, options));
      return completedStream(model);
    },
    anthropicSimple(model, _context, options) {
      calls.push(call("simple", "anthropic-messages", model, options));
      return completedStream(model);
    },
    chatSimple(model, _context, options) {
      calls.push(call("simple", "openai-completions", model, options));
      return completedStream(model);
    },
    responsesSimple(model, _context, options) {
      calls.push(call("simple", "openai-responses", model, options));
      return completedStream(model);
    },
  };
}

function call(
  kind: "stream" | "simple",
  api: string,
  model: Model<Api>,
  options?: StreamOptions,
): StreamCall {
  return {
    kind,
    api,
    modelId: model.id,
    baseUrl: model.baseUrl,
    apiKey: options?.apiKey,
    resolvedRoot: options?.env?.[GATEWAY_RESOLVED_ROOT_ENV],
  };
}

async function configuredModels(runtime: ReturnType<typeof createGatewayProviderRuntime>) {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(PROVIDER_NAME, async () => ({ type: "api_key", key: "native-key" }));
  const modelsStore = new InMemoryModelsStore();
  const models = createModels({ credentials, modelsStore });
  models.setProvider(runtime.provider);
  return { credentials, modelsStore, models };
}

function cachedModel(id = "cached-only"): Model<"openai-completions"> {
  return {
    id,
    name: id,
    provider: PROVIDER_NAME,
    api: "openai-completions",
    baseUrl: "https://cached.example.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

describe("complete native Gateway Provider", () => {
  it("starts with an empty catalog and performs no construction network", () => {
    const network = fetchers();
    const controller = authController();
    const runtime = createGatewayProviderRuntime({
      authController: controller,
      fetchers: network,
      now: () => new Date("2026-07-23T00:00:00.000Z"),
    });

    expect(runtime.provider.id).toBe(PROVIDER_NAME);
    expect(runtime.provider.name).toBe("SF LLM Gateway");
    expect(runtime.provider.getModels()).toEqual([]);
    expect(runtime.getLastDiscovery()).toEqual({
      source: "empty",
      modelIds: [],
    });
    expect(network.modelIds).not.toHaveBeenCalled();
    expect(network.modelInfo).not.toHaveBeenCalled();

    runtime.bind("/workspace", UNUSED_UI, "tui");
    runtime.clear();
    expect(controller.bind).toHaveBeenCalledWith("/workspace", UNUSED_UI, "tui", undefined);
    expect(controller.clear).toHaveBeenCalledTimes(1);
    expect(network.modelIds).not.toHaveBeenCalled();
  });

  it("keeps models.json overrides above the cached dynamic Provider catalog", async () => {
    const gateway = createGatewayProviderRuntime({ authController: authController() });
    const cached = cachedModel("example-discovered-model");
    const modelsStore = new InMemoryModelsStore();
    await modelsStore.write(PROVIDER_NAME, { models: [cached], checkedAt: 1 });
    const credentials = new InMemoryCredentialStore();
    await credentials.modify(PROVIDER_NAME, async () => ({ type: "api_key", key: "native-key" }));
    const nativeModels = createModels({ credentials, modelsStore });
    nativeModels.setProvider(gateway.provider);
    await nativeModels.refresh({ allowNetwork: false });
    const dir = mkdtempSync(path.join(tmpdir(), "sf-pi-m3a-model-overrides-"));
    const modelsPath = path.join(dir, "models.json");
    writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          [PROVIDER_NAME]: {
            modelOverrides: {
              [cached.id]: { name: "User Override", maxTokens: 777 },
            },
          },
        },
      }),
    );
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsStore,
      modelsPath,
      allowModelNetwork: false,
    });

    runtime.registerNativeProvider(gateway.provider);

    expect(runtime.getModel(PROVIDER_NAME, cached.id)).toMatchObject({
      name: "User Override",
      maxTokens: 777,
    });
  });

  it("dispatches real API tags with family-correct endpoints and native auth for simple and full streams", async () => {
    const calls: StreamCall[] = [];
    const runtime = createGatewayProviderRuntime({
      authController: authController("https://active.example.test/v1"),
      fetchers: fetchers(),
      streams: streams(calls),
    });
    const { models } = await configuredModels(runtime);
    await models.refresh({ allowNetwork: true });
    const byApi = new Map(runtime.provider.getModels().map((model) => [model.api, model]));

    for (const api of ["anthropic-messages", "openai-completions", "openai-responses"] as const) {
      const model = byApi.get(api);
      expect(model).toBeDefined();
      if (!model) continue;
      await models.completeSimple(model, EMPTY_CONTEXT);
      await models.complete(model, EMPTY_CONTEXT);
    }

    expect(calls).toHaveLength(6);
    for (const entry of calls) {
      expect(entry.apiKey).toBe("native-key");
      expect(entry.resolvedRoot).toBe("https://active.example.test/v1");
      expect(entry.baseUrl).toBe(
        entry.api === "openai-completions"
          ? "https://active.example.test/v1"
          : "https://active.example.test",
      );
    }
  });

  it("restores Pi's cached catalog, replaces it on discovery, and retains it on failure", async () => {
    const network = fetchers({
      ids: ["example-responses-model", "fresh-chat", "no-default-models"],
      filteredIds: ["no-default-models"],
    });
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: network,
      now: () => new Date("2026-07-23T01:02:03.000Z"),
    });
    const { models, modelsStore } = await configuredModels(runtime);
    await modelsStore.write(PROVIDER_NAME, {
      models: [
        cachedModel(),
        { ...cachedModel("example-responses-model"), name: "Cached GPT override" },
      ],
      checkedAt: 1,
    });

    await models.refresh({ allowNetwork: false });
    expect(models.getModel(PROVIDER_NAME, "cached-only")).toBeDefined();
    expect(models.getModel(PROVIDER_NAME, "example-responses-model")?.name).toBe(
      "Cached GPT override",
    );
    expect(
      models.getModels(PROVIDER_NAME).filter((model) => model.id === "example-responses-model"),
    ).toHaveLength(1);
    expect(runtime.getLastDiscovery()).toEqual({
      source: "cache",
      modelIds: runtime.provider.getModels().map((model) => model.id),
    });
    expect(network.modelIds).not.toHaveBeenCalled();

    const refreshed = await models.refresh({ allowNetwork: true });
    expect(refreshed.errors.size).toBe(0);
    const modelIdCall = vi.mocked(network.modelIds).mock.calls[0];
    const modelInfoCall = vi.mocked(network.modelInfo).mock.calls[0];
    expect(modelIdCall?.slice(0, 2)).toEqual(["https://active.example.test", "native-key"]);
    expect(modelInfoCall?.slice(0, 2)).toEqual(["https://active.example.test", "native-key"]);
    // Pi 0.84 always supplies a concrete signal; Pi 0.82/0.83 may omit it.
    if (modelIdCall?.[2] !== undefined) expect(modelIdCall[2]).toBeInstanceOf(AbortSignal);
    if (modelInfoCall?.[2] !== undefined) expect(modelInfoCall[2]).toBeInstanceOf(AbortSignal);
    expect(models.getModel(PROVIDER_NAME, "cached-only")).toBeUndefined();
    expect(models.getModel(PROVIDER_NAME, "example-responses-model")?.name).not.toBe(
      "Cached GPT override",
    );
    expect(
      models.getModels(PROVIDER_NAME).filter((model) => model.id === "example-responses-model"),
    ).toHaveLength(1);
    expect(models.getModels(PROVIDER_NAME)).toHaveLength(2);
    expect(models.getModel(PROVIDER_NAME, "fresh-chat")).toMatchObject({
      provider: PROVIDER_NAME,
      api: "openai-completions",
      baseUrl: "https://gateway.invalid/v1",
    });
    expect(runtime.getLastDiscovery()).toEqual({
      modelIds: runtime.provider.getModels().map((model) => model.id),
      source: "gateway",
      discoveredAt: "2026-07-23T01:02:03.000Z",
      filteredModelIds: ["no-default-models"],
    });
    const persisted = await modelsStore.read(PROVIDER_NAME);
    expect(persisted?.models.map((model) => model.id)).toEqual([
      "example-responses-model",
      "fresh-chat",
    ]);
    const serializedStore = JSON.stringify(persisted);
    expect(serializedStore).not.toContain("active.example.test");
    expect(serializedStore).not.toContain("native-key");
    expect(serializedStore).toContain("gateway.invalid");

    vi.mocked(network.modelIds).mockRejectedValueOnce(
      new Error("gateway unavailable at https://active.example.test?token=native-key"),
    );
    const failed = await models.refresh({ allowNetwork: true });
    expect(failed.errors.get(PROVIDER_NAME)?.message).toBe(
      "Gateway model refresh failed. Run /sf-llm-gateway doctor.",
    );
    expect(models.getModel(PROVIDER_NAME, "fresh-chat")).toBeDefined();
    expect((await modelsStore.read(PROVIDER_NAME))?.models.map((model) => model.id)).toEqual([
      "example-responses-model",
      "fresh-chat",
    ]);
    expect(runtime.getLastDiscovery()).toEqual({
      source: "gateway",
      modelIds: runtime.provider.getModels().map((model) => model.id),
      discoveredAt: "2026-07-23T01:02:03.000Z",
      filteredModelIds: ["no-default-models"],
      error: "Gateway model refresh failed. Run /sf-llm-gateway doctor.",
    });
    expect(JSON.stringify(runtime.getLastDiscovery())).not.toMatch(/active\.example|native-key/u);
  });

  it("retains last-known models when an in-flight refresh is aborted", async () => {
    let signalFetchStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalFetchStarted = resolve;
    });
    const network = fetchers({ ids: ["unused"], filteredIds: [] });
    vi.mocked(network.modelIds).mockImplementation(
      async (_root, _key, signal) =>
        new Promise<GatewayModelIdDiscovery>((_resolve, reject) => {
          signalFetchStarted?.();
          signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted https://active.example.test token=native-key")),
            { once: true },
          );
        }),
    );
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: network,
    });
    const { models, modelsStore } = await configuredModels(runtime);
    await modelsStore.write(PROVIDER_NAME, { models: [cachedModel("last-known")], checkedAt: 1 });
    await models.refresh({ allowNetwork: false });
    const discoveryBeforeAbort = runtime.getLastDiscovery();

    const controller = new AbortController();
    const refresh = models.refresh({ allowNetwork: true, signal: controller.signal });
    await started;
    controller.abort();
    const result = await refresh;

    expect(result.aborted).toBe(true);
    expect(result.errors.size).toBe(0);
    expect(models.getModel(PROVIDER_NAME, "last-known")).toBeDefined();
    expect((await modelsStore.read(PROVIDER_NAME))?.models[0]?.id).toBe("last-known");
    expect(runtime.getLastDiscovery()).toEqual(discoveryBeforeAbort);
    expect(JSON.stringify(runtime.getLastDiscovery())).not.toMatch(/active\.example|native-key/u);
  });

  it.runIf(compareVersions(getInstalledPiVersion() ?? "0.0.0", "0.84.0") >= 0)(
    "uses Pi 0.84 provider-scoped refresh without touching unrelated catalogs",
    async () => {
      const network = fetchers({ ids: ["gateway-only"], filteredIds: [] });
      const runtime = createGatewayProviderRuntime({
        authController: authController(),
        fetchers: network,
      });
      const unrelatedFetch = vi.fn(async () => new Promise<readonly Model<Api>[]>(() => undefined));
      const unrelatedProvider = createProvider({
        id: "unrelated-dynamic-provider",
        name: "Unrelated Dynamic Provider",
        auth: {
          apiKey: {
            name: "test",
            resolve: async ({ credential }) =>
              credential?.type === "api_key" && credential.key
                ? { auth: { apiKey: credential.key }, source: "test" }
                : undefined,
          },
        },
        models: [],
        fetchModels: unrelatedFetch,
        api: {
          stream: (model) => completedStream(model),
          streamSimple: (model) => completedStream(model),
        },
      });
      const credentials = new InMemoryCredentialStore();
      await credentials.modify(PROVIDER_NAME, async () => ({
        type: "api_key",
        key: "gateway-key",
      }));
      await credentials.modify("unrelated-dynamic-provider", async () => ({
        type: "api_key",
        key: "unrelated-key",
      }));
      const models = createModels({ credentials, modelsStore: new InMemoryModelsStore() });
      models.setProvider(runtime.provider);
      models.setProvider(unrelatedProvider);

      const refresh = models.refresh.bind(models) as unknown as (options: {
        allowNetwork: boolean;
        providers: readonly string[];
        signal: AbortSignal;
      }) => Promise<{ aborted: boolean; errors: ReadonlyMap<string, Error> }>;
      const result = await refresh({
        allowNetwork: true,
        providers: [PROVIDER_NAME],
        signal: new AbortController().signal,
      });

      expect(result.aborted).toBe(false);
      expect(result.errors.size).toBe(0);
      expect(network.modelIds).toHaveBeenCalledOnce();
      expect(unrelatedFetch).not.toHaveBeenCalled();
      expect(models.getModel(PROVIDER_NAME, "gateway-only")).toBeDefined();
    },
  );

  it("keeps callable peers when discovery also reports non-callable sentinels", async () => {
    const network = fetchers({
      ids: ["callable-peer", "no-default-models"],
      filteredIds: ["no-default-models"],
    });
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: network,
    });
    const { models } = await configuredModels(runtime);

    const result = await models.refresh({ allowNetwork: true });

    expect(result.errors.size).toBe(0);
    expect(models.getModel(PROVIDER_NAME, "callable-peer")).toBeDefined();
    expect(models.getModel(PROVIDER_NAME, "no-default-models")).toBeUndefined();
    expect(runtime.getLastDiscovery().filteredModelIds).toEqual(["no-default-models"]);
  });

  it("publishes sentinel-only access as an empty catalog and later restores granted models", async () => {
    const network = fetchers({ ids: [], filteredIds: ["no-default-models"] });
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: network,
      now: () => new Date("2026-07-23T04:05:06.000Z"),
    });
    const { models, modelsStore } = await configuredModels(runtime);
    await modelsStore.write(PROVIDER_NAME, {
      models: [cachedModel("stale-forbidden-model")],
      checkedAt: 1,
    });
    await models.refresh({ allowNetwork: false });
    expect(models.getModel(PROVIDER_NAME, "stale-forbidden-model")).toBeDefined();

    const denied = await models.refresh({ allowNetwork: true });

    expect(denied.errors.size).toBe(0);
    expect(models.getModels(PROVIDER_NAME)).toEqual([]);
    expect((await modelsStore.read(PROVIDER_NAME))?.models).toEqual([]);
    expect(runtime.getLastDiscovery()).toEqual({
      source: "gateway",
      modelIds: [],
      accessState: "no-default-models",
      discoveredAt: "2026-07-23T04:05:06.000Z",
      filteredModelIds: ["no-default-models"],
    });

    vi.mocked(network.modelIds).mockRejectedValueOnce(new Error("temporary discovery failure"));
    const failed = await models.refresh({ allowNetwork: true });
    expect(failed.errors.get(PROVIDER_NAME)?.message).toContain("Gateway model refresh failed");
    expect(models.getModels(PROVIDER_NAME)).toEqual([]);
    expect((await modelsStore.read(PROVIDER_NAME))?.models).toEqual([]);

    vi.mocked(network.modelIds).mockResolvedValueOnce({ ids: ["restored-model"], filteredIds: [] });
    vi.mocked(network.modelInfo).mockResolvedValueOnce({});
    const restored = await models.refresh({ allowNetwork: true });

    expect(restored.errors.size).toBe(0);
    expect(models.getModel(PROVIDER_NAME, "restored-model")).toBeDefined();
    expect(runtime.getLastDiscovery()).not.toHaveProperty("accessState");
    expect((await modelsStore.read(PROVIDER_NAME))?.models.map((model) => model.id)).toEqual([
      "restored-model",
    ]);
  });

  it("retains a cached catalog for an ambiguous empty discovery without the access sentinel", async () => {
    const network = fetchers({ ids: [], filteredIds: [] });
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: network,
    });
    const { models, modelsStore } = await configuredModels(runtime);
    await modelsStore.write(PROVIDER_NAME, {
      models: [cachedModel("last-known")],
      checkedAt: 1,
    });
    await models.refresh({ allowNetwork: false });

    const result = await models.refresh({ allowNetwork: true });

    expect(result.errors.get(PROVIDER_NAME)?.message).toBe(
      "Gateway returned zero callable models.",
    );
    expect(models.getModel(PROVIDER_NAME, "last-known")).toBeDefined();
    expect((await modelsStore.read(PROVIDER_NAME))?.models.map((model) => model.id)).toEqual([
      "last-known",
    ]);
  });

  it("rejects missing refresh inputs and an ambiguous fresh empty catalog", async () => {
    const zero = fetchers({ ids: [], filteredIds: [] });
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: zero,
    });
    const store = new InMemoryModelsStore();
    const scopedStore = {
      read: () => store.read(PROVIDER_NAME),
      write: (entry: Parameters<typeof store.write>[1]) => store.write(PROVIDER_NAME, entry),
      delete: () => store.delete(PROVIDER_NAME),
    };
    const refresh = runtime.provider.refreshModels as unknown as (
      context: Record<string, unknown>,
    ) => Promise<void>;
    const refreshWith = (credential: Record<string, unknown>) =>
      refresh({
        credential,
        // Pi <=0.83 reads store; Pi 0.84 uses stored + publish.
        store: scopedStore,
        stored: undefined,
        publish: async () => true,
        allowNetwork: true,
        signal: new AbortController().signal,
      });

    await expect(refreshWith({ type: "api_key", key: "key" })).rejects.toThrow(
      "resolved gateway root URL",
    );
    await expect(
      refreshWith({
        type: "api_key",
        env: { [GATEWAY_RESOLVED_ROOT_ENV]: "https://gateway.example.test" },
      }),
    ).rejects.toThrow("resolved API key");
    await expect(
      refreshWith({
        type: "api_key",
        key: "key",
        env: { [GATEWAY_RESOLVED_ROOT_ENV]: "https://gateway.example.test" },
      }),
    ).rejects.toThrow("zero callable models");
    expect(runtime.provider.getModels()).toEqual([]);
  });

  it("resets discovery diagnostics on a new binding and on clear", async () => {
    const network = fetchers({ ids: ["fresh-chat"], filteredIds: [] });
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: network,
    });
    const { models } = await configuredModels(runtime);

    await models.refresh({ allowNetwork: true });

    vi.mocked(network.modelIds).mockRejectedValueOnce(
      new Error("private https://project-a.example.test token=project-a-secret"),
    );
    await models.refresh({ allowNetwork: true });
    expect(runtime.getLastDiscovery().error).toBe(
      "Gateway model refresh failed. Run /sf-llm-gateway doctor.",
    );

    runtime.bind("/workspace/project-b", UNUSED_UI, "tui");
    expect(runtime.getLastDiscovery()).not.toHaveProperty("error");
    expect(JSON.stringify(runtime.getLastDiscovery())).not.toMatch(/project-a|secret/u);

    runtime.clear();
    expect(runtime.getLastDiscovery()).not.toHaveProperty("error");
  });

  it("returns a stream error for an unmapped API instead of guessing from the model id", async () => {
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: fetchers(),
      streams: streams([]),
    });
    const unknown = {
      ...cachedModel("unknown-api-model"),
      api: "unknown-gateway-api",
    } as unknown as Model<GatewayApi>;

    await expect(
      runtime.provider.streamSimple(unknown, EMPTY_CONTEXT).result(),
    ).resolves.toMatchObject({
      stopReason: "error",
      errorMessage: 'Provider sf-llm-gateway has no API implementation for "unknown-gateway-api"',
    });
  });
});
