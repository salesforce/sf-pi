/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Live Opus 4.7 transform checks against a real SF LLM Gateway instance.
 *
 * This suite is intentionally opt-in:
 * - it only runs when SF_LLM_GATEWAY_INTERNAL_BASE_URL and
 *   SF_LLM_GATEWAY_INTERNAL_API_KEY are set
 * - it talks to the real gateway over the network
 *
 * Goal: verify that the Gateway accepts the same Opus 4.7 adaptive-thinking
 * payload shape that sf-pi preserves after Pi 0.73 added native xhigh effort
 * support. Unit tests pin local request shaping; these tests prove the live
 * transform endpoint still accepts the shape.
 */
import { describe, expect, it } from "vitest";
import { API_KEY_ENV, BASE_URL_ENV, normalizeBaseUrl } from "../lib/config.ts";
import { toGatewayRootBaseUrl } from "../lib/gateway-url.ts";
import { OPUS_47_MODEL_MAX_TOKENS, applyOpus47MaxThinking } from "../lib/transport.ts";

const LIVE_OPUS_MODEL_ENV = "SF_LLM_GATEWAY_INTERNAL_OPUS47_TEST_MODEL";
const LIVE_TIMEOUT_ENV = "SF_LLM_GATEWAY_INTERNAL_OPUS47_TEST_TIMEOUT_MS";
const DEFAULT_OPUS_TEST_MODEL = "claude-opus-4-7";
const DEFAULT_TIMEOUT_MS = 45_000;

const baseUrl = normalizeBaseUrl(process.env[BASE_URL_ENV]);
const apiKey = process.env[API_KEY_ENV]?.trim();
const opusModel = process.env[LIVE_OPUS_MODEL_ENV]?.trim() || DEFAULT_OPUS_TEST_MODEL;
const timeoutMs = Number(process.env[LIVE_TIMEOUT_ENV] || DEFAULT_TIMEOUT_MS);
const hasLiveGatewayConfig = !!baseUrl && !!apiKey;
const describeLive = hasLiveGatewayConfig ? describe : describe.skip;

describeLive("sf-llm-gateway-internal Opus 4.7 transform regression", () => {
  it(
    "preserves Pi-native xhigh adaptive thinking and strips incompatible temperature",
    async () => {
      const payload: Record<string, unknown> = {
        model: opusModel,
        messages: [{ role: "user", content: "debug probe — do not execute" }],
        max_tokens: 64_000,
        thinking: { type: "adaptive" },
        output_config: { effort: "xhigh" },
        temperature: 0.3,
      };

      applyOpus47MaxThinking(payload, "medium");

      expect(payload.output_config).toEqual({ effort: "xhigh" });
      expect(payload.temperature).toBeUndefined();
      expect(payload.max_tokens).toBeLessThanOrEqual(OPUS_47_MODEL_MAX_TOKENS);

      const transformed = await postTransformRequest(payload);

      expect(transformed.raw_request_body?.thinking).toEqual({ type: "adaptive" });
      expect(transformed.raw_request_body?.output_config).toEqual({ effort: "xhigh" });
      expect(transformed.raw_request_body?.temperature).toBeUndefined();
      expect(transformed.raw_request_body?.max_tokens).toBe(64_000);
    },
    timeoutMs + 5_000,
  );

  it(
    "accepts a lower-effort adaptive payload with the Gateway-specific max token floor",
    async () => {
      const payload: Record<string, unknown> = {
        model: opusModel,
        messages: [{ role: "user", content: "debug probe — do not execute" }],
      };

      applyOpus47MaxThinking(payload, "high");

      expect(payload).toMatchObject({
        max_tokens: 48_000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
      });

      const transformed = await postTransformRequest(payload);

      expect(transformed.raw_request_body?.thinking).toEqual({ type: "adaptive" });
      expect(transformed.raw_request_body?.output_config).toEqual({ effort: "high" });
      expect(transformed.raw_request_body?.max_tokens).toBe(48_000);
    },
    timeoutMs + 5_000,
  );
});

type TransformResponse = {
  raw_request_body?: Record<string, unknown>;
  error?: string | Record<string, unknown>;
};

async function postTransformRequest(payload: Record<string, unknown>): Promise<TransformResponse> {
  if (!baseUrl || !apiKey) {
    throw new Error(`Live Opus 4.7 regression requires ${BASE_URL_ENV} and ${API_KEY_ENV}.`);
  }

  const response = await fetch(`${toGatewayRootBaseUrl(baseUrl)}/utils/transform_request`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      call_type: "completion",
      request_body: payload,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  const parsed = tryParseJson(text) as TransformResponse;

  if (!response.ok || parsed.error) {
    const detail = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error);
    throw new Error(`Gateway transform failed (${response.status}): ${detail || text}`);
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
