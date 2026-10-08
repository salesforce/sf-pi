/* SPDX-License-Identifier: Apache-2.0 */
/** Recursive field, relationship, TYPEOF, and function validation for SOQL shapes. */

import type { SoqlConnection as Connection } from "./api.ts";
import { finding } from "./digest.ts";
import { loadSchemaDescription } from "./resolver.ts";
import type {
  SfSoqlSessionState,
  SObjectDescribe,
  SObjectFieldDescribe,
  SoqlApiMode,
  SoqlFinding,
  SoqlFunctionField,
  SoqlQueryShape,
  SoqlSemiJoinShape,
  SoqlSubqueryShape,
  SoqlTypeOfClause,
} from "./types.ts";

export async function validateSchemaShape(
  conn: Connection,
  describe: SObjectDescribe,
  shape: SoqlQueryShape,
  api: SoqlApiMode,
  state?: SfSoqlSessionState,
): Promise<SoqlFinding[]> {
  return [
    ...(await validateFields(conn, describe, shape, api, state)),
    ...(await validateFieldCapabilities(conn, describe, shape, api, state)),
  ];
}

async function validateFields(
  conn: Connection,
  describe: SObjectDescribe,
  shape: SoqlQueryShape,
  api: SoqlApiMode,
  state?: SfSoqlSessionState,
): Promise<SoqlFinding[]> {
  const findings: SoqlFinding[] = [];
  const fieldMap = new Map(describe.fields.map((field) => [field.name.toLowerCase(), field]));
  for (const field of shape.fields ?? []) {
    if (isExpression(field)) continue;
    if (!field.includes(".")) {
      const direct = fieldMap.get(field.toLowerCase());
      if (!direct)
        findings.push(
          finding("error", "❌", "Field", `${field} does not exist on ${describe.name}.`),
        );
      continue;
    }
    const [relationship, ...tail] = field.split(".");
    const refField = describe.fields.find(
      (candidate) => candidate.relationshipName?.toLowerCase() === relationship.toLowerCase(),
    );
    if (!refField) {
      findings.push(
        finding(
          "error",
          "❌",
          "Relationship",
          `${relationship} is not a parent relationship on ${describe.name}.`,
        ),
      );
      continue;
    }
    const parentObjects = refField.referenceTo ?? [];
    if (!parentObjects.length || !tail.length) continue;
    const tailPath = tail.join(".");
    if (parentObjects.length > 1) {
      const nameDescribe = (await loadSchemaDescription(conn, "Name", api, state)).describe;
      const resolved = await resolveField(conn, nameDescribe, tailPath, api, state);
      if (!resolved) {
        findings.push(
          finding(
            "error",
            "❌",
            "Polymorphic Field",
            `${field} does not resolve on Name; use TYPEOF for type-specific fields.`,
          ),
        );
      } else {
        findings.push(
          finding(
            "info",
            "🧬",
            "Polymorphic",
            `${field} is valid through the Name polymorphic contract.`,
          ),
        );
      }
      continue;
    }
    const parentDescribe = (await loadSchemaDescription(conn, parentObjects[0], api, state))
      .describe;
    const resolved = await resolveField(conn, parentDescribe, tailPath, api, state);
    if (!resolved) {
      findings.push(
        finding("error", "❌", "Field", `${field} does not resolve on ${parentObjects[0]}.`),
      );
    }
  }

  findings.push(
    ...(await validateTypeOfClauses(conn, describe, shape.type_of_clauses ?? [], api, state)),
  );

  for (const subquery of shape.subqueries ?? []) {
    const rel = (describe.childRelationships ?? []).find(
      (candidate) =>
        candidate.relationshipName?.toLowerCase() === subquery.relationship.toLowerCase(),
    );
    if (!rel?.childSObject) {
      findings.push(
        finding(
          "error",
          "❌",
          "Subquery",
          `${subquery.relationship} is not a child relationship on ${describe.name}.`,
        ),
      );
      continue;
    }
    const childDescribe = (await loadSchemaDescription(conn, rel.childSObject, api, state))
      .describe;
    const childShape = shapeForSubquery(subquery);
    const childFindings = [
      ...(await validateFields(conn, childDescribe, childShape, api, state)),
      ...(await validateFieldCapabilities(conn, childDescribe, childShape, api, state)),
    ];
    findings.push(
      ...childFindings.map((item) => ({
        ...item,
        label: `${subquery.relationship} ${item.label}`,
      })),
    );
  }

  for (const semiJoin of shape.semi_joins ?? []) {
    const joinedDescribe = (await loadSchemaDescription(conn, semiJoin.object, api, state))
      .describe;
    const joinedShape = shapeForSemiJoin(semiJoin);
    const joinedFindings = [
      ...(joinedShape.type_of_clauses?.length
        ? [
            finding(
              "error",
              "❌",
              "TYPEOF Semi-join",
              "TYPEOF is not allowed inside a semi-join query.",
            ),
          ]
        : []),
      ...(await validateFields(conn, joinedDescribe, joinedShape, api, state)),
      ...(await validateFieldCapabilities(conn, joinedDescribe, joinedShape, api, state)),
    ];
    findings.push(
      ...joinedFindings.map((item) => ({
        ...item,
        label: `${semiJoin.object} Semi-join ${item.label}`,
      })),
    );
  }
  return findings.length
    ? findings
    : [finding("info", "✅", "Fields", "Objects, fields, and relationships verified.")];
}

