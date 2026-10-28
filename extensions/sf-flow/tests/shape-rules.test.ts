/* SPDX-License-Identifier: Apache-2.0 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeFlowSource } from "../lib/analyzer.ts";
import { FLOW_SHAPE_RULE_IDS } from "../lib/shape-rules.ts";

/**
 * Every case mutates a Builder-ready Flow (zero Flow Builder errors, activated and
 * run in a non-production org) with one change whose platform verdict was observed
 * through the activation lane or the Flow Builder Errors panel.
 */
const READY = readFileSync(
  path.join(import.meta.dirname, "fixtures", "shape", "Catalog_Picker_Builder_Ready.flow-meta.xml"),
  "utf8",
);
const DRAFT_ONLY = readFileSync(
  path.join(import.meta.dirname, "fixtures", "Catalog_Picker_Draft_Only.flow-meta.xml"),
  "utf8",
);
const SHAPE = new Set<string>(FLOW_SHAPE_RULE_IDS);

function mutate(find: string, replace: string): string {
  expect(READY.includes(find), find).toBe(true);
  return READY.replace(find, replace);
}

function addTableInput(name: string, value = "<booleanValue>true</booleanValue>"): string {
  return mutate(
    "                <name>selectionMode</name>",
    `                <name>${name}</name>
                <value>${value}</value>
            </inputParameters>
            <inputParameters>
                <name>selectionMode</name>`,
  );
}

function withoutTableInput(name: string): string {
  return READY.replace(
    new RegExp(`\\s*<inputParameters>\\s*<name>${name}</name>[\\s\\S]*?</inputParameters>`),
    "",
  );
}

function summaryMerge(expression: string): string {
  return mutate(
    "Products added: {!productsAdded}",
    `Products added: {!productsAdded} {!${expression}}`,
  );
}

function shapeFindings(source: string) {
  return analyzeFlowSource(source, "Catalog_Picker.flow-meta.xml").findings.filter((finding) =>
    SHAPE.has(finding.rule_id),
  );
}

function highRules(source: string): string[] {
  return [
    ...new Set(
      analyzeFlowSource(source, "Catalog_Picker.flow-meta.xml")
        .findings.filter((finding) => finding.severity === "high")
        .map((finding) => finding.rule_id),
    ),
  ];
}

