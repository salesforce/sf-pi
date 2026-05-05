/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only gateway preflight diagnostics for `/sf-llm-gateway-internal doctor`. */
import {
  describeApiKey,
  describeConfigValue,
  getGatewayConfig,
  type ConfigSource,
} from "./config.ts";
import { toGatewayOpenAiBaseUrl, toGatewayRootBaseUrl } from "./gateway-url.ts";
import { fetchWithTimeout } from "./models.ts";

const DOCTOR_TIMEOUT_MS = 8_000;
const BODY_PREVIEW_LIMIT = 240;

export type GatewayDoctorCheck = {
  name: string;
  url: string;
  status?: number;
  ok: boolean;
  interpretation: string;
  bodyPreview?: string;
};

export type GatewayDoctorReport = {
  enabled: boolean;
  baseUrl?: string;
  baseUrlSource: ConfigSource;
  apiKeyPresent: boolean;
  apiKeyDescription: string;
  openAiBaseUrl?: string;
  anthropicRootUrl?: string;
  checks: GatewayDoctorCheck[];
  recommendations: string[];
};

export function interpretGatewayHttpResult(status: number, bodyPreview: string): string {
  if (status >= 200 && status < 300) {
    if (/server_root_path|proxy_base_url/.test(bodyPreview)) {
      return "OK (LiteLLM proxy signature)";
    }
    return "OK";
  }
  if (status === 401 && /key is blocked/i.test(bodyPreview)) {
    return "Authentication failed because the active gateway key is blocked. Run /login and paste a new gateway API key; saved pi config now takes precedence over stale env or Keychain exports.";
  }
  if (status === 401 || /no api key|authentication|unauthorized/i.test(bodyPreview)) {
    return "Authentication failed. Run /login to paste a gateway API key, or use env vars only for automation when no saved key exists.";
  }
  if (
    status === 302 ||
    status === 307 ||
    /openid-connect|oauth|Found<\/a>|<html/i.test(bodyPreview)
  ) {
    return "Endpoint redirected to an interactive login route. Check that the configured base URL is the API gateway URL, not a browser/SSO URL.";
  }
  if (/Invalid model name passed in model=v1/i.test(bodyPreview)) {
    return "Routing issue: Claude native traffic is reaching an OpenAI deployment path. Use the gateway root for Anthropic routes; sf-pi now strips known deployment suffixes automatically.";
  }
  if (status === 404)
    return "Endpoint not found. Check whether the base URL includes the correct deployment path.";
  if (status === 405)
    return "Endpoint exists but does not allow this method. This usually means the route is reachable.";
  if (status >= 500)
    return "Gateway or upstream service error. Retry later or check gateway health.";
  return `Unexpected HTTP ${status}.`;
}

export async function fetchGatewayDoctorReport(cwd: string): Promise<GatewayDoctorReport> {
  const config = getGatewayConfig(cwd);
  const openAiBaseUrl = config.baseUrl ? toGatewayOpenAiBaseUrl(config.baseUrl) : undefined;
  const anthropicRootUrl = config.baseUrl ? toGatewayRootBaseUrl(config.baseUrl) : undefined;
  const checks: GatewayDoctorCheck[] = [];

  if (anthropicRootUrl) {
    // Un-authenticated signature check. Runs before the authenticated probes
    // so misconfigured base URLs (e.g. SSO portal pasted instead of the API
    // gateway) are called out before the first 401.
    checks.push(
      await runGatewayCheck(
        "Gateway signature",
        `${anthropicRootUrl}/.well-known/litellm-ui-config`,
        undefined,
      ),
    );
  }
  if (openAiBaseUrl) {
    checks.push(await runGatewayCheck("Model discovery", `${openAiBaseUrl}/models`, config.apiKey));
  }
  if (anthropicRootUrl) {
    checks.push(
      await runGatewayCheck(
        "Gateway health",
        `${anthropicRootUrl}/health/readiness`,
        config.apiKey,
      ),
    );
  }

  const recommendations: string[] = [];
  if (!config.baseUrl) {
    recommendations.push(`Run /sf-llm-gateway-internal setup and enter the gateway base URL.`);
  }
  if (!config.apiKey) {
    recommendations.push(
      "Run /login and paste the gateway API key. Env vars are only an automation fallback when no saved key exists.",
    );
  }
  for (const check of checks) {
    if (!check.ok) recommendations.push(`${check.name}: ${check.interpretation}`);
  }
  if (recommendations.length === 0) {
    recommendations.push("Gateway preflight passed.");
  }

  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    baseUrlSource: config.baseUrlSource,
    apiKeyPresent: Boolean(config.apiKey),
    apiKeyDescription: describeApiKey(config.apiKey, config.apiKeySource),
    openAiBaseUrl,
    anthropicRootUrl,
    checks,
    recommendations,
  };
}

/**
 * Minimal liveness probe used by the footer refresher to confirm the
 * gateway is reachable without the 450-byte readiness payload. Returns
 * true when `GET /test` responds `{route: "/test"}` and the endpoint is
 * open to API-token auth.
 *
 * Exported so non-doctor code paths (e.g. monthly-usage refresh) can reuse
 * the same interpretation without duplicating the fetch boilerplate.
 */
export async function pingGateway(
  baseUrlRoot: string,
  apiKey: string | undefined,
  timeoutMs: number = DOCTOR_TIMEOUT_MS,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const response = await fetchWithTimeout(
      `${baseUrlRoot}/test`,
      {
        method: "GET",
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          "Content-Type": "application/json",
        },
        redirect: "manual",
      },
      timeoutMs,
    );
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function runGatewayCheck(
  name: string,
  url: string,
  apiKey: string | undefined,
): Promise<GatewayDoctorCheck> {
  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          "Content-Type": "application/json",
        },
        redirect: "manual",
      },
      DOCTOR_TIMEOUT_MS,
    );
    const bodyPreview = (await response.text()).slice(0, BODY_PREVIEW_LIMIT);
    return {
      name,
      url,
      status: response.status,
      ok: response.ok,
      interpretation: interpretGatewayHttpResult(response.status, bodyPreview),
      bodyPreview: bodyPreview || undefined,
    };
  } catch (error) {
    return {
      name,
      url,
      ok: false,
      interpretation: error instanceof Error ? error.message : String(error),
    };
  }
}

export function formatGatewayDoctorReport(report: GatewayDoctorReport): string {
  const lines = [
    "SF LLM Gateway Doctor",
    "",
    `Provider enabled: ${report.enabled ? "yes" : "no"}`,
    `Configured URL: ${describeConfigValue(report.baseUrl, report.baseUrlSource)}`,
    `OpenAI route: ${report.openAiBaseUrl ?? "missing"}`,
    `Claude/admin root: ${report.anthropicRootUrl ?? "missing"}`,
    `API key: ${report.apiKeyDescription}`,
    "",
    "Checks:",
  ];

  if (report.checks.length === 0) {
    lines.push("- no network checks run (missing base URL)");
  } else {
    for (const check of report.checks) {
      lines.push(
        `- ${check.name}: ${check.ok ? "OK" : "WARN"}${check.status ? ` (${check.status})` : ""}`,
        `  ${check.url}`,
        `  ${check.interpretation}`,
      );
    }
  }

  lines.push("", "Recommendations:");
  for (const item of report.recommendations) lines.push(`- ${item}`);
  return lines.join("\n");
}