async function validateTypeOfClauses(
  conn: Connection,
  describe: SObjectDescribe,
  clauses: SoqlTypeOfClause[],
  api: SoqlApiMode,
  state?: SfSoqlSessionState,
): Promise<SoqlFinding[]> {
  const findings: SoqlFinding[] = [];
  for (const clause of clauses) {
    const relationshipField = describe.fields.find(
      (candidate) =>
        candidate.relationshipName?.toLowerCase() === clause.relationship.toLowerCase(),
    );
    if (!relationshipField) {
      findings.push(
        finding(
          "error",
          "❌",
          "TYPEOF Relationship",
          `${clause.relationship} is not a relationship on ${describe.name}.`,
        ),
      );
      continue;
    }
    const referenceTargets = relationshipField.referenceTo ?? [];
    if (
      referenceTargets.length <= 1 ||
      relationshipField.namePointing === false ||
      relationshipField.polymorphicForeignKey === false
    ) {
      findings.push(
        finding(
          "error",
          "❌",
          "TYPEOF Relationship",
          `${describe.name}.${clause.relationship} is not a polymorphic relationship eligible for TYPEOF.`,
        ),
      );
      continue;
    }
    for (const branch of clause.when) {
      if (
        referenceTargets.length &&
        !referenceTargets.some((target) => target.toLowerCase() === branch.object.toLowerCase())
      ) {
        findings.push(
          finding(
            "error",
            "❌",
            "TYPEOF Object",
            `${branch.object} is not a valid target for ${describe.name}.${clause.relationship}.`,
          ),
        );
        continue;
      }
      const branchDescribe = (await loadSchemaDescription(conn, branch.object, api, state))
        .describe;
      const branchFindings = await validateFields(
        conn,
        branchDescribe,
        { fields: branch.fields },
        api,
        state,
      );
      findings.push(
        ...branchFindings.map((item) => ({
          ...item,
          label: `TYPEOF ${branch.object} ${item.label}`,
        })),
      );
    }
    if (clause.else_fields?.length) {
      const nameDescribe = (await loadSchemaDescription(conn, "Name", api, state)).describe;
      const elseFindings = await validateFields(
        conn,
        nameDescribe,
        { fields: clause.else_fields },
        api,
        state,
      );
      findings.push(
        ...elseFindings.map((item) => ({
          ...item,
          label: `TYPEOF ELSE ${item.label}`,
        })),
      );
    }
  }
  return findings;
}

function shapeForSubquery(subquery: SoqlSubqueryShape): SoqlQueryShape {
  return {
    fields: subquery.fields,
    subqueries: subquery.subqueries,
    semi_joins: subquery.semi_joins,
    function_fields: subquery.function_fields,
    where_fields: subquery.where_fields,
    order_by_fields: subquery.order_by_fields,
    group_by_fields: subquery.group_by_fields,
    having_fields: subquery.having_fields,
    aliases: subquery.aliases,
    bind_variables: subquery.bind_variables,
    type_of_fields: subquery.type_of_fields,
    type_of_clauses: subquery.type_of_clauses,
    aggregate_fields: subquery.aggregate_fields,
    literal_filters: subquery.literal_filters,
    limit: subquery.limit,
  };
}

function shapeForSemiJoin(semiJoin: SoqlSemiJoinShape): SoqlQueryShape {
  return {
    fields: semiJoin.fields,
    semi_joins: semiJoin.semi_joins,
    function_fields: semiJoin.function_fields,
    where_fields: semiJoin.where_fields,
    order_by_fields: semiJoin.order_by_fields,
    group_by_fields: semiJoin.group_by_fields,
    having_fields: semiJoin.having_fields,
    aliases: semiJoin.aliases,
    bind_variables: semiJoin.bind_variables,
    type_of_fields: semiJoin.type_of_fields,
    type_of_clauses: semiJoin.type_of_clauses,
    aggregate_fields: semiJoin.aggregate_fields,
    literal_filters: semiJoin.literal_filters,
    limit: semiJoin.limit,
  };
}

