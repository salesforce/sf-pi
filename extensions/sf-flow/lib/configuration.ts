/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic Flow metadata configuration checks that need no org schema. */

import { child, childText, descendants, type XmlNode } from "./xml.ts";

export const FLOW_CONFIGURATION_RULE_IDS = [
  "conflicting-create-output-storage",
  "invalid-async-path-configuration",
  "missing-async-path-entry-guard",
  "invalid-start-filter-logic",
  "invalid-record-filter",
] as const;

export interface FlowConfigurationIssue {
  rule_id: (typeof FLOW_CONFIGURATION_RULE_IDS)[number];
  message: string;
  node: XmlNode;
  element?: string;
}

const VALID_RECORD_FILTER_OPERATORS = new Set([
  "EqualTo",
  "NotEqualTo",
  "GreaterThan",
  "LessThan",
  "GreaterThanOrEqualTo",
  "LessThanOrEqualTo",
  "StartsWith",
  "EndsWith",
  "Contains",
  "IsNull",
]);

export function findFlowConfigurationIssues(root: XmlNode): FlowConfigurationIssue[] {
  const issues: FlowConfigurationIssue[] = [];
  const report = (
    rule_id: FlowConfigurationIssue["rule_id"],
    message: string,
    node: XmlNode,
    element?: string,
  ) => issues.push({ rule_id, message, node, element });

  checkCreateOutputStorage(root, report);
  checkAsyncPathConfiguration(root, report);
  checkAsyncPathEntryGuard(root, report);
  checkStartFilterLogic(root, report);
  checkRecordFilters(root, report);
  return issues;
}

type Report = (
  rule_id: FlowConfigurationIssue["rule_id"],
  message: string,
  node: XmlNode,
  element?: string,
) => void;

function checkCreateOutputStorage(root: XmlNode, report: Report): void {
  for (const create of root.children.filter((node) => node.name === "recordCreates")) {
    if (
      !childText(create, "assignRecordIdToReference") ||
      childText(create, "storeOutputAutomatically") !== "true"
    ) {
      continue;
    }
    const name = childText(create, "name");
    report(
      "conflicting-create-output-storage",
      `${name ?? "Create Records"} can't assign its created record ID to a variable and store output automatically at the same time. Choose one output contract.`,
      create,
      name,
    );
  }
}

function checkAsyncPathConfiguration(root: XmlNode, report: Report): void {
  const start = child(root, "start");
  if (!start) return;
  const incompatibleFields = [
    "label",
    "timeSource",
    "offsetUnit",
    "offsetNumber",
    "recordField",
    "maxBatchSize",
  ];
  for (const path of asyncPaths(start)) {
    const name = childText(path, "name");
    if (childText(start, "triggerType") !== "RecordAfterSave") {
      report(
        "invalid-async-path-configuration",
        `${name ?? "Asynchronous path"} requires RecordAfterSave trigger timing.`,
        path,
        name,
      );
    }
    const present = incompatibleFields.filter((field) => child(path, field));
    if (present.length) {
      report(
        "invalid-async-path-configuration",
        `${name ?? "Asynchronous path"} can't set ${present.join(", ")} when pathType is AsyncAfterCommit.`,
        path,
        name,
      );
    }
  }
}

function checkAsyncPathEntryGuard(root: XmlNode, report: Report): void {
  const start = child(root, "start");
  if (
    !start ||
    childText(start, "triggerType") !== "RecordAfterSave" ||
    !["Update", "CreateAndUpdate"].includes(childText(start, "recordTriggerType") ?? "")
  ) {
    return;
  }
  const requiresTransition = childText(start, "doesRequireRecordChangedToMeetCriteria") === "true";
  const hasIsChanged = descendants(start).some(
    (node) => node.name === "operator" && node.text.trim() === "IsChanged",
  );
  if (requiresTransition || hasIsChanged) return;
  for (const path of asyncPaths(start)) {
    const name = childText(path, "name");
    report(
      "missing-async-path-entry-guard",
      `${name ?? "Asynchronous path"} requires changed-to-meet entry criteria or an IsChanged condition for an update trigger.`,
      path,
      name,
    );
  }
}

function asyncPaths(start: XmlNode): XmlNode[] {
  return start.children.filter(
    (node) => node.name === "scheduledPaths" && childText(node, "pathType") === "AsyncAfterCommit",
  );
}

function checkStartFilterLogic(root: XmlNode, report: Report): void {
  const start = child(root, "start");
  if (!start) return;
  const logicNode = child(start, "filterLogic");
  const logic = logicNode?.text.trim();
  if (!logic || ["and", "or"].includes(logic.toLowerCase())) return;
  const indexes = parseFilterLogic(logic);
  if (!indexes) {
    report(
      "invalid-start-filter-logic",
      `Start filterLogic syntax is invalid: "${logic}". Use numbered conditions joined by AND or OR with balanced parentheses.`,
      logicNode,
    );
    return;
  }
  const conditionCount = start.children.filter((node) => node.name === "filters").length;
  const invalidIndexes = [
    ...new Set(indexes.filter((index) => index < 1 || index > conditionCount)),
  ];
  if (!invalidIndexes.length) return;
  report(
    "invalid-start-filter-logic",
    `Start filterLogic references condition ${invalidIndexes.join(", ")}, but only ${conditionCount} filter condition${conditionCount === 1 ? " exists" : "s exist"}.`,
    logicNode,
  );
}

