/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Footer/status text builders for the gateway extension.
 *
 * These functions are pure string formatters. Keeping them separate from the
 * runtime event handlers makes the main index easier to scan and easier to test.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  API_KEY_ENV,
  BETAS_ENV,
  DEFAULT_MODEL_ID,
  DEFAULT_THINKING_LEVEL,
  FALLBACK_MODEL_ID,
  LEGACY_API_KEY_ENV,
  LEGACY_BETAS_ENV,
  describeApiKey,
  describeConfigValue,
  getGatewayConfig,
  getMergedSavedGatewayConfig,
  getSavedExclusiveScopeStatus,
  globalGatewayConfigPath,
  projectGatewayConfigPath,
  readGatewayEnv,
} from "./config.ts";
import {
  KNOWN_BETAS,
  formatTokens,
  formatUsd,
  getActiveModelDefinition,
  isDefaultAnthropicBeta,
} from "./models.ts";
import { getLastModelGroupDrift, type GatewayDiscoveryState } from "./discovery.ts";
import type { ModelGroupDrift } from "./models.ts";
import type {
  GatewayConnectionStatus,
  GatewayDailyActivity,
  GatewayHealth,
  GatewayKeyInfo,
  GatewayKeyList,
  GatewayMonthlyUsage,
} from "./monthly-usage.ts";
import { formatProviderSignalBadge, getActiveProviderSignal } from "./provider-telemetry.ts";
import { getWireTraceFile, isWireTraceEnabled } from "./wire-trace.ts";
import { glyph, resolveGlyphMode } from "../../../lib/common/glyph-policy.ts";

// Re-exported so callers outside the gateway extension (and tests) can import
// the badge formatter from the status surface without reaching into the
// telemetry module directly.
export { formatProviderSignalBadge } from "./provider-telemetry.ts";

export interface GatewayRuntimeStatusState {
  discovery: GatewayDiscoveryState | null;
  monthlyUsage: GatewayMonthlyUsage | null;
  monthlyUsageError: string | null;
  lastKnownMonthlyUsage?: GatewayMonthlyUsage | null;
  keyInfo: GatewayKeyInfo | null;
  keyInfoError: string | null;
  health: GatewayHealth | null;
  healthError: string | null;
  connectionStatus?: GatewayConnectionStatus | null;
  dailyActivity?: GatewayDailyActivity | null;
  dailyActivityError?: string | null;
  keyList?: GatewayKeyList | null;
  keyListError?: string | null;
  runtimeBetaOverrides: Set<string> | null;
  runtimeExtraBetas: Set<string>;
}

export function buildFooterStatus(state: GatewayRuntimeStatusState): string {
  // Footer = monthly budget + (optional) live provider-health badge.
  // Model/context info is already in the devbar top bar, so we stay minimal.
  const parts = [
    formatMonthlyUsagePart(
      state.monthlyUsage,
      state.monthlyUsageError,
      state.lastKnownMonthlyUsage,
    ),
  ];
  const signalBadge = formatProviderSignalBadge(getActiveProviderSignal());
  if (signalBadge) {
    parts.push(signalBadge);
  }
  return parts.join("  ");
}

