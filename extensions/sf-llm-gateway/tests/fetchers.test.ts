/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for gateway discovery HTTP fetchers. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchGatewayModelIdDiscovery,
  fetchGatewayModelIds,
  fetchGatewayModelInfoMap,
} from "../lib/models.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("gateway discovery fetchers", () => {
  it("filters non-callable sentinel IDs", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "no-default-models", mode: "chat", max_input_tokens: 999 },
              {
                id: "example-chat-model",
                mode: "chat",
                max_input_tokens: 128_000,
                max_output_tokens: 8_000,
              },
              {
                id: "example-responses-model",
                mode: "responses",
                max_input_tokens: 256_000,
                max_output_tokens: 16_000,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as typeof fetch;

    await expect(
      fetchGatewayModelIdDiscovery("https://gateway.example.test", "test-key"),
    ).resolves.toEqual({
      ids: ["example-chat-model", "example-responses-model"],
      filteredIds: ["no-default-models"],
      modelInfo: {
        "example-chat-model": {
          id: "example-chat-model",
          mode: "chat",
          maxInputTokens: 128_000,
          maxOutputTokens: 8_000,
        },
        "example-responses-model": {
          id: "example-responses-model",
          mode: "responses",
          maxInputTokens: 256_000,
          maxOutputTokens: 16_000,
        },
      },
    });
    await expect(fetchGatewayModelIds("https://gateway.example.test", "test-key")).resolves.toEqual(
      ["example-chat-model", "example-responses-model"],
    );
  });

  it("returns zero models when discovery only returns sentinels", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ id: "no-default-models" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as typeof fetch;

    await expect(fetchGatewayModelIds("https://gateway.example.test", "test-key")).resolves.toEqual(
      [],
    );
  });

  it.each([
    [401, "authentication failed (401)"],
    [404, "endpoint was not found (404)"],
    [503, "service failed (503)"],
  ] as const)("classifies HTTP %s without exposing response content", async (status, expected) => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "private upstream detail" }), {
          status,
          headers: { "content-type": "application/json" },
        }),
    ) as typeof fetch;

    await expect(fetchGatewayModelIds("https://gateway.example.test", "test-key")).rejects.toThrow(
      expected,
    );
  });

  it("sanitizes network failures with an actionable doctor handoff", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("private host and credential-shaped detail");
    }) as typeof fetch;

    const error = await fetchGatewayModelIds("https://gateway.example.test", "test-key").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("/sf-llm-gateway doctor");
    expect((error as Error).message).not.toContain("private host");
    expect((error as Error).message).not.toContain("credential-shaped");
  });

  it("propagates outer cancellation through required and optional fetches", async () => {
    const receivedSignals: AbortSignal[] = [];
    globalThis.fetch = vi.fn(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return reject(new Error("missing signal"));
          receivedSignals.push(signal);
          signal.addEventListener("abort", () => reject(new Error("outer abort")), { once: true });
        }),
    ) as typeof fetch;
    const controller = new AbortController();

    const required = fetchGatewayModelIdDiscovery(
      "https://gateway.example.test",
      "test-key",
      controller.signal,
    );
    const optionalInfo = fetchGatewayModelInfoMap(
      "https://gateway.example.test",
      "test-key",
      controller.signal,
    );
    controller.abort();

    await expect(required).rejects.toThrow("outer abort");
    await expect(optionalInfo).rejects.toThrow("outer abort");
    expect(receivedSignals).toHaveLength(2);
    expect(receivedSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it("returns only neutral client-facing model metadata", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { model_name: "no-default-models", model_info: { max_input_tokens: 999 } },
              {
                model_name: "example-responses-model",
                model_info: {
                  mode: "responses",
                  max_input_tokens: 256_000,
                  max_output_tokens: 16_000,
                  supports_reasoning: true,
                  supports_vision: false,
                  supports_function_calling: true,
                  supports_prompt_caching: false,
                  litellm_provider: "unpublished-provider",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as typeof fetch;

    const info = await fetchGatewayModelInfoMap("https://gateway.example.test", "test-key");
    expect(info).toEqual({
      "example-responses-model": {
        id: "example-responses-model",
        mode: "responses",
        maxInputTokens: 256_000,
        maxOutputTokens: 16_000,
        supportsReasoning: true,
        supportsVision: false,
        supportsFunctionCalling: true,
        supportsPromptCaching: false,
      },
    });
    expect(JSON.stringify(info)).not.toContain("unpublished-provider");
  });
});
