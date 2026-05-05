/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Phase 3 — gpt-5.5 `/responses` transport pivot tests.
 *
 * Cover the routing decisions around gpt-5.5: the model is tagged as
 * `openai-responses` at registration, the dispatcher delegates it to
 * `streamSfGatewayResponses`, and the shim falls back to the chat path
 * either on env opt-out or on an early stream error.
 *
 * The shim accepts an optional `hooks` argument so tests can inject fake
 * streamers without touching pi-ai's ESM exports.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
} from "@mariozechner/pi-ai";
import { toProviderModelConfig, GPT55_RESPONSES_THINKING_LEVEL_MAP } from "../lib/models.ts";
import {
  GPT55_FORCE_CHAT_ENV,
  streamSfGatewayResponses,
  type Gpt55ResponsesTestHooks,
} from "../lib/transport.ts";

const ORIGINAL_ENV = process.env[GPT55_FORCE_CHAT_ENV];

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env[GPT55_FORCE_CHAT_ENV];
  } else {
    process.env[GPT55_FORCE_CHAT_ENV] = ORIGINAL_ENV;
  }
});

describe("gpt-5.5 model registration", () => {
  it("tags the model as openai-responses with the clamped thinkingLevelMap", () => {
    const cfg = toProviderModelConfig("gpt-5.5", null, new Set());
    expect(cfg.api).toBe("openai-responses");
    expect(cfg.thinkingLevelMap).toEqual(GPT55_RESPONSES_THINKING_LEVEL_MAP);
  });

  it("clamps every pi thinking level to low|medium|high", () => {
    const map = GPT55_RESPONSES_THINKING_LEVEL_MAP!;
    // Overlap between LiteLLM's Pydantic validator (minimal|low|medium|high)
    // and upstream OpenAI Responses (none|low|medium|high|xhigh) is
    // low|medium|high. Both ends of pi's scale clamp inward.
    expect(map.minimal).toBe("low");
    expect(map.low).toBe("low");
    expect(map.medium).toBe("medium");
    expect(map.high).toBe("high");
    expect(map.xhigh).toBe("high");
  });

  it("does not tag gpt-5 or gpt-5-mini as openai-responses", () => {
    expect(toProviderModelConfig("gpt-5", null, new Set()).api).toBe("openai-completions");
    expect(toProviderModelConfig("gpt-5-mini", null, new Set()).api).toBe("openai-completions");
  });
});

describe("streamSfGatewayResponses", () => {
  const responsesModel = {
    api: "openai-responses",
    id: "gpt-5.5",
  } as unknown as Model<"openai-responses">;
  const chatModel = {
    api: "openai-completions",
    id: "gpt-5.5",
  } as unknown as Model<"openai-completions">;
  const context: Context = { messages: [] };

  let responsesCalls: number;
  let chatCalls: number;

  beforeEach(() => {
    responsesCalls = 0;
    chatCalls = 0;
  });

  function dummyMessage(): AssistantMessage {
    return {
      role: "assistant",
      content: [],
      api: "openai-responses" as const,
      provider: "sf-llm-gateway-internal",
      model: "gpt-5.5",
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
  }

  function happyResponsesStreamer(): AssistantMessageEventStream {
    responsesCalls++;
    const stream = createAssistantMessageEventStream();
    setTimeout(() => {
      stream.push({ type: "start", partial: dummyMessage() });
      stream.push({
        type: "text_delta",
        contentIndex: 0,
        delta: "ok",
        partial: { ...dummyMessage(), content: [{ type: "text", text: "ok" }] },
      });
      stream.push({
        type: "done",
        reason: "stop",
        message: { ...dummyMessage(), content: [{ type: "text", text: "ok" }] },
      });
      stream.end();
    }, 0);
    return stream;
  }

  function erroringResponsesStreamer(errorMessage: string): AssistantMessageEventStream {
    responsesCalls++;
    const stream = createAssistantMessageEventStream();
    setTimeout(() => {
      stream.push({
        type: "error",
        reason: "error",
        error: { ...dummyMessage(), stopReason: "error", errorMessage },
      });
      stream.end();
    }, 0);
    return stream;
  }

  function emptyChatStreamer(): AssistantMessageEventStream {
    chatCalls++;
    const stream = createAssistantMessageEventStream();
    setTimeout(() => stream.end(), 0);
    return stream;
  }

  async function collect(
    stream: AssistantMessageEventStream,
  ): Promise<AssistantMessageEvent["type"][]> {
    const types: AssistantMessageEvent["type"][] = [];
    for await (const event of stream) types.push(event.type);
    return types;
  }

  it("delegates to the Responses streamer on the happy path", async () => {
    const hooks: Gpt55ResponsesTestHooks = {
      responsesStreamer: happyResponsesStreamer,
      chatStreamer: emptyChatStreamer,
    };
    const events = await collect(
      streamSfGatewayResponses(responsesModel, context, undefined, { chatModel }, hooks),
    );
    expect(responsesCalls).toBe(1);
    expect(chatCalls).toBe(0);
    expect(events).toContain("text_delta");
    expect(events).toContain("done");
  });

  it("falls back to chat when the Responses stream errors before content", async () => {
    let fallbackReason: string | undefined;
    const hooks: Gpt55ResponsesTestHooks = {
      responsesStreamer: () => erroringResponsesStreamer("responses rejected before content"),
      chatStreamer: emptyChatStreamer,
    };
    await collect(
      streamSfGatewayResponses(
        responsesModel,
        context,
        undefined,
        {
          chatModel,
          onFallback: (reason) => {
            fallbackReason = reason;
          },
        },
        hooks,
      ),
    );
    expect(responsesCalls).toBe(1);
    expect(chatCalls).toBe(1);
    expect(fallbackReason).toMatch(/falling back to chat/i);
  });

  it("respects SF_LLM_GATEWAY_INTERNAL_GPT55_FORCE_CHAT=1 before the first attempt", async () => {
    process.env[GPT55_FORCE_CHAT_ENV] = "1";
    let fallbackReason: string | undefined;
    const hooks: Gpt55ResponsesTestHooks = {
      responsesStreamer: happyResponsesStreamer,
      chatStreamer: emptyChatStreamer,
    };
    await collect(
      streamSfGatewayResponses(
        responsesModel,
        context,
        undefined,
        {
          chatModel,
          onFallback: (reason) => {
            fallbackReason = reason;
          },
        },
        hooks,
      ),
    );
    expect(responsesCalls).toBe(0);
    expect(chatCalls).toBe(1);
    expect(fallbackReason).toMatch(/FORCE_CHAT/i);
  });

  it("ignores unset or falsy values of the force-chat env var", async () => {
    const hooks: Gpt55ResponsesTestHooks = {
      responsesStreamer: happyResponsesStreamer,
      chatStreamer: emptyChatStreamer,
    };

    delete process.env[GPT55_FORCE_CHAT_ENV];
    await collect(
      streamSfGatewayResponses(responsesModel, context, undefined, { chatModel }, hooks),
    );
    expect(responsesCalls).toBe(1);
    expect(chatCalls).toBe(0);

    responsesCalls = 0;
    chatCalls = 0;
    process.env[GPT55_FORCE_CHAT_ENV] = "0";
    await collect(
      streamSfGatewayResponses(responsesModel, context, undefined, { chatModel }, hooks),
    );
    expect(responsesCalls).toBe(1);
    expect(chatCalls).toBe(0);
  });
});