async function validateFieldCapabilities(
  conn: Connection,
  describe: SObjectDescribe,
  shape: SoqlQueryShape,
  api: SoqlApiMode,
  state?: SfSoqlSessionState,
): Promise<SoqlFinding[]> {
  const findings: SoqlFinding[] = [];
  for (const fieldName of shape.where_fields ?? []) {
    const resolved = await resolveField(conn, describe, fieldName, api, state);
    if (!resolved) {
      findings.push(
        finding("error", "❌", "Field", `${fieldName} does not exist on ${describe.name}.`),
      );
    } else if (resolved.field.filterable === false) {
      findings.push(
        finding(
          "error",
          "❌",
          "Filterable",
          `${fieldName} is not filterable on ${resolved.objectName}.`,
        ),
      );
    }
  }
  const aliases = new Set((shape.aliases ?? []).map((alias) => alias.toLowerCase()));
  for (const fieldName of shape.order_by_fields ?? []) {
    if (aliases.has(fieldName.toLowerCase())) continue;
    const resolved = await resolveField(conn, describe, fieldName, api, state);
    if (!resolved) {
      findings.push(
        finding("error", "❌", "Field", `${fieldName} does not exist on ${describe.name}.`),
      );
    } else if (resolved.field.sortable === false) {
      findings.push(
        finding(
          "error",
          "❌",
          "Sortable",
          `${fieldName} is not sortable on ${resolved.objectName}.`,
        ),
      );
    }
  }
  for (const fieldName of shape.group_by_fields ?? []) {
    if (aliases.has(fieldName.toLowerCase())) continue;
    const resolved = await resolveField(conn, describe, fieldName, api, state);
    if (!resolved) {
      findings.push(
        finding("error", "❌", "Field", `${fieldName} does not exist on ${describe.name}.`),
      );
    } else if (resolved.field.groupable === false) {
      findings.push(
        finding(
          "error",
          "❌",
          "Groupable",
          `${fieldName} is not groupable on ${resolved.objectName}.`,
        ),
      );
    }
  }
  for (const fieldName of shape.having_fields ?? []) {
    if (aliases.has(fieldName.toLowerCase())) continue;
    const resolved = await resolveField(conn, describe, fieldName, api, state);
    if (!resolved) {
      findings.push(
        finding("error", "❌", "Field", `${fieldName} does not exist on ${describe.name}.`),
      );
    } else if (resolved.field.filterable === false) {
      findings.push(
        finding(
          "error",
          "❌",
          "Having",
          `${fieldName} is not filterable in HAVING on ${resolved.objectName}.`,
        ),
      );
    }
  }
  for (const aggregate of shape.aggregate_fields ?? []) {
    if (!aggregate.field || aliases.has(aggregate.field.toLowerCase())) continue;
    const resolved = await resolveField(conn, describe, aggregate.field, api, state);
    if (!resolved) {
      findings.push(
        finding("error", "❌", "Field", `${aggregate.field} does not exist on ${describe.name}.`),
      );
    } else if (resolved.field.aggregatable === false) {
      findings.push(
        finding(
          "error",
          "❌",
          "Aggregatable",
          `${aggregate.fn}(${aggregate.field}) is not supported because ${aggregate.field} is not aggregatable.`,
        ),
      );
    }
  }
  findings.push(
    ...(await validateFunctionFields(conn, describe, shape.function_fields ?? [], api, state)),
  );
  for (const filter of shape.literal_filters ?? []) {
    const resolved = await resolveField(conn, describe, filter.field, api, state);
    if (!resolved?.field.type || !["picklist", "multipicklist"].includes(resolved.field.type))
      continue;
    const activeValues = (resolved.field.picklistValues ?? [])
      .filter((value) => value.active !== false && value.value)
      .map((value) => value.value as string);
    if (activeValues.length > 0 && !activeValues.includes(filter.value)) {
      findings.push(
        finding(
          "warning",
          "⚠️",
          "Picklist",
          `${filter.field} ${filter.operator} '${filter.value}' is not an active picklist value.`,
        ),
      );
    }
  }
  return findings;
}

const DATE_FUNCTIONS = new Set([
  "CALENDAR_MONTH",
  "CALENDAR_QUARTER",
  "CALENDAR_YEAR",
  "DAY_IN_MONTH",
  "DAY_IN_WEEK",
  "DAY_IN_YEAR",
  "DAY_ONLY",
  "FISCAL_MONTH",
  "FISCAL_QUARTER",
  "FISCAL_YEAR",
  "HOUR_IN_DAY",
  "WEEK_IN_MONTH",
  "WEEK_IN_YEAR",
]);
const DATETIME_ONLY_FUNCTIONS = new Set(["CONVERTTIMEZONE", "DAY_ONLY", "HOUR_IN_DAY"]);

