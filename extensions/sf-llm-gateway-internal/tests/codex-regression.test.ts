/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Live Codex regression checks against a real SF LLM Gateway instance.
 *
 * This suite is intentionally opt-in:
 * - it only runs when SF_LLM_GATEWAY_INTERNAL_BASE_URL and
 *   SF_LLM_GATEWAY_INTERNAL_API_KEY are set
 * - it talks to the real gateway over the network
 *
 * Goal: catch regressions where future refactors stop shaping Codex payloads
 * the way LiteLLM's Responses-API-backed Codex path expects.
 */
import { describe, expect, it } from "vitest";
import { API_KEY_ENV, BASE_URL_ENV, normalizeBaseUrl } from "../lib/config.ts";
import { toGatewayOpenAiBaseUrl } from "../lib/gateway-url.ts";
import { flattenCodexTools, injectCodexGatewayParams } from "../lib/transport.ts";

const LIVE_CODEX_MODEL_ENV = "SF_LLM_GATEWAY_INTERNAL_CODEX_TEST_MODEL";
const LIVE_TIMEOUT_ENV = "SF_LLM_GATEWAY_INTERNAL_CODEX_TEST_TIMEOUT_MS";
const DEFAULT_CODEX_TEST_MODEL = "gpt-5.3-codex";
const DEFAULT_TIMEOUT_MS = 45_000;

const baseUrl = normalizeBaseUrl(process.env[BASE_URL_ENV]);
const apiKey = process.env[API_KEY_ENV]?.trim();
const codexModel = process.env[LIVE_CODEX_MODEL_ENV]?.trim() || DEFAULT_CODEX_TEST_MODEL;
const timeoutMs = Number(process.env[LIVE_TIMEOUT_ENV] || DEFAULT_TIMEOUT_MS);
const hasLiveGatewayConfig = !!baseUrl && !!apiKey;
const describeLive = hasLiveGatewayConfig ? describe : describe.skip;

describeLive("sf-llm-gateway-internal Codex regression", () => {
  it("succeeds after flattening Codex tool definitions", async () => {
    const payload: Record<string, unknown> = {
      model: codexModel,
      messages: [
        {
          role: "user",
          content: "Use the get_time tool to answer this request. Do not answer from memory.",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "get_time",
            description: "Return the current time.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
    };

    flattenCodexTools(payload);
    injectCodexGatewayParams(payload);

    const response = await postGatewayChatCompletions(payload);
    const choice = response.choices?.[0];
    const toolCall = choice?.message?.tool_calls?.[0];

    expect(choice?.finish_reason).toBe("tool_calls");
    expect(toolCall?.function?.name).toBe("get_time");
    expect(payload.tools).toEqual([
      {
        type: "function",
        name: "get_time",
        description: "Return the current time.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ]);
  });

  it("clamps xhigh reasoning to a gateway-safe value before sending", async () => {
    const payload: Record<string, unknown> = {
      model: codexModel,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
      reasoning_effort: "xhigh",
    };

    injectCodexGatewayParams(payload);

    const response = await postGatewayChatCompletions(payload);
    const content = response.choices?.[0]?.message?.content;

    expect(payload.reasoning_effort).toBe("high");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });
});

type GatewayChatCompletionsResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
      tool_calls?: Array<{
        function?: {
          name?: string;
        };
      }>;
    };
  }>;
};

async function postGatewayChatCompletions(
  payload: Record<string, unknown>,
): Promise<GatewayChatCompletionsResponse> {
  if (!baseUrl || !apiKey) {
    throw new Error(`Live Codex regression requires ${BASE_URL_ENV} and ${API_KEY_ENV}.`);
  }

  const response = await fetch(`${toGatewayOpenAiBaseUrl(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  const parsed = tryParseJson(text) as GatewayChatCompletionsResponse & {
    error?: { message?: string };
  };

  if (!response.ok) {
    const detail = parsed?.error?.message || text || response.statusText;
    throw new Error(`Gateway request failed (${response.status}): ${detail}`);
  }

  return parsed;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
