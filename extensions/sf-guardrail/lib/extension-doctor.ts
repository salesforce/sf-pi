/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Adapter that contributes a small Guardrail health summary to the
 * aggregated `/sf-pi doctor` view.
 *
 * Reports static config state only — no network or session-branch reads.
 * Recent decision counts live in `/sf-guardrail audit` (which has access
 * to the ExtensionContext); this provider deliberately stays cwd-only
 * so it can run inside `/sf-pi doctor`.
 */
import type { ExtensionDoctorReport } from "../../../lib/common/doctor/registry.ts";
import { loadConfig } from "./config.ts";

const HEADLESS_ALLOW_ENV = "SF_GUARDRAIL_ALLOW_HEADLESS";

export async function runExtensionDoctor(_cwd: string): Promise<ExtensionDoctorReport> {
  const checks: ExtensionDoctorReport["checks"] = [];

  const { config, source } = loadConfig();

  checks.push({
    id: "guardrail.config-source",
    severity: "ok",
    title: `Configuration source: ${source}`,
    detail:
      source === "override"
        ? "Using user override at <globalAgentDir>/sf-pi/sf-guardrail/overrides.json"
        : "Using bundled defaults (run /sf-guardrail install-preset to fork them).",
  });

  const featureNames: string[] = [];
  if (config.features.policies) featureNames.push("policies");
  if (config.features.commandGate) featureNames.push("commandGate");
  if (config.features.orgAwareGate) featureNames.push("orgAwareGate");
  if (config.features.promptInjection) featureNames.push("promptInjection");

  checks.push({
    id: "guardrail.features",
    severity: featureNames.length > 0 ? "ok" : "warn",
    title:
      featureNames.length > 0
        ? `Active feature tiers: ${featureNames.join(", ")}`
        : "All Guardrail features disabled",
    detail: `${config.policies.rules.length} policies, ${config.commandGate.patterns.length} command-gate patterns, ${config.orgAwareGate.rules.length} org-aware rules loaded.`,
    fix:
      featureNames.length === 0
        ? "Re-enable features in /sf-guardrail config or run /sf-guardrail install-preset to restore defaults."
        : undefined,
  });

  const headlessAllow = process.env[HEADLESS_ALLOW_ENV] === "1";
  checks.push({
    id: "guardrail.headless-allow",
    severity: headlessAllow ? "warn" : "ok",
    title: headlessAllow
      ? `${HEADLESS_ALLOW_ENV}=1 — headless gating allows risky actions`
      : "Headless gating is fail-closed",
    detail: headlessAllow
      ? "Risky tool calls will not require confirmation in headless mode."
      : "Default behavior — every confirm-class call fails closed without an interactive UI.",
    fix: headlessAllow
      ? `Unset ${HEADLESS_ALLOW_ENV} for production runs unless you explicitly want bypass.`
      : undefined,
  });

  const summary = checks.every((c) => c.severity === "ok") ? "✓ ready" : "! review settings";
  return {
    extensionId: "sf-guardrail",
    title: "SF Guardrail",
    checks,
    summary,
  };
}
