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
import { resolveRuleBehavior } from "./rule-behavior.ts";

const HEADLESS_ALLOW_ENV = "SF_GUARDRAIL_ALLOW_HEADLESS";

export async function runExtensionDoctor(): Promise<ExtensionDoctorReport> {
  const checks: ExtensionDoctorReport["checks"] = [];

  const { config, source } = loadConfig();

  checks.push({
    id: "guardrail.config-source",
    severity: "ok",
    title: `Configuration source: ${source}`,
    detail:
      source === "bundled"
        ? "Using bundled defaults."
        : "Using Pi settings and/or advanced overrides for effective config.",
  });

  const activePolicyCount = config.policies.rules.filter(
    (rule) => resolveRuleBehavior(rule) !== "off",
  ).length;
  const activeCommandCount = config.commandGate.patterns.filter(
    (pattern) => resolveRuleBehavior(pattern) !== "off",
  ).length;
  const activeOrgAwareCount = config.orgAwareGate.rules.filter(
    (rule) => resolveRuleBehavior(rule) !== "off",
  ).length;
  const activeRuleCount = activePolicyCount + activeCommandCount + activeOrgAwareCount;

  checks.push({
    id: "guardrail.rules",
    severity: activeRuleCount > 0 ? "ok" : "warn",
    title:
      activeRuleCount > 0
        ? `Active rules: ${activeRuleCount}`
        : "All Guardrail rules are set to Off",
    detail: `${activePolicyCount}/${config.policies.rules.length} file policies, ${activeCommandCount}/${config.commandGate.patterns.length} command patterns, ${activeOrgAwareCount}/${config.orgAwareGate.rules.length} org-aware rules active.`,
    fix:
      activeRuleCount === 0
        ? "Set at least one rule to Ask me or Block in /sf-pi → SF Guardrail → Settings."
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
