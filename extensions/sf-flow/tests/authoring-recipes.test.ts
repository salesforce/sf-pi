/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import {
  authoringGuidance,
  AUTHORING_CONTRACT_IDS,
  AUTHORING_RECIPE_IDS,
} from "../lib/authoring-recipes.ts";
import { analyzeFlowSource } from "../lib/analyzer.ts";

const CATALOG_INTENT =
  "Build a screen flow on the Opportunity record page that helps reps add products. " +
  "Get the active PricebookEntries for the Opportunity's Pricebook. Screen 1: the rep picks a " +
  "Product Family. Keep only entries in that family and sort them by UnitPrice ascending. Screen 2: " +
  "show them in a data table where the rep selects the products to add. Transform the selected entries " +
  "into OpportunityLineItems and create them. Then call the subflow Apply_Volume_Discount, and show a " +
  "summary screen with the number of products added and the total value.";

describe("author.plan guidance", () => {
  it("selects every element contract and recipe for the catalog-picker intent", () => {
    const guidance = authoringGuidance(CATALOG_INTENT, "screen");
    expect(guidance.contracts.map((contract) => contract.id).sort()).toEqual(
      [...AUTHORING_CONTRACT_IDS].sort(),
    );
    expect(guidance.recipes.map((recipe) => recipe.id).sort()).toEqual(
      [...AUTHORING_RECIPE_IDS].sort(),
    );
  });

  it("keeps screen-only contracts out of non-screen families", () => {
    const guidance = authoringGuidance(CATALOG_INTENT, "autolaunched");
    const ids = guidance.contracts.map((contract) => contract.id);
    expect(ids).not.toContain("data-table");
    expect(ids).not.toContain("picklist-choice");
    expect(ids).not.toContain("record-page-input");
  });

  it("returns nothing for an unrelated intent", () => {
    const guidance = authoringGuidance("Send an email when a case is closed", "record-triggered");
    expect(guidance.contracts).toEqual([]);
    expect(guidance.recipes).toEqual([]);
  });

  it("every element contract snippet is well-formed and free of high findings", () => {
    const guidance = authoringGuidance(CATALOG_INTENT, "screen");
    for (const contract of guidance.contracts) {
      const snippet = contract.xml.replace(/<!--.*?-->/gs, "");
      const wrapped = `<?xml version="1.0" encoding="UTF-8"?>\n<Flow xmlns="http://soap.sforce.com/2006/04/metadata">\n${snippet}\n</Flow>`;
      const analysis = analyzeFlowSource(wrapped, `${contract.id}.flow-meta.xml`);
      const parseErrors = analysis.findings.filter((finding) => finding.rule_id === "xml-syntax");
      expect(parseErrors, contract.id).toEqual([]);
      // The isolated snippet contains only its own element, so any shape-rule
      // high finding would mean the example itself is wrong.
      const shapeHigh = analysis.findings.filter(
        (finding) =>
          finding.severity === "high" &&
          [
            "screen-component-contract",
            "sort-output-reference",
            "record-field-path",
            "screen-field-dot-value",
            "transform-scalar-into-collection",
            "choice-set-datatype",
            "collection-scalar-mismatch",
            "component-output-binding",
          ].includes(finding.rule_id),
      );
      expect(shapeHigh, `${contract.id}: ${JSON.stringify(shapeHigh)}`).toEqual([]);
    }
  });

  it("names a prevented rule for every contract and recipe", () => {
    const guidance = authoringGuidance(CATALOG_INTENT, "screen");
    for (const contract of guidance.contracts) expect(contract.prevents.length).toBeGreaterThan(0);
    for (const recipe of guidance.recipes) expect(recipe.prevents.length).toBeGreaterThan(0);
  });
});
