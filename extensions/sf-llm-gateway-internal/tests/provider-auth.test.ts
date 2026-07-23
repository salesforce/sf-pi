/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior tests for complete-Provider Gateway authentication and session context. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  InMemoryCredentialStore,
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type AssistantMessage,
  type AuthContext,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
  API_KEY_ENV,
  BASE_URL_ENV,
  LEGACY_API_KEY_ENV,
  PROVIDER_NAME,
  globalGatewayConfigPath,
  projectGatewayConfigPath,
  writeGatewaySavedConfig,
} from "../lib/config.ts";
import {
  GATEWAY_RESOLVED_ROOT_ENV,
  createGatewayProviderAuth,
  type GatewayProviderAuthDependencies,
} from "../lib/provider-auth.ts";
import type { SecureCredentialPromptBridge } from "../lib/secure-credential-prompt.ts";

const UNUSED_UI = {} as ExtensionUIContext;

function authContext(values: Record<string, string | undefined>): AuthContext {
  return {
    env: async (name) => values[name],
    fileExists: async () => false,
  };
}

function makePromptBridge(value = "canonical-login-key"): SecureCredentialPromptBridge {
  return {
    bind: vi.fn((_ui: ExtensionUIContext, _mode: ExtensionContext["mode"]) => undefined),
    clear: vi.fn(() => undefined),
    prompt: vi.fn(async (_signal?: AbortSignal) => value),
  };
}

function makeDependencies(
  overrides: Partial<GatewayProviderAuthDependencies> = {},
): GatewayProviderAuthDependencies {
  return {
    promptBridge: makePromptBridge(),
    getConfig: (cwd) => ({
      enabled: true,
      baseUrl: cwd
        ? `https://${path.basename(cwd)}.example.test/v1`
        : "https://global.example.test/v1",
    }),
    ...overrides,
  };
}

async function resolve(
  dependencies: GatewayProviderAuthDependencies,
  values: Record<string, string | undefined> = {},
  credential?: { type: "api_key"; key?: string; env?: Record<string, string> },
) {
  const controller = createGatewayProviderAuth(dependencies);
  controller.bind("/workspace/project-a", UNUSED_UI, "tui");
  return controller.auth.resolve({ ctx: authContext(values), credential });
}

