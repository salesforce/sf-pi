/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Common sf-guardrail preferences.
 *
 * These are the normal user-facing toggles exposed by `/sf-guardrail settings`.
 * Advanced rule overrides still live in the same override file and are
 * preserved when these common preferences are updated.
 */
import { readJsonFile, writeJsonFile } from "../../../lib/common/sf-pi-settings.ts";
import { readBundledConfig, userConfigPath } from "./config.ts";
import type {
  CommandPattern,
  GuardrailConfig,
  OrgAwareRule,
  PolicyRule,
  RuleBehavior,
} from "./types.ts";
import {
  behaviorEnabled,
  labelForRuleBehavior,
  resolveRuleBehavior,
  ruleBehaviorFromLabel,
} from "./rule-behavior.ts";

export type StaticGuardrailPreferenceKey =
  | "enabled"
  | "features.policies"
  | "features.commandGate"
  | "features.orgAwareGate"
  | "features.promptInjection"
  | "confirmTimeoutMs";

export type GuardrailPreferenceKey =
  | StaticGuardrailPreferenceKey
  | `policies.rules.${string}.enabled`
  | `commandGate.patterns.${string}.enabled`
  | `orgAwareGate.rules.${string}.enabled`;

export type GuardrailPreset = "powerTool" | "strict";

export interface GuardrailPreferenceDescriptor {
  key: GuardrailPreferenceKey;
  label: string;
  description: string;
  values: string[];
}

export const GUARDRAIL_PREFERENCE_DESCRIPTORS: GuardrailPreferenceDescriptor[] = [
  {
    key: "enabled",
    label: "Guardrail enabled",
    description: "Master switch for sf-guardrail mediation.",
    values: ["on", "off"],
  },
  {
    key: "features.policies",
    label: "File policies",
    description: "Protect destructive manifests, CLI state, and secret-like files.",
    values: ["on", "off"],
  },
  {
    key: "features.commandGate",
    label: "Dangerous command gate",
    description: "Confirm locally dangerous shell commands from bash and herdr.run.",
    values: ["on", "off"],
  },
  {
    key: "features.orgAwareGate",
    label: "Org-aware gate",
    description: "Confirm production-sensitive Salesforce CLI operations.",
    values: ["on", "off"],
  },
  {
    key: "features.promptInjection",
    label: "Rule-derived guidance",
    description: "Inject compact agent guidance generated from the effective rule set.",
    values: ["on", "off"],
  },
  {
    key: "confirmTimeoutMs",
    label: "Approval timeout",
    description: "How long human approval dialogs wait before blocking.",
    values: ["30000", "60000", "120000", "300000"],
  },
];

export function buildGuardrailPreferenceDescriptors(
  config: GuardrailConfig,
): GuardrailPreferenceDescriptor[] {
  return [
    ...GUARDRAIL_PREFERENCE_DESCRIPTORS,
    ...config.policies.rules.map((rule) => ({
      key: policyRulePreferenceKey(rule.id),
      label: `Policy · ${rule.description ?? rule.id}`,
      description: `Choose behavior for policy rule ${rule.id}.`,
      values: ["confirm", "hard block", "off"],
    })),
    ...config.commandGate.patterns.map((pattern) => ({
      key: commandPatternPreferenceKey(pattern.id),
      label: `Command · ${pattern.description ?? pattern.id}`,
      description: `Choose behavior for command pattern ${pattern.id}.`,
      values: ["confirm", "hard block", "off"],
    })),
    ...config.orgAwareGate.rules.map((rule) => ({
      key: orgAwareRulePreferenceKey(rule.id),
      label: `Org-aware · ${rule.description ?? rule.id}`,
      description: `Choose behavior for org-aware rule ${rule.id}.`,
      values: ["confirm", "hard block", "off"],
    })),
  ];
}

