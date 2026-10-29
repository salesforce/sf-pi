/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Verified Flow element contracts and design recipes for author.plan.
 *
 * Every snippet comes from a Flow that saved with zero Flow Builder errors,
 * activated, and ran in a non-production org (the Builder-ready shape fixture).
 * Each recipe names the rule ids it prevents, so the plan, the diagnostics, and
 * the platform failure hints describe one failure mode with one name.
 */

export interface FlowElementContract {
  id: string;
  label: string;
  prevents: string[];
  rules: string[];
  xml: string;
}

export interface FlowDesignRecipe {
  id: string;
  label: string;
  when: string;
  steps: string[];
  prevents: string[];
}

const CONTRACTS: Array<FlowElementContract & { triggers: RegExp }> = [
  {
    id: "data-table",
    label: "Data table (flowruntime:datatable)",
    triggers:
      /data ?table|select(s|ed)? (the |which )?(rows?|records?|products?|items?)|pick (rows|records)/i,
    prevents: [
      "screen-component-contract",
      "component-output-binding",
      "collection-scalar-mismatch",
    ],
    rules: [
      "Set dataTypeMappings typeName T to the record object.",
      "Set tableData (a record collection), columns, selectionMode, and minRowSelection; minRowSelection is required in every selection mode.",
      "Put isRequired on the field, never as an inputParameter; do not set objectName, preSelectedRows, keyField, sortedBy, or tableBorder.",
      "Read the selection as <Table>.selectedRows or <Table>.firstSelectedRow with storeOutputAutomatically=true.",
    ],
    xml: `<fields>
    <name>Record_Table</name>
    <dataTypeMappings>
        <typeName>T</typeName>
        <typeValue>PricebookEntry</typeValue>
    </dataTypeMappings>
    <extensionName>flowruntime:datatable</extensionName>
    <fieldType>ComponentInstance</fieldType>
    <inputParameters>
        <name>tableData</name>
        <value><elementReference>Get_Entries</elementReference></value>
    </inputParameters>
    <inputParameters>
        <name>columns</name>
        <value><stringValue>[{&quot;apiName&quot;:&quot;Name&quot;,&quot;guid&quot;:&quot;column-a1&quot;,&quot;editable&quot;:false,&quot;hasCustomHeaderLabel&quot;:false,&quot;label&quot;:&quot;Name&quot;,&quot;order&quot;:0,&quot;type&quot;:&quot;text&quot;,&quot;wrapText&quot;:true}]</stringValue></value>
    </inputParameters>
    <inputParameters>
        <name>minRowSelection</name>
        <value><numberValue>1.0</numberValue></value>
    </inputParameters>
    <inputParameters>
        <name>selectionMode</name>
        <value><stringValue>MULTI_SELECT</stringValue></value>
    </inputParameters>
    <inputsOnNextNavToAssocScrn>UseStoredValues</inputsOnNextNavToAssocScrn>
    <isRequired>true</isRequired>
    <storeOutputAutomatically>true</storeOutputAutomatically>
</fields>`,
  },
  {
    id: "picklist-choice",
    label: "Picklist choice set on a screen",
    triggers: /pick(s|ed)? (a|the) \w+|choose (a|the) \w+|picklist|dropdown|family/i,
    prevents: ["choice-set-datatype", "screen-field-dot-value", "picklist-literal"],
    rules: [
      "A dynamic choice set over a picklist field uses dataType Picklist.",
      "Reference the screen input by its name (Family_Picker), never Family_Picker.value.",
    ],
    xml: `<dynamicChoiceSets>
    <name>Family_Choices</name>
    <dataType>Picklist</dataType>
    <picklistField>Family</picklistField>
    <picklistObject>Product2</picklistObject>
</dynamicChoiceSets>
<!-- inside a screen -->
<fields>
    <name>Family_Picker</name>
    <choiceReferences>Family_Choices</choiceReferences>
    <dataType>String</dataType>
    <fieldText>Product Family</fieldText>
    <fieldType>DropdownBox</fieldType>
    <isRequired>true</isRequired>
</fields>`,
  },
  {
    id: "get-records-sorted",
    label: "Get Records with an In filter and sort",
    triggers: /\bsort(ed)?\b|order(ed)? by|ascending|descending|\bin (that|the) (family|set|list)/i,
    prevents: ["record-field-path", "sort-output-reference", "unknown-field", "field-capability"],
    rules: [
      "Fields, filters, and sortField name fields on the queried object only; no Parent.Field paths.",
      "Prefer sorting in Get Records. A Collection Sort sorts its input in place and has no output to reference.",
      "The In operator takes a text collection, such as a Transform that maps Ids.",
    ],
    xml: `<recordLookups>
    <name>Get_Entries</name>
    <filterLogic>and</filterLogic>
    <filters>
        <field>Pricebook2Id</field>
        <operator>EqualTo</operator>
        <value><elementReference>Get_Opportunity.Pricebook2Id</elementReference></value>
    </filters>
    <filters>
        <field>Product2Id</field>
        <operator>In</operator>
        <value><elementReference>Map_Product_Ids</elementReference></value>
    </filters>
    <getFirstRecordOnly>false</getFirstRecordOnly>
    <object>PricebookEntry</object>
    <sortField>UnitPrice</sortField>
    <sortOrder>Asc</sortOrder>
    <queriedFields>Id</queriedFields>
    <queriedFields>UnitPrice</queriedFields>
    <storeOutputAutomatically>true</storeOutputAutomatically>
</recordLookups>`,
  },
  {
    id: "transform-records",
    label: "Collection Transform into new records",
    triggers: /transform|map (the |each )?\w+ (in)?to|convert/i,
    prevents: ["transform-scalar-into-collection", "unknown-field", "required-create-fields"],
    rules: [
      "dataType SObject, isCollection true, objectType set to the target object.",
      "The first mapping must read a per-item [$EachItem] source; a single value such as a parent Id may follow it and applies to every item.",
      "Map every required field of the target object (for example OpportunityId and Quantity).",
    ],
    xml: `<transforms>
    <name>Transform_To_Line_Items</name>
    <dataType>SObject</dataType>
    <isCollection>true</isCollection>
    <objectType>OpportunityLineItem</objectType>
    <storeOutputAutomatically>true</storeOutputAutomatically>
    <transformValues>
        <transformValueActions>
            <outputFieldApiName>PricebookEntryId</outputFieldApiName>
            <transformType>Map</transformType>
            <value><elementReference>Record_Table.selectedRows[$EachItem].Id</elementReference></value>
        </transformValueActions>
        <transformValueActions>
            <outputFieldApiName>OpportunityId</outputFieldApiName>
            <transformType>Map</transformType>
            <value><elementReference>recordId</elementReference></value>
        </transformValueActions>
        <transformValueActions>
            <outputFieldApiName>Quantity</outputFieldApiName>
            <transformType>Map</transformType>
            <value><numberValue>1.0</numberValue></value>
        </transformValueActions>
    </transformValues>
</transforms>`,
  },
  {
    id: "transform-ids",
    label: "Transform a record collection into an Id list",
    triggers:
      /\bids?\b.*\b(in|list|set)\b|keep only|filter .* by (a |the )?(parent|related)|in that family/i,
    prevents: ["record-field-path", "collection-scalar-mismatch"],
    rules: ["dataType String, isCollection true, one Map action from [$EachItem].Id."],
    xml: `<transforms>
    <name>Map_Product_Ids</name>
    <dataType>String</dataType>
    <isCollection>true</isCollection>
    <scale>0</scale>
    <storeOutputAutomatically>true</storeOutputAutomatically>
    <transformValues>
        <transformValueActions>
            <transformType>Map</transformType>
            <value><elementReference>Get_Products_In_Family[$EachItem].Id</elementReference></value>
        </transformValueActions>
    </transformValues>
</transforms>`,
  },
  {
    id: "record-page-input",
    label: "Record page recordId input",
    triggers: /record page|on the \w+ (record )?page|quick action|lightning page/i,
    prevents: ["record-page-input", "record-id-as-string"],
    rules: ["Declare recordId as a single, input-enabled variable; the record page passes the Id."],
    xml: `<variables>
    <name>recordId</name>
    <dataType>String</dataType>
    <isCollection>false</isCollection>
    <isInput>true</isInput>
    <isOutput>false</isOutput>
</variables>`,
  },
];

