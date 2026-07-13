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
} from "@earendil-works/pi-ai";
import {
  toProviderModelConfig,
  GPT55_RESPONSES_THINKING_LEVEL_MAP,
  GPT5_BEDROCK_RESPONSES_THINKING_LEVEL_MAP,
  GPT5_RESPONSES_THINKING_LEVEL_MAP,
} from "../lib/models.ts";
import {
  GPT5_BEDROCK_EARLY_DONE_GRACE_MS,
  GPT5_FORCE_CHAT_ENV,
  GPT55_FORCE_CHAT_ENV,
  isGpt5FamilyResponsesModelId,
  streamSfGatewayResponses,
  type Gpt55ResponsesTestHooks,
} from "../lib/transport.ts";

const ORIGINAL_ENV_55 = process.env[GPT55_FORCE_CHAT_ENV];
const ORIGINAL_ENV_5 = process.env[GPT5_FORCE_CHAT_ENV];

afterEach(() => {
  for (const [name, original] of [
    [GPT55_FORCE_CHAT_ENV, ORIGINAL_ENV_55] as const,
    [GPT5_FORCE_CHAT_ENV, ORIGINAL_ENV_5] as const,
  ]) {
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
  }
});

describe("gpt-5.5 model registration", () => {
  it("tags the model as openai-responses with the clamped thinkingLevelMap", () => {
    const cfg = toProviderModelConfig("gpt-5.5");
    expect(cfg.api).toBe("openai-responses");
    expect(cfg.thinkingLevelMap).toEqual(GPT55_RESPONSES_THINKING_LEVEL_MAP);
  });

  it("maps Pi max to the live-proven GPT-5.5 xhigh effort", () => {
    const map = GPT55_RESPONSES_THINKING_LEVEL_MAP!;
    // Live probe on 2026-07-12: gpt-5.5 rejects `max` but accepts `xhigh`
    // on the Responses route. Pi's user-facing max therefore maps to the
    // strongest wire value this gateway route accepts.
    expect(map.minimal).toBe("low");
    expect(map.low).toBe("low");
    expect(map.medium).toBe("medium");
    expect(map.high).toBe("high");
    expect(map.xhigh).toBe("xhigh");
    expect(map.max).toBe("xhigh");
  });

  it("also tags gpt-5, gpt-5-mini, and versioned non-Bedrock IDs with the native clamp", () => {
    for (const id of ["gpt-5", "gpt-5-mini", "gpt-5.4"]) {
      const cfg = toProviderModelConfig(id);
      expect(cfg.api).toBe("openai-responses");
      expect(cfg.thinkingLevelMap).toEqual(GPT5_RESPONSES_THINKING_LEVEL_MAP);
    }
  });

  it("tags GPT-5 Bedrock Responses models with the conservative high-only clamp", () => {
    for (const id of ["gpt-5.4-bedrock", "gpt-5.5-bedrock"]) {
      const cfg = toProviderModelConfig(id);
      expect(cfg.api).toBe("openai-responses");
      expect(cfg.thinkingLevelMap).toEqual(GPT5_BEDROCK_RESPONSES_THINKING_LEVEL_MAP);
    }
  });

  it("keeps codex, gpt-4o, and non-gpt-5 models on openai-completions", () => {
    for (const id of ["gpt-5.2-codex", "gpt-5.3-codex", "gpt-4o", "gpt-4o-mini"]) {
      expect(toProviderModelConfig(id).api).toBe("openai-completions");
    }
  });
});

