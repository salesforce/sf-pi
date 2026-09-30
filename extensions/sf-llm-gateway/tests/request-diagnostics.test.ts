/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proofs for protocol-neutral Gateway request diagnostics. */
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext, MessageEndEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  handleGatewayRequestDiagnostics,
  normalizeGatewayRequestError,
  type GatewayRequestReadiness,
} from "../lib/request-diagnostics.ts";

const READY: GatewayRequestReadiness = {
  enabled: true,
  baseUrlConfigured: true,
  credentialConfigured: true,
  modelId: "example-model",
};

function errorMessage(
  provider = "sf-llm-gateway",
  message = "Provider is not configured: sf-llm-gateway",
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider,
    model: "example-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: message,
    timestamp: Date.now(),
  };
}

describe("normalizeGatewayRequestError", () => {
  it.each([
    'Error code: 403 - {"error":{"code":"team_model_access_denied","message":"denied"}}',
    "Messages permission_error: team_model_access_denied",
    "Gateway request failed (403): code=team_model_access_denied",
  ])("normalizes model-access denial without leaking the provider body: %s", (raw) => {
    const normalized = normalizeGatewayRequestError(raw, READY);

    expect(normalized).toBe(
      [
        "SF LLM Gateway denied access to sf-llm-gateway/example-model (team_model_access_denied).",
        "Run /sf-llm-gateway refresh, then choose an available model with /model.",
        "If refresh returns no models, request model access from your Gateway administrator.",
      ].join("\n"),
    );
    expect(normalized).not.toContain('{"error"');
    expect(normalized).not.toContain("Tip: Agent retries");
  });

  it("normalizes unsupported cache-key errors without echoing upstream details", () => {
    const raw =
      "Gateway API error (400): UnsupportedParamsError: prompt_cache_key unsupported on example-route";
    const normalized = normalizeGatewayRequestError(raw, READY);

    expect(normalized).toBe(
      [
        "SF LLM Gateway rejected an unsupported prompt_cache_key parameter.",
        "SF Pi omits this field on Gateway requests; update SF Pi and retry.",
        "If it persists, ask your Gateway administrator to review the selected model's route.",
      ].join("\n"),
    );
    expect(normalized).not.toContain("example-route");
  });

  it("explains that an image failure belongs to the deployed route, not the public model", () => {
    const raw =
      'sf-llm-gateway API error (400): litellm.BadRequestError: BedrockException - {"message":"This model doesn\'t support the image field for user messages. Remove image and try again."}';
    const normalized = normalizeGatewayRequestError(raw, {
      ...READY,
      modelId: "gpt-6-sol",
    });

    expect(normalized).toBe(
      [
        "SF LLM Gateway route sf-llm-gateway/gpt-6-sol rejected image input.",
        "The public model can support images, but this deployed route has not proved compatible vision support.",
        "Use a verified image-capable route or resend without the image, then run /sf-llm-gateway doctor.",
      ].join("\n"),
    );
    expect(normalized).not.toContain("BedrockException");
    expect(normalized).not.toContain("litellm.BadRequestError");
  });

  it.each([
    "terminated",
    "Request timed out.",
    "Connection error.",
    "sf-llm-gateway API error (503): upstream connect error or disconnect/reset before headers",
  ])("normalizes transient stream failure without claiming the model failed: %s", (raw) => {
    expect(normalizeGatewayRequestError(raw, READY)).toBe(
      [
        "SF LLM Gateway stream for sf-llm-gateway/example-model ended before local completion.",
        "This is a retryable transport failure, not proof that the model rejected the request.",
        "Run /sf-llm-gateway doctor; Pi agent retries apply when retry.enabled is true.",
      ].join("\n"),
    );
  });

  it("does not echo an unsafe model identifier into access guidance", () => {
    const normalized = normalizeGatewayRequestError("team_model_access_denied", {
      ...READY,
      modelId: "model\nprivate-detail",
    });

    expect(normalized).toContain("the selected Gateway model");
    expect(normalized).not.toContain("private-detail");
  });

  it("is idempotent for an already normalized model-access error", () => {
    const normalized = normalizeGatewayRequestError(
      "SF LLM Gateway denied access to sf-llm-gateway/example-model (team_model_access_denied).\nRun /sf-llm-gateway refresh, then choose an available model with /model.",
      READY,
    );

    expect(normalized).toBeUndefined();
  });

  it.each([
    {
      readiness: { ...READY, enabled: false },
      expected:
        "SF LLM Gateway is disabled for requests.\nRun /sf-llm-gateway on to enable it, then retry.",
    },
    {
      readiness: { ...READY, baseUrlConfigured: false, credentialConfigured: false },
      expected:
        "SF LLM Gateway has no usable endpoint or credential.\nRun /sf-llm-gateway setup, then /login sf-llm-gateway and /sf-llm-gateway refresh.",
    },
    {
      readiness: { ...READY, baseUrlConfigured: false },
      expected: "SF LLM Gateway has no usable endpoint.\nRun /sf-llm-gateway setup, then retry.",
    },
    {
      readiness: { ...READY, credentialConfigured: false },
      expected:
        "SF LLM Gateway has no usable credential.\nRun /login sf-llm-gateway, then /sf-llm-gateway refresh.",
    },
    {
      readiness: READY,
      expected:
        "SF LLM Gateway authentication could not be resolved for this request.\nRun /sf-llm-gateway doctor. If the key is rejected, run /login sf-llm-gateway, then refresh.",
    },
  ])("turns Pi's generic auth error into targeted recovery guidance", ({ readiness, expected }) => {
    expect(
      normalizeGatewayRequestError("Provider is not configured: sf-llm-gateway", readiness),
    ).toBe(expected);
  });

  it("does not rewrite unrelated request failures", () => {
    expect(normalizeGatewayRequestError("Gateway request failed (403): policy denied", READY)).toBe(
      undefined,
    );
    expect(
      normalizeGatewayRequestError("Provider is not configured: another-provider", READY),
    ).toBe(undefined);
    expect(normalizeGatewayRequestError("UnsupportedParamsError: another_param", READY)).toBe(
      undefined,
    );
  });
});

