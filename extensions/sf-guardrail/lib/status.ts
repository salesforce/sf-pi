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
import type { Data360ExecutionChainEntryData } from "./approval-ledger.ts";
import type { DecisionEntryData, GuardrailConfig } from "./types.ts";

export interface StatusInput {
  config: GuardrailConfig;
  configSource: GuardrailConfigSource;
  recent: DecisionEntryData[];
  data360ExecutionChains?: Data360ExecutionChainEntryData[];
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
    data360ExecutionChains = [],
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
  appendData360ExecutionChains(lines, data360ExecutionChains, 3, "  ");
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

export function renderAudit(
  recent: DecisionEntryData[],
  data360ExecutionChains: Data360ExecutionChainEntryData[] = [],
): string {
  const lines: string[] = [];
  if (recent.length === 0) {
    lines.push("No guardrail decisions recorded this session.");
  } else {
    lines.push(`Guardrail decisions (${recent.length}):`);
    for (const entry of recent) lines.push(`  ${formatEntry(entry)}`);
  }
  appendData360ExecutionChains(lines, data360ExecutionChains, data360ExecutionChains.length, "");
  return lines.join("\n");
}

function appendData360ExecutionChains(
  lines: string[],
  chains: Data360ExecutionChainEntryData[],
  limit: number,
  indent: string,
): void {
  if (!chains.length) return;
  lines.push("");
  lines.push(`${indent}related Data 360 execution chains (${chains.length}):`);
  for (const entry of chains.slice(0, limit)) {
    lines.push(`${indent}  ${formatData360ExecutionChain(entry)}`);
  }
  if (chains.length > limit) {
    lines.push(`${indent}  +${chains.length - limit} more execution chain(s)`);
  }
}

function formatData360ExecutionChain(entry: Data360ExecutionChainEntryData): string {
  const when = new Date(entry.timestamp).toISOString().slice(11, 19);
  const parent = [entry.parentTool, entry.parentAction].filter(Boolean).join(" ") || "Data 360";
  const target = entry.targetOrg ? ` org=${entry.targetOrg}` : "";
  const status = entry.ok === false ? "failed" : "ok";
  const childActions = entry.executionChain
    .slice(0, 5)
    .map((step) => [stringValue(step.tool), stringValue(step.action)].filter(Boolean).join(" "))
    .filter(Boolean);
  const childText = childActions.length ? childActions.join(" → ") : "no child actions recorded";
  const more =
    entry.executionChain.length > childActions.length
      ? ` (+${entry.executionChain.length - childActions.length} more)`
      : "";
  const fingerprint =
    typeof entry.journey_fingerprint === "string"
      ? ` fingerprint=${entry.journey_fingerprint}`
      : "";
  return `${when}  ${status}  ${parent}${target}${fingerprint}  ${childText}${more}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