export function preferenceValue(config: GuardrailConfig, key: GuardrailPreferenceKey): string {
  const policyRuleId = parseRulePreferenceKey(key, "policies.rules.");
  if (policyRuleId) {
    const rule = config.policies.rules.find((candidate) => candidate.id === policyRuleId);
    return labelForRuleBehavior(resolveRuleBehavior(rule ?? { behavior: "off" }));
  }

  const commandPatternId = parseRulePreferenceKey(key, "commandGate.patterns.");
  if (commandPatternId) {
    const pattern = config.commandGate.patterns.find(
      (candidate) => candidate.id === commandPatternId,
    );
    return labelForRuleBehavior(resolveRuleBehavior(pattern ?? { behavior: "off" }));
  }

  const orgRuleId = parseRulePreferenceKey(key, "orgAwareGate.rules.");
  if (orgRuleId) {
    const rule = config.orgAwareGate.rules.find((candidate) => candidate.id === orgRuleId);
    return labelForRuleBehavior(resolveRuleBehavior(rule ?? { behavior: "off" }));
  }

  switch (key) {
    case "enabled":
      return onOff(config.enabled);
    case "features.policies":
      return onOff(config.features.policies);
    case "features.commandGate":
      return onOff(config.features.commandGate);
    case "features.orgAwareGate":
      return onOff(config.features.orgAwareGate);
    case "features.promptInjection":
      return onOff(config.features.promptInjection);
    case "confirmTimeoutMs":
      return String(config.confirmTimeoutMs);
  }
}

export function applyGuardrailPreset(
  preset: GuardrailPreset,
  effectiveConfig: GuardrailConfig,
): void {
  const current = readJsonFile(userConfigPath());
  const next = { ...current };

  for (const rule of effectiveConfig.policies.rules) {
    upsertPolicyRuleBehavior(next, rule, behaviorForPreset(preset, rule.id));
  }
  for (const pattern of effectiveConfig.commandGate.patterns) {
    upsertCommandPatternBehavior(next, pattern, behaviorForPreset(preset, pattern.id));
  }
  for (const rule of effectiveConfig.orgAwareGate.rules) {
    upsertOrgAwareRuleBehavior(next, rule, behaviorForPreset(preset, rule.id));
  }

  writeJsonFile(userConfigPath(), next);
}

export function updateProductionAliasesFromText(value: string): string[] {
  const aliases = parseProductionAliases(value);
  const current = readJsonFile(userConfigPath());
  writeJsonFile(userConfigPath(), { ...current, productionAliases: aliases });
  return aliases;
}

export function productionAliasesText(config: GuardrailConfig): string {
  return config.productionAliases.join(", ");
}

export function updateUserPreference(
  key: GuardrailPreferenceKey,
  value: string,
  effectiveConfig: GuardrailConfig = readBundledConfig(),
): void {
  const current = readJsonFile(userConfigPath());
  const next = { ...current };

  const policyRuleId = parseRulePreferenceKey(key, "policies.rules.");
  if (policyRuleId) {
    const rule = effectiveConfig.policies.rules.find((candidate) => candidate.id === policyRuleId);
    if (!rule) return;
    upsertPolicyRuleBehavior(next, rule, parseRuleBehavior(value));
    writeJsonFile(userConfigPath(), next);
    return;
  }

  const commandPatternId = parseRulePreferenceKey(key, "commandGate.patterns.");
  if (commandPatternId) {
    const pattern = effectiveConfig.commandGate.patterns.find(
      (candidate) => candidate.id === commandPatternId,
    );
    if (!pattern) return;
    upsertCommandPatternBehavior(next, pattern, parseRuleBehavior(value));
    writeJsonFile(userConfigPath(), next);
    return;
  }

  const orgRuleId = parseRulePreferenceKey(key, "orgAwareGate.rules.");
  if (orgRuleId) {
    const rule = effectiveConfig.orgAwareGate.rules.find((candidate) => candidate.id === orgRuleId);
    if (!rule) return;
    upsertOrgAwareRuleBehavior(next, rule, parseRuleBehavior(value));
    writeJsonFile(userConfigPath(), next);
    return;
  }

  switch (key) {
    case "enabled":
      next.enabled = parseOnOff(value);
      break;
    case "features.policies":
    case "features.commandGate":
    case "features.orgAwareGate":
    case "features.promptInjection": {
      const features =
        next.features && typeof next.features === "object"
          ? { ...(next.features as Record<string, unknown>) }
          : {};
      features[key.slice("features.".length)] = parseOnOff(value);
      next.features = features;
      break;
    }
    case "confirmTimeoutMs": {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      next.confirmTimeoutMs = parsed;
      break;
    }
  }

  writeJsonFile(userConfigPath(), next);
}