export function buildStatusReport(
  ctx: ExtensionContext,
  providerRegistered: boolean,
  state: GatewayRuntimeStatusState,
): string {
  const config = getGatewayConfig(ctx.cwd);
  const savedScope = getSavedExclusiveScopeStatus(ctx.cwd);
  const activeModel = getActiveModelDefinition(ctx.model?.id, state.discovery?.modelIds);
  const contextUsage = ctx.getContextUsage();
  const discovery = state.discovery;
  const customBetas = [...state.runtimeExtraBetas]
    .filter((value) => !KNOWN_BETAS.some((beta) => beta.value === value))
    .sort();

  return [
    "SF LLM Gateway Internal",
    "",
    `Provider enabled: ${config.enabled ? "yes" : "no"}`,
    `Provider registered: ${providerRegistered ? "yes" : "no"}`,
    `Base URL: ${describeConfigValue(config.baseUrl, config.baseUrlSource)}`,
    `API key: ${describeApiKey(config.apiKey, config.apiKeySource)}`,
    `Saved config files: ${globalGatewayConfigPath()}, ${projectGatewayConfigPath(ctx.cwd)}`,
    `Saved scope fallback: project=${savedScope.project}, global=${savedScope.global}, effective=${savedScope.effective} (${savedScope.effectiveSource})`,
    `Effective scoped model mode: ${config.exclusiveScope ? "exclusive (gateway-only scoped models)" : "additive (preserve existing scoped models)"}`,
    `Active model: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none"}`,
    `Active SF model: ${activeModel ? activeModel.name : "no"}`,
    `Thinking default: ${DEFAULT_THINKING_LEVEL}`,
    `Context usage: ${contextUsage ? `${formatTokens(contextUsage.tokens)} / ${formatTokens(contextUsage.contextWindow)}` : "unknown"}`,
    `Monthly usage: ${formatMonthlyUsageReportLine(state.monthlyUsage, state.monthlyUsageError)}`,
    `Key spend: ${formatKeyInfoReportLine(state.keyInfo, state.keyInfoError)}`,
    `Gateway connection: ${formatConnectionReportLine(state.connectionStatus)}`,
    `Gateway health: ${formatHealthReportLine(state.health, state.healthError)}`,
    `Last 7d: ${formatDailyActivityReportLine(state.dailyActivity, state.dailyActivityError)}`,
    `Keys on account: ${formatKeyListReportLine(state.keyList, state.keyListError, state.keyInfo?.keyName)}`,
    ...formatApiKeyGuidanceReportLines(ctx.cwd, state),
    "",
    `Model discovery: ${discovery?.source ?? "not run"}${discovery?.error ? ` ⚠ ${discovery.error}` : ""}`,
    `Discovered models: ${discovery?.modelIds.length ?? 0}`,
    ...formatModelGroupDriftLines(getLastModelGroupDrift()),
    "",
    "Anthropic beta headers:",
    ...KNOWN_BETAS.map((beta) => {
      const active = isKnownBetaActive(beta.value, state);
      return `- ${beta.aliases[0]}: ${active ? "on" : "off"} (${beta.value})`;
    }),
    ...(customBetas.length > 0
      ? ["", "Custom injected betas:", ...customBetas.map((value) => `- ${value}`)]
      : []),
    `Beta source: ${getBetaSource(state)}`,
    "",
    ...buildProviderTelemetryReport(),
    ...buildWireTraceReport(),
    `Default model: ${DEFAULT_MODEL_ID}`,
    `Fallback model: ${FALLBACK_MODEL_ID}`,
  ].join("\n");
}

/**
 * Build the provider-telemetry lines for the status report.
 *
 * Shows a short summary of the most recent warning signal (if still live)
 * plus when it was recorded. When no warning is active we emit a single
 * "healthy" line so operators know the telemetry hook is wired up.
 */
function buildProviderTelemetryReport(): string[] {
  const signal = getActiveProviderSignal();
  if (!signal) {
    return ["Provider health: healthy (no warnings in last 60s)", ""];
  }
  const ageSec = Math.max(0, Math.round((Date.now() - signal.at) / 1000));
  const details: string[] = [`status=${signal.status}`];
  if (typeof signal.retryAfterSec === "number") {
    details.push(`retry=${signal.retryAfterSec}s`);
  }
  if (typeof signal.remainingRequests === "number") {
    details.push(`req-remaining=${signal.remainingRequests}`);
  }
  if (typeof signal.remainingTokens === "number") {
    details.push(`tok-remaining=${signal.remainingTokens}`);
  }
  if (signal.resetAt) {
    details.push(`resets=${signal.resetAt}`);
  }
  return [`Provider health: ⚠ ${signal.kind} (${ageSec}s ago)`, `  ${details.join(", ")}`, ""];
}

/**
 * Surface whether the opt-in wire trace is active. The trace captures raw
 * request/response bytes under Pi's global agent directory when
 * `SF_LLM_GATEWAY_TRACE=1`. When inactive we stay silent to keep the
 * report tidy.
 */
function buildWireTraceReport(): string[] {
  if (!isWireTraceEnabled()) return [];
  return [`Wire trace: ON → ${getWireTraceFile()}`, ""];
}