describe("Builder-parity shape rules", () => {
  it("keeps the Builder-ready Flow free of high findings", () => {
    expect(highRules(READY)).toEqual([]);
    expect(shapeFindings(READY)).toEqual([]);
  });

  it("finds every Builder-reported defect in the Draft-only Flow", () => {
    const findings = analyzeFlowSource(DRAFT_ONLY, "Catalog_Picker_Draft_Only.flow-meta.xml")
      .findings.filter((finding) => finding.severity === "high")
      .map((finding) => `${finding.rule_id}:${finding.message}`);
    for (const expected of [
      'record-field-path:Get_Active_Pricebook_Entries uses "Product2.Family"',
      'screen-component-contract:Product_Table is missing the required input "minRowSelection"',
      'screen-component-contract:Product_Table does not support the input "objectName"',
      'screen-component-contract:Product_Table does not support the input "isRequired"',
      'sort-output-reference:"Sort_By_Unit_Price" is a Collection Sort',
      'screen-field-dot-value:Reference the screen input "Family_Picker" directly',
      'transform-scalar-into-collection:Transform_To_Line_Items starts with the single value "recordId"',
    ]) {
      expect(
        findings.some((finding) => finding.startsWith(expected)),
        expected,
      ).toBe(true);
    }
  });

  describe.each([
    [
      "missing data table type mapping",
      () => READY.replace(/\s*<dataTypeMappings>[\s\S]*?<\/dataTypeMappings>/, ""),
      "screen-component-contract",
    ],
    [
      "undeclared objectName input",
      () => addTableInput("objectName", "<stringValue>PricebookEntry</stringValue>"),
      "screen-component-contract",
    ],
    [
      "isRequired as an inputParameter",
      () => addTableInput("isRequired"),
      "screen-component-contract",
    ],
    ["preSelectedRows input", () => addTableInput("preSelectedRows"), "screen-component-contract"],
    [
      "keyField input without a complex value",
      () => addTableInput("keyField", "<stringValue>Id</stringValue>"),
      "screen-component-contract",
    ],
    [
      "missing minRowSelection",
      () => withoutTableInput("minRowSelection"),
      "screen-component-contract",
    ],
    [
      "missing selectionMode",
      () => withoutTableInput("selectionMode"),
      "screen-component-contract",
    ],
    [
      "single record as tableData",
      () =>
        mutate(
          "<elementReference>Get_Active_Pricebook_Entries</elementReference>\n                </value>\n            </inputParameters>\n            <inputParameters>\n                <name>columns</name>",
          "<elementReference>Get_Opportunity</elementReference>\n                </value>\n            </inputParameters>\n            <inputParameters>\n                <name>columns</name>",
        ),
      "collection-scalar-mismatch",
    ],
    [
      "undeclared data table output",
      () => summaryMerge("Product_Table.selectedThings"),
      "component-output-binding",
    ],
    [
      "data table output read without stored outputs",
      () =>
        mutate(
          "            <storeOutputAutomatically>true</storeOutputAutomatically>\n        </fields>",
          "        </fields>",
        ),
      "component-output-binding",
    ],
    [
      "field read on a record collection",
      () => summaryMerge("Get_Active_Pricebook_Entries.UnitPrice"),
      "collection-scalar-mismatch",
    ],
    [
      "loop over a single record",
      () =>
        mutate(
          "<collectionReference>Transform_To_Line_Items</collectionReference>",
          "<collectionReference>Get_Opportunity</collectionReference>",
        ),
      "collection-scalar-mismatch",
    ],
    [
      "dotted queried field",
      () =>
        mutate(
          "<queriedFields>UnitPrice</queriedFields>",
          "<queriedFields>UnitPrice</queriedFields>\n        <queriedFields>Product2.Family</queriedFields>",
        ),
      "record-field-path",
    ],
    [
      "dotted filter field",
      () => mutate("<field>IsActive</field>", "<field>Product2.IsActive</field>"),
      "record-field-path",
    ],
    [
      "dotted sort field",
      () => mutate("<sortField>UnitPrice</sortField>", "<sortField>Product2.Name</sortField>"),
      "record-field-path",
    ],
    [
      "screen input read as .value",
      () =>
        mutate(
          "<elementReference>Family_Picker</elementReference>",
          "<elementReference>Family_Picker.value</elementReference>",
        ),
      "screen-field-dot-value",
    ],
    [
      "picklist choice set typed String",
      () =>
        mutate(
          "<name>Family_Choices</name>\n        <dataType>Picklist</dataType>",
          "<name>Family_Choices</name>\n        <dataType>String</dataType>",
        ),
      "choice-set-datatype",
    ],
    [
      "scalar first in a collection Transform",
      () =>
        mutate(
          "        <transformValues>\n            <transformValueActions>\n                <outputFieldApiName>PricebookEntryId</outputFieldApiName>",
          "        <transformValues>\n            <transformValueActions>\n                <outputFieldApiName>Description</outputFieldApiName>\n                <transformType>Map</transformType>\n                <value><elementReference>recordId</elementReference></value>\n            </transformValueActions>\n            <transformValueActions>\n                <outputFieldApiName>PricebookEntryId</outputFieldApiName>",
        ),
      "transform-scalar-into-collection",
    ],
    [
      "IsNull compared to a String",
      () =>
        mutate(
          "<operator>IsNull</operator>\n                <rightValue>\n                    <booleanValue>false</booleanValue>",
          "<operator>IsNull</operator>\n                <rightValue>\n                    <stringValue>false</stringValue>",
        ),
      "condition-operand-type",
    ],
  ])("%s", (_label, build, ruleId) => {
    it(`reports ${ruleId} as high`, () => {
      expect(highRules(build())).toContain(ruleId);
    });
  });

  describe.each([
    [
      "maxRowSelection input",
      () => addTableInput("maxRowSelection", "<numberValue>5.0</numberValue>"),
    ],
    ["isShowSearchBar input", () => addTableInput("isShowSearchBar")],
    ["shouldDisplayLabel input", () => addTableInput("shouldDisplayLabel")],
    ["firstSelectedRow output", () => summaryMerge("Product_Table.firstSelectedRow.Name")],
    [
      "related field in a Decision",
      () =>
        mutate(
          "<leftValueReference>Get_Opportunity.Pricebook2Id</leftValueReference>",
          "<leftValueReference>Get_Opportunity.Account.Name</leftValueReference>",
        ),
    ],
    ["related field in a merge field", () => summaryMerge("Get_Opportunity.Account.Name")],
    [
      "scalar after a per-item Transform mapping",
      () =>
        mutate(
          "                <outputFieldApiName>Quantity</outputFieldApiName>",
          "                <outputFieldApiName>OpportunityId</outputFieldApiName>\n                <transformType>Map</transformType>\n                <value><elementReference>recordId</elementReference></value>\n            </transformValueActions>\n            <transformValueActions>\n                <outputFieldApiName>Quantity</outputFieldApiName>",
        ),
    ],
    [
      "NotIn collection filter",
      () => mutate("<operator>In</operator>", "<operator>NotIn</operator>"),
    ],
  ])("accepted variant: %s", (_label, build) => {
    it("adds no high findings", () => {
      expect(highRules(build())).toEqual([]);
    });
  });

  it("warns on an input-disabled record-page recordId", () => {
    const source = mutate(
      "<isCollection>false</isCollection>\n        <isInput>true</isInput>",
      "<isCollection>false</isCollection>\n        <isInput>false</isInput>",
    );
    expect(shapeFindings(source)).toEqual([
      expect.objectContaining({ rule_id: "record-page-input", severity: "moderate" }),
    ]);
  });

  it("warns on related-field Collection Filter conditions", () => {
    const findings = analyzeFlowSource(
      DRAFT_ONLY,
      "Catalog_Picker_Draft_Only.flow-meta.xml",
    ).findings;
    expect(findings).toContainEqual(
      expect.objectContaining({ rule_id: "record-field-path", severity: "moderate" }),
    );
  });
});