const RECIPES: Array<FlowDesignRecipe & { triggers: RegExp }> = [
  {
    id: "filter-by-parent-field",
    label: "Filter child records by a parent field",
    when: "Records must be narrowed by a field that lives on a related parent (for example entries by Product Family).",
    triggers: /(keep only|filter|only) .*(family|parent|related|category|type)|in that family/i,
    steps: [
      "Get Records on the parent object filtered by the chosen value; query Id only.",
      "Transform the parent collection into a String Id list ([$EachItem].Id).",
      "Get Records on the child with <ParentId> In the Id list.",
    ],
    prevents: ["record-field-path"],
  },
  {
    id: "sort-results",
    label: "Sort a result set",
    when: "The user sees records in a specific order.",
    triggers: /\bsort(ed)?\b|order(ed)? by|ascending|descending/i,
    steps: [
      "Sort in the Get Records element (sortField and sortOrder) whenever the sort field is on the queried object.",
      "If a Collection Sort is required, sort a collection variable in place and reference the variable afterwards.",
    ],
    prevents: ["sort-output-reference"],
  },
  {
    id: "selection-to-records",
    label: "Turn a data table selection into new records",
    when: "Selected rows become new child records.",
    triggers: /select(s|ed)? .*(add|create)|selected (rows|records|entries|products)/i,
    steps: [
      "Collection Transform from <Table>.selectedRows[$EachItem] to the target object, per-item mapping first.",
      "Map the parent Id after a per-item mapping, or stamp it in a Loop with an Assignment.",
      "One Create Records on the transformed collection, with a fault path.",
    ],
    prevents: [
      "transform-scalar-into-collection",
      "component-output-binding",
      "required-create-fields",
    ],
  },
  {
    id: "summarize-created",
    label: "Count and total created records",
    when: "A summary shows how many records were created and their total value.",
    triggers: /summary|number of|count|total (value|amount)|how many/i,
    steps: [
      "Loop over the created collection and add to Number variables in an Assignment, or use a Transform Count and Sum.",
      "Display the variables with {!variable} merge fields; never read a field from a collection directly.",
    ],
    prevents: ["collection-scalar-mismatch"],
  },
  {
    id: "call-subflow",
    label: "Call a subflow",
    when: "The Flow delegates to another Flow.",
    triggers: /subflow|call the (flow|subflow)|then call/i,
    steps: [
      "Confirm the subflow exists in the target org and read its input variable names (author.plan with target_org).",
      "Pass only declared inputs; the activation lane rejects a missing subflow.",
    ],
    prevents: ["subflow-contract"],
  },
];

export interface AuthoringGuidance {
  contracts: FlowElementContract[];
  recipes: FlowDesignRecipe[];
}

/** Select the element contracts and recipes the intent needs, in a stable order. */
export function authoringGuidance(intent: string, family: string): AuthoringGuidance {
  const screen = family === "screen";
  const contracts = CONTRACTS.filter(
    (contract) =>
      contract.triggers.test(intent) &&
      (screen || !["data-table", "picklist-choice", "record-page-input"].includes(contract.id)),
  ).map(withoutTriggers);
  const recipes = RECIPES.filter((recipe) => recipe.triggers.test(intent)).map(withoutTriggers);
  return { contracts, recipes };
}

/** Drop the internal intent matcher before returning public guidance. */
function withoutTriggers<T extends { triggers: RegExp }>(entry: T): Omit<T, "triggers"> {
  const copy: Partial<T> = { ...entry };
  delete copy.triggers;
  return copy as Omit<T, "triggers">;
}

export const AUTHORING_CONTRACT_IDS = CONTRACTS.map((contract) => contract.id);
export const AUTHORING_RECIPE_IDS = RECIPES.map((recipe) => recipe.id);