function formatMonthlyUsagePart(
  monthlyUsage: GatewayMonthlyUsage | null,
  monthlyUsageError: string | null,
  lastKnownMonthlyUsage: GatewayMonthlyUsage | null | undefined,
): string {
  // Resolve glyph mode per call so a runtime settings flip is reflected on
  // the next status refresh without a restart. This value bubbles up into
  // the bottom bar via `ctx.ui.setStatus` so terminals without emoji
  // fallback (notably Terminal.app) show a clean `$X/∞` pill instead of
  // tofu or a duplicated dollar sign.
  const mode = resolveGlyphMode();
  const g = glyph("monthly", mode);
  const prefix = mode === "ascii" ? "" : `${g} `;
  if (monthlyUsage) {
    // Show infinity for the budget ceiling — there is no fixed cap.
    return `${prefix}${formatUsd(monthlyUsage.spend)}/∞`;
  }

  if (monthlyUsageError) {
    if (lastKnownMonthlyUsage) {
      return `${prefix}${formatUsd(lastKnownMonthlyUsage.spend)}/∞ ${glyph("warn", mode)} stale`;
    }
    return `${prefix}unavailable`;
  }

  return `${prefix}loading…`;
}

function formatMonthlyUsageReportLine(
  monthlyUsage: GatewayMonthlyUsage | null,
  monthlyUsageError: string | null,
): string {
  if (monthlyUsage) {
    const resetPart = monthlyUsage.budgetResetAt ? `, resets ${monthlyUsage.budgetResetAt}` : "";
    const budget = Number.isFinite(monthlyUsage.maxBudget)
      ? formatUsd(monthlyUsage.maxBudget)
      : "∞";
    return `${formatUsd(monthlyUsage.spend)} spent of ${budget}${resetPart}`;
  }

  return monthlyUsageError ?? "not loaded yet";
}

function formatConnectionReportLine(
  connectionStatus: GatewayConnectionStatus | null | undefined,
): string {
  if (!connectionStatus) return "not checked yet";
  const parts: string[] = [connectionStatus.kind];
  if (connectionStatus.source) parts.push(`via ${connectionStatus.source}`);
  if (connectionStatus.detail) parts.push(connectionStatus.detail);
  return parts.join(", ");
}

function formatKeyInfoReportLine(
  keyInfo: GatewayKeyInfo | null,
  keyInfoError: string | null,
): string {
  if (keyInfo) {
    const parts = [`${formatUsd(keyInfo.spend)} spent on ${keyInfo.keyName ?? "current key"}`];
    if (typeof keyInfo.rpmLimit === "number") {
      parts.push(`rpm=${keyInfo.rpmLimit}`);
    }
    if (typeof keyInfo.tpmLimit === "number") {
      parts.push(`tpm=${keyInfo.tpmLimit}`);
    }
    return parts.join(", ");
  }
  return keyInfoError ?? "not loaded yet";
}

function formatHealthReportLine(health: GatewayHealth | null, healthError: string | null): string {
  if (health) {
    const parts = [health.status];
    if (health.litellmVersion) parts.push(`LiteLLM ${health.litellmVersion}`);
    if (health.lastUpdated) parts.push(`updated ${health.lastUpdated}`);
    return parts.join(", ");
  }
  return healthError ?? "not loaded yet";
}

/**
 * One-line rollup of daily activity for the status report. Combines total
 * spend, request totals, failure count, and a per-day sparkline so users
 * can see a bad day next to healthy baseline at a glance.
 *
 * Exported for unit tests and the usage-probe renderer.
 */
export function formatDailyActivityReportLine(
  dailyActivity: GatewayDailyActivity | null | undefined,
  dailyActivityError: string | null | undefined,
): string {
  if (!dailyActivity) return dailyActivityError ?? "not loaded yet";
  const entries = dailyActivity.entries;
  if (entries.length === 0) return "no activity in window";

  let totalSpend = 0;
  let totalRequests = 0;
  let totalFailed = 0;
  for (const e of entries) {
    totalSpend += e.spend;
    totalRequests += e.apiRequests;
    totalFailed += e.failedRequests;
  }

  const warn = totalFailed > 0 ? " \u26A0" : "";
  return (
    `${formatUsd(totalSpend)} across ${totalRequests} requests (${totalFailed} failed${warn}) ` +
    `| spend: ${formatSparkline(entries.map((e) => e.spend))}`
  );
}

/**
 * Render the `/key/list` count line for the status report. Mentions the
 * currently-active key's masked name when `keyInfo.keyName` is available
 * so users can cross-check against what the gateway admin UI shows.
 *
 * Exported for unit tests.
 */
export function formatKeyListReportLine(
  keyList: GatewayKeyList | null | undefined,
  keyListError: string | null | undefined,
  activeKeyName?: string,
): string {
  if (!keyList) return keyListError ?? "not loaded yet";
  const activeHint = activeKeyName ? `, active: ${activeKeyName}` : "";
  if (keyList.count <= 1) return `${keyList.count}${activeHint}`;
  return `${keyList.count} (multiple keys exist; confirm the active key before pruning old keys in the gateway UI${activeHint})`;
}

