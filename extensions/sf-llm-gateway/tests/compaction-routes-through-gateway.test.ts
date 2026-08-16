/* SPDX-License-Identifier: Apache-2.0 */
/** Exact Pi compaction handoff through the complete Gateway Provider. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Api,
  type ApiKeyAuth,
  type AssistantMessage,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";
import { PROVIDER_NAME } from "../lib/config.ts";
import {
  GATEWAY_RESOLVED_ROOT_ENV,
  type GatewayProviderAuthController,
} from "../lib/provider-auth.ts";
import {
  createGatewayProviderRuntime,
  type GatewayFetchers,
  type GatewayStreamImplementations,
} from "../lib/provider.ts";

type CompletedStopReason = Extract<
  AssistantMessage["stopReason"],
  "stop" | "length" | "toolUse" | "deferred"
>;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function summaryStream(
  model: Model<Api>,
  text = "[gateway summary]",
  stopReason: CompletedStopReason = "stop",
  usage: Partial<AssistantMessage["usage"]> = {},
) {
  const stream = createAssistantMessageEventStream();
  const input = usage.input ?? 0;
  const output = usage.output ?? 0;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input,
      output,
      cacheRead,
      cacheWrite,
      totalTokens: usage.totalTokens ?? input + output + cacheRead + cacheWrite,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: stopReason, message });
    stream.end();
  });
  return stream;
}

function configuredAuthController(): GatewayProviderAuthController {
  const auth: ApiKeyAuth = {
    name: "test",
    async resolve({ credential }) {
      return credential?.type === "api_key" && credential.key
        ? {
            auth: { apiKey: credential.key },
            env: { [GATEWAY_RESOLVED_ROOT_ENV]: "https://gateway.example.test" },
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
    hasConfiguredCredential: vi.fn(async () => true),
    resolveRuntimeAuth: vi.fn(async () => ({
      apiKey: "test-key",
      baseUrl: "https://gateway.example.test",
      source: "test credential",
    })),
  };
}

async function createCompactionSession(
  options: {
    agentReplies?: Array<{
      text: string;
      stopReason: CompletedStopReason;
      input?: number;
      output?: number;
    }>;
    authenticated?: boolean;
    throwingCompactionHook?: boolean;
  } = {},
) {
  const cwd = mkdtempSync(path.join(tmpdir(), "sf-pi-gateway-compaction-"));
  tempDirs.push(cwd);
  const summarization = vi.fn((model: Model<Api>) => summaryStream(model));
  let agentCall = 0;
  const agent = vi.fn((model: Model<Api>) => {
    const reply = options.agentReplies?.[agentCall++] ?? {
      text: "[agent response]",
      stopReason: "stop" as const,
      input: 100,
      output: 20,
    };
    return summaryStream(model, reply.text, reply.stopReason, {
      input: reply.input ?? 100,
      output: reply.output ?? 20,
    });
  });
  const dispatch = (model: Model<Api>, context: Context) =>
    context.systemPrompt?.includes("test agent prompt") ? agent(model) : summarization(model);
  const simple = vi.fn(dispatch);
  const full = vi.fn(dispatch);
  const streams: GatewayStreamImplementations = {
    anthropicFull: full as GatewayStreamImplementations["anthropicFull"],
    chatFull: full as GatewayStreamImplementations["chatFull"],
    responsesFull: full as GatewayStreamImplementations["responsesFull"],
    anthropicSimple: simple as GatewayStreamImplementations["anthropicSimple"],
    chatSimple: simple as GatewayStreamImplementations["chatSimple"],
    responsesSimple: simple as GatewayStreamImplementations["responsesSimple"],
  };
  const fetchers: GatewayFetchers = {
    modelIds: vi.fn(async () => ({ ids: ["example-chat-model"], filteredIds: [] })),
    modelInfo: vi.fn(async () => ({})),
  };
  const runtime = createGatewayProviderRuntime({
    authController: configuredAuthController(),
    fetchers,
    streams,
  });
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(PROVIDER_NAME, async () => ({
    type: "api_key",
    key: "test-key",
  }));
  const modelRuntime = await ModelRuntime.create({
    credentials,
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
  });
  modelRuntime.registerNativeProvider(runtime.provider);
  const refresh = await modelRuntime.refresh({ providers: [PROVIDER_NAME], force: true });
  expect(refresh.errors.size).toBe(0);
  const model = modelRuntime.getModel(PROVIDER_NAME, "example-chat-model");
  expect(model).toBeDefined();
  if (!model) throw new Error("Expected refreshed Gateway model");
  if (options.authenticated === false) {
    await credentials.delete(PROVIDER_NAME);
  }

  const sessionManager = SessionManager.inMemory(cwd);
  sessionManager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "old context ".repeat(80) }],
    timestamp: Date.now() - 3,
  });
  sessionManager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "old response" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 300,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 320,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now() - 2,
  });
  sessionManager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "recent request" }],
    timestamp: Date.now() - 1,
  });

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true, reserveTokens: 1_024, keepRecentTokens: 1 },
    retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => "test agent prompt",
    extensionFactories: options.throwingCompactionHook
      ? [
          {
            name: "throwing-compaction-hook",
            factory: (pi) => {
              pi.on("session_before_compact", () => {
                throw new Error("custom compaction hook failed");
              });
            },
          },
        ]
      : [],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir: cwd,
    model,
    noTools: "all",
    modelRuntime,
    settingsManager,
    resourceLoader,
    sessionManager,
  });
  return {
    session,
    summarization,
    agent,
    restoreCredential: () =>
      credentials.modify(PROVIDER_NAME, async () => ({ type: "api_key", key: "test-key" })),
  };
}

describe("Pi compaction → complete Gateway Provider", () => {
  it("compacts an in-memory AgentSession through registered Gateway auth and dispatch", async () => {
    const { session, summarization } = await createCompactionSession();

    try {
      const result = await session.compact();

      expect(result.summary).toContain("[gateway summary]");
      expect(summarization).toHaveBeenCalledOnce();
      expect(session.sessionManager.getBranch().at(-1)).toMatchObject({
        type: "compaction",
        summary: expect.stringContaining("[gateway summary]"),
      });
    } finally {
      session.dispose();
    }
  });

  it("falls back to built-in Gateway compaction when a custom compaction hook throws", async () => {
    const { session, summarization } = await createCompactionSession({
      throwingCompactionHook: true,
    });

    try {
      await expect(session.compact()).resolves.toMatchObject({
        summary: expect.stringContaining("[gateway summary]"),
      });
      expect(summarization).toHaveBeenCalledOnce();
      expect(session.sessionManager.getBranch().at(-1)).toMatchObject({ type: "compaction" });
    } finally {
      session.dispose();
    }
  });

  it("leaves the session uncompacted and recoverable when Gateway auth is unavailable", async () => {
    const { session, restoreCredential } = await createCompactionSession({ authenticated: false });
    const entriesBefore = session.sessionManager.getEntries().length;

    try {
      await expect(session.compact()).rejects.toThrow(
        "Summarization failed: Provider is not configured: sf-llm-gateway",
      );
      expect(session.sessionManager.getEntries()).toHaveLength(entriesBefore);
      expect(session.sessionManager.getEntries().some((entry) => entry.type === "compaction")).toBe(
        false,
      );

      await restoreCredential();
      await expect(session.compact()).resolves.toMatchObject({
        summary: expect.stringContaining("[gateway summary]"),
      });
    } finally {
      session.dispose();
    }
  });

  it("compacts and retries once when a Gateway response is truncated below its output limit", async () => {
    const { session, summarization, agent } = await createCompactionSession({
      agentReplies: [
        { text: "[truncated]", stopReason: "length", input: 7_000, output: 10 },
        { text: "[recovered response]", stopReason: "stop", input: 500, output: 20 },
      ],
    });

    try {
      await session.prompt("continue after the truncated response");

      expect(agent).toHaveBeenCalledTimes(2);
      expect(summarization).toHaveBeenCalled();
      expect(session.sessionManager.getBranch()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "compaction",
            summary: expect.stringContaining("[gateway summary]"),
          }),
        ]),
      );
      expect(session.messages.at(-1)).toMatchObject({
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "[recovered response]" }],
      });
    } finally {
      session.dispose();
    }
  });
});
