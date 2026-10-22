/* SPDX-License-Identifier: Apache-2.0 */
/** Compact rule-derived model context; exact matching and enforcement stay in the Safety Kernel. */
import { readBundledConfig } from "./config.ts";
import { labelForRuleBehavior, resolveRuleBehavior } from "./rule-behavior.ts";
import type { GuardrailConfig } from "./types.ts";

type RuleEntry = {
  category: "Files" | "Commands" | "Org-aware";
  id: string;
  behavior: ReturnType<typeof resolveRuleBehavior>;
  serialized: string;
};

export function renderGuardrailGuidance(config: GuardrailConfig = readBundledConfig()): string {
  const bundled = readBundledConfig();
  const entries = flatten(config);
  const bundledByKey = new Map(
    flatten(bundled).map((entry) => [`${entry.category}:${entry.id}`, entry]),
  );
  const hardBlocks = entries.filter((entry) => entry.behavior === "block");
  const overrides = entries.filter((entry) => {
    const baseline = bundledByKey.get(`${entry.category}:${entry.id}`);
    return !baseline || baseline.serialized !== entry.serialized;
  });

  const lines = [
    "<sf_guardrail>",
    "SF Guardrail is the active Safety Mediator for protected files, risky commands, and durable operations.",
    "Operate normally and wait when it requests human approval. Never bypass, weaken, or work around its decision.",
    "For Salesforce mutations, establish the intended destination and pass an explicit target_org or --target-org. A configured default is not user intent; ask when the destination is unresolved.",
    ...hardBlockLines(hardBlocks),
    ...overrideLines(overrides),
    ...runtimeOverrideLines(config, bundled),
    "Exact patterns, ordinary confirmation rules, approvals, and audit details remain in /sf-guardrail.",
    "</sf_guardrail>",
  ];
  return `${lines.join("\n")}\n`;
}

function hardBlockLines(entries: RuleEntry[]): string[] {
  if (entries.length === 0) return ["Active hard blocks: none."];
  return [
    "Active hard blocks:",
    ...group(entries).map(([category, ids]) => `- ${category}: ${ids.join(", ")}`),
  ];
}

function overrideLines(entries: RuleEntry[]): string[] {
  if (entries.length === 0) return ["Non-default rule overrides: none."];
  return [
    "Non-default rule overrides:",
    ...entries.map((entry) => `- ${entry.id}=${labelForRuleBehavior(entry.behavior)}`),
  ];
}

function runtimeOverrideLines(config: GuardrailConfig, bundled: GuardrailConfig): string[] {
  const overrides: string[] = [];
  if (config.headlessEscapeHatchEnv !== bundled.headlessEscapeHatchEnv) {
    overrides.push(`headless confirmation env=${config.headlessEscapeHatchEnv}=1`);
  }
  if (config.confirmTimeoutMs !== bundled.confirmTimeoutMs) {
    overrides.push(`confirmation timeout=${config.confirmTimeoutMs}ms`);
  }
  return overrides.length > 0 ? [`Non-default runtime settings: ${overrides.join(", ")}.`] : [];
}

function flatten(config: GuardrailConfig): RuleEntry[] {
  return [
    ...config.policies.rules.map((rule) => entry("Files", rule)),
    ...config.commandGate.patterns.map((rule) => entry("Commands", rule)),
    ...config.orgAwareGate.rules.map((rule) => entry("Org-aware", rule)),
  ];
}

function entry(
  category: RuleEntry["category"],
  rule: { id: string } & Parameters<typeof resolveRuleBehavior>[0],
): RuleEntry {
  return {
    category,
    id: rule.id,
    behavior: resolveRuleBehavior(rule),
    serialized: JSON.stringify(rule),
  };
}

function group(entries: RuleEntry[]): Array<[RuleEntry["category"], string[]]> {
  const grouped = new Map<RuleEntry["category"], string[]>();
  for (const item of entries) {
    const ids = grouped.get(item.category) ?? [];
    ids.push(item.id);
    grouped.set(item.category, ids);
  }
  return [...grouped.entries()];
}