describe("Gateway complete-Provider auth resolution", () => {
  it("prefers a native Pi credential while environment values remain", async () => {
    const result = await resolve(
      makeDependencies(),
      {
        [API_KEY_ENV]: "primary-env-private",
        [LEGACY_API_KEY_ENV]: "legacy-env-private",
      },
      { type: "api_key", key: "native-private" },
    );

    expect(result).toEqual({
      auth: { apiKey: "native-private" },
      env: { [GATEWAY_RESOLVED_ROOT_ENV]: "https://project-a.example.test" },
      source: "Pi saved credential",
    });
    expect(result?.source).not.toMatch(/native|primary-env|legacy-project|legacy-global-private/i);
  });

  it("prefers a saved project URL, then the Pi credential URL, then environment fallback", async () => {
    const credential = {
      type: "api_key" as const,
      key: "native-private",
      env: { [BASE_URL_ENV]: "https://credential.example.test/v1" },
    };
    const credentialUrl = await resolve(
      makeDependencies({
        getConfig: () => ({
          enabled: true,
          baseUrl: "https://environment.example.test/v1",
          baseUrlSource: "env",
        }),
      }),
      {},
      credential,
    );
    const savedUrl = await resolve(
      makeDependencies({
        getConfig: () => ({
          enabled: true,
          baseUrl: "https://project.example.test/v1",
          baseUrlSource: "saved",
        }),
      }),
      {},
      credential,
    );

    expect(credentialUrl?.env?.[GATEWAY_RESOLVED_ROOT_ENV]).toBe("https://credential.example.test");
    expect(savedUrl?.env?.[GATEWAY_RESOLVED_ROOT_ENV]).toBe("https://project.example.test");
  });

  it("uses primary then legacy environment variables before legacy files", async () => {
    const primary = await resolve(makeDependencies(), {
      [API_KEY_ENV]: "primary-env-private",
      [LEGACY_API_KEY_ENV]: "legacy-env-private",
    });
    const legacy = await resolve(makeDependencies(), {
      [LEGACY_API_KEY_ENV]: "legacy-env-private",
    });

    expect(primary).toEqual({
      auth: { apiKey: "primary-env-private" },
      env: { [GATEWAY_RESOLVED_ROOT_ENV]: "https://project-a.example.test" },
      source: API_KEY_ENV,
    });
    expect(legacy).toEqual({
      auth: { apiKey: "legacy-env-private" },
      env: { [GATEWAY_RESOLVED_ROOT_ENV]: "https://project-a.example.test" },
      source: LEGACY_API_KEY_ENV,
    });
  });

  it("does not use legacy project or global saved tokens after the migration cutoff", async () => {
    const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "sf-pi-m3b-auth-"));
    const projectDir = path.join(fixtureDir, "project");
    process.env.PI_CODING_AGENT_DIR = path.join(fixtureDir, "agent");

    try {
      writeGatewaySavedConfig(globalGatewayConfigPath(), {
        enabled: true,
        baseUrl: "https://global.example.test",
        apiKey: "legacy-global-private",
      });
      writeGatewaySavedConfig(projectGatewayConfigPath(projectDir), {
        enabled: true,
        baseUrl: "https://project.example.test",
        apiKey: "legacy-project-private",
      });
      const projectBefore = readFileSync(projectGatewayConfigPath(projectDir), "utf8");
      const globalBefore = readFileSync(globalGatewayConfigPath(), "utf8");
      const controller = createGatewayProviderAuth();

      controller.bind(projectDir, UNUSED_UI, "tui");
      await expect(controller.auth.resolve({ ctx: authContext({}) })).resolves.toBeUndefined();
      await expect(
        controller.auth.resolve({
          ctx: authContext({ [API_KEY_ENV]: "active-automation-private" }),
        }),
      ).resolves.toMatchObject({
        auth: { apiKey: "active-automation-private" },
        source: API_KEY_ENV,
      });
      controller.clear();
      await expect(controller.auth.resolve({ ctx: authContext({}) })).resolves.toBeUndefined();

      expect(readFileSync(projectGatewayConfigPath(projectDir), "utf8")).toBe(projectBefore);
      expect(readFileSync(globalGatewayConfigPath(), "utf8")).toBe(globalBefore);
    } finally {
      if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("returns undefined when disabled, missing an endpoint, or missing every credential", async () => {
    await expect(
      resolve(
        makeDependencies({
          getConfig: () => ({ enabled: false, baseUrl: "https://gateway.test" }),
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      resolve(makeDependencies({ getConfig: () => ({ enabled: true }) })),
    ).resolves.toBeUndefined();
    await expect(resolve(makeDependencies())).resolves.toBeUndefined();
  });

  it("switches request-time project config on bind and drops stale project context on clear", async () => {
    const dependencies = makeDependencies({
      getConfig: (cwd) => ({
        enabled: true,
        baseUrl: cwd
          ? `https://${path.basename(cwd)}.example.test/bedrock/v1`
          : "https://global.example.test/v1",
      }),
    });
    const controller = createGatewayProviderAuth(dependencies);
    const ctx = authContext({ [API_KEY_ENV]: "automation-private" });

    controller.bind("/workspace/project-a", UNUSED_UI, "tui");
    const projectA = await controller.auth.resolve({ ctx });
    controller.bind("/workspace/project-b", UNUSED_UI, "tui");
    const projectB = await controller.auth.resolve({ ctx });
    controller.clear();
    const global = await controller.auth.resolve({ ctx });

    expect(projectA).toMatchObject({
      auth: { apiKey: "automation-private" },
      env: { [GATEWAY_RESOLVED_ROOT_ENV]: "https://project-a.example.test" },
    });
    expect(projectB).toMatchObject({
      auth: { apiKey: "automation-private" },
      env: { [GATEWAY_RESOLVED_ROOT_ENV]: "https://project-b.example.test" },
    });
    expect(global).toEqual({
      auth: { apiKey: "automation-private" },
      env: { [GATEWAY_RESOLVED_ROOT_ENV]: "https://global.example.test" },
      source: API_KEY_ENV,
    });
    expect(controller.getActiveCwd()).toBeUndefined();
    expect(dependencies.promptBridge.clear).toHaveBeenCalledTimes(1);
  });

  it("collects a missing non-secret URL through Pi text input and stores it with the credential", async () => {
    const promptBridge = makePromptBridge("masked-private-key");
    const controller = createGatewayProviderAuth(
      makeDependencies({
        promptBridge,
        getConfig: () => ({ enabled: true }),
      }),
    );
    controller.bind("/workspace/project-a", UNUSED_UI, "tui");
    const prompt = vi.fn(async () => "https://gateway.example.test/v1");

    const credential = await controller.auth.login?.({ prompt, notify: vi.fn() });

    expect(prompt).toHaveBeenCalledWith({
      type: "text",
      message: "SF LLM Gateway root URL",
      placeholder: "https://gateway.example.com",
    });
    expect(credential).toEqual({
      type: "api_key",
      key: "masked-private-key",
      env: { [BASE_URL_ENV]: "https://gateway.example.test" },
    });
    expect(JSON.stringify(prompt.mock.calls)).not.toContain("masked-private-key");
  });

  it("checks availability with the same source and without mutation", async () => {
    const dependencies = makeDependencies();
    const controller = createGatewayProviderAuth(dependencies);
    controller.bind("/workspace/project-a", UNUSED_UI, "tui");
    const input = { ctx: authContext({ [API_KEY_ENV]: "env-private" }) };

    const checked = await controller.auth.check?.(input);
    const resolved = await controller.auth.resolve(input);

    expect(checked).toEqual({ type: "api_key", source: API_KEY_ENV });
    expect(resolved?.source).toBe(checked?.source);
  });

  it("detects stored or environment credentials while Gateway routing is disabled", async () => {
    const controller = createGatewayProviderAuth(
      makeDependencies({
        getConfig: () => ({ enabled: false, baseUrl: "https://gateway.example.test" }),
      }),
    );
    controller.bind("/workspace/project-a", UNUSED_UI, "tui", {
      getProviderAuthStatus: () => ({ configured: true, source: "stored" }),
    } as never);

    await expect(controller.hasConfiguredCredential()).resolves.toBe(true);

    controller.clear();
    const previousPrimary = process.env[API_KEY_ENV];
    const previousLegacy = process.env[LEGACY_API_KEY_ENV];
    try {
      process.env[API_KEY_ENV] = "automation-private";
      delete process.env[LEGACY_API_KEY_ENV];
      await expect(controller.hasConfiguredCredential()).resolves.toBe(true);
    } finally {
      if (previousPrimary === undefined) delete process.env[API_KEY_ENV];
      else process.env[API_KEY_ENV] = previousPrimary;
      if (previousLegacy === undefined) delete process.env[LEGACY_API_KEY_ENV];
      else process.env[LEGACY_API_KEY_ENV] = previousLegacy;
    }
  });

  it("resolves auxiliary Gateway calls through the active public ModelRegistry", async () => {
    const controller = createGatewayProviderAuth(makeDependencies());
    const getProviderAuth = vi.fn(async () => ({
      auth: { apiKey: "native-runtime-private" },
      env: { [GATEWAY_RESOLVED_ROOT_ENV]: "https://runtime.example.test/v1" },
      source: "Pi saved credential",
    }));
    controller.bind("/workspace/project-a", UNUSED_UI, "tui", {
      getProviderAuth,
    } as never);

    const resolved = await controller.resolveRuntimeAuth();

    expect(getProviderAuth).toHaveBeenCalledWith(PROVIDER_NAME);
    expect(resolved).toEqual({
      apiKey: "native-runtime-private",
      baseUrl: "https://runtime.example.test",
      source: "Pi saved credential",
    });
    expect(resolved?.source).not.toContain("native-runtime-private");

    controller.clear();
    expect(controller.getActiveCwd()).toBeUndefined();
  });
});

describe("Gateway provider auth through Pi public Models", () => {
  it("persists canonical api_key login and removes it on logout without changing legacy fixtures", async () => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "sf-pi-m3a-auth-"));
    const projectFixture = path.join(fixtureDir, "project.json");
    const globalFixture = path.join(fixtureDir, "global.json");
    const projectContents = '{"apiKey":"legacy-project-private"}\n';
    const globalContents = '{"apiKey":"legacy-global-private"}\n';
    writeFileSync(projectFixture, projectContents);
    writeFileSync(globalFixture, globalContents);

    const promptBridge = makePromptBridge("canonical-login-key");
    const controller = createGatewayProviderAuth(
      makeDependencies({
        promptBridge,
        getConfig: () => ({ enabled: true, baseUrl: "https://gateway.example.test/v1" }),
      }),
    );
    controller.bind(fixtureDir, UNUSED_UI, "tui");

    const streams: ProviderStreams = {
      stream: () => createAssistantMessageEventStream(),
      streamSimple: () => createAssistantMessageEventStream(),
    };
    const provider = createProvider({
      id: PROVIDER_NAME,
      name: "SF LLM Gateway",
      auth: { apiKey: controller.auth },
      models: [],
      api: streams,
    });
    const credentials = new InMemoryCredentialStore();
    const models = createModels({ credentials });
    models.setProvider(provider);
    const stockPrompt = vi.fn(async () => "");
    const environment = { [API_KEY_ENV]: "environment-private" };
    const environmentBefore = { ...environment };

    const loggedIn = await models.login(PROVIDER_NAME, "api_key", {
      prompt: stockPrompt,
      notify: vi.fn(),
    });
    const stored = await credentials.read(PROVIDER_NAME);
    const resolved = await models.getAuth(PROVIDER_NAME, {
      env: environment,
    });

    expect(loggedIn).toEqual({
      type: "api_key",
      key: "canonical-login-key",
      env: { [BASE_URL_ENV]: "https://gateway.example.test" },
    });
    expect(stored).toEqual(loggedIn);
    expect(resolved).toEqual({
      auth: { apiKey: "canonical-login-key" },
      env: { [GATEWAY_RESOLVED_ROOT_ENV]: "https://gateway.example.test" },
      source: "Pi saved credential",
    });
    expect(stockPrompt).toHaveBeenCalledWith({
      type: "text",
      message: "SF LLM Gateway root URL (press Enter to keep current)",
      placeholder: "https://gateway.example.test",
    });
    expect(JSON.stringify(stockPrompt.mock.calls)).not.toContain("canonical-login-key");
    expect(resolved?.source).not.toMatch(
      /canonical-login-key|environment-private|legacy-.*-private/u,
    );
    expect(environment).toEqual(environmentBefore);
    expect(readFileSync(projectFixture, "utf8")).toBe(projectContents);
    expect(readFileSync(globalFixture, "utf8")).toBe(globalContents);

    await models.logout(PROVIDER_NAME);
    expect(await credentials.read(PROVIDER_NAME)).toBeUndefined();
    expect(readFileSync(projectFixture, "utf8")).toBe(projectContents);
    expect(readFileSync(globalFixture, "utf8")).toBe(globalContents);
  });

  it("preserves per-model endpoints and passes the resolved root through provider options", async () => {
    const controller = createGatewayProviderAuth(
      makeDependencies({
        promptBridge: makePromptBridge("canonical-login-key"),
        getConfig: () => ({ enabled: true, baseUrl: "https://active.example.test/v1" }),
      }),
    );
    controller.bind("/workspace/project-a", UNUSED_UI, "tui");

    const calls: Array<{
      id: string;
      api: string;
      baseUrl: string;
      apiKey?: string;
      root?: string;
    }> = [];
    const streams: ProviderStreams = {
      stream: () => createAssistantMessageEventStream(),
      streamSimple: (model, _context, options) => {
        calls.push({
          id: model.id,
          api: model.api,
          baseUrl: model.baseUrl,
          apiKey: options?.apiKey,
          root: options?.env?.[GATEWAY_RESOLVED_ROOT_ENV],
        });
        const stream = createAssistantMessageEventStream();
        const message: AssistantMessage = {
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
          stopReason: "stop",
          timestamp: Date.now(),
        };
        queueMicrotask(() => {
          stream.push({ type: "start", partial: message });
          stream.push({ type: "done", reason: "stop", message });
          stream.end();
        });
        return stream;
      },
    };
    const provider = createProvider({
      id: PROVIDER_NAME,
      name: "SF LLM Gateway",
      auth: { apiKey: controller.auth },
      models: [
        {
          id: "chat-model",
          name: "Chat Model",
          provider: PROVIDER_NAME,
          api: "openai-completions",
          baseUrl: "https://bootstrap.example.test/v1",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1_000,
          maxTokens: 100,
        },
        {
          id: "root-model",
          name: "Root Model",
          provider: PROVIDER_NAME,
          api: "anthropic-messages",
          baseUrl: "https://bootstrap.example.test",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1_000,
          maxTokens: 100,
        },
      ],
      api: streams,
    });
    const models = createModels({
      credentials: new InMemoryCredentialStore(),
      authContext: authContext({}),
    });
    models.setProvider(provider);
    await models.login(PROVIDER_NAME, "api_key", {
      prompt: vi.fn(async () => ""),
      notify: vi.fn(),
    });

    for (const modelId of ["chat-model", "root-model"]) {
      const model = models.getModel(PROVIDER_NAME, modelId);
      expect(model).toBeDefined();
      if (!model) continue;
      for await (const _event of models.streamSimple(model, {
        systemPrompt: "",
        messages: [],
        tools: [],
      })) {
        // Draining the public lazy stream invokes auth application and provider dispatch.
      }
    }

    expect(calls).toEqual([
      {
        id: "chat-model",
        api: "openai-completions",
        baseUrl: "https://bootstrap.example.test/v1",
        apiKey: "canonical-login-key",
        root: "https://active.example.test",
      },
      {
        id: "root-model",
        api: "anthropic-messages",
        baseUrl: "https://bootstrap.example.test",
        apiKey: "canonical-login-key",
        root: "https://active.example.test",
      },
    ]);
  });
});
