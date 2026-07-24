/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for gateway discovery HTTP fetchers. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchGatewayModelGroupInfo,
  fetchGatewayModelIdDiscovery,
  fetchGatewayModelIds,
  fetchGatewayModelInfoMap,
} from "../lib/models.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchGatewayModelIds", () => {
  it("filters LiteLLM non-callable sentinel model IDs", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "no-default-models" },
              { id: "gpt-5" },
              { id: "no-default-models" },
              { id: "claude-opus-4-8" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as typeof fetch;

    await expect(
      fetchGatewayModelIdDiscovery("https://gateway.example.test", "test-key"),
    ).resolves.toEqual({
      ids: ["gpt-5", "claude-opus-4-8"],
      filteredIds: ["no-default-models"],
    });
    await expect(fetchGatewayModelIds("https://gateway.example.test", "test-key")).resolves.toEqual(
      ["gpt-5", "claude-opus-4-8"],
    );
  });

  it("returns zero models when discovery only returns non-callable sentinels", async () => {
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

  it("propagates outer cancellation through the timeout signal for required and optional fetches", async () => {
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
    const optionalGroups = fetchGatewayModelGroupInfo(
      "https://gateway.example.test",
      "test-key",
      controller.signal,
    );
    controller.abort();

    await expect(required).rejects.toThrow("outer abort");
    await expect(optionalInfo).rejects.toThrow("outer abort");
    await expect(optionalGroups).rejects.toThrow("outer abort");
    expect(receivedSignals).toHaveLength(3);
    expect(receivedSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it("distinguishes an unavailable model-group endpoint from a valid empty snapshot", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ) as typeof fetch;

    await expect(
      fetchGatewayModelGroupInfo("https://gateway.example.test", "test-key"),
    ).resolves.toBeUndefined();
    await expect(
      fetchGatewayModelGroupInfo("https://gateway.example.test", "test-key"),
    ).resolves.toBeUndefined();
    await expect(
      fetchGatewayModelGroupInfo("https://gateway.example.test", "test-key"),
    ).resolves.toEqual({});
  });

  it("filters LiteLLM non-callable sentinels from model info enrichment", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { model_name: "no-default-models", model_info: { max_input_tokens: 999 } },
              { model_name: "gpt-5.5", model_info: { max_input_tokens: 1_000_000 } },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as typeof fetch;

    await expect(
      fetchGatewayModelInfoMap("https://gateway.example.test", "test-key"),
    ).resolves.toEqual({
      "gpt-5.5": expect.objectContaining({ id: "gpt-5.5", maxInputTokens: 1_000_000 }),
    });
  });
});