async function validateFunctionFields(
  conn: Connection,
  describe: SObjectDescribe,
  functionFields: SoqlFunctionField[],
  api: SoqlApiMode,
  state?: SfSoqlSessionState,
): Promise<SoqlFinding[]> {
  const findings: SoqlFinding[] = [];
  for (const reference of functionFields) {
    const resolved = await resolveField(conn, describe, reference.field, api, state);
    if (!resolved) {
      findings.push(
        finding(
          "error",
          "❌",
          "Function Field",
          `${reference.field} does not exist on ${describe.name}.`,
        ),
      );
      continue;
    }
    const fieldType = resolved.field.type?.toLowerCase();
    if (DATETIME_ONLY_FUNCTIONS.has(reference.function) && fieldType !== "datetime") {
      findings.push(
        finding(
          "error",
          "❌",
          "Function Type",
          `${reference.function} requires a datetime field; ${reference.field} is ${fieldType ?? "unknown"}.`,
        ),
      );
    } else if (
      DATE_FUNCTIONS.has(reference.function) &&
      fieldType !== "date" &&
      fieldType !== "datetime"
    ) {
      findings.push(
        finding(
          "error",
          "❌",
          "Function Type",
          `${reference.function} requires a date or datetime field; ${reference.field} is ${fieldType ?? "unknown"}.`,
        ),
      );
    }
    if (reference.function === "DISTANCE" && fieldType !== "location") {
      findings.push(
        finding(
          "error",
          "❌",
          "Function Type",
          `DISTANCE requires a geolocation field; ${reference.field} is ${fieldType ?? "unknown"}.`,
        ),
      );
    }
    if (
      reference.function !== "DISTANCE" &&
      (reference.context === "where" || reference.context === "having") &&
      resolved.field.filterable === false
    ) {
      findings.push(
        finding(
          "error",
          "❌",
          "Function Filterable",
          `${reference.field} is not filterable on ${resolved.objectName}.`,
        ),
      );
    }
    if (
      !DATE_FUNCTIONS.has(reference.function) &&
      reference.context === "group_by" &&
      resolved.field.groupable === false
    ) {
      findings.push(
        finding(
          "error",
          "❌",
          "Function Groupable",
          `${reference.field} is not groupable on ${resolved.objectName}.`,
        ),
      );
    }
    if (
      reference.function !== "DISTANCE" &&
      reference.context === "order_by" &&
      resolved.field.sortable === false
    ) {
      findings.push(
        finding(
          "error",
          "❌",
          "Function Sortable",
          `${reference.field} is not sortable on ${resolved.objectName}.`,
        ),
      );
    }
  }
  return findings;
}

function isExpression(field: string): boolean {
  return /\(|\)|\s/.test(field) || /^TYPEOF\b/i.test(field);
}

async function resolveField(
  conn: Connection,
  describe: SObjectDescribe,
  path: string,
  api: SoqlApiMode,
  state?: SfSoqlSessionState,
): Promise<
  { objectName: string; field: SObjectFieldDescribe; polymorphic?: string[] } | undefined
> {
  if (isExpression(path)) return undefined;
  const current = describe;
  const parts = path.split(".");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === parts.length - 1) {
      const field = current.fields.find(
        (candidate) => candidate.name.toLowerCase() === part.toLowerCase(),
      );
      return field ? { objectName: current.name, field } : undefined;
    }
    const relationshipField = current.fields.find(
      (candidate) => candidate.relationshipName?.toLowerCase() === part.toLowerCase(),
    );
    const parentObjects = relationshipField?.referenceTo ?? [];
    if (!parentObjects.length) return undefined;
    if (parentObjects.length > 1) {
      const nameDescribe = (await loadSchemaDescription(conn, "Name", api, state)).describe;
      return resolveField(conn, nameDescribe, parts.slice(i + 1).join("."), api, state);
    }
    for (const parentObject of parentObjects) {
      const parentDescribe = (await loadSchemaDescription(conn, parentObject, api, state)).describe;
      const remaining = parts.slice(i + 1).join(".");
      const resolved = await resolveField(conn, parentDescribe, remaining, api, state);
      if (resolved) {
        return {
          ...resolved,
          polymorphic: parentObjects.length > 1 ? parentObjects : resolved.polymorphic,
        };
      }
    }
    return undefined;
  }
  return undefined;
}
