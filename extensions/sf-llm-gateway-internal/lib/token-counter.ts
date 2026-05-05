/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Gateway-backed token counting and cost estimation.
 *
 * Two endpoints power this:
 *   - `POST /utils/token_counter` → `{ total_tokens, model_used, tokenizer_type }`
 *   - `POST /spend/calculate`     → `{ cost: <usd> }`
 *
 * Neither invokes a real completion, so probes are free. Both accept the
 * same `{ model, messages | prompt }` shape and route internally based on
 * which field is present. This module exposes them as small pure async
 * helpers that the `/sf-llm-gateway-internal tokens` command composes into
 * a single report.
 *
 * Pure functions, no runtime state. All failures are encoded in the
 * returned value so the command handler can stay linear and render
 * consistent output whether the gateway is healthy, slow, or 401.
 */
import { API_KEY_ENV, getGatewayConfig } from "./config.ts";
import { toGatewayRootBaseUrl } from "./gateway-url.ts";
import { fetchWithTimeout } from "./models.ts";

const TOKEN_COUNT_TIMEOUT_MS = 8_000;

export interface TokenCountResult {
  ok: boolean;
  model: string;
  totalTokens?: number;
  modelUsed?: string;
  tokenizerType?: string;
  error?: string;
}

export interface SpendEstimateResult {
  ok: boolean;
  model: string;
  /** Estimated cost in USD, e.g. `0.00001`. */
  costUsd?: number;
  error?: string;
}

export interface TokenProbeInput {
  model: string;
  /** Raw prompt. Preferred for quick CLI probes. */
  prompt?: string;
  /** Full messages array. Preferred for "what would this session cost" probes. */
  messages?: Array<{ role: string; content: string }>;
}

/**
 * Count tokens for a prompt or messages array on a given gateway model.
 *
 * Sends `{model, prompt}` when only `prompt` is provided, otherwise sends
 * `{model, messages}`. The gateway picks the right tokenizer for the model
 * (see `tokenizerType` in the result) so callers do not need to ship a
 * local tokenizer that drifts from upstream.
 */
export async function countTokens(cwd: string, input: TokenProbeInput): Promise<TokenCountResult> {
  const config = getGatewayConfig(cwd);
  if (!config.baseUrl) {
    return { ok: false, model: input.model, error: "Missing gateway base URL." };
  }
  if (!config.apiKey) {
    return { ok: false, model: input.model, error: `Missing ${API_KEY_ENV} or saved API key.` };
  }

  const body: Record<string, unknown> = { model: input.model };
  if (input.messages && input.messages.length > 0) {
    body.messages = input.messages;
  } else if (typeof input.prompt === "string") {
    body.prompt = input.prompt;
  } else {
    return { ok: false, model: input.model, error: "Provide either prompt or messages." };
  }

  const url = `${toGatewayRootBaseUrl(config.baseUrl)}/utils/token_counter`;
  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      TOKEN_COUNT_TIMEOUT_MS,
    );

    if (!response.ok) {
      return {
        ok: false,
        model: input.model,
        error: `token_counter returned ${response.status}.`,
      };
    }

    const json = (await response.json()) as {
      total_tokens?: number;
      model_used?: string;
      tokenizer_type?: string;
    };
    if (typeof json.total_tokens !== "number") {
      return {
        ok: false,
        model: input.model,
        error: "token_counter response missing total_tokens.",
      };
    }
    return {
      ok: true,
      model: input.model,
      totalTokens: json.total_tokens,
      modelUsed: json.model_used,
      tokenizerType: json.tokenizer_type,
    };
  } catch (error) {
    return {
      ok: false,
      model: input.model,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Estimate the dollar cost of sending a prompt or messages array through a
 * gateway model. Wraps `/spend/calculate`, which performs token counting +
 * per-model price lookup server-side and returns a USD figure. Returns
 * zero for no-cost models (e.g. unpriced entries in `/v1/model/info`).
 *
 * The endpoint requires `{model, messages}`; we always send `messages` and
 * wrap a bare prompt into a synthetic user message for convenience.
 */
export async function estimateSpend(
  cwd: string,
  input: TokenProbeInput,
): Promise<SpendEstimateResult> {
  const config = getGatewayConfig(cwd);
  if (!config.baseUrl) {
    return { ok: false, model: input.model, error: "Missing gateway base URL." };
  }
  if (!config.apiKey) {
    return { ok: false, model: input.model, error: `Missing ${API_KEY_ENV} or saved API key.` };
  }

  const messages =
    input.messages && input.messages.length > 0
      ? input.messages
      : typeof input.prompt === "string"
        ? [{ role: "user", content: input.prompt }]
        : undefined;
  if (!messages) {
    return { ok: false, model: input.model, error: "Provide either prompt or messages." };
  }

  const url = `${toGatewayRootBaseUrl(config.baseUrl)}/spend/calculate`;
  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: input.model, messages }),
      },
      TOKEN_COUNT_TIMEOUT_MS,
    );

    if (!response.ok) {
      return {
        ok: false,
        model: input.model,
        error: `spend/calculate returned ${response.status}.`,
      };
    }

    const json = (await response.json()) as { cost?: number };
    if (typeof json.cost !== "number") {
      return { ok: false, model: input.model, error: "spend/calculate response missing cost." };
    }
    return { ok: true, model: input.model, costUsd: json.cost };
  } catch (error) {
    return {
      ok: false,
      model: input.model,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Render a combined token-count + spend-estimate report for the
 * `/sf-llm-gateway-internal tokens` command. Kept as a pure formatter so
 * the command handler can stay thin and tests can assert exact text.
 */
export function formatTokenReport(tokens: TokenCountResult, spend: SpendEstimateResult): string {
  const lines: string[] = [];
  if (tokens.ok) {
    const tokenizer = tokens.tokenizerType ? ` using ${tokens.tokenizerType}` : "";
    const routed =
      tokens.modelUsed && tokens.modelUsed !== tokens.model
        ? ` (routed to ${tokens.modelUsed})`
        : "";
    lines.push(`Tokens: ${tokens.totalTokens}${tokenizer} on ${tokens.model}${routed}`);
  } else {
    lines.push(`Tokens: ${tokens.error ?? "unknown error"}`);
  }
  if (spend.ok) {
    const rounded = formatCostUsd(spend.costUsd ?? 0);
    lines.push(`Estimated cost: ${rounded} for a no-op turn`);
  } else {
    lines.push(`Estimated cost: ${spend.error ?? "unknown error"}`);
  }
  return lines.join("\n");
}

/**
 * Format a USD cost to a readable string. Amounts below 1 cent are shown
 * in scientific notation so users can tell "$1e-05" apart from "$0.00".
 */
export function formatCostUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value < 0.01) return `$${value.toExponential(2)}`;
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