describe("isGpt5FamilyResponsesModelId", () => {
  it("matches non-Codex GPT-5 Responses IDs plus the openai/ prefix form", () => {
    for (const id of [
      "gpt-5",
      "gpt-5-mini",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-bedrock",
      "gpt-5.5-bedrock",
      "openai/gpt-5",
      "openai/gpt-5-mini",
      "openai/gpt-5.5",
      "openai/gpt-5.4-bedrock",
      "GPT-5",
    ]) {
      expect(isGpt5FamilyResponsesModelId(id)).toBe(true);
    }
  });

  it("does not match codex, gpt-4o, or unrelated ids", () => {
    for (const id of [
      "gpt-5.2-codex",
      "gpt-5.3-codex",
      "gpt-4o",
      "gpt-4o-mini",
      "claude-opus-4-7",
      "gemini-3.1-pro-preview",
    ]) {
      expect(isGpt5FamilyResponsesModelId(id)).toBe(false);
    }
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

  it("injects service_tier: priority onto the Responses payload", async () => {
    let observedTier: unknown;
    const hooks: Gpt55ResponsesTestHooks = {
      responsesStreamer: (_model, _ctx, options) => {
        const payload: Record<string, unknown> = { model: "gpt-5.5", input: "hi" };
        void Promise.resolve(options?.onPayload?.(payload, responsesModel)).then(() => {
          observedTier = payload.service_tier;
        });
        return happyResponsesStreamer();
      },
      chatStreamer: emptyChatStreamer,
    };

    await collect(
      streamSfGatewayResponses(responsesModel, context, undefined, { chatModel }, hooks),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observedTier).toBe("priority");
  });

  it("leaves a caller-provided service_tier untouched", async () => {
    let observedTier: unknown;
    const hooks: Gpt55ResponsesTestHooks = {
      responsesStreamer: (_model, _ctx, options) => {
        const payload: Record<string, unknown> = {
          model: "gpt-5.5",
          input: "hi",
          service_tier: "flex",
        };
        void Promise.resolve(options?.onPayload?.(payload, responsesModel)).then(() => {
          observedTier = payload.service_tier;
        });
        return happyResponsesStreamer();
      },
      chatStreamer: emptyChatStreamer,
    };

    await collect(
      streamSfGatewayResponses(responsesModel, context, undefined, { chatModel }, hooks),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observedTier).toBe("flex");
  });

  it("does not inject service_tier: priority for GPT-5 Bedrock Responses models", async () => {
    let observedTier: unknown = "unset";
    const bedrockResponsesModel = {
      ...responsesModel,
      id: "gpt-5.5-bedrock",
    } as Model<"openai-responses">;
    const bedrockChatModel = {
      ...chatModel,
      id: "gpt-5.5-bedrock",
    } as Model<"openai-completions">;
    const hooks: Gpt55ResponsesTestHooks = {
      responsesStreamer: (_model, _ctx, options) => {
        const payload: Record<string, unknown> = { model: "gpt-5.5-bedrock", input: "hi" };
        void Promise.resolve(options?.onPayload?.(payload, bedrockResponsesModel)).then(() => {
          observedTier = payload.service_tier;
        });
        return happyResponsesStreamer();
      },
      chatStreamer: emptyChatStreamer,
    };

    await collect(
      streamSfGatewayResponses(
        bedrockResponsesModel,
        context,
        undefined,
        { chatModel: bedrockChatModel },
        hooks,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observedTier).toBeUndefined();
  });

  it("finishes GPT-5 Bedrock Responses turns after visible output instead of waiting for a delayed terminal event", async () => {
    const bedrockResponsesModel = {
      ...responsesModel,
      id: "gpt-5.5-bedrock",
    } as Model<"openai-responses">;
    const bedrockChatModel = {
      ...chatModel,
      id: "gpt-5.5-bedrock",
    } as Model<"openai-completions">;
    const hooks: Gpt55ResponsesTestHooks = {
      responsesStreamer: () => delayedDoneStreamer("gpt-5.5-bedrock"),
      chatStreamer: emptyChatStreamer,
    };

    const started = Date.now();
    const events = await collect(
      streamSfGatewayResponses(
        bedrockResponsesModel,
        context,
        undefined,
        { chatModel: bedrockChatModel },
        hooks,
      ),
    );

    expect(Date.now() - started).toBeLessThan(GPT5_BEDROCK_EARLY_DONE_GRACE_MS * 3);
    expect(responsesCalls).toBe(1);
    expect(chatCalls).toBe(0);
    expect(events).toEqual(["start", "text_start", "text_end", "done"]);
  });

  it("does not early-finish non-Bedrock Responses turns before the upstream terminal event", async () => {
    const hooks: Gpt55ResponsesTestHooks = {
      responsesStreamer: () => delayedDoneStreamer("gpt-5.5"),
      chatStreamer: emptyChatStreamer,
    };

    const started = Date.now();
    const events = await collect(
      streamSfGatewayResponses(responsesModel, context, undefined, { chatModel }, hooks),
    );

    expect(Date.now() - started).toBeGreaterThanOrEqual(GPT5_BEDROCK_EARLY_DONE_GRACE_MS * 3);
    expect(responsesCalls).toBe(1);
    expect(chatCalls).toBe(0);
    expect(events).toEqual(["start", "text_start", "text_end", "done"]);
  });

  function delayedDoneStreamer(modelId: string): AssistantMessageEventStream {
    responsesCalls++;
    const stream = createAssistantMessageEventStream();
    setTimeout(() => {
      const partial = {
        ...dummyMessage(),
        model: modelId,
        content: [{ type: "text" as const, text: "ok" }],
      };
      stream.push({ type: "start", partial: dummyMessage() });
      stream.push({ type: "text_start", contentIndex: 0, partial: dummyMessage() });
      stream.push({ type: "text_end", contentIndex: 0, content: "ok", partial });
    }, 0);
    setTimeout(() => {
      stream.push({ type: "done", reason: "stop", message: dummyMessage() });
      stream.end();
    }, GPT5_BEDROCK_EARLY_DONE_GRACE_MS * 4);
    return stream;
  }

  it("passes the Gateway default provider retry budget to Responses", async () => {
    let observedMaxRetries: number | undefined;
    const hooks: Gpt55ResponsesTestHooks = {
      responsesStreamer: (_model, _context, options) => {
        observedMaxRetries = options?.maxRetries;
        return happyResponsesStreamer();
      },
      chatStreamer: emptyChatStreamer,
    };

    await collect(
      streamSfGatewayResponses(responsesModel, context, undefined, { chatModel }, hooks),
    );

    expect(observedMaxRetries).toBe(3);
  });

  it("preserves explicit Pi provider retry overrides, including 0", async () => {
    let observedMaxRetries: number | undefined;
    const hooks: Gpt55ResponsesTestHooks = {
      responsesStreamer: (_model, _context, options) => {
        observedMaxRetries = options?.maxRetries;
        return happyResponsesStreamer();
      },
      chatStreamer: emptyChatStreamer,
    };

    await collect(
      streamSfGatewayResponses(responsesModel, context, { maxRetries: 0 }, { chatModel }, hooks),
    );
    expect(observedMaxRetries).toBe(0);

    await collect(
      streamSfGatewayResponses(responsesModel, context, { maxRetries: 5 }, { chatModel }, hooks),
    );
    expect(observedMaxRetries).toBe(5);
  });

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

  it("respects SF_LLM_GATEWAY_INTERNAL_GPT5_FORCE_CHAT=1 before the first attempt", async () => {
    process.env[GPT5_FORCE_CHAT_ENV] = "1";
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

  it("also honors the legacy SF_LLM_GATEWAY_INTERNAL_GPT55_FORCE_CHAT alias", async () => {
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
    expect(fallbackReason).toMatch(/GPT55_FORCE_CHAT/i);
  });

  it("ignores unset or falsy values of the force-chat env vars", async () => {
    const hooks: Gpt55ResponsesTestHooks = {
      responsesStreamer: happyResponsesStreamer,
      chatStreamer: emptyChatStreamer,
    };

    delete process.env[GPT5_FORCE_CHAT_ENV];
    delete process.env[GPT55_FORCE_CHAT_ENV];
    await collect(
      streamSfGatewayResponses(responsesModel, context, undefined, { chatModel }, hooks),
    );
    expect(responsesCalls).toBe(1);
    expect(chatCalls).toBe(0);

    responsesCalls = 0;
    chatCalls = 0;
    process.env[GPT5_FORCE_CHAT_ENV] = "0";
    process.env[GPT55_FORCE_CHAT_ENV] = "false";
    await collect(
      streamSfGatewayResponses(responsesModel, context, undefined, { chatModel }, hooks),
    );
    expect(responsesCalls).toBe(1);
    expect(chatCalls).toBe(0);
  });
});
