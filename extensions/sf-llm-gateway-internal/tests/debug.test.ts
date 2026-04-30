/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for /utils/transform_request debug helpers.
 *
 * These live side-by-side with `transport.test.ts`: where transport tests
 * pin the *shims*, these pin the *debug probe* that lets users ask the
 * gateway "what would you actually send upstream for this model?".
 */
import { describe, expect, it } from "vitest";
import {
  buildProbeBody,
  formatTransformReport,
  sanitizeUpstreamHeaders,
  type GatewayTransformReport,
  type TransformProbe,
} from "../lib/debug.ts";

describe("buildProbeBody", () => {
  it("produces a minimal Claude probe when adaptive is not set", () => {
    const probe: TransformProbe = { model: "claude-opus-4-6-v1" };
    expect(buildProbeBody(probe)).toEqual({
      model: "claude-opus-4-6-v1",
      messages: [{ role: "user", content: "debug probe — no real request" }],
      max_tokens: 4096,
    });
  });

  it("injects adaptive thinking + effort on Claude when requested", () => {
    const probe: TransformProbe = {
      model: "claude-opus-4-7",
      adaptive: true,
      reasoning: "max" as unknown as TransformProbe["reasoning"],
    };
    const body = buildProbeBody(probe);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "max" });
  });

  it("produces a GPT-5 probe with reasoning_effort + allow-list (the gateway requires both)", () => {
    const probe: TransformProbe = { model: "gpt-5", reasoning: "high" };
    const body = buildProbeBody(probe);
    expect(body.reasoning_effort).toBe("high");
    expect(body.allowed_openai_params).toEqual(["reasoning_effort"]);
  });

  it("clamps xhigh to high for OpenAI-family probes (mirrors the shim)", () => {
    const probe: TransformProbe = { model: "gpt-5", reasoning: "xhigh" };
    expect(buildProbeBody(probe).reasoning_effort).toBe("high");
  });

  it("clamps minimal to low for OpenAI-family probes", () => {
    const probe: TransformProbe = { model: "gpt-5.3-codex", reasoning: "minimal" };
    expect(buildProbeBody(probe).reasoning_effort).toBe("low");
  });

  it("adds a nested-shape tool when asked — exposes the Codex flatten requirement", () => {
    const probe: TransformProbe = { model: "gpt-5.3-codex", withTool: true };
    const body = buildProbeBody(probe);
    expect(Array.isArray(body.tools)).toBe(true);
    // Nested shape on purpose: the point of the probe is to let users see
    // that the gateway rejects this shape for Codex without our shim.
    expect((body.tools as any)[0]).toEqual({
      type: "function",
      function: {
        name: "debug_probe_tool",
        description: "Sample tool for the transform probe",
        parameters: { type: "object", properties: {} },
      },
    });
  });

  it("omits reasoning_effort on gpt-4o probes because 4o does not support reasoning", () => {
    const probe: TransformProbe = { model: "gpt-4o" };
    const body = buildProbeBody(probe);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.allowed_openai_params).toBeUndefined();
  });
});

describe("sanitizeUpstreamHeaders", () => {
  it("drops Authorization and x-api-key", () => {
    const clean = sanitizeUpstreamHeaders({
      Authorization: "Bearer secret",
      "x-api-key": "sk-very-secret",
      "anthropic-version": "2023-06-01",
    });
    expect(clean).toEqual({ "anthropic-version": "2023-06-01" });
  });

  it("is case-insensitive when stripping sensitive headers", () => {
    const clean = sanitizeUpstreamHeaders({
      AUTHORIZATION: "x",
      "X-Api-Key": "y",
      accept: "application/json",
    });
    expect(clean).toEqual({ accept: "application/json" });
  });

  it("returns an empty object for undefined input", () => {
    expect(sanitizeUpstreamHeaders(undefined)).toEqual({});
  });
});

describe("formatTransformReport", () => {
  it("renders success reports with upstream URL, headers, and sorted body keys", () => {
    const report: GatewayTransformReport = {
      ok: true,
      model: "claude-opus-4-7",
      upstreamUrl: "https://api.anthropic.com/v1/messages",
      upstreamHeaders: {
        "anthropic-version": "2023-06-01",
        Authorization: "Bearer secret",
        "x-api-key": "sk-...",
      },
      upstreamBody: {
        model: "claude-opus-4-7",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 128_000,
        thinking: { type: "adaptive" },
        output_config: { effort: "max" },
      },
    };

    const out = formatTransformReport(report);
    expect(out).toContain("Upstream: https://api.anthropic.com/v1/messages");
    expect(out).toContain('"anthropic-version":"2023-06-01"');
    expect(out).not.toContain("secret");
    expect(out).not.toContain("x-api-key");
    // Body keys sorted alphabetically.
    expect(out).toContain("Body keys: max_tokens, messages, model, output_config, thinking");
    // Full body is appended as pretty JSON.
    expect(out).toContain('"thinking": {');
  });

  it("renders error reports compactly", () => {
    const report: GatewayTransformReport = {
      ok: false,
      model: "gpt-5",
      error: "openai does not support parameters: ['reasoning_effort']",
    };
    const out = formatTransformReport(report);
    expect(out).toContain("Transform probe for gpt-5 failed.");
    expect(out).toContain("Error: openai does not support parameters");
  });
});
