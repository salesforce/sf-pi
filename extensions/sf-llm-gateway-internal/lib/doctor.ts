/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only gateway preflight diagnostics for `/sf-llm-gateway doctor`. */
import type { ExtensionDoctorReport } from "../../../lib/common/doctor/registry.ts";
import {
  API_KEY_ENV,
  CA_BUNDLE_SOURCE_ENV,
  describeApiKey,
  describeConfigValue,
  FRIENDLY_COMMAND_NAME,
  getGatewayConfig,
  getMergedSavedGatewayConfig,
  type ConfigSource,
} from "./config.ts";
import { toGatewayOpenAiBaseUrl, toGatewayRootBaseUrl } from "./gateway-url.ts";
import { fetchWithTimeout } from "./models.ts";
import { type GatewayCaProbeFailureClass, writeCaProbeState } from "./ca-probe-state.ts";
import {
  collectUsableCaBundlePaths,
  discoverGatewayOnboardingSources,
  findShellOnlyNodeExtraCaCerts,
  formatDiscoveredCaBundleSummary,
} from "./onboarding-sources.ts";

const DOCTOR_TIMEOUT_MS = 8_000;
const BODY_PREVIEW_LIMIT = 240;

export type GatewayDoctorCheck = {
  name: string;
  url: string;
  status?: number;
  ok: boolean;
  interpretation: string;
  bodyPreview?: string;
  /**
   * Machine-readable failure class for this check. null when the check
   * passed. Aggregated across checks into the report-wide `failureClass`
   * field that the splash gate keys on.
   */
  failureClass: GatewayCaProbeFailureClass;
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
  /**
   * Aggregate failure class for the splash nudge gate. Computed from the
   * individual check classes (TLS wins over auth wins over redirect wins
   * over other). null when every check passed.
   */
  failureClass: GatewayCaProbeFailureClass;
};

/**
 * Substrings produced by Node / undici / OpenSSL when TLS chain validation
 * fails. The corporate CA bundle fix (`/sf-llm-gateway fix-ca-bundle`)
 * targets exactly this class — every other failure mode (auth, redirect,
 * 5xx) needs a different remedy.
 *
 * Exported so tests can drive the same matcher used at runtime, and so the
 * fixer module can re-classify results from its own re-probe.
 */
export const TLS_ERROR_FRAGMENTS = [
  "unable to verify the first certificate",
  "self-signed certificate in certificate chain",
  "unable_to_get_issuer_cert_locally",
  "cert_has_expired",
  "depth zero self-signed cert",
  "unable_to_get_issuer_cert",
  "err_tls_cert_altname_invalid",
  // Node / undici surface the generic message when the underlying TLS
  // error reaches them. We treat "fetch failed" as TLS-class only when
  // there's no HTTP status (i.e. the request never produced one).
  "fetch failed",
] as const;

/**
 * Classify a thrown error message into the failure class enum. Returns
 * "tls" when the message matches a TLS chain-validation fragment, "other"
 * for anything else (DNS, abort, timeout). Auth / redirect classification
 * happens at the HTTP-status layer in `interpretGatewayHttpResult`.
 */
export function classifyThrownError(message: string): GatewayCaProbeFailureClass {
  const lower = message.toLowerCase();
  if (TLS_ERROR_FRAGMENTS.some((fragment) => lower.includes(fragment))) {
    return "tls";
  }
  return "other";
}

/**
 * Classify a non-2xx HTTP response into the failure class enum. Mirrors
 * the prose `interpretGatewayHttpResult` returns so tests can assert on a
 * stable, machine-readable signal without string-matching prose.
 */
export function classifyHttpResult(
  status: number,
  bodyPreview: string,
): GatewayCaProbeFailureClass {
  if (status >= 200 && status < 300) return null;
  if (status === 401) return "auth";
  if (
    status === 302 ||
    status === 307 ||
    /openid-connect|oauth|Found<\/a>|<html/i.test(bodyPreview)
  ) {
    return "redirect";
  }
  return "other";
}

/**
 * Aggregate per-check classes into the report-wide class. The splash gate
 * keys on this single value, so the priority order matters: TLS wins
 * (drives the corporate-CA fix), then auth, then redirect. "other" is the
 * lowest priority so a transient 5xx never hides a real TLS failure that
 * also showed up in the same probe.
 */
