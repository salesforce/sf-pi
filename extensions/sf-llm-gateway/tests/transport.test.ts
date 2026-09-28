/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proofs for provider-neutral gateway transport adapters. */
import { describe, expect, it, vi } from "vitest";
import {
  createAssistantMessageEventStream,
  normalizeContext,
  type Model,
  type OpenAICompletionsOptions,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  formatAnthropicStreamError,
  streamSfGatewayOpenAI,
  streamSfGatewayOpenAIFull,
  streamSfGatewayResponses,
  streamSfGatewayResponsesFull,
} from "../lib/transport.ts";

const CONTEXT = normalizeContext({ systemPrompt: "", messages: [], tools: [] });

function emptyStream() {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => stream.end());
  return stream;
}

function chatModel(): Model<"openai-completions"> {
  return {
    id: "example-chat-model",
    provider: "sf-llm-gateway",
    api: "openai-completions",
    name: "Example Chat Model",
    baseUrl: "https://gateway.invalid/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096,
  };
}

function responsesModel(): Model<"openai-responses"> {
  return {
    ...chatModel(),
    id: "example-responses-model",
    api: "openai-responses",
    name: "Example Responses Model",
    baseUrl: "https://gateway.invalid",
  };
}

async function captureResponsesPayload(
  model: Model<"openai-responses">,
  options: Pick<SimpleStreamOptions, "samplingParams" | "onPayload" | "sessionId"> = {},
  full = false,
): Promise<Record<string, unknown> | undefined> {
  let payload: Record<string, unknown> | undefined;
  const requestOptions = {
    apiKey: "test-key",
    maxRetries: 0,
    ...options,
    fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ error: { message: "mock response" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    },
  };
  const stream = full
    ? streamSfGatewayResponsesFull(model, CONTEXT, requestOptions)
    : streamSfGatewayResponses(model, CONTEXT, requestOptions);
  await stream.result();
  return payload;
}

async function captureChatPayload(
  model: Model<"openai-completions">,
  options: Pick<SimpleStreamOptions, "cacheRetention" | "onPayload" | "sessionId"> = {},
  full = false,
): Promise<Record<string, unknown> | undefined> {
  let payload: Record<string, unknown> | undefined;
  const requestOptions = {
    apiKey: "test-key",
    maxRetries: 0,
    ...options,
    fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ error: { message: "mock response" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    },
  };
  const stream = full
    ? streamSfGatewayOpenAIFull(model, CONTEXT, requestOptions)
    : streamSfGatewayOpenAI(model, CONTEXT, requestOptions);
  await stream.result();
  return payload;
}

describe("generic Chat Completions adapter", () => {
  it("passes non-Gateway models and options through", () => {
    const model = { ...chatModel(), provider: "openai" };
    const options: OpenAICompletionsOptions = {
      apiKey: "test-key",
      onPayload: vi.fn((payload) => payload),
    };
    const streamer = vi.fn(() => emptyStream());

    streamSfGatewayOpenAIFull(model, CONTEXT, options, { streamer });

    expect(streamer).toHaveBeenCalledWith(model, CONTEXT, options);
  });

  it.each([false, true])("omits Gateway long-retention cache key (full=%s)", async (full) => {
    const onPayload = vi.fn((payload: unknown) => ({
      ...(payload as object),
      prompt_cache_key: "caller-added",
      metadata: { test: true },
    }));
    const options = { sessionId: "test-session", cacheRetention: "long" as const, onPayload };
    const gateway = await captureChatPayload(chatModel(), options, full);
    const otherProvider = await captureChatPayload(
      { ...chatModel(), provider: "openai" },
      options,
      full,
    );

    expect(gateway).not.toHaveProperty("prompt_cache_key");
    expect(gateway).toMatchObject({ metadata: { test: true } });
    expect(otherProvider).toHaveProperty("prompt_cache_key", "caller-added");
    expect(onPayload).toHaveBeenCalledTimes(2);
  });

  it("keeps Gateway Chat Completions without a cache key by default", async () => {
    const payload = await captureChatPayload(chatModel(), { sessionId: "test-session" });
    expect(payload).not.toHaveProperty("prompt_cache_key");
  });
});

