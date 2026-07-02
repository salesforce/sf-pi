/* SPDX-License-Identifier: Apache-2.0 */
/** Parse + describe-backed SOQL validation. */

import type { Connection } from "@salesforce/core";
import { apiCall, apiVersion, describeSObject } from "./api.ts";
import { writeSoqlArtifact } from "./artifacts.ts";
import { buildDigest, finding, row, section, toolResultFromDigest } from "./digest.ts";
import { validateWithSoqlLsp } from "./lsp.ts";
import { isAggregateOrCount, parseSoql } from "./parser.ts";
import type {
  SfSoqlParams,
  SObjectDescribe,
  SObjectFieldDescribe,
  SoqlFinding,
  SoqlQueryShape,
  ToolResult,
} from "./types.ts";
import { explainPlanDigest } from "./runner.ts";

export async function validateQuery(conn: Connection, params: SfSoqlParams): Promise<ToolResult> {
  const rawQuery = requireQuery(params);
  const shape = parseSoql(rawQuery);
  const apiCalls = [
    apiCall("PARSE", "SOQL", shape.syntax_errors?.length ? "syntax=errors" : "syntax=ok"),
  ];
  const findings: SoqlFinding[] = [];
  const lspDiagnostics = shape.normalized ? validateWithSoqlLsp(shape.normalized) : [];
  for (const diagnostic of lspDiagnostics) {
    findings.push(
      finding(
        diagnostic.severity === 1 ? "error" : "warning",
        diagnostic.severity === 1 ? "❌" : "⚠️",
        "LSP Syntax",
        `${formatDiagnosticLocation(diagnostic)} ${diagnostic.message}`.trim(),
      ),
    );
  }
  if (shape.syntax_errors?.length && lspDiagnostics.length === 0) {
    findings.push(
      ...shape.syntax_errors.map((err) =>
        finding("error", "❌", "Syntax", `${err.line}:${err.column} ${err.message}`),
      ),
    );
  }

  let describe: SObjectDescribe | undefined;
  if (shape.primary_object) {
    describe = await describeSObject(conn, shape.primary_object);
    apiCalls.push(
      apiCall(
        "GET",
        `/sobjects/${shape.primary_object}/describe`,
        `fields=${describe.fields.length}`,
      ),
    );
    findings.push(...(await validateFields(conn, describe, shape)));
    findings.push(...(await validateFieldCapabilities(conn, describe, shape)));
  } else {
    findings.push(finding("error", "❌", "Object", "Could not determine top-level FROM object."));
  }

  if (!shape.limit && !isAggregateOrCount(shape.normalized ?? rawQuery)) {
    findings.push(finding("warning", "⚠️", "Limit", "Exploratory query has no top-level LIMIT."));
  }
  if (/\bLIKE\s+'%/i.test(shape.normalized ?? rawQuery)) {
    findings.push(finding("warning", "⚠️", "Filter", "Leading wildcard LIKE may be scan-heavy."));
  }
  if (shape.all_rows) {
    findings.push(
      finding(
        "warning",
        "🕰️",
        "QueryAll",
        "ALL ROWS includes deleted or archived records where supported.",
      ),
    );
  }
  if (shape.bind_variables?.length) {
    findings.push(
      finding(
        "info",
        "🔗",
        "Bind Variables",
        `Detected bind variables: ${shape.bind_variables.join(", ")}. Runtime values are not validated by sf-soql.`,
      ),
    );
  }
  if (shape.type_of_fields?.length) {
    findings.push(
      finding(
        "info",
        "🧬",
        "TYPEOF",
        "TYPEOF clauses are parser-recognized but only lightly validated in V1.",
      ),
    );
  }

  const shouldExplain = params.include_plan || findings.some((item) => item.severity === "warning");
  const plan =
    shouldExplain && shape.normalized
      ? await explainPlanDigest(conn, shape.normalized).catch(() => undefined)
      : undefined;
  if (plan)
    apiCalls.push(
      apiCall(
        "GET",
        "/query?explain=SELECT...",
        plan.relative_cost !== undefined ? `cost=${plan.relative_cost}` : undefined,
      ),
    );

  const verdict = verdictFor(findings);
  const artifact = await writeSoqlArtifact(
    "validation",
    `${shape.primary_object ?? "query"}-${Date.now()}.json`,
    { query: shape.normalized ?? rawQuery, findings, plan },
  );
  const digest = buildDigest({
    action: "query.validate",
    status: verdict === "invalid" ? "fail" : verdict === "safe" ? "pass" : "warning",
    icon: "🛡️",
    title: `SOQL Validation${shape.primary_object ? ` · ${shape.primary_object}` : ""}`,
    org: { alias: params.target_org, api_version: apiVersion(conn) },
    query: shape,
    validation: { verdict, findings },
    plan,
    api_calls: apiCalls,
    output_mode: params.output_mode,
    sections: [
      section("🧾", "Query Shape", [
        row("🧾", "Object", shape.primary_object),
        row("🧩", "Fields", shape.fields?.slice(0, 8).join(", ")),
        row(
          "🔗",
          "Subqueries",
          shape.subqueries?.map((subquery) => subquery.relationship).join(", "),
        ),
        row("🔎", "WHERE fields", shape.where_fields?.join(", ")),
        row("↕️", "ORDER BY", shape.order_by_fields?.join(", ")),
        row("📚", "GROUP BY", shape.group_by_fields?.join(", ")),
        row("🧮", "HAVING", shape.having_fields?.join(", ")),
        row("🏷️", "Aliases", shape.aliases?.join(", ")),
        row("📦", "Limit", shape.limit),
      ]),
      section(
        "🛡️",
        "Findings",
        findings.map((item) => row(item.icon, item.label, item.message)),
      ),
      ...(plan
        ? [
            section("📈", "Query Plan", [
              row("🧠", "Leading Op", plan.leading_operation_type),
              row("💰", "Cost", plan.relative_cost),
              row("📊", "Cardinality", plan.cardinality),
              row("✅", "Verdict", plan.verdict),
              ...(plan.notes ?? []).slice(0, 3).map((note) => row("💡", "Note", note)),
            ]),
          ]
        : []),
    ],
    artifacts: [artifact],
  });
  return toolResultFromDigest(digest);
}

