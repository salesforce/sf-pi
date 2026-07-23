/* SPDX-License-Identifier: Apache-2.0 */
/** Opt-in live gate for the complete Gateway Provider path. */
import { describe, expect, it, vi } from "vitest";
import { generateSummary } from "@earendil-works/pi-coding-agent";
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
  Type,
  createModels,
  type Api,
  type ApiKeyAuth,
  type AssistantMessage,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";
import {
  API_KEY_ENV,
  BASE_URL_ENV,
  LEGACY_API_KEY_ENV,
  LEGACY_BASE_URL_ENV,
  PROVIDER_NAME,
  normalizeBaseUrl,
  readGatewayEnv,
} from "../lib/config.ts";
import {
  GATEWAY_RESOLVED_ROOT_ENV,
  type GatewayProviderAuthController,
} from "../lib/provider-auth.ts";
import { createGatewayProviderRuntime } from "../lib/provider.ts";

const LIVE_ENV = "SF_LLM_GATEWAY_NATIVE_PROVIDER_LIVE";
const baseUrl = normalizeBaseUrl(readGatewayEnv(BASE_URL_ENV, LEGACY_BASE_URL_ENV));
const apiKey = readGatewayEnv(API_KEY_ENV, LEGACY_API_KEY_ENV)?.trim();
const describeLive = process.env[LIVE_ENV] === "1" && baseUrl && apiKey ? describe : describe.skip;
const timeoutMs = 60_000;

function authController(): GatewayProviderAuthController {
  const auth: ApiKeyAuth = {
    name: "live test",
    async resolve({ credential }) {
      return credential?.key && baseUrl
        ? {
            auth: { apiKey: credential.key },
            env: { [GATEWAY_RESOLVED_ROOT_ENV]: baseUrl },
            source: "live test credential",
          }
        : undefined;
    },
  };
  return {
    auth,
    bind: vi.fn(),
    clear: vi.fn(),
    getActiveCwd: vi.fn(() => undefined),
    resolveRuntimeAuth: vi.fn(async () =>
      apiKey && baseUrl ? { apiKey, baseUrl, source: "live test credential" } : undefined,
    ),
  };
}

async function liveModels() {
  const runtime = createGatewayProviderRuntime({ authController: authController() });
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(PROVIDER_NAME, async () => ({
    type: "api_key",
    key: apiKey,
    env: baseUrl ? { [BASE_URL_ENV]: baseUrl } : undefined,
  }));
  const models = createModels({ credentials, modelsStore: new InMemoryModelsStore() });
  models.setProvider(runtime.provider);
  const refresh = await models.refresh({
    allowNetwork: true,
    signal: AbortSignal.timeout(timeoutMs),
  });
  expect(refresh.errors.size).toBe(0);
  return { models, runtime };
}

function toolContext(): Context {
  return {
    systemPrompt: "You are a deterministic live transport probe.",
    messages: [
      {
        role: "user",
        content: "Call the live_probe tool exactly once and do not answer from memory.",
        timestamp: Date.now(),
      },
    ],
    tools: [
      {
        name: "live_probe",
        description: "Return a deterministic probe result.",
        parameters: Type.Object({}),
      },
    ],
  };
}

function findModel(models: Awaited<ReturnType<typeof liveModels>>["models"], id: string) {
  const model = models.getModel(PROVIDER_NAME, id);
  expect(model, `live model ${id}`).toBeDefined();
  return model;
}

function expectToolCall(model: Model<Api>, message: AssistantMessage) {
  expect(message.stopReason).not.toBe("error");
  expect(message.content.some((block) => block.type === "toolCall")).toBe(true);
  expect(message.provider).toBe(model.provider);
}

describeLive("complete Gateway Provider live routes", () => {
  it(
    "routes Chat, Responses, and Anthropic tool calls through the complete Provider",
    async () => {
      const { models } = await liveModels();
      const probes = [
        {
          id: process.env.SF_LLM_GATEWAY_INTERNAL_CODEX_TEST_MODEL || "gpt-5.3-codex",
          reasoning: "high" as const,
        },
        {
          id: process.env.SF_LLM_GATEWAY_INTERNAL_GPT55_TEST_MODEL || "gpt-5.5",
          reasoning: "high" as const,
        },
        {
          id: process.env.SF_LLM_GATEWAY_INTERNAL_OPUS47_TEST_MODEL || "claude-opus-4-7",
          reasoning: "xhigh" as const,
        },
      ];

      for (const probe of probes) {
        const model = findModel(models, probe.id);
        if (!model) continue;
        const message = await models.completeSimple(model, toolContext(), {
          reasoning: probe.reasoning,
          maxTokens: 256,
          signal: AbortSignal.timeout(timeoutMs),
        });
        expectToolCall(model, message);
      }
    },
    timeoutMs * 3,
  );

  it(
    "routes Pi compaction through the complete Provider stream",
    async () => {
      const { models } = await liveModels();
      const model = findModel(
        models,
        process.env.SF_LLM_GATEWAY_INTERNAL_CODEX_TEST_MODEL || "gpt-5.3-codex",
      );
      if (!model) return;
      const summary = await generateSummary(
        [
          {
            role: "user",
            content: "Remember the project uses a blue deployment.",
            timestamp: Date.now(),
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "Understood." }],
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
          },
        ],
        model,
        2_048,
        undefined,
        undefined,
        AbortSignal.timeout(timeoutMs),
        "Mention the deployment color.",
        undefined,
        "low",
        (selectedModel, context, options) => models.streamSimple(selectedModel, context, options),
      );
      expect(summary.toLowerCase()).toContain("blue");
    },
    timeoutMs,
  );
});