describe("generic Responses adapter", () => {
  it.each(["gpt-5.6-sol", "gpt-6-sol"])("requests priority traffic for Gateway %s", async (id) => {
    const payload = await captureResponsesPayload({ ...responsesModel(), id });
    expect(payload).toMatchObject({ model: id, service_tier: "priority" });
  });

  it.each([false, true])("omits the Gateway cache key on Responses (full=%s)", async (full) => {
    const onPayload = vi.fn((payload: unknown) => ({
      ...(payload as object),
      prompt_cache_key: "caller-added",
      metadata: { test: true },
    }));
    const gateway = await captureResponsesPayload(
      { ...responsesModel(), id: "gpt-6-sol" },
      { sessionId: "test-session", onPayload },
      full,
    );
    const otherProvider = await captureResponsesPayload(
      { ...responsesModel(), provider: "openai" },
      { sessionId: "test-session" },
      full,
    );

    expect(gateway).not.toHaveProperty("prompt_cache_key");
    expect(gateway).toMatchObject({ service_tier: "priority", metadata: { test: true } });
    expect(otherProvider).toHaveProperty("prompt_cache_key", "test-session");
    expect(onPayload).toHaveBeenCalledOnce();
  });

  it("omits the key for any Gateway Responses model, not just priority models", async () => {
    const payload = await captureResponsesPayload(responsesModel(), {
      sessionId: "test-session",
    });
    expect(payload).not.toHaveProperty("prompt_cache_key");
    expect(payload).not.toHaveProperty("service_tier");
  });

  it("keeps priority when sampling parameters or a payload hook are provided", async () => {
    const onPayload = vi.fn((payload: unknown) => ({
      ...(payload as object),
      metadata: { test: true },
    }));
    const payload = await captureResponsesPayload(
      { ...responsesModel(), id: "gpt-6-sol" },
      { samplingParams: { top_p: 0.5, service_tier: "default" }, onPayload },
    );

    expect(payload).toMatchObject({
      service_tier: "priority",
      top_p: 0.5,
      metadata: { test: true },
    });
    expect(onPayload).toHaveBeenCalledOnce();
  });

  it("does not request priority for other models or providers", async () => {
    const unrelated = await captureResponsesPayload(responsesModel());
    const nonGateway = await captureResponsesPayload({
      ...responsesModel(),
      provider: "openai",
      id: "gpt-6-sol",
    });

    expect(unrelated).not.toHaveProperty("service_tier");
    expect(nonGateway).not.toHaveProperty("service_tier");
  });

  it("requests priority for full Responses streams too", async () => {
    const payload = await captureResponsesPayload(
      { ...responsesModel(), id: "gpt-6-sol" },
      {},
      true,
    );
    expect(payload).toMatchObject({ model: "gpt-6-sol", service_tier: "priority" });
  });

  it("uses only the selected Responses protocol and does not construct a fallback", () => {
    const model = responsesModel();
    const options: SimpleStreamOptions = { apiKey: "test-key" };
    const responsesStreamer = vi.fn(() => emptyStream());

    streamSfGatewayResponses(model, CONTEXT, options, { responsesStreamer });

    expect(responsesStreamer).toHaveBeenCalledOnce();
    expect(responsesStreamer).toHaveBeenCalledWith(
      model,
      CONTEXT,
      expect.objectContaining(options),
    );
  });
});

describe("Messages error formatting", () => {
  it("sanitizes structured error envelopes and preserves request IDs", () => {
    expect(
      formatAnthropicStreamError(
        JSON.stringify({
          type: "error",
          error: { type: "api_error", message: "Temporary failure" },
          request_id: "request-example",
        }),
      ),
    ).toBe("Messages api_error: Temporary failure (request_id: request-example)");
  });

  it("returns unstructured errors without deployment-routing guidance", () => {
    const message = "The configured model could not be used.";
    expect(formatAnthropicStreamError(message)).toBe(message);
  });
});
