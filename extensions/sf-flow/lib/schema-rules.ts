/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Org-grounded Flow schema rules.
 *
 * Resolves the objects and fields a Flow reads and writes against the target
 * org's sObject describe, through the shared schema catalog. Severity follows
 * observed Flow Builder and activation-lane verdicts (see QUALITY_RULES.md):
 * references the platform rejects (unknown objects, fields, subflows, subflow
 * inputs) are High; shapes the platform accepts but that misbehave at run time
 * (non-filterable or non-sortable query fields, read-only writes, picklist
 * literals outside the value set, unknown data table columns, missing required
 * create fields) are Moderate.
 */

import {
  activePicklistValues,
  findSchemaField,
  type SchemaCatalog,
  type SchemaFieldDescribe,
  type SchemaObjectDescribe,
} from "../../../lib/common/sf-schema/index.ts";
import type { FlowFinding } from "./types.ts";
import { child, childText, descendants, parseFlowXml, type XmlNode } from "./xml.ts";

export const FLOW_SCHEMA_RULE_IDS = [
  "unknown-object",
  "unknown-field",
  "field-capability",
  "picklist-literal",
  "required-create-fields",
  "subflow-contract",
] as const;

export type FlowSchemaRuleId = (typeof FLOW_SCHEMA_RULE_IDS)[number];

/** Read-only sources for subflow contracts; kept narrow so tests can stub it. */
export interface FlowSubflowContract {
  exists: boolean;
  inputs: Array<{ name: string; data_type?: string; is_collection: boolean }>;
}

export interface FlowSchemaContext {
  catalog: SchemaCatalog;
  subflow?: (apiName: string) => Promise<FlowSubflowContract>;
  /** Hard cap on distinct objects described for one Flow. */
  maxObjects?: number;
}

export interface FlowSchemaResult {
  findings: FlowFinding[];
  objects: string[];
  unresolved: string[];
  truncated: boolean;
}

const DEFAULT_MAX_OBJECTS = 25;
const SYSTEM_FIELDS = new Set(["Id"]);

interface ResourceType {
  object?: string;
  collection: boolean;
}

export async function runFlowSchemaRules(
  source: string,
  context: FlowSchemaContext,
): Promise<FlowSchemaResult> {
  const findings: FlowFinding[] = [];
  const parsed = parseFlowXml(source);
  const root = parsed.root;
  if (!root || root.name !== "Flow")
    return { findings, objects: [], unresolved: [], truncated: false };

  const maxObjects = context.maxObjects ?? DEFAULT_MAX_OBJECTS;
  const described = new Map<string, SchemaObjectDescribe | undefined>();
  let truncated = false;
  const describe = async (name: string | undefined) => {
    if (!name) return undefined;
    const key = name.toLowerCase();
    if (described.has(key)) return described.get(key);
    if (described.size >= maxObjects) {
      truncated = true;
      return undefined;
    }
    const value = await context.catalog.object(name);
    described.set(key, value);
    return value;
  };
  const report = (
    rule_id: FlowSchemaRuleId,
    severity: FlowFinding["severity"],
    message: string,
    node: XmlNode,
    element?: string,
  ) => findings.push({ rule_id, severity, message, line: node.line, column: node.column, element });

  const types = indexResourceTypes(root);

  // Objects named directly by elements and resources.
  for (const node of root.children) {
    const objectNode =
      node.name === "recordLookups" ||
      node.name === "recordCreates" ||
      node.name === "recordUpdates" ||
      node.name === "recordDeletes"
        ? child(node, "object")
        : node.name === "variables" || node.name === "transforms"
          ? child(node, "objectType")
          : node.name === "dynamicChoiceSets"
            ? (child(node, "picklistObject") ?? child(node, "object"))
            : undefined;
    const name = objectNode?.text.trim();
    if (!objectNode || !name) continue;
    if ((await describe(name)) === undefined && !truncated) {
      report(
        "unknown-object",
        "high",
        `${childText(node, "name") ?? node.name} references the object "${name}", which does not exist in the target org.`,
        objectNode,
        childText(node, "name"),
      );
    }
  }

  await checkRecordLookups(root, describe, report);
  await checkRecordWrites(root, types, describe, report);
  await checkChoiceSets(root, describe, report);
  await checkFieldReferences(root, types, describe, report);
  await checkDataTableColumns(root, describe, report);
  await checkPicklistLiterals(root, types, describe, report);
  if (context.subflow) await checkSubflows(root, context.subflow, report);

  const objects = [...described.entries()].filter(([, value]) => value).map(([key]) => key);
  const unresolved = [...described.entries()].filter(([, value]) => !value).map(([key]) => key);
  return { findings: dedupe(findings), objects, unresolved, truncated };
}

