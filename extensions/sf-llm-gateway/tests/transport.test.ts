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
  streamSfGatewayOpenAIFull,
  streamSfGatewayResponses,
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

describe("generic Chat Completions adapter", () => {
  it("passes the model and options through without route-specific payload mutation", () => {
    const model = chatModel();
    const options: OpenAICompletionsOptions = {
      apiKey: "test-key",
      onPayload: vi.fn((payload) => payload),
    };
    const streamer = vi.fn(() => emptyStream());

    streamSfGatewayOpenAIFull(model, CONTEXT, options, { streamer });

    expect(streamer).toHaveBeenCalledWith(model, CONTEXT, options);
  });
});

describe("generic Responses adapter", () => {
  it("uses only the selected Responses protocol and does not construct a fallback", () => {
    const model = responsesModel();
    const options: SimpleStreamOptions = { apiKey: "test-key" };
    const responsesStreamer = vi.fn(() => emptyStream());

    streamSfGatewayResponses(model, CONTEXT, options, { responsesStreamer });

    expect(responsesStreamer).toHaveBeenCalledWith(model, CONTEXT, options);
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
