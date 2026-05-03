/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Human-readable status summary for `/sf-guardrail` (default subcommand).
 *
 * Kept as a pure formatter so tests can snapshot it. index.ts passes the
 * current config and the recent audit entries; this module returns the
 * string shown via ctx.ui.notify.
 */
import type { DecisionEntryData, GuardrailConfig } from "./types.ts";

export interface StatusInput {
  config: GuardrailConfig;
  configSource: "bundled" | "override";
  recent: DecisionEntryData[];
  hasUI: boolean;
  headlessEnabled: boolean;
}

export function renderStatus(input: StatusInput): string {
  const { config, configSource, recent, hasUI, headlessEnabled } = input;
  const lines: string[] = [];
  lines.push(`sf-guardrail: ${config.enabled ? "on" : "off"} (source: ${configSource})`);

  const features: string[] = [];
  if (config.features.policies) features.push("policies");
  if (config.features.commandGate) features.push("commandGate");
  if (config.features.orgAwareGate) features.push("orgAwareGate");
  if (config.features.promptInjection) features.push("promptInjection");
  lines.push(`  features: ${features.join(", ") || "none"}`);

  lines.push(
    `  policies: ${count(config.policies.rules, (r) => r.enabled !== false)} active / ${config.policies.rules.length} defined`,
  );
  lines.push(
    `  command gate: ${config.commandGate.patterns.length} patterns; ${config.commandGate.allowedPatterns.length} allowed; ${config.commandGate.autoDenyPatterns.length} auto-deny`,
  );
  lines.push(
    `  org-aware gate: ${count(config.orgAwareGate.rules, (r) => r.enabled !== false)} active / ${config.orgAwareGate.rules.length} defined`,
  );

  if (config.productionAliases.length > 0) {
    lines.push(`  productionAliases: ${config.productionAliases.join(", ")}`);
  }

  if (!hasUI) {
    lines.push(`  headless mode: ${headlessEnabled ? "opt-in pass" : "fail-closed"}`);
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

function formatEntry(e: DecisionEntryData): string {
  const when = new Date(e.timestamp).toISOString().slice(11, 19);
  const shortSubject = e.subject.length > 60 ? e.subject.slice(0, 57) + "…" : e.subject;
  const orgSuffix = e.orgAlias ? ` org=${e.orgAlias}(${e.orgType ?? "?"})` : "";
  return `${when}  ${e.outcome}  ${e.ruleId}${orgSuffix}  ${e.toolName}  ${shortSubject}`;
}

export function renderRules(config: GuardrailConfig): string {
  const lines: string[] = [];
  lines.push("Policies:");
  for (const rule of config.policies.rules) {
    const status = rule.enabled === false ? "[off]" : "[on]";
    lines.push(`  ${status} ${rule.id} (${rule.protection})  ${rule.description ?? ""}`.trimEnd());
    for (const p of rule.patterns) {
      lines.push(`      ${p.regex ? "regex" : "glob"}: ${p.pattern}`);
    }
  }
  lines.push("");
  lines.push("Command gate:");
  for (const p of config.commandGate.patterns) {
    lines.push(`  [on]  ${p.id}  ${p.pattern}  ${p.description ?? ""}`.trimEnd());
  }
  lines.push("");
  lines.push("Org-aware gate:");
  for (const rule of config.orgAwareGate.rules) {
    const status = rule.enabled === false ? "[off]" : "[on]";
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