export function aggregateFailureClass(
  classes: ReadonlyArray<GatewayCaProbeFailureClass>,
): GatewayCaProbeFailureClass {
  if (classes.includes("tls")) return "tls";
  if (classes.includes("auth")) return "auth";
  if (classes.includes("redirect")) return "redirect";
  if (classes.includes("other")) return "other";
  return null;
}

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

  const failureClass = aggregateFailureClass(checks.map((check) => check.failureClass));
  const discovery = discoverGatewayOnboardingSources({
    cwd,
    caBundleCandidates: config.caBundleCandidates,
  });

  const recommendations: string[] = [];
  if (!config.baseUrl) {
    recommendations.push(`Run /sf-llm-gateway setup and enter the gateway base URL.`);
  }
  if (!config.apiKey) {
    recommendations.push(
      "Run /login and paste the gateway API key. Env vars are only an automation fallback when no saved key exists.",
    );
  }
  for (const check of checks) {
    if (!check.ok) recommendations.push(`${check.name}: ${check.interpretation}`);
  }
  recommendations.push(...buildDoctorKeySourceRecommendations(cwd));
  recommendations.push(...buildTlsHintRecommendations(failureClass, discovery));
  if (config.helpUrl) {
    recommendations.push(`More info: ${config.helpUrl}`);
  }
  if (recommendations.length === 0) {
    recommendations.push("Gateway preflight passed.");
  }

  // Persist the snapshot the splash will read on next boot. Captures
  // platform + NODE_EXTRA_CA_CERTS state at probe time so the splash gate
  // doesn't have to re-derive them.
  writeCaProbeState({
    at: new Date().toISOString(),
    lastFailureClass: failureClass,
    hasNodeExtraCaCerts: Boolean(process.env.NODE_EXTRA_CA_CERTS),
    platform: process.platform,
  });

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
    failureClass,
  };
}

/**
 * Build the macOS-specific TLS recommendation when the failure class is
 * "tls" AND we're on macOS AND NODE_EXTRA_CA_CERTS isn't already set.
 * Other platforms inherit OpenSSL's keychain integration so the hint
 * would be a red herring there. Static prose; no live work.
 */
function buildTlsHintRecommendations(
  failureClass: GatewayCaProbeFailureClass,
  discovery: ReturnType<typeof discoverGatewayOnboardingSources>,
): string[] {
  if (failureClass !== "tls") return [];
  if (process.platform !== "darwin") return [];
  if (process.env.NODE_EXTRA_CA_CERTS) return [];

  const validCandidatePaths = collectUsableCaBundlePaths(discovery);
  const shellOnly = findShellOnlyNodeExtraCaCerts(discovery);
  const discoveredCaLines = formatDiscoveredCaBundleSummary(discovery);
  const recommendations = [
    `TLS verification failed and NODE_EXTRA_CA_CERTS is not set. macOS Node does not trust the system keychain. If your org issues a private CA bundle, point NODE_EXTRA_CA_CERTS at it (one-shot fix: /${FRIENDLY_COMMAND_NAME} fix-ca-bundle).`,
    `Heads up: NODE_EXTRA_CA_CERTS must be set in two places to cover every launch path \u2014 a LaunchAgent for Dock/Spotlight launches and an export in ~/.zshenv for Terminal launches. The fix-ca-bundle action handles both. Override the bundle source via ${CA_BUNDLE_SOURCE_ENV} if you maintain your own.`,
  ];

  if (shellOnly.length > 0) {
    recommendations.push(
      `NODE_EXTRA_CA_CERTS is present in ${shellOnly
        .map((finding) => finding.location)
        .join(
          ", ",
        )}, but pi may not see it for every launch path. Run /${FRIENDLY_COMMAND_NAME} fix-ca-bundle to mirror the valid bundle into ~/.zshenv and the LaunchAgent.`,
    );
  }
  if (validCandidatePaths.length > 0) {
    recommendations.push(
      `A valid CA bundle candidate was found at ${validCandidatePaths[0]}. /${FRIENDLY_COMMAND_NAME} fix-ca-bundle will adopt it instead of asking for a download URL.`,
    );
    recommendations.push(...discoveredCaLines);
  }

  return recommendations;
}