describe("Builder-parity quick fixes", () => {
  it.each([
    [
      "choice-set-datatype",
      READY.replace(
        "<name>Family_Choices</name>\n        <dataType>Picklist</dataType>",
        "<name>Family_Choices</name>\n        <dataType>String</dataType>",
      ),
    ],
    [
      "screen-field-dot-value",
      READY.replace(
        "<elementReference>Family_Picker</elementReference>",
        "<elementReference>Family_Picker.value</elementReference>",
      ).replace(
        "Products added: {!productsAdded}",
        "Products added: {!productsAdded} {!Family_Picker.value}",
      ),
    ],
  ])("repairs %s back to zero shape findings", async (ruleId, source) => {
    const { mkdtemp, writeFile, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { applyFlowQuickFix, listFlowQuickFixes, sourceVersion } =
      await import("../lib/quick-fixes.ts");
    const root = await mkdtemp(path.join(tmpdir(), "sf-flow-shape-fix-"));
    await writeFile(
      path.join(root, "sfdx-project.json"),
      JSON.stringify({
        packageDirectories: [{ path: ".", default: true }],
        sourceApiVersion: "68.0",
      }),
      "utf8",
    );
    const file = path.join(root, "Catalog_Picker.flow-meta.xml");
    await writeFile(file, source, "utf8");
    const analysis = analyzeFlowSource(source, "Catalog_Picker.flow-meta.xml");
    const fix = (await listFlowQuickFixes(source, analysis, root)).find(
      (candidate) => candidate.rule_id === ruleId,
    );
    expect(fix).toBeDefined();
    await applyFlowQuickFix(
      {
        action: "fix.apply",
        file: "Catalog_Picker.flow-meta.xml",
        workspace: root,
        fix_id: fix?.id,
        source_version: sourceVersion(source),
      },
      root,
    );
    const repaired = await readFile(file, "utf8");
    expect(shapeFindings(repaired)).toEqual([]);
  });
});
