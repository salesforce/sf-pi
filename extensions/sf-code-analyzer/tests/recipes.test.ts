/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  CODE_ANALYZER_RECIPES,
  herdrHandoffsForRecipes,
  renderBroaderRecipeSuggestion,
  suggestBroaderRecipes,
} from "../lib/recipes.ts";

describe("Code Analyzer recipes", () => {
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

  it("builds structured Herdr handoff metadata", () => {
    const [handoff] = herdrHandoffsForRecipes(["appexchange"]);
    expect(handoff.intent).toContain("AppExchange");
    expect(handoff.suggestedCommand).toContain("sf code-analyzer run");
    expect(handoff.suggestedCommand).toContain("--rule-selector AppExchange");
  });
});