function buildDoctorKeySourceRecommendations(cwd: string): string[] {
  const config = getGatewayConfig(cwd);
  const savedKey = getMergedSavedGatewayConfig(cwd).apiKey?.trim();
  const envKey = process.env[API_KEY_ENV]?.trim();

  if (savedKey && envKey && savedKey !== envKey) {
    return [
      `${API_KEY_ENV} is set but ignored because a saved key wins. If the env key is newer, run /login or /sf-llm-gateway setup to save it; otherwise remove the stale env var from your shell or Keychain setup.`,
    ];
  }

  if (config.apiKeySource === "env") {
    return [
      `Using ${API_KEY_ENV} as an automation fallback. For interactive use, run /login or /sf-llm-gateway setup so pi keeps using the intended key across shells.`,
    ];
  }

  return [];
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
      failureClass: response.ok ? null : classifyHttpResult(response.status, bodyPreview),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureClass = classifyThrownError(message);
    return {
      name,
      url,
      ok: false,
      interpretation: enrichThrownInterpretation(message, failureClass),
      failureClass,
    };
  }
}

/**
 * Wrap a raw thrown-error message with a TLS-aware hint when applicable.
 * Keeps the underlying message visible so debugging still works, but
 * makes the recommendation actionable in the common macOS-no-bundle case.
 */
function enrichThrownInterpretation(
  message: string,
  failureClass: GatewayCaProbeFailureClass,
): string {
  if (failureClass === "tls" && process.platform === "darwin" && !process.env.NODE_EXTRA_CA_CERTS) {
    return `${message} \u2014 looks like a TLS chain-validation failure. macOS Node ignores the system keychain; run /${FRIENDLY_COMMAND_NAME} fix-ca-bundle to wire NODE_EXTRA_CA_CERTS into both LaunchAgent (Dock/Spotlight launches) and ~/.zshenv (Terminal launches).`;
  }
  return message;
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

/**
 * Adapter for the shared `/sf-pi doctor` aggregator. Returns the same
 * underlying probe as the standalone `/sf-llm-gateway doctor`
 * view, shaped into per-check rows so the manager can render them next
 * to other extensions' diagnostics.
 */
export async function runExtensionDoctor(cwd: string): Promise<ExtensionDoctorReport> {
  const report = await fetchGatewayDoctorReport(cwd);
  const checks: ExtensionDoctorReport["checks"] = [];

  if (!report.enabled) {
    checks.push({
      id: "gateway.disabled",
      severity: "info",
      title: "Gateway is disabled",
      detail: "Saved config has enabled=false; run /sf-llm-gateway setup to turn it on.",
    });
  }

  checks.push({
    id: "gateway.base-url",
    severity: report.baseUrl ? "ok" : "warn",
    title: report.baseUrl ? `Base URL configured (${report.baseUrl})` : "Base URL not configured",
    detail: `source: ${report.baseUrlSource}`,
    fix: report.baseUrl ? undefined : "Run /sf-llm-gateway setup and enter the gateway base URL.",
  });

  checks.push({
    id: "gateway.api-key",
    severity: report.apiKeyPresent ? "ok" : "warn",
    title: report.apiKeyPresent ? "API key present" : "API key not present",
    detail: report.apiKeyDescription,
    fix: report.apiKeyPresent ? undefined : "Run /login and paste the gateway API key.",
  });

  for (const check of report.checks) {
    checks.push({
      id: `gateway.${check.name.toLowerCase().replace(/\s+/g, "-")}`,
      severity: check.ok ? "ok" : "warn",
      title: `${check.name} ${check.status ? `(${check.status})` : ""}`.trim(),
      detail: `${check.url} — ${check.interpretation}`,
    });
  }

  const summary = checks.some((c) => c.severity === "warn" || c.severity === "error")
    ? "! issues detected"
    : "✓ ready";

  return {
    extensionId: "sf-llm-gateway-internal",
    title: "SF LLM Gateway Internal",
    checks,
    summary,
  };
}
