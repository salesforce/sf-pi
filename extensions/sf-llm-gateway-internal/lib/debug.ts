/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Gateway debug helpers.
 *
 * The gateway's `POST /utils/transform_request` endpoint echoes the exact
 * upstream payload (URL, headers, body) LiteLLM would send for a given
 * request. That is a powerful debugging surface when you need to know
 * whether the gateway accepts a particular parameter, whether Claude is
 * routed through Bedrock or direct Anthropic, whether `reasoning_effort` is
 * being dropped, and so on.
 *
 * This module exposes that as a pure async fetcher plus a small formatter
 * so the `/sf-llm-gateway-internal debug <model>` command can render a
 * readable report in the TUI.
 *
 * Pure functions, no runtime state. All failures are encoded in the returned
 * value so the command handler can stay linear.
 */
import { API_KEY_ENV, getGatewayConfig } from "./config.ts";
import { toGatewayRootBaseUrl } from "./gateway-url.ts";
import { fetchWithTimeout } from "./models.ts";

const TRANSFORM_TIMEOUT_MS = 8_000;

export interface GatewayTransformReport {
  ok: boolean;
  model: string;
  upstreamUrl?: string;
  upstreamHeaders?: Record<string, string>;
  upstreamBody?: Record<string, unknown>;
  error?: string;
}

/**
 * Which request body to probe. Exported so the command handler and tests can
 * pin specific scenarios (plain prompt, with reasoning_effort, with tools,
 * etc.) without reconstructing the shape.
 */
export interface TransformProbe {
  /** Model to probe. Must be a string the gateway knows about. */
  model: string;
  /** Thinking level to request (mapped to reasoning_effort for OpenAI-family). */
  reasoning?: "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Set true to also include a sample function tool. */
  withTool?: boolean;
  /** Claude-only adaptive thinking toggle. */
  adaptive?: boolean;
}

/**
 * Build the request body we ask the gateway to transform. Kept as a pure
 * helper so unit tests can assert the exact probe shape without talking to
 * the network.
 */
export function buildProbeBody(probe: TransformProbe): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: probe.model,
    messages: [{ role: "user", content: "debug probe — no real request" }],
  };

  const isClaude = probe.model.toLowerCase().includes("claude");
  const isCodex = probe.model.toLowerCase().includes("codex");
  const isOpenAi = probe.model.toLowerCase().startsWith("gpt-");

  if (isClaude) {
    body.max_tokens = 4096;
    if (probe.adaptive) {
      body.thinking = { type: "adaptive" };
      body.output_config = { effort: probe.reasoning ?? "high" };
    }
  } else if (isCodex || isOpenAi) {
    // OpenAI-family reasoning models (gpt-5, codex) need this combo to
    // satisfy LiteLLM; gpt-4o ignores reasoning_effort entirely.
    //
    // gpt-5.5 is a hard exception: the gateway rejects reasoning_effort +
    // function tools on /v1/chat/completions for this model, and the
    // extension transport strips the field for every gpt-5.5 request. The
    // probe mirrors that behavior so `/sf-llm-gateway-internal debug
    // gpt-5.5 reasoning=xhigh tool` shows the payload the extension would
    // actually send (without reasoning_effort) instead of a shape the
    // gateway would reject.
    const isGpt55 = /(^|\/)gpt-5\.5(?!\d)/.test(probe.model.toLowerCase());
    if (probe.reasoning && !isGpt55) {
      body.reasoning_effort =
        probe.reasoning === "xhigh" || probe.reasoning === "high"
          ? "high"
          : probe.reasoning === "medium"
            ? "medium"
            : "low";
      body.allowed_openai_params = ["reasoning_effort"];
    }
  }

  if (probe.withTool) {
    // Chat Completions shape. The gateway rejects this for Codex unless the
    // client flattens it — that is exactly the bug our Codex shim fixes, so
    // the debug command should show it in the transformed output.
    body.tools = [
      {
        type: "function",
        function: {
          name: "debug_probe_tool",
          description: "Sample tool for the transform probe",
          parameters: { type: "object", properties: {} },
        },
      },
    ];
  }

  return body;
}

/**
 * Call `POST /utils/transform_request` and shape the response into a
 * predictable report the command handler can render.
 */
export async function fetchTransformReport(
  cwd: string,
  probe: TransformProbe,
): Promise<GatewayTransformReport> {
  const config = getGatewayConfig(cwd);
  if (!config.baseUrl) {
    return { ok: false, model: probe.model, error: "Missing gateway base URL." };
  }
  if (!config.apiKey) {
    return {
      ok: false,
      model: probe.model,
      error: `Missing ${API_KEY_ENV} or saved API key.`,
    };
  }

  const url = `${toGatewayRootBaseUrl(config.baseUrl)}/utils/transform_request`;

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          call_type: "completion",
          request_body: buildProbeBody(probe),
        }),
      },
      TRANSFORM_TIMEOUT_MS,
    );

    if (!response.ok) {
      return {
        ok: false,
        model: probe.model,
        error: `transform_request returned ${response.status}.`,
      };
    }

    const json = (await response.json()) as {
      raw_request_api_base?: string;
      raw_request_headers?: Record<string, string>;
      raw_request_body?: Record<string, unknown>;
      error?: string | Record<string, unknown>;
    };

    if (json.error) {
      const msg = typeof json.error === "string" ? json.error : JSON.stringify(json.error);
      return { ok: false, model: probe.model, error: msg.slice(0, 400) };
    }

    return {
      ok: true,
      model: probe.model,
      upstreamUrl: json.raw_request_api_base,
      upstreamHeaders: json.raw_request_headers,
      upstreamBody: json.raw_request_body,
    };
  } catch (error) {
    return {
      ok: false,
      model: probe.model,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Remove obviously-sensitive headers before rendering to the TUI. */
export function sanitizeUpstreamHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === "authorization" || lower === "x-api-key") continue;
    out[k] = v;
  }
  return out;
}

/** Render a transform report as a multi-line plain-text report. */
export function formatTransformReport(report: GatewayTransformReport): string {
  if (!report.ok) {
    return `Transform probe for ${report.model} failed.\n  Error: ${report.error ?? "unknown"}`;
  }

  const lines = [
    `Transform probe for ${report.model}`,
    `  Upstream: ${report.upstreamUrl ?? "?"}`,
    `  Headers:  ${JSON.stringify(sanitizeUpstreamHeaders(report.upstreamHeaders))}`,
    `  Body keys: ${Object.keys(report.upstreamBody ?? {})
      .sort()
      .join(", ")}`,
    "",
    JSON.stringify(report.upstreamBody ?? {}, null, 2),
  ];
  return lines.join("\n");
}
