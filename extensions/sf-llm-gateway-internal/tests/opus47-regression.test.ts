/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Live Opus 4.7 regression checks against a real SF LLM Gateway instance.
 *
 * This suite is intentionally opt-in:
 * - it only runs when SF_LLM_GATEWAY_INTERNAL_BASE_URL and
 *   SF_LLM_GATEWAY_INTERNAL_API_KEY are set
 * - it talks to the real gateway over the network
 *
 * Goal: verify the actual sf-pi transport path for the critical-path Opus 4.7
 * model. Pi owns the generic adaptive-thinking payload via
 * `compat.forceAdaptiveThinking`; sf-pi keeps the gateway-specific
 * max_tokens floor and xhigh→high mapping.
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
import { streamSfGatewayAnthropic } from "../lib/transport.ts";

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

describeLive("sf-llm-gateway-internal Opus 4.7 live regression", () => {
  it(
    "uses Pi-native adaptive thinking with sf-pi's gateway-specific xhigh max-token policy",
    async () => {
      const capturedPayloads: Record<string, unknown>[] = [];
      const events = await collectStream(
        streamSfGatewayAnthropic(makeOpusModel(), makeTinyContext(), {
          apiKey,
          reasoning: "xhigh",
          signal: AbortSignal.timeout(timeoutMs),
          onPayload: (payload) => {
            if (payload && typeof payload === "object" && !Array.isArray(payload)) {
              capturedPayloads.push(payload as Record<string, unknown>);
            }
            return payload;
          },
        }),
      );

      const payload = capturedPayloads[0];
      expect(payload).toBeDefined();
      expect(payload?.thinking).toEqual({ type: "adaptive", display: "summarized" });
      expect(payload?.output_config).toEqual({ effort: "high" });
      expect(payload?.temperature).toBeUndefined();
      expect(payload?.max_tokens).toBe(64_000);
      expect(events.some((event) => event.type === "error")).toBe(false);
      expect(events.some((event) => event.type === "done")).toBe(true);
    },
    timeoutMs + 5_000,
  );
});

function makeOpusModel(): Model<"anthropic-messages"> {
  const cfg = toProviderModelConfig(opusModel, null, new Set());
  return {
    ...cfg,
    api: "anthropic-messages",
    provider: PROVIDER_NAME,
    baseUrl: toGatewayRootBaseUrl(baseUrl!),
  } as Model<"anthropic-messages">;
}

function makeTinyContext(): Context {
  return {
    messages: [
      {
        role: "user",
        content: "Reply with the single word OK.",
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
      throw new Error(event.error.errorMessage ?? "Opus 4.7 live stream failed");
    }
  }
  return events;
}
