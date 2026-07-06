/* SPDX-License-Identifier: Apache-2.0 */
/** Shared model helpers for the sf-guardrail Manager settings panel. */
import { readBundledConfig, readUserOverride } from "./config.ts";
import { readGuardrailPiSettings } from "./guardrail-settings.ts";
import type { GuardrailConfig } from "./types.ts";
import type { GuardrailSettingsSection } from "./preferences.ts";

export type RuleDefinitionSource = "bundled" | "overridden" | "custom";
export type RuleBehaviorSource = "settings" | "override" | "definition";
export type RulePanelSection = "files" | "commands" | "orgs";

export interface SettingsSectionItem {
  value:
    | Exclude<GuardrailSettingsSection, "aliases" | "advanced" | "power">
    | "aliases"
    | "advanced"
    | "power";
  label: string;
  description: string;
}

export const SECTION_ITEMS: SettingsSectionItem[] = [
  {
    value: "files",
    label: "File protection rules",
    description: "One row per effective file policy rule id.",
  },
  {
    value: "commands",
    label: "Dangerous command rules",
    description: "One row per effective command pattern rule id.",
  },
  {
    value: "orgs",
    label: "Salesforce org operation rules",
    description: "One row per effective Org-Aware Gate rule id.",
  },
  {
    value: "aliases",
    label: "Protected org aliases",
    description: "Treat aliases as production-level risk targets.",
  },
  {
    value: "power",
    label: "Power Tool Mode",
    description: "Persisted auto-approval scope for advanced users.",
  },
  {
    value: "advanced",
    label: "Advanced Rule Overrides",
    description: "Expert-only JSON rule definition source.",
  },
];

export function resolveRuleDefinitionSource(
  section: RulePanelSection,
  id: string,
): RuleDefinitionSource {
  const bundled = readBundledConfig();
  const override = readUserOverride();
  const inBundled = idsForSection(bundled, section).has(id);
  const inOverride = idsForSection(override, section).has(id);
  if (!inBundled && inOverride) return "custom";
  if (inBundled && inOverride) return "overridden";
  return "bundled";
}

export function resolveRuleBehaviorSource(
  section: RulePanelSection,
  id: string,
): RuleBehaviorSource {
  const settings = readGuardrailPiSettings();
  const settingsSection = settingsSectionFor(section);
  if (settings.ruleBehaviors?.[settingsSection]?.[id]) return "settings";
  if (idsForSection(readUserOverride(), section).has(id)) return "override";
  return "definition";
}

export function settingsSectionFor(
  section: RulePanelSection,
): "policies" | "commandGate" | "orgAwareGate" {
  if (section === "files") return "policies";
  if (section === "commands") return "commandGate";
  return "orgAwareGate";
}

export function ruleIdFromPreferenceKey(key: string): string | undefined {
  const match = key.match(
    /^(?:policies\.rules|commandGate\.patterns|orgAwareGate\.rules)\.(.+)\.enabled$/,
  );
  return match?.[1];
}

export function sourceLabel(
  definitionSource: RuleDefinitionSource,
  behaviorSource: RuleBehaviorSource,
): string {
  if (definitionSource === "custom") return "custom";
  if (definitionSource === "overridden") return "overridden";
  if (behaviorSource === "settings") return "settings";
  return "bundled";
}

export function rulesTitle(section: RulePanelSection): string {
  if (section === "files") return "File protection rules";
  if (section === "commands") return "Dangerous command rules";
  return "Salesforce org operation rules";
}

function idsForSection(
  config: Partial<GuardrailConfig> | undefined,
  section: RulePanelSection,
): Set<string> {
  if (!config) return new Set();
  if (section === "files") return new Set(config.policies?.rules?.map((rule) => rule.id) ?? []);
  if (section === "commands") {
    return new Set(config.commandGate?.patterns?.map((pattern) => pattern.id) ?? []);
  }
  return new Set(config.orgAwareGate?.rules?.map((rule) => rule.id) ?? []);
}