type Describe = (name: string | undefined) => Promise<SchemaObjectDescribe | undefined>;
type Report = (
  rule_id: FlowSchemaRuleId,
  severity: FlowFinding["severity"],
  message: string,
  node: XmlNode,
  element?: string,
) => void;

function indexResourceTypes(root: XmlNode): Map<string, ResourceType> {
  const types = new Map<string, ResourceType>();
  for (const node of root.children) {
    const name = childText(node, "name");
    if (!name) continue;
    if (node.name === "variables" && childText(node, "dataType") === "SObject") {
      types.set(name, {
        object: childText(node, "objectType"),
        collection: childText(node, "isCollection") === "true",
      });
    } else if (
      node.name === "recordLookups" &&
      childText(node, "storeOutputAutomatically") === "true"
    ) {
      types.set(name, {
        object: childText(node, "object"),
        collection: childText(node, "getFirstRecordOnly") !== "true",
      });
    } else if (node.name === "transforms" && childText(node, "dataType") === "SObject") {
      types.set(name, {
        object: childText(node, "objectType"),
        collection: childText(node, "isCollection") === "true",
      });
    }
  }
  // Loop variables take the element type of their collection.
  for (const loop of root.children.filter((node) => node.name === "loops")) {
    const name = childText(loop, "name");
    const source = types.get(childText(loop, "collectionReference") ?? "");
    if (name && source?.object) types.set(name, { object: source.object, collection: false });
  }
  for (const processor of root.children.filter((node) => node.name === "collectionProcessors")) {
    const name = childText(processor, "name");
    const source = types.get(childText(processor, "collectionReference") ?? "");
    if (
      name &&
      source?.object &&
      childText(processor, "collectionProcessorType") !== "SortCollectionProcessor"
    ) {
      types.set(name, { object: source.object, collection: true });
    }
  }
  return types;
}

async function checkRecordLookups(
  root: XmlNode,
  describe: Describe,
  report: Report,
): Promise<void> {
  for (const lookup of root.children.filter((node) => node.name === "recordLookups")) {
    const name = childText(lookup, "name");
    const objectName = childText(lookup, "object");
    const object = await describe(objectName);
    if (!object) continue;
    const check = (node: XmlNode, capability?: "filterable" | "sortable") => {
      const fieldName = node.text.trim();
      // Dotted paths are owned by the local record-field-path rule.
      if (!fieldName || fieldName.includes(".")) return;
      const field = findSchemaField(object, fieldName);
      if (!field) {
        report(
          "unknown-field",
          "high",
          `${name ?? "Get Records"} uses "${fieldName}", which is not a field on ${object.name}.`,
          node,
          name,
        );
        return;
      }
      if (capability && field[capability] === false) {
        // Observed: Flow Builder and the activation lane accept this; the query fails at run time.
        report(
          "field-capability",
          "moderate",
          `${name ?? "Get Records"} ${capability === "filterable" ? "filters" : "sorts"} by ${object.name}.${field.name}, which is not ${capability}; the query fails when the Flow runs.`,
          node,
          name,
        );
      }
    };
    for (const node of lookup.children.filter((candidate) => candidate.name === "queriedFields"))
      check(node);
    const sort = child(lookup, "sortField");
    if (sort) check(sort, "sortable");
    for (const filter of lookup.children.filter((candidate) => candidate.name === "filters")) {
      const field = child(filter, "field");
      if (field) check(field, "filterable");
    }
    for (const assignment of lookup.children.filter(
      (candidate) => candidate.name === "outputAssignments",
    )) {
      const field = child(assignment, "field");
      if (field) check(field);
    }
  }
}

