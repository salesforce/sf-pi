/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Builder-parity Flow shape rules.
 *
 * Draft check-only validation skips most semantic checks, and some errors only
 * surface in Flow Builder. These deterministic rules catch that class locally
 * from the Flow XML alone: element contracts, collection/scalar shape, dotted
 * field paths in record elements, and reference forms Builder rejects. Each
 * rule was calibrated against observed Flow Builder or activation-lane errors;
 * accepted variants are covered by negative fixtures.
 */

import { child, childText, descendants, type XmlNode } from "./xml.ts";

export const FLOW_SHAPE_RULE_IDS = [
  "screen-component-contract",
  "sort-output-reference",
  "record-field-path",
  "screen-field-dot-value",
  "transform-scalar-into-collection",
  "choice-set-datatype",
  "collection-scalar-mismatch",
  "component-output-binding",
  "condition-operand-type",
  "record-page-input",
] as const;

export type FlowShapeRuleId = (typeof FLOW_SHAPE_RULE_IDS)[number];

export interface FlowShapeIssue {
  rule_id: FlowShapeRuleId;
  message: string;
  node: XmlNode;
  element?: string;
  severity?: "high" | "moderate";
}

type Report = (issue: FlowShapeIssue) => void;

/**
 * Pinned `flowruntime:datatable` input contract for generated record tables.
 * Observed: unknown names are rejected ("can't find this input attribute"),
 * `keyField` requires a complex value that generated metadata should not set, and
 * `tableData`, `columns`, `selectionMode`, and `minRowSelection` are required in
 * every selection mode.
 */
const DATATABLE_INPUTS = new Set([
  "label",
  "tableData",
  "columns",
  "selectionMode",
  "minRowSelection",
  "maxRowSelection",
  "isShowSearchBar",
  "shouldDisplayLabel",
]);
const DATATABLE_REQUIRED = ["tableData", "columns", "selectionMode", "minRowSelection"];
const DATATABLE_OUTPUTS = new Set(["selectedRows", "firstSelectedRow"]);
const STANDARD_INPUT_FIELD_TYPES = new Set([
  "InputField",
  "DropdownBox",
  "RadioButtons",
  "MultiSelectCheckboxes",
  "MultiSelectPicklist",
  "LargeTextArea",
  "PasswordField",
]);
const RECORD_PAGE_ID = "recordId";

/** Shape of a named resource or element output, when it can be proven locally. */
interface ResourceShape {
  kind: string;
  collection?: boolean;
  object?: string;
}

export function findFlowShapeIssues(root: XmlNode): FlowShapeIssue[] {
  const issues: FlowShapeIssue[] = [];
  const report: Report = (issue) => issues.push(issue);
  const shapes = indexResourceShapes(root);
  checkScreenComponents(root, shapes, report);
  checkSortOutputReferences(root, shapes, report);
  checkRecordFieldPaths(root, shapes, report);
  checkScreenFieldDotValue(root, report);
  checkTransformScalars(root, report);
  checkChoiceSetDatatype(root, report);
  checkCollectionScalarMismatch(root, shapes, report);
  checkConditionOperandTypes(root, report);
  checkRecordPageInput(root, report);
  return issues;
}

function indexResourceShapes(root: XmlNode): Map<string, ResourceShape> {
  const shapes = new Map<string, ResourceShape>();
  for (const node of root.children) {
    const name = childText(node, "name");
    if (!name) continue;
    if (node.name === "variables") {
      shapes.set(name, {
        kind: "variable",
        collection: childText(node, "isCollection") === "true",
        object: childText(node, "objectType"),
      });
    } else if (node.name === "recordLookups") {
      // Only automatic output is addressable by element name.
      if (childText(node, "storeOutputAutomatically") !== "true") continue;
      shapes.set(name, {
        kind: "recordLookups",
        collection: childText(node, "getFirstRecordOnly") !== "true",
        object: childText(node, "object"),
      });
    } else if (node.name === "collectionProcessors") {
      const type = childText(node, "collectionProcessorType");
      shapes.set(name, {
        kind: type === "SortCollectionProcessor" ? "sort" : "collectionProcessor",
        collection: type === "SortCollectionProcessor" ? undefined : true,
      });
    } else if (node.name === "transforms") {
      shapes.set(name, {
        kind: "transforms",
        collection: childText(node, "isCollection") === "true",
        object: childText(node, "objectType"),
      });
    } else if (node.name === "loops") {
      shapes.set(name, { kind: "loop", collection: false });
    } else if (node.name === "screens") {
      for (const field of node.children.filter((candidate) => candidate.name === "fields")) {
        const fieldName = childText(field, "name");
        if (!fieldName) continue;
        shapes.set(fieldName, {
          kind: childText(field, "extensionName") ?? childText(field, "fieldType") ?? "screenField",
        });
      }
    }
  }
  return shapes;
}

