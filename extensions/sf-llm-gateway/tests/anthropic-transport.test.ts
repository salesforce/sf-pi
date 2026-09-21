/* SPDX-License-Identifier: Apache-2.0 */
/** Gateway Anthropic Adapter behavior after retry ownership moved to Pi. */
import { describe, expect, it } from "vitest";
import {
  createAssistantMessageEventStream,
  normalizeContext,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { streamSfGatewayAnthropicFull } from "../lib/transport.ts";

const MODEL: Model<"anthropic-messages"> = {
  id: "example-native-message-model",
  provider: "sf-llm-gateway",
  api: "anthropic-messages",
  name: "Opus 5",
  baseUrl: "https://gateway.test",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1_000_000,
  maxTokens: 128_000,
};
const CONTEXT = normalizeContext({ messages: [] });

function message(
  stopReason: AssistantMessage["stopReason"],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: MODEL.api,
    provider: MODEL.provider,
    model: MODEL.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}

function eventStream(events: AssistantMessageEvent[]): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    for (const event of events) stream.push(event);
    stream.end();
  });
  return stream;
}

async function drain(stream: AssistantMessageEventStream): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("Gateway Anthropic transport Adapter", () => {
  it("forwards Pi retry options without adding a Gateway retry default", async () => {
    const observed: Array<number | undefined> = [];
    const done = message("stop");
    const streamer = (
      _model: Model<"anthropic-messages">,
      _context: TranscriptContext,
      options?: { maxRetries?: number },
    ) => {
      observed.push(options?.maxRetries);
      return eventStream([
        { type: "start", partial: done },
        { type: "done", reason: "stop", message: done },
      ]);
    };

    await drain(streamSfGatewayAnthropicFull(MODEL, CONTEXT, undefined, { streamer }));
    await drain(streamSfGatewayAnthropicFull(MODEL, CONTEXT, { maxRetries: 0 }, { streamer }));
    await drain(streamSfGatewayAnthropicFull(MODEL, CONTEXT, { maxRetries: 5 }, { streamer }));

    expect(observed).toEqual([undefined, 0, 5]);
  });

  it("sanitizes one terminal Gateway envelope and leaves retry attempts to Pi", async () => {
    let calls = 0;
    const envelope = JSON.stringify({
      type: "error",
      error: { type: "api_error", message: "Internal server error" },
      request_id: "req_test_1",
    });
    const streamer = () => {
      calls += 1;
      const partial = message("stop");
      return eventStream([
        { type: "start", partial },
        { type: "error", reason: "error", error: message("error", envelope) },
      ]);
    };

    const events = await drain(
      streamSfGatewayAnthropicFull(MODEL, CONTEXT, { maxRetries: 3 }, { streamer }),
    );
    const error = events.find(
      (event): event is Extract<AssistantMessageEvent, { type: "error" }> => event.type === "error",
    );

    expect(calls).toBe(1);
    expect(events.map((event) => event.type)).toEqual(["start", "error"]);
    expect(error?.error.errorMessage).toContain("Messages api_error: Internal server error");
    expect(error?.error.errorMessage).toContain("request_id: req_test_1");
    expect(error?.error.errorMessage).toContain("retry.maxRetries");
    expect(error?.error.errorMessage?.trim().startsWith("{")).toBe(false);
  });
});
