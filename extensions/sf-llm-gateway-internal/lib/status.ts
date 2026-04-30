/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Footer/status text builders for the gateway extension.
 *
 * These functions are pure string formatters. Keeping them separate from the
 * runtime event handlers makes the main index easier to scan and easier to test.
 */
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  BETAS_ENV,
  DEFAULT_MODEL_ID,
  DEFAULT_THINKING_LEVEL,
  FALLBACK_MODEL_ID,
  describeApiKey,
  describeConfigValue,
  getGatewayConfig,
  getSavedExclusiveScopeStatus,
  globalGatewayConfigPath,
  projectGatewayConfigPath,
} from "./config.ts";
import {
  KNOWN_BETAS,
  formatTokens,
  formatUsd,
  getActiveModelDefinition,
  isDefaultAnthropicBeta,
} from "./models.ts";
import type { GatewayDiscoveryState } from "./discovery.ts";
import type { GatewayHealth, GatewayKeyInfo, GatewayMonthlyUsage } from "./monthly-usage.ts";
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
  keyInfo: GatewayKeyInfo | null;
  keyInfoError: string | null;
  health: GatewayHealth | null;
  healthError: string | null;
  runtimeBetaOverrides: Set<string> | null;
  runtimeExtraBetas: Set<string>;
}

export function buildFooterStatus(ctx: ExtensionContext, state: GatewayRuntimeStatusState): string {
  // Footer = monthly budget + (optional) live provider-health badge.
  // Model/context info is already in the devbar top bar, so we stay minimal.
  const parts = [formatMonthlyUsagePart(state.monthlyUsage, state.monthlyUsageError)];
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
    `Gateway health: ${formatHealthReportLine(state.health, state.healthError)}`,
    "",
    `Model discovery: ${discovery?.source ?? "not run"}${discovery?.error ? ` ⚠ ${discovery.error}` : ""}`,
    `Discovered models: ${discovery?.modelIds.length ?? 0}`,
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
 * `SF_LLM_GATEWAY_INTERNAL_TRACE=1`. When inactive we stay silent to keep the
 * report tidy.
 */
function buildWireTraceReport(): string[] {
  if (!isWireTraceEnabled()) return [];
  return [`Wire trace: ON → ${getWireTraceFile()}`, ""];
}

function formatMonthlyUsagePart(
  monthlyUsage: GatewayMonthlyUsage | null,
  monthlyUsageError: string | null,
): string {
  // Resolve glyph mode per call so a runtime settings flip is reflected on
  // the next status refresh without a restart. This value bubbles up into
  // the bottom bar via `ctx.ui.setStatus` so terminals without emoji
  // fallback (notably Terminal.app) show `$ $X/∞` instead of tofu.
  const g = glyph("monthly", resolveGlyphMode());
  if (monthlyUsage) {
    // Show infinity for the budget ceiling — there is no fixed cap.
    return `${g} ${formatUsd(monthlyUsage.spend)}/∞`;
  }

  if (monthlyUsageError) {
    return `${g} unavailable`;
  }

  return `${g} loading…`;
}

function formatMonthlyUsageReportLine(
  monthlyUsage: GatewayMonthlyUsage | null,
  monthlyUsageError: string | null,
): string {
  if (monthlyUsage) {
    const resetPart = monthlyUsage.budgetResetAt ? `, resets ${monthlyUsage.budgetResetAt}` : "";
    return `${formatUsd(monthlyUsage.spend)} spent of ${formatUsd(monthlyUsage.maxBudget)}${resetPart}`;
  }

  return monthlyUsageError ?? "not loaded yet";
}

function formatKeyInfoReportLine(
  keyInfo: GatewayKeyInfo | null,
  keyInfoError: string | null,
): string {
  if (keyInfo) {
    const parts = [`${formatUsd(keyInfo.spend)} lifetime on ${keyInfo.keyName ?? "current key"}`];
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

function isKnownBetaActive(value: string, state: GatewayRuntimeStatusState): boolean {
  if (isDefaultAnthropicBeta(value)) {
    return state.runtimeBetaOverrides === null ? true : state.runtimeBetaOverrides.has(value);
  }
  return state.runtimeExtraBetas.has(value);
}

function getBetaSource(state: GatewayRuntimeStatusState): string {
  if (process.env[BETAS_ENV] !== undefined) {
    return "env override";
  }
  if (state.runtimeBetaOverrides !== null || state.runtimeExtraBetas.size > 0) {
    return "command override";
  }
  return "model defaults";
}