async function validateFields(
  conn: Connection,
  describe: SObjectDescribe,
  shape: SoqlQueryShape,
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
    const resolvedTargets = await Promise.all(
      parentObjects.map(async (parentObject) => ({
        parentObject,
        describe: await describeSObject(conn, parentObject),
      })),
    );
    const matchingTargets = resolvedTargets.filter(({ describe: parentDescribe }) =>
      parentDescribe.fields.some(
        (candidate) => candidate.name.toLowerCase() === tail[0].toLowerCase(),
      ),
    );
    if (matchingTargets.length === 0) {
      findings.push(
        finding(
          "error",
          "❌",
          "Field",
          `${field} does not resolve on ${parentObjects.join(" or ")}.`,
        ),
      );
    } else if (parentObjects.length > 1) {
      findings.push(
        finding(
          "info",
          "🧬",
          "Polymorphic",
          `${relationship} is polymorphic; ${field} was found on ${summarizeList(
            matchingTargets.map((target) => target.parentObject),
            6,
          )}.`,
        ),
      );
    }
  }

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
    const childDescribe = await describeSObject(conn, rel.childSObject);
    const childFields = new Set(childDescribe.fields.map((field) => field.name.toLowerCase()));
    for (const field of subquery.fields) {
      if (!isExpression(field) && !childFields.has(field.toLowerCase())) {
        findings.push(
          finding(
            "error",
            "❌",
            "Subquery Field",
            `${field} does not exist on ${rel.childSObject}.`,
          ),
        );
      }
    }
  }
  return findings.length
    ? findings
    : [finding("info", "✅", "Fields", "Objects, fields, and relationships verified.")];
}

async function validateFieldCapabilities(
  conn: Connection,
  describe: SObjectDescribe,
  shape: SoqlQueryShape,
): Promise<SoqlFinding[]> {
  const findings: SoqlFinding[] = [];
  for (const fieldName of shape.where_fields ?? []) {
    const resolved = await resolveField(conn, describe, fieldName);
    if (resolved?.field.filterable === false) {
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
    const resolved = await resolveField(conn, describe, fieldName);
    if (resolved?.field.sortable === false) {
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
    const resolved = await resolveField(conn, describe, fieldName);
    if (resolved?.field.groupable === false) {
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
    const resolved = await resolveField(conn, describe, fieldName);
    if (resolved?.field.filterable === false) {
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
    const resolved = await resolveField(conn, describe, aggregate.field);
    if (resolved?.field.aggregatable === false) {
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
  for (const filter of shape.literal_filters ?? []) {
    const resolved = await resolveField(conn, describe, filter.field);
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

async function resolveField(
  conn: Connection,
  describe: SObjectDescribe,
  path: string,
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
    for (const parentObject of parentObjects) {
      const parentDescribe = await describeSObject(conn, parentObject);
      const remaining = parts.slice(i + 1).join(".");
      const resolved = await resolveField(conn, parentDescribe, remaining);
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

function formatDiagnosticLocation(diagnostic: {
  range?: { start?: { line?: number; character?: number } };
}): string {
  const line = diagnostic.range?.start?.line;
  const character = diagnostic.range?.start?.character;
  if (line === undefined || character === undefined) return "";
  return `${line + 1}:${character + 1}`;
}

function summarizeList(values: string[], max: number): string {
  if (values.length <= max) return values.join(", ") || "—";
  return `${values.slice(0, max).join(", ")} … +${values.length - max} more`;
}

function isExpression(field: string): boolean {
  return /\(|\)|\s/.test(field) || /^TYPEOF\b/i.test(field);
}

function verdictFor(findings: SoqlFinding[]): "safe" | "review" | "risky" | "invalid" {
  if (findings.some((item) => item.severity === "error")) return "invalid";
  if (findings.some((item) => item.severity === "warning")) return "review";
  return "safe";
}

export function requireQuery(params: SfSoqlParams): string {
  const query = params.query?.trim();
  if (!query) throw new Error("query is required for this sf_soql action.");
  return query;
}