describe("handleGatewayRequestDiagnostics", () => {
  it("replaces a finalized Gateway assistant error through the message_end seam", async () => {
    const message = errorMessage();
    const event: MessageEndEvent = { type: "message_end", message };
    const ctx = {
      cwd: "/workspace",
    } as ExtensionContext;

    const result = await handleGatewayRequestDiagnostics(event, ctx, {
      getConfig: () => ({ enabled: true, baseUrl: "https://gateway.example.test" }),
      hasConfiguredCredential: vi.fn(async () => false),
    });

    expect(result?.message).toMatchObject({
      role: "assistant",
      provider: "sf-llm-gateway",
      stopReason: "error",
      errorMessage:
        "SF LLM Gateway has no usable credential.\nRun /login sf-llm-gateway, then /sf-llm-gateway refresh.",
    });
    expect(message.errorMessage).toBe("Provider is not configured: sf-llm-gateway");
  });

  it("replaces only Gateway unsupported cache-key failures", async () => {
    const raw = "UnsupportedParamsError: prompt_cache_key unsupported on example-route";
    const ctx = { cwd: "/workspace" } as ExtensionContext;
    const result = await handleGatewayRequestDiagnostics(
      { type: "message_end", message: errorMessage("sf-llm-gateway", raw) },
      ctx,
    );

    expect(result?.message).toMatchObject({
      errorMessage: expect.stringContaining("update SF Pi and retry"),
    });
    expect(JSON.stringify(result?.message)).not.toContain("example-route");
    await expect(
      handleGatewayRequestDiagnostics(
        { type: "message_end", message: errorMessage("another-provider", raw) },
        ctx,
      ),
    ).resolves.toBeUndefined();
  });

  it("leaves successful, non-Gateway, and unrecognized errors unchanged", async () => {
    const deps = {
      getConfig: () => ({ enabled: true, baseUrl: "https://gateway.example.test" }),
      hasConfiguredCredential: vi.fn(async () => true),
    };
    const successful = { ...errorMessage(), stopReason: "stop" as const, errorMessage: undefined };

    await expect(
      handleGatewayRequestDiagnostics(
        { type: "message_end", message: successful },
        { cwd: "/workspace" } as ExtensionContext,
        deps,
      ),
    ).resolves.toBeUndefined();
    await expect(
      handleGatewayRequestDiagnostics(
        { type: "message_end", message: errorMessage("another-provider") },
        { cwd: "/workspace" } as ExtensionContext,
        deps,
      ),
    ).resolves.toBeUndefined();
    await expect(
      handleGatewayRequestDiagnostics(
        {
          type: "message_end",
          message: errorMessage("sf-llm-gateway", "Gateway request failed (403): policy denied"),
        },
        { cwd: "/workspace" } as ExtensionContext,
        deps,
      ),
    ).resolves.toBeUndefined();
    expect(deps.hasConfiguredCredential).not.toHaveBeenCalled();
  });
});
