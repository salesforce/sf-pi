/* SPDX-License-Identifier: Apache-2.0 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SchemaCatalog, SchemaObjectDescribe } from "../../../lib/common/sf-schema/index.ts";
import { runFlowSchemaRules, type FlowSubflowContract } from "../lib/schema-rules.ts";
import { mergeSchemaFindings } from "../lib/schema-grounding.ts";
import { analyzeFlowSource } from "../lib/analyzer.ts";

/**
 * Describe fixtures are captured from a developer org (standard objects only).
 * Mutations mirror cases whose Flow Builder and activation-lane verdicts were
 * observed; see QUALITY_RULES.md for the calibration table.
 */
const fixtures = path.join(import.meta.dirname, "fixtures");
const READY = readFileSync(
  path.join(fixtures, "shape", "Catalog_Picker_Builder_Ready.flow-meta.xml"),
  "utf8",
);
const DESCRIBES = new Map<string, SchemaObjectDescribe>(
  ["Opportunity", "OpportunityLineItem", "Product2", "PricebookEntry"].map((name) => [
    name.toLowerCase(),
    JSON.parse(readFileSync(path.join(fixtures, "schema", `${name}.json`), "utf8")),
  ]),
);

function catalog(overrides: Record<string, SchemaObjectDescribe> = {}): SchemaCatalog {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async object(name) {
      calls += 1;
      return overrides[name.toLowerCase()] ?? DESCRIBES.get(name.toLowerCase());
    },
  };
}

const subflows: Record<string, FlowSubflowContract> = {
  Apply_Volume_Discount: {
    exists: true,
    inputs: [{ name: "opportunityId", data_type: "String", is_collection: false }],
  },
};
const subflow = vi.fn(async (name: string) => subflows[name] ?? { exists: false, inputs: [] });

function mutate(find: string, replace: string): string {
  expect(READY.includes(find), find).toBe(true);
  return READY.replace(find, replace);
}

async function rules(source: string, overrides?: Record<string, SchemaObjectDescribe>) {
  const result = await runFlowSchemaRules(source, { catalog: catalog(overrides), subflow });
  return result.findings.map((finding) => `${finding.severity}:${finding.rule_id}`);
}

function withSubflow(flowName: string, input: string): string {
  return mutate(
    "    <transforms>\n        <name>Map_Product_Ids</name>",
    `    <subflows>
        <name>Apply_Discount</name>
        <label>Apply Discount</label>
        <locationX>314</locationX>
        <locationY>1300</locationY>
        <flowName>${flowName}</flowName>
        <inputAssignments>
            <name>${input}</name>
            <value><elementReference>recordId</elementReference></value>
        </inputAssignments>
    </subflows>
    <transforms>
        <name>Map_Product_Ids</name>`,
  );
}

