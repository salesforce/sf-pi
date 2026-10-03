/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proofs for provider-neutral gateway transport adapters. */
import { describe, expect, it, vi } from "vitest";
import {
  createAssistantMessageEventStream,
  normalizeContext,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type OpenAICompletionsOptions,
  type OpenAIResponsesOptions,
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

function terminalButOpenResponsesStreamer(
  model: Model<"openai-responses">,
  completed: AssistantMessage,
  providerEvents: unknown[],
) {
  return vi.fn(
    (
      _model: Model<"openai-responses">,
      _context: typeof CONTEXT,
      options?: SimpleStreamOptions | OpenAIResponsesOptions,
    ) => {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(async () => {
        stream.push({ type: "start", partial: completed });
        for (const event of providerEvents) {
          await options?.onProviderStreamEvent?.(event, model);
        }
        options?.signal?.addEventListener(
          "abort",
          () => {
            stream.push({ type: "error", reason: "aborted", error: completed });
            stream.end();
          },
          { once: true },
        );
      });
      return stream;
    },
  );
}

async function resultAfterTerminalCloseGuard(
  stream: AssistantMessageEventStream,
): Promise<AssistantMessage | "still-open"> {
  const outcome = Promise.race([
    stream.result(),
    new Promise<"still-open">((resolve) => setTimeout(() => resolve("still-open"), 2_000)),
  ]);
  await vi.advanceTimersByTimeAsync(2_000);
  return outcome;
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

  it.each(["simple", "full"] as const)(
    "finishes a completed response when the %s provider stream stays open",
    async (streamKind) => {
      vi.useFakeTimers();
      try {
        const model = { ...responsesModel(), id: "gpt-6-sol" };
        const completed = {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: "ok" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 10,
            output: 2,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 12,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "aborted" as const,
          rawStopReason: "completed",
          errorMessage: "Request aborted",
          timestamp: Date.now(),
        };
        const responsesStreamer = terminalButOpenResponsesStreamer(model, completed, [
          {
            type: "response.completed",
            response: { status: "completed", output: [], usage: { total_tokens: 12 } },
          },
        ]);

        const stream =
          streamKind === "full"
            ? streamSfGatewayResponsesFull(
                model,
                CONTEXT,
                { apiKey: "test-key", maxRetries: 0 },
                { responsesStreamer },
              )
            : streamSfGatewayResponses(
                model,
                CONTEXT,
                { apiKey: "test-key", maxRetries: 0 },
                { responsesStreamer },
              );
        const outcome = resultAfterTerminalCloseGuard(stream);

        await expect(outcome).resolves.toMatchObject({
          stopReason: "stop",
          rawStopReason: "completed",
          usage: { totalTokens: 12 },
          diagnostics: [
            {
              type: "sf-llm-gateway.terminal-close-recovered",
              details: { graceMs: 1_000 },
            },
          ],
        });
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("recovers a fully completed tool call but never an unfinished one", async () => {
    vi.useFakeTimers();
    try {
      const model = { ...responsesModel(), id: "gpt-6-sol" };
      const toolCall = {
        type: "toolCall" as const,
        id: "call-1|fc-1",
        name: "gateway_probe",
        arguments: { value: "ok" },
      };
      const completed = {
        role: "assistant" as const,
        content: [toolCall],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 10,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 12,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "aborted" as const,
        rawStopReason: "completed",
        errorMessage: "Request aborted",
        timestamp: Date.now(),
      };
      const completeEvents = [
        { type: "response.output_item.added", output_index: 0 },
        { type: "response.output_item.done", output_index: 0 },
        { type: "response.completed", response: { status: "completed", output: [] } },
      ];
      const unfinishedEvents = [
        { type: "response.output_item.added", output_index: 0 },
        { type: "response.completed", response: { status: "completed", output: [] } },
      ];
      const missingLifecycleEvents = [
        {
          type: "response.completed",
          response: { status: "completed", output: [{ type: "function_call" }] },
        },
      ];
      const duplicateTerminalEvents = [
        ...completeEvents,
        { type: "response.completed", response: { status: "completed", output: [] } },
      ];

      const recovered = streamSfGatewayResponses(
        model,
        CONTEXT,
        { apiKey: "test-key", maxRetries: 0 },
        { responsesStreamer: terminalButOpenResponsesStreamer(model, completed, completeEvents) },
      );
      const refused = streamSfGatewayResponses(
        model,
        CONTEXT,
        { apiKey: "test-key", maxRetries: 0 },
        { responsesStreamer: terminalButOpenResponsesStreamer(model, completed, unfinishedEvents) },
      );
      const missingLifecycle = streamSfGatewayResponses(
        model,
        CONTEXT,
        { apiKey: "test-key", maxRetries: 0 },
        {
          responsesStreamer: terminalButOpenResponsesStreamer(
            model,
            completed,
            missingLifecycleEvents,
          ),
        },
      );
      const duplicateTerminal = streamSfGatewayResponses(
        model,
        CONTEXT,
        { apiKey: "test-key", maxRetries: 0 },
        {
          responsesStreamer: terminalButOpenResponsesStreamer(
            model,
            completed,
            duplicateTerminalEvents,
          ),
        },
      );

      await expect(resultAfterTerminalCloseGuard(recovered)).resolves.toMatchObject({
        stopReason: "toolUse",
        content: [toolCall],
      });
      await expect(resultAfterTerminalCloseGuard(refused)).resolves.toMatchObject({
        stopReason: "aborted",
        errorMessage: "Request aborted",
      });
      await expect(resultAfterTerminalCloseGuard(missingLifecycle)).resolves.toMatchObject({
        stopReason: "aborted",
        errorMessage: "Request aborted",
      });
      await expect(resultAfterTerminalCloseGuard(duplicateTerminal)).resolves.toMatchObject({
        stopReason: "aborted",
        errorMessage: "Request aborted",
      });
    } finally {
      vi.useRealTimers();
    }
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