/**
 * Build key-rotation/source guidance for status surfaces. The extension can
 * reliably detect source conflicts (saved key vs env var), auth rejection, and
 * multiple keys on the account; it cannot infer key creation dates, so the
 * guidance tells users where to update or prune instead of guessing age.
 */
export function getApiKeyGuidanceLines(cwd: string, state: GatewayRuntimeStatusState): string[] {
  const config = getGatewayConfig(cwd);
  const savedKey = getMergedSavedGatewayConfig(cwd).apiKey?.trim();
  const envKey = readGatewayEnv(API_KEY_ENV, LEGACY_API_KEY_ENV)?.trim();
  const lines: string[] = [];

  if (state.connectionStatus?.kind === "auth-failed") {
    lines.push(
      "Active gateway key was rejected. Run /login to paste a new key, then rerun /sf-llm-gateway doctor.",
    );
  }

  if (savedKey && envKey && savedKey !== envKey) {
    lines.push(
      `${API_KEY_ENV} is also set but ignored because a saved key wins. If the env key is newer, run /login or /sf-llm-gateway setup to save it; otherwise remove the stale env var from your shell or Keychain setup.`,
    );
  } else if (config.apiKeySource === "env") {
    lines.push(
      `Using ${API_KEY_ENV} as an automation fallback. For interactive use, run /login or /sf-llm-gateway setup so pi keeps using the intended key across shells.`,
    );
  }

  if (state.keyList && state.keyList.count > 1) {
    const active = state.keyInfo?.keyName ? ` Active key: ${state.keyInfo.keyName}.` : "";
    lines.push(
      `Gateway reports ${state.keyList.count} keys on this account.${active} After confirming pi works with the current key, prune older unused keys in the gateway UI.`,
    );
  }

  return lines;
}

export function summarizeApiKeyGuidance(
  cwd: string,
  state: GatewayRuntimeStatusState,
): string | undefined {
  return getApiKeyGuidanceLines(cwd, state)[0];
}

function formatApiKeyGuidanceReportLines(cwd: string, state: GatewayRuntimeStatusState): string[] {
  const guidance = getApiKeyGuidanceLines(cwd, state);
  if (guidance.length === 0) return [];
  return ["", "API key guidance:", ...guidance.map((line) => `- ${line}`)];
}

/**
 * Render provider-drift warnings from the last discovery diff. Returns an
 * empty array when the model-group providers array is unchanged so callers
 * can spread into the report without any conditional glue.
 *
 * Exported for unit tests.
 */
export function formatModelGroupDriftLines(drift: ModelGroupDrift[]): string[] {
  if (drift.length === 0) return [];
  const out: string[] = ["Model-group provider drift:"];
  for (const d of drift) {
    const prev = d.previousProviders.length ? d.previousProviders.join(", ") : "(none)";
    const curr = d.currentProviders.length ? d.currentProviders.join(", ") : "(none)";
    out.push(`  ⚠ ${d.modelGroup}: [${prev}] → [${curr}]`);
  }
  return out;
}

/**
 * Render a Unicode block sparkline for a numeric series. Empty arrays and
 * all-zero arrays are represented with a single empty block so the status
 * line stays aligned across days. Tested via snapshot in status.test.ts.
 */
export function formatSparkline(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values);
  if (max <= 0) return values.map(() => "\u2581").join("");
  const bars = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];
  return values
    .map((v) => {
      if (v <= 0) return bars[0];
      const idx = Math.min(bars.length - 1, Math.floor((v / max) * (bars.length - 1)));
      return bars[idx];
    })
    .join("");
}

function isKnownBetaActive(value: string, state: GatewayRuntimeStatusState): boolean {
  if (isDefaultAnthropicBeta(value)) {
    return state.runtimeBetaOverrides === null ? true : state.runtimeBetaOverrides.has(value);
  }
  return state.runtimeExtraBetas.has(value);
}

function getBetaSource(state: GatewayRuntimeStatusState): string {
  if (readGatewayEnv(BETAS_ENV, LEGACY_BETAS_ENV) !== undefined) {
    return "env override";
  }
  if (state.runtimeBetaOverrides !== null || state.runtimeExtraBetas.size > 0) {
    return "command override";
  }
  return "model defaults";
}
