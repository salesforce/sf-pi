/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Common sf-guardrail preferences.
 *
 * Routine preferences are intentionally narrow: approval timeout, production
 * aliases, and per-rule behavior. Advanced rule definitions remain in the
 * sf-guardrail override file and are not touched by these helpers.
 */
import { readBundledConfig } from "./config.ts";
import {
  setGuardrailProductionAliases,
  setGuardrailRuleBehaviorPreference,
  setGuardrailTimeoutPreference,
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

export type StaticGuardrailPreferenceKey = "confirmTimeoutMs";

export type GuardrailPreferenceKey =
  | StaticGuardrailPreferenceKey
  | `policies.rules.${string}.enabled`
  | `commandGate.patterns.${string}.enabled`
  | `orgAwareGate.rules.${string}.enabled`;

export type GuardrailSettingsSection = "files" | "commands" | "orgs" | "aliases" | "advanced";

export interface GuardrailPreferenceDescriptor {
  key: GuardrailPreferenceKey;
  section: GuardrailSettingsSection;
  label: string;
  description: string;
  values: string[];
  example?: string;
  why?: string;
}

export const GUARDRAIL_PREFERENCE_DESCRIPTORS: GuardrailPreferenceDescriptor[] = [
  {
    key: "confirmTimeoutMs",
    section: "advanced",
    label: "Approval timeout",
    description: "How long human approval dialogs wait before blocking.",
    values: ["30000", "60000", "120000", "300000"],
    example: "120000 = two minutes.",
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
    case "confirmTimeoutMs":
      return String(config.confirmTimeoutMs);
  }
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
      return "Use Ask me when the action may be intentional; use Block when the rule should not be human-overridable.";
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
      return "Use Ask me when the action may be intentional; use Block when the rule should not be human-overridable.";
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
