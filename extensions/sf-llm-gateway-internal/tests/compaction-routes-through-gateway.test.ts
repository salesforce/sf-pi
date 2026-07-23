/* SPDX-License-Identifier: Apache-2.0 */
/** Exact Pi compaction handoff through the complete Gateway Provider. */
import { describe, expect, it, vi } from "vitest";
import { generateSummary } from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type Api,
  type ApiKeyAuth,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
} from "@earendil-works/pi-ai";
import type { GatewayProviderAuthController } from "../lib/provider-auth.ts";
import {
  createGatewayProviderRuntime,
  type GatewayStreamImplementations,
} from "../lib/provider.ts";

function summaryStream(model: Model<Api>, text = "[gateway summary]") {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text }],
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
}

function userMessages(model: Model<Api>): Message[] {
  return [
    {
      role: "user",
      content: [{ type: "text", text: "Help me with a Salesforce thing." }],
      timestamp: Date.now(),
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "Sure, what do you need?" }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 150,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    },
  ];
}

function authController(): GatewayProviderAuthController {
  const auth: ApiKeyAuth = {
    name: "test",
    resolve: async () => undefined,
  };
  return {
    auth,
    bind: vi.fn(),
    clear: vi.fn(),
    getActiveCwd: vi.fn(() => undefined),
    resolveRuntimeAuth: vi.fn(async () => undefined),
  };
}

describe("Pi compaction → complete Gateway Provider", () => {
  it("runs the registered Gateway streamSimple implementation", async () => {
    let calls = 0;
    let systemPrompt: string | undefined;
    const simple = (model: Model<Api>, context: Context) => {
      calls += 1;
      systemPrompt = context.systemPrompt;
      return summaryStream(model);
    };
    const full = (model: Model<Api>) => summaryStream(model);
    const streams: GatewayStreamImplementations = {
      anthropicFull: full as GatewayStreamImplementations["anthropicFull"],
      chatFull: full as GatewayStreamImplementations["chatFull"],
      responsesFull: full as GatewayStreamImplementations["responsesFull"],
      anthropicSimple: simple as GatewayStreamImplementations["anthropicSimple"],
      chatSimple: simple as GatewayStreamImplementations["chatSimple"],
      responsesSimple: simple as GatewayStreamImplementations["responsesSimple"],
    };
    const runtime = createGatewayProviderRuntime({ authController: authController(), streams });
    const model = runtime.provider.getModels().find((entry) => entry.api === "openai-completions");
    expect(model).toBeDefined();
    if (!model) return;

    const summary = await generateSummary(
      userMessages(model),
      model,
      8_192,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      runtime.provider.streamSimple.bind(runtime.provider),
    );

    expect(calls).toBe(1);
    expect(systemPrompt).toBeTruthy();
    expect(summary).toBe("[gateway summary]");
  });
});
