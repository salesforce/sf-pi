/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Live GPT-5 Responses regression checks against a real SF LLM Gateway instance.
 *
 * This suite is intentionally opt-in:
 * - it only runs when SF_LLM_GATEWAY_BASE_URL and SF_LLM_GATEWAY_API_KEY are set
 * - it talks to the real gateway over the network
 *
 * Goal: verify the actual sf-pi transport path for critical-path GPT-5
 * Responses models. The model must route through `POST <gateway-root>/responses`,
 * keep tool-shaped agentic requests accepted, and avoid the chat-completions
 * fallback unless the explicit kill switch is set.
 *
 * Set SF_LLM_GATEWAY_INTERNAL_GPT55_TEST_MODEL to probe a specific discovered
 * Responses model, such as gpt-5.4-bedrock or gpt-5.5-bedrock.
 */
import { describe, expect, it } from "vitest";
import type {
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { API_KEY_ENV, BASE_URL_ENV, normalizeBaseUrl, PROVIDER_NAME } from "../lib/config.ts";
import { toGatewayRootBaseUrl } from "../lib/gateway-url.ts";
import { toProviderModelConfig } from "../lib/models.ts";
import { streamSfGatewayResponses } from "../lib/transport.ts";

const LIVE_GPT55_MODEL_ENV = "SF_LLM_GATEWAY_INTERNAL_GPT55_TEST_MODEL";
const LIVE_TIMEOUT_ENV = "SF_LLM_GATEWAY_INTERNAL_GPT55_TEST_TIMEOUT_MS";
const DEFAULT_GPT55_TEST_MODEL = "gpt-5.5";
const DEFAULT_TIMEOUT_MS = 45_000;

const baseUrl = normalizeBaseUrl(process.env[BASE_URL_ENV]);
const apiKey = process.env[API_KEY_ENV]?.trim();
const gpt55Model = process.env[LIVE_GPT55_MODEL_ENV]?.trim() || DEFAULT_GPT55_TEST_MODEL;
const timeoutMs = Number(process.env[LIVE_TIMEOUT_ENV] || DEFAULT_TIMEOUT_MS);
const hasLiveGatewayConfig = !!baseUrl && !!apiKey;
const describeLive = hasLiveGatewayConfig ? describe : describe.skip;

describeLive("sf-llm-gateway-internal GPT-5 Responses live regression", () => {
  it(
    "streams through the OpenAI Responses transport with an agentic tool-shaped request",
    async () => {
      let fallbackReason: string | undefined;
      const capturedPayloads: Record<string, unknown>[] = [];

      const events = await collectStream(
        streamSfGatewayResponses(
          makeGpt55ResponsesModel(),
          makeToolContext(),
          {
            apiKey,
            reasoning: "high",
            maxTokens: 128,
            signal: AbortSignal.timeout(timeoutMs),
            onPayload: (payload) => {
              if (payload && typeof payload === "object" && !Array.isArray(payload)) {
                capturedPayloads.push(payload as Record<string, unknown>);
              }
              return payload;
            },
          },
          {
            chatModel: makeGpt55ChatModel(),
            onFallback: (reason) => {
              fallbackReason = reason;
            },
          },
        ),
      );

      const payload = capturedPayloads[0];
      expect(payload).toBeDefined();
      expect(payload?.model).toBe(gpt55Model);
      expect(payload?.tools).toBeDefined();
      expect(payload?.reasoning).toEqual({ effort: "high", summary: "auto" });
      expect(fallbackReason).toBeUndefined();
      expect(events.some((event) => event.type === "error")).toBe(false);
      expect(events.some((event) => event.type === "done")).toBe(true);
    },
    timeoutMs + 5_000,
  );
});

function makeGpt55ResponsesModel(): Model<"openai-responses"> {
  const cfg = toProviderModelConfig(gpt55Model);
  return {
    ...cfg,
    api: "openai-responses",
    provider: PROVIDER_NAME,
    baseUrl: toGatewayRootBaseUrl(baseUrl!),
  } as Model<"openai-responses">;
}

function makeGpt55ChatModel(): Model<"openai-completions"> {
  const cfg = toProviderModelConfig(gpt55Model);
  return {
    ...cfg,
    api: "openai-completions",
    provider: PROVIDER_NAME,
    baseUrl: toGatewayRootBaseUrl(baseUrl!),
  } as Model<"openai-completions">;
}

function makeToolContext(): Context {
  return {
    messages: [
      {
        role: "user",
        content:
          "Use the noop tool if needed, otherwise reply with OK. Keep the response as short as possible.",
        timestamp: Date.now(),
      },
    ],
    tools: [
      {
        name: "noop",
        description: "A no-op tool used only to preserve the agentic request shape.",
        parameters: Type.Object({}),
      },
    ],
  };
}

async function collectStream(
  stream: AssistantMessageEventStream,
): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) {
    events.push(event);
    if (event.type === "error") {
      throw new Error(event.error.errorMessage ?? "GPT 5.5 live stream failed");
    }
  }
  return events;
}