async function checkRecordWrites(
  root: XmlNode,
  types: Map<string, ResourceType>,
  describe: Describe,
  report: Report,
): Promise<void> {
  for (const element of root.children.filter(
    (node) => node.name === "recordCreates" || node.name === "recordUpdates",
  )) {
    const name = childText(element, "name");
    const objectName = childText(element, "object");
    if (!objectName) continue;
    const object = await describe(objectName);
    if (!object) continue;
    const capability = element.name === "recordCreates" ? "createable" : "updateable";
    for (const assignment of element.children.filter((node) => node.name === "inputAssignments")) {
      const fieldNode = child(assignment, "field");
      const fieldName = fieldNode?.text.trim();
      if (!fieldNode || !fieldName) continue;
      const field = findSchemaField(object, fieldName);
      if (!field) {
        report(
          "unknown-field",
          "high",
          `${name} writes "${fieldName}", which is not a field on ${object.name}.`,
          fieldNode,
          name,
        );
      } else if (field[capability] === false) {
        report(
          "field-capability",
          "moderate",
          `${name} writes ${object.name}.${field.name}, which is not ${capability}.`,
          fieldNode,
          name,
        );
      }
    }
    for (const filter of element.children.filter((node) => node.name === "filters")) {
      const fieldNode = child(filter, "field");
      const fieldName = fieldNode?.text.trim();
      if (
        fieldNode &&
        fieldName &&
        !fieldName.includes(".") &&
        !findSchemaField(object, fieldName)
      ) {
        report(
          "unknown-field",
          "high",
          `${name} filters by "${fieldName}", which is not a field on ${object.name}.`,
          fieldNode,
          name,
        );
      }
    }
    if (element.name === "recordCreates") {
      const assigned = new Set(
        element.children
          .filter((node) => node.name === "inputAssignments")
          .map((node) => childText(node, "field")?.toLowerCase())
          .filter(Boolean),
      );
      const missing = requiredCreateFields(object).filter(
        (field) => !assigned.has(field.name.toLowerCase()),
      );
      if (missing.length) {
        report(
          "required-create-fields",
          "moderate",
          `${name} creates ${object.name} without required field${missing.length === 1 ? "" : "s"} ${missing.map((field) => field.name).join(", ")}.`,
          element,
          name,
        );
      }
    }
  }
  // Collection Transforms build records that a later Create/Update writes.
  for (const transform of root.children.filter(
    (node) => node.name === "transforms" && childText(node, "dataType") === "SObject",
  )) {
    const name = childText(transform, "name");
    const object = await describe(childText(transform, "objectType"));
    if (!object) continue;
    for (const output of descendants(transform).filter(
      (node) => node.name === "outputFieldApiName",
    )) {
      const fieldName = output.text.trim();
      if (!fieldName || fieldName.includes(".") || fieldName.includes("[")) continue;
      const field = findSchemaField(object, fieldName);
      if (!field) {
        report(
          "unknown-field",
          "high",
          `${name} maps "${fieldName}", which is not a field on ${object.name}.`,
          output,
          name,
        );
      } else if (
        field.createable === false &&
        field.updateable === false &&
        !SYSTEM_FIELDS.has(field.name)
      ) {
        report(
          "field-capability",
          "moderate",
          `${name} maps ${object.name}.${field.name}, which is read-only; the value is discarded when the record is saved.`,
          output,
          name,
        );
      }
    }
  }
  // Collections written by Create Records: required fields set anywhere upstream.
  for (const create of root.children.filter(
    (node) => node.name === "recordCreates" && !childText(node, "object"),
  )) {
    const name = childText(create, "name");
    const input = childText(create, "inputReference");
    const type = input ? types.get(input) : undefined;
    const object = await describe(type?.object);
    if (!object || !input) continue;
    const set = fieldsSetOnType(root, types, object.name);
    const missing = requiredCreateFields(object).filter(
      (field) => !set.has(field.name.toLowerCase()),
    );
    if (missing.length) {
      report(
        "required-create-fields",
        "moderate",
        `${name} creates ${object.name} records from ${input}, but no element sets required field${missing.length === 1 ? "" : "s"} ${missing.map((field) => field.name).join(", ")}.`,
        create,
        name,
      );
    }
  }
}

function requiredCreateFields(object: SchemaObjectDescribe): SchemaFieldDescribe[] {
  return object.fields.filter(
    (field) =>
      field.createable === true &&
      field.nillable === false &&
      field.defaultedOnCreate !== true &&
      field.type !== "boolean",
  );
}