function head(reference: string): string {
  return reference.split(".")[0]?.replace(/\[\$EachItem\]$/u, "") ?? reference;
}

function ownerElement(node: XmlNode): XmlNode | undefined {
  let current = node.parent;
  while (current?.parent && current.parent.parent) current = current.parent;
  return current;
}

function ownerName(node: XmlNode): string | undefined {
  const owner = ownerElement(node);
  return owner ? childText(owner, "name") : undefined;
}

/** Element references plus `{!merge}` references inside text nodes. */
function allReferences(root: XmlNode): Array<{ value: string; node: XmlNode }> {
  const references: Array<{ value: string; node: XmlNode }> = [];
  for (const node of descendants(root)) {
    const text = node.text.trim();
    if (!text) continue;
    if (
      [
        "elementReference",
        "leftValueReference",
        "assignToReference",
        "collectionReference",
        "inputReference",
      ].includes(node.name)
    ) {
      references.push({ value: text, node });
    } else if (node.children.length === 0) {
      for (const match of text.matchAll(/\{!\s*([^}\s]+)\s*\}/gu)) {
        references.push({ value: match[1] ?? "", node });
      }
    }
  }
  return references;
}

function checkScreenComponents(
  root: XmlNode,
  shapes: Map<string, ResourceShape>,
  report: Report,
): void {
  for (const field of descendants(root).filter(
    (node) =>
      node.name === "fields" && childText(node, "extensionName") === "flowruntime:datatable",
  )) {
    const name = childText(field, "name") ?? "Data table";
    const typeMapping = field.children.some(
      (node) => node.name === "dataTypeMappings" && childText(node, "typeName") === "T",
    );
    if (!typeMapping) {
      report({
        rule_id: "screen-component-contract",
        message: `${name} needs a dataTypeMappings entry with typeName T set to the record object it displays.`,
        node: field,
        element: name,
      });
    }
    const inputs = field.children.filter((node) => node.name === "inputParameters");
    const inputNames = new Set(inputs.map((input) => childText(input, "name") ?? ""));
    for (const input of inputs) {
      const inputName = childText(input, "name") ?? "";
      if (!DATATABLE_INPUTS.has(inputName)) {
        report({
          rule_id: "screen-component-contract",
          message: `${name} does not support the input "${inputName}" in generated metadata. Remove it; use the field-level element (for example <isRequired>) when one exists.`,
          node: input,
          element: name,
        });
      }
    }
    for (const required of DATATABLE_REQUIRED) {
      if (!inputNames.has(required)) {
        report({
          rule_id: "screen-component-contract",
          message: `${name} is missing the required input "${required}".`,
          node: field,
          element: name,
        });
      }
    }
    const tableData = inputs.find((input) => childText(input, "name") === "tableData");
    const reference = tableData
      ? descendants(tableData)
          .find((node) => node.name === "elementReference")
          ?.text.trim()
      : undefined;
    const shape = reference && !reference.includes(".") ? shapes.get(reference) : undefined;
    if (reference && shape?.collection === false) {
      report({
        rule_id: "collection-scalar-mismatch",
        message: `${name} tableData must be a record collection; "${reference}" holds a single value.`,
        node: tableData ?? field,
        element: name,
      });
    }
  }
  checkComponentOutputs(root, shapes, report);
}

function checkComponentOutputs(
  root: XmlNode,
  shapes: Map<string, ResourceShape>,
  report: Report,
): void {
  const tables = new Map<string, XmlNode>();
  for (const field of descendants(root).filter(
    (node) =>
      node.name === "fields" && childText(node, "extensionName") === "flowruntime:datatable",
  )) {
    const name = childText(field, "name");
    if (name) tables.set(name, field);
  }
  if (!tables.size) return;
  const reported = new Set<string>();
  for (const { value, node } of allReferences(root)) {
    const name = head(value);
    const table = tables.get(name);
    if (!table || shapes.get(name)?.kind !== "flowruntime:datatable") continue;
    const attribute = value
      .slice(name.length + 1)
      .split(".")[0]
      ?.replace(/\[\$EachItem\]$/u, "");
    const key = `${name}:${attribute}`;
    if (reported.has(key)) continue;
    if (attribute && !DATATABLE_OUTPUTS.has(attribute)) {
      reported.add(key);
      report({
        rule_id: "component-output-binding",
        message: `${name} has no output named "${attribute}"; use selectedRows or firstSelectedRow.`,
        node,
        element: ownerName(node),
      });
    } else if (attribute && childText(table, "storeOutputAutomatically") !== "true") {
      reported.add(key);
      report({
        rule_id: "component-output-binding",
        message: `${name}.${attribute} is read, but ${name} does not store its outputs. Set storeOutputAutomatically to true or map outputs to variables.`,
        node,
        element: ownerName(node),
      });
    }
  }
}

