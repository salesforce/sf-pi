/* SPDX-License-Identifier: Apache-2.0 */
/** Static, public-safe scan recipe catalog for SF Code Analyzer. */

export interface CodeAnalyzerRecipe {
  id: string;
  label: string;
  when: string;
  ruleSelector: string[];
  workspace: string[];
  target?: string[];
  outputFiles?: string[];
  herdrRecommended?: boolean;
  herdrReason?: string;
}

export const CODE_ANALYZER_RECIPES: CodeAnalyzerRecipe[] = [
  {
    id: "auto-apex-default",
    label: "Automatic Apex default",
    when: "Post-agent auto-scan for changed Apex, trigger, or .apex files.",
    ruleSelector: ["pmd:Recommended"],
    workspace: ["."],
  },
  {
    id: "auto-js-default",
    label: "Automatic JavaScript/TypeScript default",
    when: "Post-agent auto-scan for changed JavaScript or TypeScript files.",
    ruleSelector: ["eslint:Recommended"],
    workspace: ["."],
  },
  {
    id: "auto-flow-default",
    label: "Automatic Flow metadata default",
    when: "Post-agent auto-scan for changed Flow metadata files.",
    ruleSelector: ["flow:Recommended"],
    workspace: ["."],
  },
  {
    id: "full-recommended",
    label: "Full project recommended scan",
    when: "Before a larger checkpoint when you want recommended rules across eligible engines.",
    ruleSelector: ["Recommended"],
    workspace: ["."],
    herdrRecommended: true,
    herdrReason: "Whole-project recommended scans can be long-running and produce broad output.",
  },
  {
    id: "security",
    label: "Security-focused scan",
    when: "Auth, permissions, CRUD/FLS, sharing, dynamic SOQL, callouts, endpoints, secrets, crypto, or guest/Experience changes.",
    ruleSelector: ["Recommended:Security"],
    workspace: ["."],
    herdrRecommended: true,
    herdrReason:
      "Security scans often touch multiple engines and are best run in a visible validation lane.",
  },
  {
    id: "appexchange",
    label: "AppExchange security review scan",
    when: "Managed package, AppExchange, ISV, packaging, or security review preparation.",
    ruleSelector: ["AppExchange"],
    workspace: ["."],
    outputFiles: ["code-analyzer-results.html", "code-analyzer-results.sarif.json"],
    herdrRecommended: true,
    herdrReason: "AppExchange scans can be long-running and generate review artifacts.",
  },
  {
    id: "all-rules",
    label: "All rules scan",
    when: "Explicit exhaustive scan, CI hardening, or pre-release quality sweep.",
    ruleSelector: ["all"],
    workspace: ["."],
    herdrRecommended: true,
    herdrReason: "All-rules scans are intentionally broad and can be noisy/long-running.",
  },
  {
    id: "retire-js",
    label: "Dependency vulnerability scan",
    when: "package.json, lockfile, or dependency updates.",
    ruleSelector: ["retire-js:Recommended"],
    workspace: ["."],
    herdrRecommended: true,
    herdrReason: "Dependency scans are project-shaped and useful as explicit validation lanes.",
  },
  {
    id: "cpd",
    label: "Duplication scan",
    when: "Many files changed, refactors, migrations, or copy/similar-logic cleanup.",
    ruleSelector: ["cpd:Recommended"],
    workspace: ["."],
    herdrRecommended: true,
    herdrReason: "CPD scans compare code across files and can be broader than edit-scoped checks.",
  },
  {
    id: "sfge",
    label: "Salesforce Graph Engine scan",
    when: "Apex data-flow or security-sensitive SOQL/DML path changes.",
    ruleSelector: ["sfge:Recommended"],
    workspace: ["."],
    herdrRecommended: true,
    herdrReason:
      "SFGE can need broader Apex project context and may take longer than file-local scans.",
  },
  {
    id: "apex-performance",
    label: "Apex performance scan",
    when: "Apex loops, SOQL/DML paths, describe calls, queueing, or performance-sensitive service changes.",
    ruleSelector: ["pmd:Recommended:Performance"],
    workspace: ["."],
  },
];

export function renderRecipes(options: { inline?: boolean } = {}): string {
  const lines = ["📋 SF Code Analyzer scan recipes", ""];
  for (const recipe of CODE_ANALYZER_RECIPES) {
    lines.push(`${recipe.herdrRecommended ? "🐑 " : ""}${recipe.id} — ${recipe.label}`);
    lines.push(`  When: ${recipe.when}`);
    lines.push(`  rule_selector: ${recipe.ruleSelector.join(", ")}`);
    if (recipe.outputFiles?.length) lines.push(`  output_files: ${recipe.outputFiles.join(", ")}`);
    if (recipe.herdrRecommended) {
      lines.push(`  Herdr recommended: ${recipe.herdrReason}`);
      lines.push(
        "  Next agent step: call sf_herdr_plan visibly if available before running this scan.",
      );
    }
    if (options.inline) {
      lines.push(
        `  Example: code_analyzer action='run' rule_selector=${JSON.stringify(recipe.ruleSelector)} workspace=${JSON.stringify(recipe.workspace)}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function suggestBroaderRecipes(input: { selectors: string[]; targets: string[] }): string[] {
  const targets = input.targets.map((target) => target.toLowerCase());
  const suggestions = new Set<string>();
  if (targets.some((target) => /package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml/.test(target))) {
    suggestions.add("retire-js");
  }
  if (targets.length >= 8) suggestions.add("cpd");
  if (targets.some((target) => /\.cls$|\.trigger$|\.apex$/.test(target))) {
    suggestions.add("security");
    suggestions.add("sfge");
  }
  return [...suggestions];
}

export function renderBroaderRecipeSuggestion(recipeIds: string[]): string | undefined {
  if (recipeIds.length === 0) return undefined;
  const recipes = recipeIds
    .map((id) => CODE_ANALYZER_RECIPES.find((recipe) => recipe.id === id))
    .filter((recipe): recipe is CodeAnalyzerRecipe => Boolean(recipe));
  if (recipes.length === 0) return undefined;
  return [
    "💡 Broader scan suggestions (not run automatically):",
    ...recipes.map(
      (recipe) =>
        `- ${recipe.id}: ${recipe.label} — rule_selector ${recipe.ruleSelector.join(", ")}${recipe.herdrRecommended ? " (Herdr recommended)" : ""}`,
    ),
  ].join("\n");
}