/** Field names assigned on any resource of the given object type (Transforms, Assignments). */
function fieldsSetOnType(
  root: XmlNode,
  types: Map<string, ResourceType>,
  objectName: string,
): Set<string> {
  const set = new Set<string>();
  const matches = (resource?: string) =>
    resource !== undefined &&
    types.get(resource)?.object?.toLowerCase() === objectName.toLowerCase();
  for (const transform of root.children.filter((node) => node.name === "transforms")) {
    if (childText(transform, "objectType")?.toLowerCase() !== objectName.toLowerCase()) continue;
    for (const output of descendants(transform).filter(
      (node) => node.name === "outputFieldApiName",
    )) {
      set.add(output.text.trim().toLowerCase());
    }
  }
  for (const item of descendants(root).filter((node) => node.name === "assignToReference")) {
    const [resource, field] = item.text.trim().split(".");
    if (field && matches(resource)) set.add(field.toLowerCase());
  }
  return set;
}

async function checkChoiceSets(root: XmlNode, describe: Describe, report: Report): Promise<void> {
  for (const set of root.children.filter((node) => node.name === "dynamicChoiceSets")) {
    const name = childText(set, "name");
    const picklistField = child(set, "picklistField");
    if (!picklistField) continue;
    const object = await describe(childText(set, "picklistObject"));
    if (!object) continue;
    const field = findSchemaField(object, picklistField.text.trim());
    if (!field) {
      report(
        "unknown-field",
        "high",
        `${name} reads "${picklistField.text.trim()}", which is not a field on ${object.name}.`,
        picklistField,
        name,
      );
      continue;
    }
    if (!/picklist/i.test(field.type ?? "")) {
      report(
        "unknown-field",
        "high",
        `${name} reads ${object.name}.${field.name}, which is not a picklist.`,
        picklistField,
        name,
      );
      continue;
    }
    const values = activePicklistValues(field).filter((value) => value.toLowerCase() !== "none");
    if (!values.length) {
      report(
        "picklist-literal",
        "moderate",
        `${object.name}.${field.name} has no usable active picklist values in the target org, so ${name} offers no real choices.`,
        picklistField,
        name,
      );
    }
  }
}