function parseFilterLogic(source: string): number[] | undefined {
  const tokens: string[] = [];
  for (let offset = 0; offset < source.length;) {
    const rest = source.slice(offset);
    const whitespace = rest.match(/^\s+/u)?.[0];
    if (whitespace) {
      offset += whitespace.length;
      continue;
    }
    const number = rest.match(/^\d+/u)?.[0];
    if (number) {
      tokens.push(number);
      offset += number.length;
      continue;
    }
    const operator = rest.match(/^(?:AND|OR)\b/iu)?.[0];
    if (operator) {
      tokens.push(operator.toUpperCase());
      offset += operator.length;
      continue;
    }
    if (rest[0] === "(" || rest[0] === ")") {
      tokens.push(rest[0]);
      offset += 1;
      continue;
    }
    return undefined;
  }
  let cursor = 0;
  const indexes: number[] = [];
  const factor = (): boolean => {
    const token = tokens[cursor];
    if (/^\d+$/u.test(token ?? "")) {
      indexes.push(Number(token));
      cursor += 1;
      return true;
    }
    if (token !== "(") return false;
    cursor += 1;
    if (!expression() || tokens[cursor] !== ")") return false;
    cursor += 1;
    return true;
  };
  const conjunction = (): boolean => {
    if (!factor()) return false;
    while (tokens[cursor] === "AND") {
      cursor += 1;
      if (!factor()) return false;
    }
    return true;
  };
  const expression = (): boolean => {
    if (!conjunction()) return false;
    while (tokens[cursor] === "OR") {
      cursor += 1;
      if (!conjunction()) return false;
    }
    return true;
  };
  return tokens.length && expression() && cursor === tokens.length ? indexes : undefined;
}

function checkRecordFilters(root: XmlNode, report: Report): void {
  const localTypes = new Map(
    root.children
      .map((node) => [childText(node, "name"), childText(node, "dataType")] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1])),
  );
  for (const filter of descendants(root).filter((node) => node.name === "filters")) {
    if (!childText(filter, "field")) {
      report(
        "invalid-record-filter",
        "Record filter is missing its required field.",
        filter,
        ownerName(filter),
      );
      continue;
    }
    const operator = childText(filter, "operator");
    if (!operator || !VALID_RECORD_FILTER_OPERATORS.has(operator)) {
      report(
        "invalid-record-filter",
        operator
          ? `Record filter operator "${operator}" isn't supported by FlowRecordFilter.`
          : "Record filter is missing its required operator.",
        child(filter, "operator") ?? filter,
        ownerName(filter),
      );
      continue;
    }
    const value = child(filter, "value");
    const valueFields = value?.children.filter((node) =>
      [
        "elementReference",
        "stringValue",
        "numberValue",
        "booleanValue",
        "dateValue",
        "dateTimeValue",
      ].includes(node.name),
    );
    if (!value || valueFields?.length !== 1) {
      report(
        "invalid-record-filter",
        "Record filter requires exactly one literal or elementReference value.",
        value ?? filter,
        ownerName(filter),
      );
      continue;
    }
    const valueField = valueFields[0];
    const valueType = recordFilterValueType(valueField, localTypes);
    if (operator === "IsNull" && valueType && valueType !== "Boolean") {
      report(
        "invalid-record-filter",
        "IsNull requires a booleanValue literal or a Boolean elementReference.",
        valueField,
        ownerName(filter),
      );
    }
    if (
      ["StartsWith", "EndsWith", "Contains"].includes(operator) &&
      valueType &&
      valueType !== "String"
    ) {
      report(
        "invalid-record-filter",
        `${operator} requires a stringValue literal or a String elementReference.`,
        valueField,
        ownerName(filter),
      );
    }
    if (
      ["GreaterThan", "GreaterThanOrEqualTo", "LessThan", "LessThanOrEqualTo"].includes(operator) &&
      valueType === "Boolean"
    ) {
      report(
        "invalid-record-filter",
        `${operator} can't compare ${valueField.name === "booleanValue" ? "a booleanValue literal" : "a Boolean elementReference"} because Boolean values aren't ordered.`,
        valueField,
        ownerName(filter),
      );
    }
  }
}

function recordFilterValueType(
  value: XmlNode,
  localTypes: ReadonlyMap<string, string>,
): string | undefined {
  const literalTypes: Record<string, string> = {
    stringValue: "String",
    numberValue: "Number",
    booleanValue: "Boolean",
    dateValue: "Date",
    dateTimeValue: "DateTime",
  };
  if (literalTypes[value.name]) return literalTypes[value.name];
  if (value.name !== "elementReference") return undefined;
  const reference = value.text
    .trim()
    .split(".")[0]
    .replace(/\[\$EachItem\]$/u, "");
  return localTypes.get(reference);
}

function ownerName(node: XmlNode): string | undefined {
  let current = node.parent;
  while (current?.parent) {
    const name = childText(current, "name");
    if (name && current.parent.name === "Flow") return name;
    current = current.parent;
  }
  return undefined;
}
