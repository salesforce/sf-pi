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
  type Api,
  type ApiKeyAuth,
  type AssistantMessage,
  type Context,
  type Model,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import { ModelRuntime, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { PROVIDER_NAME } from "../lib/config.ts";
import type { GatewayModelGroupInfoMap, GatewayModelInfoMap } from "../lib/models.ts";
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
import { streamSfGatewayResponsesFull } from "../lib/transport.ts";

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

function errorStream(model: Model<Api>, message: string) {
  const stream = createAssistantMessageEventStream();
  const error: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: message,
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    stream.push({ type: "error", reason: "error", error });
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
    ids: ["gpt-5-codex", "claude-opus-4-8", "gpt-5.5"],
    filteredIds: [],
  },
  modelInfo: GatewayModelInfoMap = {},
  modelGroups: GatewayModelGroupInfoMap | undefined = {},
): GatewayFetchers {
  return {
    modelIds: vi.fn(async () => ids),
    modelInfo: vi.fn(async () => modelInfo),
    modelGroups: vi.fn(async () => modelGroups),
  };
}

interface StreamCall {
  kind: "stream" | "simple";
  api: string;
  modelId: string;
  baseUrl: string;
  apiKey?: string;
  resolvedRoot?: string;
  fallbackBaseUrl?: string;
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
    responsesFull(model, _context, options, fallback) {
      calls.push({
        ...call("stream", "openai-responses", model, options),
        fallbackBaseUrl: fallback?.chatModel.baseUrl,
      });
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
    responsesSimple(model, _context, options, fallback) {
      calls.push({
        ...call("simple", "openai-responses", model, options),
        fallbackBaseUrl: fallback?.chatModel.baseUrl,
      });
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
  it("exposes a synchronous offline catalog with one provider id, real API tags, and no construction network", () => {
    const network = fetchers();
    const controller = authController();
    const runtime = createGatewayProviderRuntime({
      authController: controller,
      fetchers: network,
      now: () => new Date("2026-07-23T00:00:00.000Z"),
    });

    const models = runtime.provider.getModels();
    expect(runtime.provider.id).toBe(PROVIDER_NAME);
    expect(runtime.provider.name).toBe("SF LLM Gateway");
    expect(new Set(models.map((model) => model.provider))).toEqual(new Set([PROVIDER_NAME]));
    expect(new Set(models.map((model) => model.api))).toEqual(
      new Set(["anthropic-messages", "openai-completions", "openai-responses"]),
    );
    for (const model of models) {
      expect(model.baseUrl).toBe(
        model.api === "openai-completions"
          ? "https://gateway.invalid/v1"
          : "https://gateway.invalid",
      );
    }
    expect(runtime.getLastDiscovery()).toEqual({
      source: "static",
      modelIds: models.map((model) => model.id),
    });
    expect(network.modelIds).not.toHaveBeenCalled();
    expect(network.modelInfo).not.toHaveBeenCalled();
    expect(network.modelGroups).not.toHaveBeenCalled();

    runtime.bind("/workspace", UNUSED_UI, "tui");
    runtime.clear();
    expect(controller.bind).toHaveBeenCalledWith("/workspace", UNUSED_UI, "tui", undefined);
    expect(controller.clear).toHaveBeenCalledTimes(1);
    expect(network.modelIds).not.toHaveBeenCalled();
  });

  it("keeps models.json overrides above the registered native Provider", async () => {
    const gateway = createGatewayProviderRuntime({ authController: authController() });
    const baseline = gateway.provider.getModels()[0];
    expect(baseline).toBeDefined();
    if (!baseline) return;
    const dir = mkdtempSync(path.join(tmpdir(), "sf-pi-m3a-model-overrides-"));
    const modelsPath = path.join(dir, "models.json");
    writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          [PROVIDER_NAME]: {
            modelOverrides: {
              [baseline.id]: { name: "User Override", maxTokens: 777 },
            },
          },
        },
      }),
    );
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsStore: new InMemoryModelsStore(),
      modelsPath,
      allowModelNetwork: false,
    });

    runtime.registerNativeProvider(gateway.provider);

    expect(runtime.getModel(PROVIDER_NAME, baseline.id)).toMatchObject({
      name: "User Override",
      maxTokens: 777,
    });
  });

  it("dispatches real API tags with family-correct endpoints and native auth for simple and full streams", async () => {
    const calls: StreamCall[] = [];
    const runtime = createGatewayProviderRuntime({
      authController: authController("https://active.example.test/bedrock/v1"),
      fetchers: fetchers(),
      streams: streams(calls),
    });
    const { models } = await configuredModels(runtime);
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
      expect(entry.resolvedRoot).toBe("https://active.example.test/bedrock/v1");
      expect(entry.baseUrl).toBe(
        entry.api === "openai-completions"
          ? "https://active.example.test/v1"
          : "https://active.example.test",
      );
    }
    const responseSimple = calls.find(
      (entry) => entry.api === "openai-responses" && entry.kind === "simple",
    );
    expect(responseSimple?.fallbackBaseUrl).toBe("https://active.example.test/v1");
  });

  it("falls back through the Gateway-aware full Chat adapter via public Models.complete", async () => {
    const calls: StreamCall[] = [];
    const implementations = streams(calls);
    implementations.responsesFull = (model, context, options, fallback) =>
      streamSfGatewayResponsesFull(model, context, options, fallback, {
        responsesStreamer: (responseModel) =>
          errorStream(responseModel, "Responses failed before visible output"),
        chatStreamer: (chatModel, _chatContext, chatOptions) => {
          calls.push(call("stream", "openai-completions", chatModel, chatOptions));
          return completedStream(chatModel, "chat fallback");
        },
      });
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: fetchers(),
      streams: implementations,
    });
    const { models } = await configuredModels(runtime);
    const responseModel = runtime.provider
      .getModels()
      .find((model) => model.api === "openai-responses");
    expect(responseModel).toBeDefined();
    if (!responseModel) return;

    const result = await models.complete(responseModel, EMPTY_CONTEXT);

    expect(result.content).toEqual([{ type: "text", text: "chat fallback" }]);
    expect(calls).toEqual([
      expect.objectContaining({
        kind: "stream",
        api: "openai-completions",
        baseUrl: "https://active.example.test/v1",
        apiKey: "native-key",
      }),
    ]);
  });

  it("uses Pi's baseline plus dynamic overlay and retains the current overlay on failure", async () => {
    const network = fetchers({
      ids: ["gpt-5.5", "fresh-chat", "no-default-models"],
      filteredIds: ["no-default-models"],
    });
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: network,
      now: () => new Date("2026-07-23T01:02:03.000Z"),
    });
    const baselineIds = runtime.provider.getModels().map((model) => model.id);
    const { models, modelsStore } = await configuredModels(runtime);
    await modelsStore.write(PROVIDER_NAME, {
      models: [cachedModel(), { ...cachedModel("gpt-5.5"), name: "Cached GPT override" }],
      checkedAt: 1,
    });

    await models.refresh({ allowNetwork: false });
    expect(models.getModel(PROVIDER_NAME, "cached-only")).toBeDefined();
    expect(models.getModel(PROVIDER_NAME, "gpt-5.5")?.name).toBe("Cached GPT override");
    expect(models.getModels(PROVIDER_NAME).filter((model) => model.id === "gpt-5.5")).toHaveLength(
      1,
    );
    expect(runtime.getLastDiscovery()).toEqual({
      source: "cache",
      modelIds: runtime.provider.getModels().map((model) => model.id),
    });
    expect(network.modelIds).not.toHaveBeenCalled();

    const refreshed = await models.refresh({ allowNetwork: true });
    expect(refreshed.errors.size).toBe(0);
    expect(network.modelIds).toHaveBeenCalledWith(
      "https://active.example.test",
      "native-key",
      undefined,
    );
    expect(network.modelInfo).toHaveBeenCalledWith(
      "https://active.example.test",
      "native-key",
      undefined,
    );
    expect(network.modelGroups).toHaveBeenCalledWith(
      "https://active.example.test",
      "native-key",
      undefined,
    );
    expect(models.getModel(PROVIDER_NAME, "cached-only")).toBeUndefined();
    expect(models.getModel(PROVIDER_NAME, "gpt-5.5")?.name).not.toBe("Cached GPT override");
    expect(models.getModels(PROVIDER_NAME).filter((model) => model.id === "gpt-5.5")).toHaveLength(
      1,
    );
    expect(models.getModels(PROVIDER_NAME)).toHaveLength(baselineIds.length + 1);
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
    expect(persisted?.models.map((model) => model.id)).toEqual(["gpt-5.5", "fresh-chat"]);
    const serializedStore = JSON.stringify(persisted);
    expect(serializedStore).not.toContain("active.example.test");
    expect(serializedStore).not.toContain("native-key");
    expect(serializedStore).toContain("gateway.invalid");

    vi.mocked(network.modelIds).mockRejectedValueOnce(
      new Error("gateway unavailable at https://active.example.test?token=native-key"),
    );
    const failed = await models.refresh({ allowNetwork: true });
    expect(failed.errors.get(PROVIDER_NAME)?.message).toBe("Gateway model refresh failed.");
    expect(models.getModel(PROVIDER_NAME, "fresh-chat")).toBeDefined();
    expect((await modelsStore.read(PROVIDER_NAME))?.models.map((model) => model.id)).toEqual([
      "gpt-5.5",
      "fresh-chat",
    ]);
    expect(runtime.getLastDiscovery()).toEqual({
      source: "gateway",
      modelIds: runtime.provider.getModels().map((model) => model.id),
      discoveredAt: "2026-07-23T01:02:03.000Z",
      filteredModelIds: ["no-default-models"],
      error: "Gateway model refresh failed.",
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

  it("rejects missing refresh inputs and zero callable models without replacing the baseline", async () => {
    const zero = fetchers({ ids: [], filteredIds: ["no-default-models"] });
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

    await expect(
      runtime.provider.refreshModels?.({
        credential: { type: "api_key", key: "key" },
        store: scopedStore,
        allowNetwork: true,
      }),
    ).rejects.toThrow("resolved gateway root URL");
    await expect(
      runtime.provider.refreshModels?.({
        credential: {
          type: "api_key",
          env: { [GATEWAY_RESOLVED_ROOT_ENV]: "https://gateway.example.test" },
        },
        store: scopedStore,
        allowNetwork: true,
      }),
    ).rejects.toThrow("resolved API key");
    await expect(
      runtime.provider.refreshModels?.({
        credential: {
          type: "api_key",
          key: "key",
          env: { [GATEWAY_RESOLVED_ROOT_ENV]: "https://gateway.example.test" },
        },
        store: scopedStore,
        allowNetwork: true,
      }),
    ).rejects.toThrow("zero callable models");
    expect(runtime.provider.getModels().length).toBeGreaterThan(0);
  });

  it("preserves the model-group baseline across unavailability and compares A to the next B", async () => {
    const network = fetchers(
      { ids: ["fresh-chat"], filteredIds: [] },
      {},
      { group: { modelGroup: "group", providers: ["provider-a"] } },
    );
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: network,
    });
    const { models } = await configuredModels(runtime);

    await models.refresh({ allowNetwork: true });
    expect(runtime.getLastModelGroupDrift()).toEqual([]);

    vi.mocked(network.modelGroups).mockResolvedValueOnce(undefined);
    await models.refresh({ allowNetwork: true });
    expect(runtime.getLastModelGroupDrift()).toEqual([]);

    vi.mocked(network.modelGroups).mockResolvedValueOnce({
      group: { modelGroup: "group", providers: ["provider-b"] },
    });
    await models.refresh({ allowNetwork: true });

    expect(runtime.getLastModelGroupDrift()).toEqual([
      {
        modelGroup: "group",
        previousProviders: ["provider-a"],
        currentProviders: ["provider-b"],
      },
    ]);
    const copy = runtime.getLastModelGroupDrift();
    copy[0]?.currentProviders.push("mutated");
    expect(runtime.getLastModelGroupDrift()[0]?.currentProviders).toEqual(["provider-b"]);
  });

  it("resets endpoint diagnostics on a new binding and on clear", async () => {
    const network = fetchers(
      { ids: ["fresh-chat"], filteredIds: [] },
      {},
      { group: { modelGroup: "group", providers: ["provider-a"] } },
    );
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: network,
    });
    const { models } = await configuredModels(runtime);

    await models.refresh({ allowNetwork: true });
    vi.mocked(network.modelGroups).mockResolvedValueOnce({
      group: { modelGroup: "group", providers: ["provider-b"] },
    });
    await models.refresh({ allowNetwork: true });
    expect(runtime.getLastModelGroupDrift()).toHaveLength(1);

    vi.mocked(network.modelIds).mockRejectedValueOnce(
      new Error("private https://project-a.example.test token=project-a-secret"),
    );
    await models.refresh({ allowNetwork: true });
    expect(runtime.getLastDiscovery().error).toBe("Gateway model refresh failed.");

    runtime.bind("/workspace/project-b", UNUSED_UI, "tui");
    expect(runtime.getLastModelGroupDrift()).toEqual([]);
    expect(runtime.getLastDiscovery()).not.toHaveProperty("error");
    expect(JSON.stringify(runtime.getLastDiscovery())).not.toMatch(/project-a|secret/u);

    runtime.clear();
    expect(runtime.getLastModelGroupDrift()).toEqual([]);
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
      errorMessage:
        'Provider sf-llm-gateway-internal has no API implementation for "unknown-gateway-api"',
    });
  });
});