/** Resolve `Resource.Field` references (Decisions, Assignments, merge fields, values). */
async function checkFieldReferences(
  root: XmlNode,
  types: Map<string, ResourceType>,
  describe: Describe,
  report: Report,
): Promise<void> {
  const seen = new Set<string>();
  for (const node of descendants(root)) {
    const text = node.text.trim();
    if (!text) continue;
    const references: string[] = [];
    if (["elementReference", "leftValueReference", "assignToReference"].includes(node.name)) {
      references.push(text);
    } else if (node.children.length === 0) {
      for (const match of text.matchAll(/\{!\s*([^}\s]+)\s*\}/gu)) references.push(match[1] ?? "");
    }
    for (const reference of references) {
      const segments = reference.split(".");
      const head = segments[0]?.replace(/\[\$EachItem\]$/u, "");
      const fieldName = segments[1];
      const type = head ? types.get(head) : undefined;
      // Collections are owned by collection-scalar-mismatch; only check one level.
      if (!type?.object || !fieldName || (type.collection && !segments[0]?.includes("[$EachItem]")))
        continue;
      const object = await describe(type.object);
      if (!object) continue;
      const field = findSchemaField(object, fieldName);
      const key = `${node.line}:${reference}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!field) {
        // Relationship names (Account.Name) are valid traversals, not fields.
        const relationship = object.fields.some(
          (candidate) => candidate.relationshipName?.toLowerCase() === fieldName.toLowerCase(),
        );
        if (relationship && segments.length > 2) continue;
        report(
          "unknown-field",
          "high",
          `"${reference}" reads "${fieldName}", which is not a field on ${object.name}.`,
          node,
          ownerName(node),
        );
      } else if (
        node.name === "assignToReference" &&
        field.createable === false &&
        field.updateable === false &&
        !SYSTEM_FIELDS.has(field.name)
      ) {
        report(
          "field-capability",
          "moderate",
          `"${reference}" assigns ${object.name}.${field.name}, which is read-only.`,
          node,
          ownerName(node),
        );
      }
    }
  }
}

async function checkDataTableColumns(
  root: XmlNode,
  describe: Describe,
  report: Report,
): Promise<void> {
  for (const field of descendants(root).filter(
    (node) =>
      node.name === "fields" && childText(node, "extensionName") === "flowruntime:datatable",
  )) {
    const name = childText(field, "name");
    const mapping = field.children.find(
      (node) => node.name === "dataTypeMappings" && childText(node, "typeName") === "T",
    );
    const object = await describe(mapping ? childText(mapping, "typeValue") : undefined);
    if (!object) continue;
    const columns = field.children.find(
      (node) => node.name === "inputParameters" && childText(node, "name") === "columns",
    );
    const raw = columns
      ? descendants(columns).find((node) => node.name === "stringValue")?.text
      : undefined;
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      report(
        "unknown-field",
        "high",
        `${name} columns are not valid JSON.`,
        columns ?? field,
        name,
      );
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const column of parsed) {
      const apiName = (column as { apiName?: unknown })?.apiName;
      if (typeof apiName !== "string" || findSchemaField(object, apiName)) continue;
      report(
        "unknown-field",
        "moderate",
        `${name} has a column for "${apiName}", which is not a field on ${object.name}; the column renders empty.`,
        columns ?? field,
        name,
      );
    }
  }
}

async function checkPicklistLiterals(
  root: XmlNode,
  types: Map<string, ResourceType>,
  describe: Describe,
  report: Report,
): Promise<void> {
  const check = async (
    object: SchemaObjectDescribe | undefined,
    fieldName: string | undefined,
    literal: XmlNode,
    element?: string,
  ) => {
    if (!object || !fieldName) return;
    const field = findSchemaField(object, fieldName);
    if (!field || field.type !== "picklist") return;
    const values = activePicklistValues(field);
    const value = literal.text.trim();
    if (!values.length || values.includes(value)) return;
    report(
      "picklist-literal",
      "moderate",
      `"${value}" is not an active value of ${object.name}.${field.name} in the target org, so this comparison never matches.`,
      literal,
      element,
    );
  };
  for (const lookup of root.children.filter((node) =>
    ["recordLookups", "recordUpdates", "recordDeletes"].includes(node.name),
  )) {
    const object = await describe(childText(lookup, "object"));
    for (const filter of lookup.children.filter((node) => node.name === "filters")) {
      const value = child(filter, "value");
      const literal = value ? child(value, "stringValue") : undefined;
      if (literal)
        await check(object, childText(filter, "field"), literal, childText(lookup, "name"));
    }
  }
  for (const condition of descendants(root).filter((node) => node.name === "conditions")) {
    const left = childText(condition, "leftValueReference");
    const right = child(condition, "rightValue");
    const literal = right ? child(right, "stringValue") : undefined;
    if (!left || !literal) continue;
    const [head, fieldName] = left.split(".");
    const type = types.get(head ?? "");
    if (!type?.object || !fieldName) continue;
    await check(await describe(type.object), fieldName, literal, ownerName(condition));
  }
}

async function checkSubflows(
  root: XmlNode,
  contract: NonNullable<FlowSchemaContext["subflow"]>,
  report: Report,
): Promise<void> {
  for (const subflow of root.children.filter((node) => node.name === "subflows")) {
    const name = childText(subflow, "name");
    const flowNameNode = child(subflow, "flowName");
    const flowName = flowNameNode?.text.trim();
    if (!flowNameNode || !flowName) continue;
    const found = await contract(flowName);
    if (!found.exists) {
      report(
        "subflow-contract",
        "high",
        `${name} calls the Flow "${flowName}", which does not exist in the target org.`,
        flowNameNode,
        name,
      );
      continue;
    }
    const inputs = new Map(found.inputs.map((input) => [input.name.toLowerCase(), input]));
    for (const assignment of subflow.children.filter((node) => node.name === "inputAssignments")) {
      const inputName = childText(assignment, "name");
      if (inputName && !inputs.has(inputName.toLowerCase())) {
        report(
          "subflow-contract",
          "high",
          `${name} passes "${inputName}", which is not an input variable of ${flowName}. Available inputs: ${found.inputs.map((input) => input.name).join(", ") || "none"}.`,
          assignment,
          name,
        );
      }
    }
  }
}

function ownerName(node: XmlNode): string | undefined {
  let current = node.parent;
  while (current?.parent && current.parent.parent) current = current.parent;
  return current ? childText(current, "name") : undefined;
}

function dedupe(findings: FlowFinding[]): FlowFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.rule_id}:${finding.line}:${finding.column}:${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
