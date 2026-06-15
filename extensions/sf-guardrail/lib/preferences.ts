/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Common sf-guardrail preferences.
 *
 * These are the normal user-facing toggles exposed through Pi settings.
 * Advanced rule overrides remain in the sf-guardrail override file and are
 * not touched when these common preferences are updated.
 */
import { readBundledConfig } from "./config.ts";
import {
  readGuardrailPiSettings,
  setGuardrailFeaturePreference,
  setGuardrailProductionAliases,
  setGuardrailRuleBehaviorPreference,
  setGuardrailTimeoutPreference,
  updateGuardrailPiSettings,
  writeGuardrailPiSettings,
} from "./guardrail-settings.ts";
import type {
  CommandPattern,
  GuardrailConfig,
  OrgAwareRule,
  PolicyRule,
  RuleBehavior,
} from "./types.ts";
import {
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
export type GuardrailSettingsSection =
  | "posture"
  | "core"
  | "files"
  | "commands"
  | "orgs"
  | "aliases"
  | "advanced";

export interface GuardrailPreferenceDescriptor {
  key: GuardrailPreferenceKey;
  section: GuardrailSettingsSection;
  label: string;
  description: string;
  values: string[];
  example?: string;
  powerToolRecommendation?: string;
  strictRecommendation?: string;
  why?: string;
}

export const GUARDRAIL_PREFERENCE_DESCRIPTORS: GuardrailPreferenceDescriptor[] = [
  {
    key: "enabled",
    section: "core",
    label: "Guardrail enabled",
    description: "Master switch for sf-guardrail mediation.",
    values: ["on", "off"],
    example: "When off, sf-guardrail does not mediate tool calls.",
    powerToolRecommendation: "on",
    strictRecommendation: "on",
    why: "Keep this on so risky actions remain visible and auditable.",
  },
  {
    key: "features.policies",
    section: "core",
    label: "File protection enabled",
    description: "Enable rules for risky file reads and writes.",
    values: ["on", "off"],
    example: "read .env, write .sf/config.json",
    powerToolRecommendation: "on",
    strictRecommendation: "on",
    why: "File risks are common in Salesforce projects and should be visible to the human.",
  },
  {
    key: "features.commandGate",
    section: "core",
    label: "Dangerous commands enabled",
    description: "Enable rules for risky local shell commands from bash and herdr.run.",
    values: ["on", "off"],
    example: "rm -rf tmp/, git push --force",
    powerToolRecommendation: "on",
    strictRecommendation: "on",
    why: "SF Pi is a power tool, so risky commands should be explainable and approved.",
  },
  {
    key: "features.orgAwareGate",
    section: "core",
    label: "Production operations enabled",
    description: "Enable rules that depend on detected Salesforce org type.",
    values: ["on", "off"],
    example: "sf project deploy start -o Prod",
    powerToolRecommendation: "on",
    strictRecommendation: "on",
    why: "Production-sensitive actions need human visibility even when they are intentional.",
  },
  {
    key: "features.promptInjection",
    section: "core",
    label: "Agent guidance enabled",
    description: "Inject compact guidance generated from the effective rule set.",
    values: ["on", "off"],
    example: "The agent sees which risks are guarded and how approvals work.",
    powerToolRecommendation: "on",
    strictRecommendation: "on",
    why: "Rule-derived guidance keeps the agent aligned with your current settings.",
  },
  {
    key: "confirmTimeoutMs",
    section: "core",
    label: "Approval timeout",
    description: "How long human approval dialogs wait before blocking.",
    values: ["30000", "60000", "120000", "300000"],
    example: "120000 = two minutes.",
    powerToolRecommendation: "120000",
    strictRecommendation: "120000",
    why: "Timeouts fail closed so unattended prompts do not silently approve risky work.",
  },
];

export function buildGuardrailPreferenceDescriptors(
  config: GuardrailConfig,
): GuardrailPreferenceDescriptor[] {
  return [
    ...GUARDRAIL_PREFERENCE_DESCRIPTORS,
    ...config.policies.rules.map((rule) =>
      ruleDescriptor({
        key: policyRulePreferenceKey(rule.id),
        section: "files",
        label: policyRuleLabel(rule),
        description: policyRuleDescription(rule),
        example: policyRuleExample(rule),
        powerToolRecommendation: "Ask me",
        strictRecommendation: strictRecommendationFor(rule.id),
        why: policyRuleWhy(rule),
      }),
    ),
    ...config.commandGate.patterns.map((pattern) =>
      ruleDescriptor({
        key: commandPatternPreferenceKey(pattern.id),
        section: "commands",
        label: commandPatternLabel(pattern),
        description: commandPatternDescription(pattern),
        example: commandPatternExample(pattern),
        powerToolRecommendation: "Ask me",
        strictRecommendation: strictRecommendationFor(pattern.id),
        why: commandPatternWhy(pattern),
      }),
    ),
    ...config.orgAwareGate.rules.map((rule) =>
      ruleDescriptor({
        key: orgAwareRulePreferenceKey(rule.id),
        section: "orgs",
        label: orgAwareRuleLabel(rule),
        description: orgAwareRuleDescription(rule),
        example: orgAwareRuleExample(rule),
        powerToolRecommendation: "Ask me",
        strictRecommendation: "Ask me",
        why: orgAwareRuleWhy(rule),
      }),
    ),
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
  const current = readGuardrailPiSettings();
  const ruleBehaviors = {
    ...(current.ruleBehaviors ?? {}),
    policies: { ...(current.ruleBehaviors?.policies ?? {}) },
    commandGate: { ...(current.ruleBehaviors?.commandGate ?? {}) },
    orgAwareGate: { ...(current.ruleBehaviors?.orgAwareGate ?? {}) },
  };

  for (const rule of effectiveConfig.policies.rules) {
    ruleBehaviors.policies[rule.id] = behaviorForPreset(preset, rule.id);
  }
  for (const pattern of effectiveConfig.commandGate.patterns) {
    ruleBehaviors.commandGate[pattern.id] = behaviorForPreset(preset, pattern.id);
  }
  for (const rule of effectiveConfig.orgAwareGate.rules) {
    ruleBehaviors.orgAwareGate[rule.id] = behaviorForPreset(preset, rule.id);
  }

  writeGuardrailPiSettings({ ...current, ruleBehaviors });
}

export function updateProductionAliasesFromText(value: string): string[] {
  const aliases = parseProductionAliases(value);
  setGuardrailProductionAliases(aliases);
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
  const policyRuleId = parseRulePreferenceKey(key, "policies.rules.");
  if (policyRuleId) {
    const rule = effectiveConfig.policies.rules.find((candidate) => candidate.id === policyRuleId);
    if (!rule) return;
    setGuardrailRuleBehaviorPreference("policies", rule.id, parseRuleBehavior(value));
    return;
  }

  const commandPatternId = parseRulePreferenceKey(key, "commandGate.patterns.");
  if (commandPatternId) {
    const pattern = effectiveConfig.commandGate.patterns.find(
      (candidate) => candidate.id === commandPatternId,
    );
    if (!pattern) return;
    setGuardrailRuleBehaviorPreference("commandGate", pattern.id, parseRuleBehavior(value));
    return;
  }

  const orgRuleId = parseRulePreferenceKey(key, "orgAwareGate.rules.");
  if (orgRuleId) {
    const rule = effectiveConfig.orgAwareGate.rules.find((candidate) => candidate.id === orgRuleId);
    if (!rule) return;
    setGuardrailRuleBehaviorPreference("orgAwareGate", rule.id, parseRuleBehavior(value));
    return;
  }

  switch (key) {
    case "enabled":
      // Compatibility only. New UI uses /sf-pi enable/disable for the extension.
      updateGuardrailPiSettings((settings) => ({ ...settings, enabled: parseOnOff(value) }));
      return;
    case "features.policies":
      setGuardrailFeaturePreference("policies", parseOnOff(value));
      return;
    case "features.commandGate":
      setGuardrailFeaturePreference("commandGate", parseOnOff(value));
      return;
    case "features.orgAwareGate":
      setGuardrailFeaturePreference("orgAwareGate", parseOnOff(value));
      return;
    case "features.promptInjection":
      setGuardrailFeaturePreference("promptInjection", parseOnOff(value));
      return;
    case "confirmTimeoutMs": {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      setGuardrailTimeoutPreference(parsed);
      return;
    }
  }
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

function ruleDescriptor(
  input: Omit<GuardrailPreferenceDescriptor, "values">,
): GuardrailPreferenceDescriptor {
  return { ...input, values: ["confirm", "hard block", "off"] };
}

function strictRecommendationFor(id: string): string {
  return STRICT_BLOCK_IDS.has(id) ? "Block" : "Ask me";
}

function policyRuleLabel(rule: PolicyRule): string {
  switch (rule.id) {
    case "secret-files":
      return "Secret files";
    case "sf-cli-state":
      return "Salesforce CLI state";
    case "sf-destructive-changes-xml":
      return "Destructive deploy manifests";
    case "sf-forceignore":
      return ".forceignore";
    default:
      return rule.description ?? rule.id;
  }
}

function policyRuleDescription(rule: PolicyRule): string {
  switch (rule.id) {
    case "secret-files":
      return "Warns before dotenv-style files that may contain secrets are read or changed.";
    case "sf-cli-state":
      return "Warns before Salesforce CLI state files are touched directly.";
    case "sf-destructive-changes-xml":
      return "Warns before direct destructive deploy manifest edits.";
    case "sf-forceignore":
      return "Warns before changes that can silently alter retrieve/deploy behavior.";
    default:
      return `Choose behavior for policy rule ${rule.id}.`;
  }
}

function policyRuleExample(rule: PolicyRule): string {
  switch (rule.id) {
    case "secret-files":
      return "read .env, write .env.production";
    case "sf-cli-state":
      return "write .sf/config.json, edit .sfdx/sfdx-config.json";
    case "sf-destructive-changes-xml":
      return "edit destructiveChanges.xml";
    case "sf-forceignore":
      return "write .forceignore";
    default:
      return rule.patterns.map((pattern) => pattern.pattern).join(", ");
  }
}

function policyRuleWhy(rule: PolicyRule): string {
  switch (rule.id) {
    case "secret-files":
      return "Secret values can enter the transcript or model context; prefer example files or /login flows.";
    case "sf-cli-state":
      return "Direct edits can corrupt local auth/config state; use sf commands when possible.";
    case "sf-destructive-changes-xml":
      return "Destructive deploys are powerful and should be intentional.";
    case "sf-forceignore":
      return "This file changes which metadata is retrieved or deployed.";
    default:
      return "Use Ask me when the action may be intentional; use Block for non-overridable team safety.";
  }
}

function commandPatternLabel(pattern: CommandPattern): string {
  switch (pattern.id) {
    case "rm-rf":
      return "Recursive force delete";
    case "sudo":
      return "Superuser command";
    case "git-force-push":
    case "git-force-push-short":
      return "Git force push";
    case "sf-org-delete":
      return "Delete Salesforce org";
    case "sf-org-auth-show-access-token":
      return "Reveal org access token";
    case "sf-org-auth-show-sfdx-auth-url":
      return "Reveal SFDX auth URL";
    case "sf-org-auth-show-user-password":
      return "Reveal org user password";
    case "sf-temp-show-secrets":
      return "Enable Salesforce CLI secret output";
    default:
      return pattern.description ?? pattern.id;
  }
}

function commandPatternDescription(pattern: CommandPattern): string {
  switch (pattern.id) {
    case "rm-rf":
      return "Warns before recursive force deletion.";
    case "sudo":
      return "Warns before commands run with elevated privileges.";
    case "git-force-push":
    case "git-force-push-short":
      return "Warns before rewriting remote git history.";
    case "sf-org-delete":
      return "Warns before deleting a scratch or sandbox org.";
    case "sf-org-auth-show-access-token":
    case "sf-org-auth-show-sfdx-auth-url":
    case "sf-org-auth-show-user-password":
    case "sf-temp-show-secrets":
      return "Warns before Salesforce credentials or secret output may be exposed.";
    default:
      return `Choose behavior for command pattern ${pattern.id}.`;
  }
}

function commandPatternExample(pattern: CommandPattern): string {
  switch (pattern.id) {
    case "rm-rf":
      return "rm -rf tmp/";
    case "sudo":
      return "sudo npm install -g something";
    case "git-force-push":
      return "git push --force origin main";
    case "git-force-push-short":
      return "git push -f origin main";
    case "sf-org-delete":
      return "sf org delete scratch -o MyScratch";
    case "sf-org-auth-show-access-token":
      return "sf org auth show-access-token -o DevHub";
    case "sf-org-auth-show-sfdx-auth-url":
      return "sf org auth show-sfdx-auth-url -o DevHub";
    case "sf-org-auth-show-user-password":
      return "sf org auth show-user-password -o DevHub";
    case "sf-temp-show-secrets":
      return "SF_TEMP_SHOW_SECRETS=true sf org display -o DevHub";
    default:
      return pattern.pattern;
  }
}

function commandPatternWhy(pattern: CommandPattern): string {
  switch (pattern.id) {
    case "sf-org-auth-show-access-token":
    case "sf-org-auth-show-sfdx-auth-url":
    case "sf-org-auth-show-user-password":
    case "sf-temp-show-secrets":
      return "Credentials can enter the transcript or model context; only approve when intentional.";
    case "rm-rf":
      return "Deleting recursively is often irreversible outside generated temp folders.";
    case "git-force-push":
    case "git-force-push-short":
      return "Force push can rewrite shared history for other developers.";
    case "sf-org-delete":
      return "Org deletion can remove a working environment; verify the alias first.";
    default:
      return "Use Ask me for power-tool workflows; use Block for non-overridable team safety.";
  }
}

function orgAwareRuleLabel(rule: OrgAwareRule): string {
  switch (rule.id) {
    case "sf-deploy-prod":
      return "Production deploy";
    case "sf-apex-run-prod":
      return "Production anonymous Apex";
    case "sf-data-mutate-prod":
      return "Production data mutation";
    case "sf-org-api-destructive-prod":
      return "Production destructive REST";
    default:
      return rule.description ?? rule.id;
  }
}

function orgAwareRuleDescription(rule: OrgAwareRule): string {
  switch (rule.id) {
    case "sf-deploy-prod":
      return "Warns before metadata deploys to a detected production org.";
    case "sf-apex-run-prod":
      return "Warns before anonymous Apex runs against production.";
    case "sf-data-mutate-prod":
      return "Warns before sf data delete/update/upsert/import targets production.";
    case "sf-org-api-destructive-prod":
      return "Warns before DELETE/PATCH/PUT REST calls target production.";
    default:
      return `Choose behavior for org-aware rule ${rule.id}.`;
  }
}

function orgAwareRuleExample(rule: OrgAwareRule): string {
  switch (rule.id) {
    case "sf-deploy-prod":
      return "sf project deploy start -o Prod";
    case "sf-apex-run-prod":
      return "sf apex run -o Prod -f scripts/apex/check.apex";
    case "sf-data-mutate-prod":
      return "sf data update record -s Account -o Prod";
    case "sf-org-api-destructive-prod":
      return "sf org api /services/data/v67.0/sobjects/Account/001... --method DELETE -o Prod";
    default:
      return rule.id;
  }
}

function orgAwareRuleWhy(rule: OrgAwareRule): string {
  switch (rule.id) {
    case "sf-deploy-prod":
      return "Deploys are powerful but often intentional; approve the Safety Envelope after rehearsal when possible.";
    case "sf-apex-run-prod":
      return "Anonymous Apex can mutate data; use Savepoint and rollback when rehearsing.";
    case "sf-data-mutate-prod":
      return "Production data mutations should be deliberate and scoped.";
    case "sf-org-api-destructive-prod":
      return "Destructive REST methods can change or delete production records/configuration.";
    default:
      return "Unknown or production-sensitive org operations fail closed and should be reviewed.";
  }
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