function upsertPolicyRuleBehavior(
  target: Record<string, unknown>,
  rule: PolicyRule,
  behavior: RuleBehavior,
): void {
  const policies = objectValue(target.policies);
  const rules = arrayValue(policies.rules);
  policies.rules = upsertRuleBehavior(rules, rule, behavior);
  target.policies = policies;
}

function upsertCommandPatternBehavior(
  target: Record<string, unknown>,
  pattern: CommandPattern,
  behavior: RuleBehavior,
): void {
  const commandGate = objectValue(target.commandGate);
  const patterns = arrayValue(commandGate.patterns);
  commandGate.patterns = upsertRuleBehavior(patterns, pattern, behavior);
  target.commandGate = commandGate;
}

function upsertOrgAwareRuleBehavior(
  target: Record<string, unknown>,
  rule: OrgAwareRule,
  behavior: RuleBehavior,
): void {
  const orgAwareGate = objectValue(target.orgAwareGate);
  const rules = arrayValue(orgAwareGate.rules);
  orgAwareGate.rules = upsertRuleBehavior(rules, rule, behavior);
  target.orgAwareGate = orgAwareGate;
}

function upsertRuleBehavior<T extends { id: string }>(
  rules: unknown[],
  rule: T,
  behavior: RuleBehavior,
): unknown[] {
  const enabled = behaviorEnabled(behavior);
  const nextRule = { ...rule, behavior, enabled };
  let found = false;
  const next = rules.map((candidate) => {
    if (!candidate || typeof candidate !== "object") return candidate;
    const raw = candidate as Record<string, unknown>;
    if (raw.id !== rule.id) return candidate;
    found = true;
    return { ...raw, behavior, enabled };
  });
  if (!found) next.push(nextRule);
  return next;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? [...value] : [];
}

function policyRulePreferenceKey(ruleId: string): `policies.rules.${string}.enabled` {
  return `policies.rules.${ruleId}.enabled`;
}

function commandPatternPreferenceKey(patternId: string): `commandGate.patterns.${string}.enabled` {
  return `commandGate.patterns.${patternId}.enabled`;
}

function orgAwareRulePreferenceKey(ruleId: string): `orgAwareGate.rules.${string}.enabled` {
  return `orgAwareGate.rules.${ruleId}.enabled`;
}

function parseRulePreferenceKey(
  key: GuardrailPreferenceKey,
  prefix: "policies.rules." | "commandGate.patterns." | "orgAwareGate.rules.",
): string | undefined {
  if (!key.startsWith(prefix) || !key.endsWith(".enabled")) return undefined;
  return key.slice(prefix.length, -".enabled".length);
}

function behaviorForPreset(preset: GuardrailPreset, id: string): RuleBehavior {
  if (preset === "powerTool") return "confirm";
  return STRICT_BLOCK_IDS.has(id) ? "block" : "confirm";
}

const STRICT_BLOCK_IDS = new Set([
  "secret-files",
  "sf-cli-state",
  "sf-org-auth-show-access-token",
  "sf-org-auth-show-sfdx-auth-url",
  "sf-org-auth-show-user-password",
  "sf-temp-show-secrets",
]);

function parseRuleBehavior(value: string): RuleBehavior {
  return ruleBehaviorFromLabel(value) ?? "confirm";
}

function parseProductionAliases(value: string): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const raw of value.split(/[\n,]/)) {
    const alias = raw.trim();
    if (!alias || seen.has(alias)) continue;
    seen.add(alias);
    aliases.push(alias);
  }
  return aliases;
}

function onOff(value: boolean): string {
  return value ? "on" : "off";
}

function parseOnOff(value: string): boolean {
  return value === "on";
}