function checkSortOutputReferences(
  root: XmlNode,
  shapes: Map<string, ResourceShape>,
  report: Report,
): void {
  for (const { value, node } of allReferences(root)) {
    const name = head(value);
    if (shapes.get(name)?.kind !== "sort") continue;
    // The Sort element's own input reference is its collection, not an output read.
    if (node.name === "collectionReference" && ownerName(node) === name) continue;
    report({
      rule_id: "sort-output-reference",
      message: `"${name}" is a Collection Sort, which sorts its input collection in place and has no output. Reference the sorted collection variable instead.`,
      node,
      element: ownerName(node),
    });
  }
}

function checkRecordFieldPaths(
  root: XmlNode,
  shapes: Map<string, ResourceShape>,
  report: Report,
): void {
  for (const lookup of root.children.filter((node) => node.name === "recordLookups")) {
    const name = childText(lookup, "name");
    const object = childText(lookup, "object") ?? "the queried object";
    const fields: XmlNode[] = [
      ...lookup.children.filter(
        (node) => node.name === "queriedFields" || node.name === "sortField",
      ),
      ...lookup.children
        .filter((node) => node.name === "filters")
        .map((filter) => child(filter, "field"))
        .filter((node): node is XmlNode => Boolean(node)),
    ];
    for (const field of fields) {
      if (!field.text.includes(".")) continue;
      report({
        rule_id: "record-field-path",
        message: `${name ?? "Get Records"} uses "${field.text.trim()}". Get Records accepts only fields on ${object}; query the related records separately and filter by Id.`,
        node: field,
        element: name,
      });
    }
  }
  for (const processor of root.children.filter(
    (node) =>
      node.name === "collectionProcessors" &&
      childText(node, "collectionProcessorType") === "FilterCollectionProcessor",
  )) {
    const name = childText(processor, "name");
    const item = childText(processor, "assignNextValueToReference");
    for (const condition of processor.children.filter((node) => node.name === "conditions")) {
      const left = child(condition, "leftValueReference");
      const value = left?.text.trim();
      if (!left || !value) continue;
      const segments = value.split(".");
      // item.Field is fine; item.Parent.Field crosses an object boundary.
      if (
        segments.length > 2 &&
        (segments[0] === item || shapes.get(segments[0] ?? "")?.kind === "variable")
      ) {
        // Accepted by Flow Builder and the activation lane, but the related field is
        // only populated if the source query loaded it, which Get Records cannot do.
        report({
          rule_id: "record-field-path",
          severity: "moderate",
          message: `${name ?? "Collection Filter"} compares the related field "${value}". Get Records cannot load related fields, so the value may be empty at run time; filter the parent records first and match by Id.`,
          node: left,
          element: name,
        });
      }
    }
  }
}

function checkScreenFieldDotValue(root: XmlNode, report: Report): void {
  const inputs = new Set<string>();
  for (const field of descendants(root).filter((node) => node.name === "fields")) {
    const name = childText(field, "name");
    if (name && STANDARD_INPUT_FIELD_TYPES.has(childText(field, "fieldType") ?? "")) {
      inputs.add(name);
    }
  }
  if (!inputs.size) return;
  for (const { value, node } of allReferences(root)) {
    const [name, attribute] = value.split(".");
    if (!name || !inputs.has(name) || attribute !== "value") continue;
    report({
      rule_id: "screen-field-dot-value",
      message: `Reference the screen input "${name}" directly; "${value}" is not a valid reference.`,
      node,
      // The screen field name is the stable target for the source-bound quick fix.
      element: name,
    });
  }
}

