/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Human-readable status summary for `/sf-guardrail` (default subcommand).
 *
 * Kept as a pure formatter so tests can snapshot it. index.ts passes the
 * current config and the recent audit entries; this module returns the
 * string shown via ctx.ui.notify.
 */
import { enabledNativeFamilies, powerToolModeLabel } from "./power-tool-mode.ts";
import { labelForRuleBehavior, resolveRuleBehavior } from "./rule-behavior.ts";
import type { GuardrailConfigSource } from "./config.ts";
import type { GuardrailPowerToolSettings } from "./power-tool-mode.ts";
import type { DecisionEntryData, GuardrailConfig } from "./types.ts";

export interface StatusInput {
  config: GuardrailConfig;
  configSource: GuardrailConfigSource;
  recent: DecisionEntryData[];
  hasUI: boolean;
  headlessEnabled: boolean;
  operatorAutoApproveEnabled: boolean;
  powerTool?: GuardrailPowerToolSettings;
}

export function renderStatus(input: StatusInput): string {
  const {
    config,
    configSource,
    recent,
    hasUI,
    headlessEnabled,
    operatorAutoApproveEnabled,
    powerTool,
  } = input;
  const lines: string[] = [];
  lines.push(`sf-guardrail: extension-enabled (source: ${configSource})`);

  lines.push(
    `  policies: ${count(config.policies.rules, (r) => resolveRuleBehavior(r) !== "off")} active / ${config.policies.rules.length} defined`,
  );
  lines.push(
    `  command gate: ${count(config.commandGate.patterns, (p) => resolveRuleBehavior(p) !== "off")} active / ${config.commandGate.patterns.length} patterns; ${config.commandGate.allowedPatterns.length} allowed; ${config.commandGate.autoDenyPatterns.length} auto-deny`,
  );
  lines.push(
    `  org-aware gate: ${count(config.orgAwareGate.rules, (r) => resolveRuleBehavior(r) !== "off")} active / ${config.orgAwareGate.rules.length} defined`,
  );

  if (config.productionAliases.length > 0) {
    lines.push(`  productionAliases: ${config.productionAliases.join(", ")}`);
  }

  if (!hasUI) {
    lines.push(`  headless mode: ${headlessEnabled ? "opt-in pass" : "fail-closed"}`);
  }
  lines.push(`  power tool mode: ${powerToolStatus(powerTool)}`);
  if (operatorAutoApproveEnabled) {
    lines.push("  operator auto-approve env: enabled for confirm-class decisions");
  }

  lines.push("");
  if (recent.length === 0) {
    lines.push("  no guardrail decisions this session");
  } else {
    lines.push(`  recent decisions (${recent.length}):`);
    for (const entry of recent.slice(0, 5)) {
      lines.push(`    ${formatEntry(entry)}`);
    }
  }
  return lines.join("\n");
}

function count<T>(xs: T[], pred: (x: T) => boolean): number {
  return xs.filter(pred).length;
}

function powerToolStatus(powerTool: GuardrailPowerToolSettings | undefined): string {
  const mode = powerTool?.mode ?? "off";
  if (mode === "off") return "Off";
  const prod = powerTool?.productionUnknown ? "prod/unknown auto-approve on" : "prod/unknown off";
  if (mode === "all") return `${powerToolModeLabel(mode)} (${prod})`;
  const families = [...enabledNativeFamilies(powerTool)].join(", ");
  return `${powerToolModeLabel(mode)} (${families}; ${prod})`;
}

function formatEntry(e: DecisionEntryData): string {
  const when = new Date(e.timestamp).toISOString().slice(11, 19);
  const shortSubject = e.subject.length > 60 ? e.subject.slice(0, 57) + "…" : e.subject;
  const orgSuffix = e.orgAlias
    ? ` org=${e.orgAlias}(${e.orgType ?? "?"}${e.orgResolutionGuessed ? ",guessed" : ""}${e.orgResolutionSource ? `,${e.orgResolutionSource}` : ""})`
    : "";
  const scopeSuffix = e.approvalScopeLabel ? ` scope=${e.approvalScopeLabel}` : "";
  return `${when}  ${e.outcome}  ${e.ruleId}${orgSuffix}${scopeSuffix}  ${e.toolName}  ${shortSubject}`;
}

export function renderRules(config: GuardrailConfig): string {
  const lines: string[] = [];
  lines.push("Policies:");
  for (const rule of config.policies.rules) {
    const status = `[${labelForRuleBehavior(resolveRuleBehavior(rule))}]`;
    lines.push(`  ${status} ${rule.id} (${rule.protection})  ${rule.description ?? ""}`.trimEnd());
    for (const p of rule.patterns) {
      lines.push(`      ${p.regex ? "regex" : "glob"}: ${p.pattern}`);
    }
  }
  lines.push("");
  lines.push("Command gate:");
  for (const p of config.commandGate.patterns) {
    const status = `[${labelForRuleBehavior(resolveRuleBehavior(p))}]`;
    lines.push(`  ${status} ${p.id}  ${p.pattern}  ${p.description ?? ""}`.trimEnd());
  }
  lines.push("");
  lines.push("Org-aware gate:");
  for (const rule of config.orgAwareGate.rules) {
    const status = `[${labelForRuleBehavior(resolveRuleBehavior(rule))}]`;
    const types = rule.whenOrgType.join(",");
    lines.push(
      `  ${status} ${rule.id} (${rule.action}, orgType=${types})  ${rule.description ?? ""}`.trimEnd(),
    );
  }
  return lines.join("\n");
}

export function renderAudit(recent: DecisionEntryData[]): string {
  if (recent.length === 0) return "No guardrail decisions recorded this session.";
  const lines: string[] = [`Guardrail decisions (${recent.length}):`];
  for (const entry of recent) lines.push(`  ${formatEntry(entry)}`);
  return lines.join("\n");
}