describe("org-grounded Flow schema rules", () => {
  it("reports nothing for the Builder-ready Flow", async () => {
    expect(await rules(READY)).toEqual([]);
  });

  it.each([
    [
      "unknown queried field",
      () =>
        mutate(
          "<queriedFields>UnitPrice</queriedFields>",
          "<queriedFields>UnitPrice</queriedFields>\n        <queriedFields>Amount__x</queriedFields>",
        ),
      "high:unknown-field",
    ],
    [
      "unknown filter field",
      () => mutate("<field>IsActive</field>", "<field>IsActiveX</field>"),
      "high:unknown-field",
    ],
    [
      "unknown sort field",
      () => mutate("<sortField>UnitPrice</sortField>", "<sortField>UnitPriceX</sortField>"),
      "high:unknown-field",
    ],
    [
      "unknown object",
      () => mutate("<object>Product2</object>", "<object>Product3</object>"),
      "high:unknown-object",
    ],
    [
      "unknown choice-set field",
      () =>
        mutate("<picklistField>Family</picklistField>", "<picklistField>FamilyX</picklistField>"),
      "high:unknown-field",
    ],
    [
      "unknown Transform output",
      () =>
        mutate(
          "<outputFieldApiName>Quantity</outputFieldApiName>",
          "<outputFieldApiName>QuantityX</outputFieldApiName>",
        ),
      "high:unknown-field",
    ],
    [
      "unknown assignment field",
      () =>
        mutate(
          "<assignToReference>Loop_Line_Items.OpportunityId</assignToReference>",
          "<assignToReference>Loop_Line_Items.OpportunityIdX</assignToReference>",
        ),
      "high:unknown-field",
    ],
    [
      "unknown Decision field",
      () =>
        mutate(
          "<leftValueReference>Get_Opportunity.Pricebook2Id</leftValueReference>",
          "<leftValueReference>Get_Opportunity.Pricebook2IdX</leftValueReference>",
        ),
      "high:unknown-field",
    ],
    [
      "unknown merge field",
      () =>
        mutate(
          "Products added: {!productsAdded}",
          "Products added: {!productsAdded} {!Get_Opportunity.AmountX}",
        ),
      "high:unknown-field",
    ],
    [
      "missing subflow",
      () => withSubflow("No_Such_Subflow", "opportunityId"),
      "high:subflow-contract",
    ],
    [
      "unknown subflow input",
      () => withSubflow("Apply_Volume_Discount", "recordId"),
      "high:subflow-contract",
    ],
    [
      "non-filterable filter field",
      () =>
        mutate(
          "<field>Id</field>\n            <operator>EqualTo</operator>\n            <value>\n                <elementReference>recordId</elementReference>",
          "<field>Description</field>\n            <operator>EqualTo</operator>\n            <value>\n                <elementReference>recordId</elementReference>",
        ),
      "moderate:field-capability",
    ],
    [
      "read-only Transform output",
      () =>
        mutate(
          "<outputFieldApiName>Quantity</outputFieldApiName>",
          "<outputFieldApiName>ListPrice</outputFieldApiName>",
        ),
      "moderate:field-capability",
    ],
    [
      "picklist literal outside the value set",
      () =>
        mutate(
          "<field>Family</field>\n            <operator>EqualTo</operator>\n            <value>\n                <elementReference>Family_Picker</elementReference>",
          "<field>Family</field>\n            <operator>EqualTo</operator>\n            <value>\n                <stringValue>Gadgets</stringValue>",
        ),
      "moderate:picklist-literal",
    ],
    [
      "unknown data table column",
      () =>
        READY.replace(
          "&quot;apiName&quot;:&quot;UnitPrice&quot;",
          "&quot;apiName&quot;:&quot;UnitPriceX&quot;",
        ),
      "moderate:unknown-field",
    ],
    [
      "required create fields never set",
      () =>
        READY.replace(
          /\s*<assignmentItems>\s*<assignToReference>Loop_Line_Items\.OpportunityId<\/assignToReference>[\s\S]*?<\/assignmentItems>/,
          "",
        ).replace(
          /\s*<transformValueActions>\s*<outputFieldApiName>Quantity<\/outputFieldApiName>[\s\S]*?<\/transformValueActions>/,
          "",
        ),
      "moderate:required-create-fields",
    ],
  ])("%s", async (_label, build, expected) => {
    expect(await rules(build())).toContain(expected);
  });

  it.each([
    [
      "related field traversal in a Decision",
      () =>
        mutate(
          "<leftValueReference>Get_Opportunity.Pricebook2Id</leftValueReference>",
          "<leftValueReference>Get_Opportunity.Account.Name</leftValueReference>",
        ),
    ],
    ["known subflow input", () => withSubflow("Apply_Volume_Discount", "opportunityId")],
    [
      "case-insensitive field names",
      () => mutate("<field>IsActive</field>", "<field>isactive</field>"),
    ],
  ])("accepts %s", async (_label, build) => {
    expect(await rules(build())).toEqual([]);
  });

  it("warns when a choice-set picklist has no usable values", async () => {
    const product = structuredClone(DESCRIBES.get("product2")) as SchemaObjectDescribe;
    for (const field of product.fields) {
      if (field.name === "Family") field.picklistValues = [{ active: true, value: "None" }];
    }
    expect(await rules(READY, { product2: product })).toEqual(["moderate:picklist-literal"]);
  });

  it("describes each object once and stops at the object limit", async () => {
    const shared = catalog();
    await runFlowSchemaRules(READY, { catalog: shared });
    expect(shared.calls).toBe(4);
    const limited = await runFlowSchemaRules(READY, { catalog: catalog(), maxObjects: 1 });
    expect(limited.truncated).toBe(true);
    expect(limited.findings.filter((finding) => finding.rule_id === "unknown-object")).toEqual([]);
  });

  it("merges schema findings into the local analysis summary and coverage", async () => {
    const source = mutate("<field>IsActive</field>", "<field>IsActiveX</field>");
    const local = analyzeFlowSource(source, "Catalog_Picker.flow-meta.xml");
    const schema = await runFlowSchemaRules(source, { catalog: catalog(), subflow });
    const merged = mergeSchemaFindings(local, schema);
    expect(merged.summary.high).toBe(local.summary.high + 1);
    expect(merged.coverage.ran).toContain("unknown-field");
    expect(merged.findings.some((finding) => finding.rule_id === "unknown-field")).toBe(true);
  });
});
