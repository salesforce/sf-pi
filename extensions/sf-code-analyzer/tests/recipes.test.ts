/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CODE_ANALYZER_RECIPES,
  buildScanRecipeGuidance,
  herdrHandoffsForRecipes,
  renderBroaderRecipeSuggestion,
  suggestBroaderRecipes,
} from "../lib/recipes.ts";

describe("Code Analyzer recipes", () => {
  it("distinguishes automatic default recipes from explicit broader recipes", () => {
    const autoApex = CODE_ANALYZER_RECIPES.find((recipe) => recipe.id === "auto-apex-default");
    const security = CODE_ANALYZER_RECIPES.find((recipe) => recipe.id === "security");
    const guidance = buildScanRecipeGuidance({ selectors: [], targets: [], includeExamples: true });

    expect(autoApex?.kind).toBe("automatic");
    expect(security?.kind).toBe("explicit");
    expect(guidance.text).toContain("Kind: automatic");
    expect(guidance.text).toContain("Kind: explicit");
  });

  it("does not suggest broader recipes for simple JS edits", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sf-code-analyzer-recipes-"));
    const file = path.join(dir, "format.ts");
    writeFileSync(file, "export function format(value: string): string { return value.trim(); }\n");

    const guidance = buildScanRecipeGuidance({
      selectors: ["eslint:Recommended"],
      targets: [file],
    });

    expect(guidance.suggestions).toEqual([]);
    expect(guidance.herdrHandoffs).toEqual([]);
  });

  it("suggests CPD guidance for many changed targets", () => {
    const guidance = buildScanRecipeGuidance({
      selectors: ["eslint:Recommended"],
      targets: Array.from({ length: 8 }, (_, index) => `src/file${index}.ts`),
    });

    expect(guidance.suggestions.map((recipe) => recipe.id)).toEqual(["cpd"]);
    expect(guidance.herdrHandoffs.map((handoff) => handoff.recipeId)).toEqual(["cpd"]);
  });

  it("suggests RetireJS guidance for dependency manifest changes", () => {
    const guidance = buildScanRecipeGuidance({
      selectors: ["eslint:Recommended"],
      targets: ["package.json"],
    });

    expect(guidance.suggestions.map((recipe) => recipe.id)).toEqual(["retire-js"]);
    expect(guidance.herdrHandoffs.map((handoff) => handoff.recipeId)).toEqual(["retire-js"]);
    expect(guidance.text).toContain("retire-js:Recommended");
  });

  it("suggests Security and SFGE guidance for Apex data-flow/security content", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sf-code-analyzer-recipes-"));
    const file = path.join(dir, "AccountAccessController.cls");
    writeFileSync(
      file,
      [
        "public without sharing class AccountAccessController {",
        "  @AuraEnabled public static List<Account> load(String name) {",
        "    return Database.query('SELECT Id FROM Account WHERE Name = ' + String.escapeSingleQuotes(name));",
        "  }",
        "}",
      ].join("\n"),
    );

    const guidance = buildScanRecipeGuidance({
      selectors: ["pmd:Recommended"],
      targets: [file],
      includeExamples: false,
    });

    expect(guidance.suggestions.map((recipe) => recipe.id)).toEqual(["security", "sfge"]);
    expect(guidance.herdrHandoffs.map((handoff) => handoff.recipeId)).toEqual(["security", "sfge"]);
    expect(guidance.text).toContain("not run automatically");
    expect(guidance.text).toContain("sf_herdr_plan");
  });

  it("includes broad scan Herdr handoff metadata", () => {
    const appexchange = CODE_ANALYZER_RECIPES.find((recipe) => recipe.id === "appexchange");
    expect(appexchange?.ruleSelector).toEqual(["AppExchange"]);
    expect(appexchange?.herdrRecommended).toBe(true);
    expect(appexchange?.herdrReason).toContain("long-running");
  });

  it("suggests broader recipes from changed target context", () => {
    expect(
      suggestBroaderRecipes({
        selectors: ["pmd:Recommended"],
        targets: ["force-app/classes/Foo.cls"],
      }),
    ).toEqual(["security"]);
    expect(
      suggestBroaderRecipes({ selectors: ["eslint:Recommended"], targets: ["package.json"] }),
    ).toEqual(["retire-js"]);
  });

  it("renders suggestions without executing them", () => {
    const rendered = renderBroaderRecipeSuggestion(["security", "sfge"]);
    expect(rendered).toContain("Broader scan suggestions");
    expect(rendered).toContain("security");
    expect(rendered).toContain("sfge");
  });

  it("builds plan-focused Herdr workflow handoff metadata", () => {
    const [handoff] = herdrHandoffsForRecipes(["appexchange"]);
    expect(handoff).toMatchObject({
      recipeId: "appexchange",
      label: "Plan a Herdr lane for AppExchange security review scan",
      commandSource: "owning-extension",
      plan: { intent: "verify", primaryWorkflow: "generic", expectedDuration: "long" },
    });
    expect(JSON.stringify(handoff)).not.toContain("suggestedCommand");
  });

  it("infers Apex workflow for Apex-specific Herdr handoffs", () => {
    const [handoff] = herdrHandoffsForRecipes(["sfge"]);
    expect(handoff.plan.primaryWorkflow).toBe("apex");
    expect(handoff.plan.intent).toBe("verify");
  });
});