function checkTransformScalars(root: XmlNode, report: Report): void {
  for (const transform of root.children.filter(
    (node) => node.name === "transforms" && childText(node, "isCollection") === "true",
  )) {
    const name = childText(transform, "name");
    const sources = descendants(transform).filter((node) => node.name === "elementReference");
    if (!sources.some((node) => node.text.includes("[$EachItem]"))) continue;
    const actions = descendants(transform).filter(
      (node) => node.name === "transformValueActions" && childText(node, "transformType") === "Map",
    );
    for (const [index, action] of actions.entries()) {
      const source = child(action, "value");
      const reference = source ? childText(source, "elementReference") : undefined;
      if (!reference || reference.includes("[$EachItem]")) continue;
      const output = childText(action, "outputFieldApiName") ?? "the output field";
      // Observed: the platform rejects a scalar source in the first mapping. A later
      // scalar mapping is accepted and broadcast to every item at run time (proven
      // by the related-pipeline runtime fixture), so only the first position is reported.
      if (index > 0) continue;
      report({
        rule_id: "transform-scalar-into-collection",
        message: `${name ?? "Transform"} starts with the single value "${reference}" mapped into each ${output}. The first mapping of a collection Transform must use a per-item ([$EachItem]) source; move this mapping after a per-item mapping.`,
        node: action,
        element: name,
      });
    }
  }
}

function checkChoiceSetDatatype(root: XmlNode, report: Report): void {
  for (const set of root.children.filter((node) => node.name === "dynamicChoiceSets")) {
    if (!childText(set, "picklistField")) continue;
    const dataType = childText(set, "dataType");
    if (dataType === "Picklist" || dataType === "Multipicklist") continue;
    const name = childText(set, "name");
    report({
      rule_id: "choice-set-datatype",
      message: `${name ?? "Choice set"} reads a picklist field, so its dataType must be Picklist (or Multipicklist), not ${dataType ?? "unset"}.`,
      node: child(set, "dataType") ?? set,
      element: name,
    });
  }
}

function checkCollectionScalarMismatch(
  root: XmlNode,
  shapes: Map<string, ResourceShape>,
  report: Report,
): void {
  // Field access on a multi-record result (Get_X.Field) is invalid.
  const reported = new Set<string>();
  for (const { value, node } of allReferences(root)) {
    const [name, field] = value.split(".");
    if (!name || !field || name.includes("[")) continue;
    const shape = shapes.get(name);
    if (!shape?.collection || !["recordLookups", "variable", "transforms"].includes(shape.kind)) {
      continue;
    }
    const key = `${node.line}:${value}`;
    if (reported.has(key)) continue;
    reported.add(key);
    report({
      rule_id: "collection-scalar-mismatch",
      message: `"${name}" is a record collection, so "${value}" is not a valid reference. Loop over it, or get only the first record.`,
      node,
      element: ownerName(node),
    });
  }
  for (const loop of root.children.filter((node) => node.name === "loops")) {
    const collection = child(loop, "collectionReference");
    const reference = collection?.text.trim();
    if (!collection || !reference || reference.includes(".")) continue;
    if (shapes.get(reference)?.collection !== false) continue;
    report({
      rule_id: "collection-scalar-mismatch",
      message: `${childText(loop, "name") ?? "Loop"} iterates "${reference}", which holds a single value. Loop over a collection.`,
      node: collection,
      element: childText(loop, "name"),
    });
  }
}

function checkConditionOperandTypes(root: XmlNode, report: Report): void {
  for (const condition of descendants(root).filter(
    (node) => node.name === "conditions" && childText(node, "operator") === "IsNull",
  )) {
    const value = child(condition, "rightValue");
    if (!value) continue;
    if (child(value, "booleanValue") || child(value, "elementReference")) continue;
    report({
      rule_id: "condition-operand-type",
      message: "IsNull compares to a Boolean; use <booleanValue>true</booleanValue> or false.",
      node: value,
      element: ownerName(condition),
    });
  }
}

function checkRecordPageInput(root: XmlNode, report: Report): void {
  if (childText(root, "processType") !== "Flow") return;
  const variable = root.children.find(
    (node) => node.name === "variables" && childText(node, "name") === RECORD_PAGE_ID,
  );
  if (!variable) return;
  const isInput = childText(variable, "isInput") === "true";
  const isCollection = childText(variable, "isCollection") === "true";
  const dataType = childText(variable, "dataType");
  if (isInput && !isCollection && (dataType === "String" || dataType === "SObject")) return;
  report({
    rule_id: "record-page-input",
    severity: "moderate",
    message:
      "A record page passes the record Id only to a single, input-enabled recordId variable (Text or a record). Mark recordId as an input and keep it a single value.",
    node: variable,
    element: RECORD_PAGE_ID,
  });
}
