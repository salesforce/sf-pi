/* SPDX-License-Identifier: Apache-2.0 */
/** Parse + API-aware describe-backed SOQL validation. */

import type { SoqlConnection as Connection } from "./api.ts";
import { apiCall, apiVersion } from "./api.ts";
import { writeSoqlArtifact } from "./artifacts.ts";
import { buildDigest, finding, row, section, toolResultFromDigest } from "./digest.ts";
import { validateWithSoqlLsp } from "./lsp.ts";
import { isAggregateOrCount, parseSoql } from "./parser.ts";
import {
  describeResolutionError,
  loadSchemaDescription,
  resolutionReason,
  resolveSchemaCandidates,
} from "./resolver.ts";
import type {
  SfSoqlParams,
  SfSoqlSessionState,
  SObjectDescribe,
  SObjectFieldDescribe,
  SoqlApiCallRailItem,
  SoqlApiMode,
  SoqlFinding,
  SoqlQueryShape,
  SoqlRunDigest,
  ToolResult,
} from "./types.ts";
import { explainPlanDigest } from "./runner.ts";

export interface QueryInspection {
  shape: SoqlQueryShape;
  requestedApi: NonNullable<SfSoqlParams["api"]>;
  resolvedApi?: SoqlApiMode;
  resolutionReason?: string;
  findings: SoqlFinding[];
  apiCalls: SoqlApiCallRailItem[];
}

export async function inspectQuery(
  conn: Connection,
  params: SfSoqlParams,
  state?: SfSoqlSessionState,
): Promise<QueryInspection> {
  const rawQuery = requireQuery(params);
  const shape = parseSoql(rawQuery);
  const apiCalls = [
    apiCall("PARSE", "SOQL", shape.syntax_errors?.length ? "syntax=errors" : "syntax=ok"),
  ];
  const findings: SoqlFinding[] = [];
  const requestedApi = params.api ?? "auto";
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

  let resolvedApi: SoqlApiMode | undefined;
  let selectedReason: string | undefined;
  if (shape.primary_object) {
    const resolution = await resolveSchemaCandidates(conn, params, shape.primary_object, state);
    apiCalls.push(...resolution.apiCalls);
    const evaluations = await Promise.all(
      resolution.candidates.map(async (candidate) => {
        try {
          return {
            ...candidate,
            findings: [
              ...(await validateFields(conn, candidate.describe, shape, candidate.api, state)),
              ...(await validateFieldCapabilities(
                conn,
                candidate.describe,
                shape,
                candidate.api,
                state,
              )),
            ],
          };
        } catch (error) {
          return {
            ...candidate,
            findings: [
              finding(
                "error",
                "❌",
                "Relationship Metadata",
                describeResolutionError(candidate.api, shape.primary_object ?? "query", error),
              ),
            ],
          };
        }
      }),
    );
    const valid = evaluations.filter(
      (candidate) => !candidate.findings.some((item) => item.severity === "error"),
    );
    const selected = selectEvaluation(evaluations, valid, requestedApi);
    if (selected) {
      resolvedApi = selected.api;
      shape.api = selected.api;
      const fieldMatchedApi =
        requestedApi === "auto" && resolution.candidates.length > 1 && valid.length === 1
          ? selected.api
          : undefined;
      selectedReason = resolutionReason(
        requestedApi,
        resolution.candidates,
        selected.api,
        fieldMatchedApi,
      );
      findings.push(
        finding(
          "info",
          "🧭",
          "API",
          `${requestedApi.toUpperCase()} resolved to ${selected.api.toUpperCase()}: ${selectedReason}.`,
        ),
      );
      findings.push(...selected.findings);
    } else {
      for (const failure of resolution.errors) {
        findings.push(
          finding(
            "error",
            "❌",
            "API Mode",
            describeResolutionError(failure.api, shape.primary_object, failure.error),
          ),
        );
      }
      if (!resolution.errors.length) {
        findings.push(
          finding(
            "error",
            "❌",
            "Object",
            `${shape.primary_object} is not queryable through REST or Tooling API.`,
          ),
        );
      }
    }
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

  return {
    shape,
    requestedApi,
    resolvedApi,
    resolutionReason: selectedReason,
    findings,
    apiCalls,
  };
}

export async function validateQuery(
  conn: Connection,
  params: SfSoqlParams,
  state?: SfSoqlSessionState,
): Promise<ToolResult> {
  const inspection = await inspectQuery(conn, params, state);
  const rawQuery = requireQuery(params);
  const shouldExplain =
    inspection.resolvedApi === "rest" &&
    (params.include_plan || inspection.findings.some((item) => item.severity === "warning"));
  const plan =
    shouldExplain && inspection.shape.normalized
      ? await explainPlanDigest(conn, inspection.shape.normalized).catch(() => undefined)
      : undefined;
  if (plan) {
    inspection.apiCalls.push(
      apiCall(
        "GET",
        conn.path("/query", { explain: "SELECT..." }),
        plan.relative_cost !== undefined ? `cost=${plan.relative_cost}` : undefined,
      ),
    );
  } else if (params.include_plan && inspection.resolvedApi === "tooling") {
    inspection.findings.push(
      finding(
        "info",
        "ℹ️",
        "Query Plan",
        "Query-plan retrieval is not run for Tooling API queries.",
      ),
    );
  }

  const verdict = verdictFor(inspection.findings);
  const artifact = await writeSoqlArtifact(
    "validation",
    `${inspection.shape.primary_object ?? "query"}-${Date.now()}.json`,
    { query: inspection.shape.normalized ?? rawQuery, findings: inspection.findings, plan },
  );
  const digest = buildDigest({
    action: "query.validate",
    status: verdict === "invalid" ? "fail" : verdict === "safe" ? "pass" : "warning",
    icon: "🛡️",
    title: `SOQL Validation${inspection.shape.primary_object ? ` · ${inspection.shape.primary_object}` : ""}`,
    org: { alias: params.target_org, api_version: apiVersion(conn) },
    meta: inspection.resolvedApi ? [inspection.resolvedApi.toUpperCase()] : undefined,
    query: inspection.shape,
    validation: { verdict, findings: inspection.findings },
    plan,
    api_resolution: {
      requested: inspection.requestedApi,
      resolved: inspection.resolvedApi,
      reason: inspection.resolutionReason,
    },
    api_calls: inspection.apiCalls,
    output_mode: params.output_mode,
    sections: validationSections(inspection, plan),
    artifacts: [artifact],
  });
  return toolResultFromDigest(digest);
}

export function blockedQueryResult(
  conn: Connection,
  params: SfSoqlParams,
  inspection: QueryInspection,
  action: SoqlRunDigest["action"],
): ToolResult {
  const title = action
    .replace("query.", "SOQL ")
    .replace(/^SOQL (\w)/, (_match, letter: string) => `SOQL ${letter.toUpperCase()}`);
  const digest = buildDigest({
    action,
    status: "fail",
    icon: "🛡️",
    title: `${title} · blocked${inspection.shape.primary_object ? ` · ${inspection.shape.primary_object}` : ""}`,
    org: { alias: params.target_org, api_version: apiVersion(conn) },
    query: inspection.shape,
    validation: { verdict: "invalid", findings: inspection.findings },
    api_resolution: {
      requested: inspection.requestedApi,
      resolved: inspection.resolvedApi,
      reason: inspection.resolutionReason,
    },
    api_calls: inspection.apiCalls,
    output_mode: params.output_mode,
    sections: [
      section(
        "🛡️",
        "Preflight Block",
        inspection.findings.map((item) => row(item.icon, item.label, item.message)),
      ),
    ],
  });
  return toolResultFromDigest(digest);
}

export function inspectionHasErrors(inspection: QueryInspection): boolean {
  return inspection.findings.some((item) => item.severity === "error");
}

function validationSections(
  inspection: QueryInspection,
  plan?: Awaited<ReturnType<typeof explainPlanDigest>>,
) {
  const shape = inspection.shape;
  return [
    section("🧾", "Query Shape", [
      row("🧾", "Object", shape.primary_object),
      row("🧭", "API", inspection.resolvedApi?.toUpperCase()),
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
      inspection.findings.map((item) => row(item.icon, item.label, item.message)),
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
  ];
}

function selectEvaluation<T extends { api: SoqlApiMode }>(
  evaluations: T[],
  valid: T[],
  requestedApi: NonNullable<SfSoqlParams["api"]>,
): T | undefined {
  if (requestedApi !== "auto")
    return evaluations.find((candidate) => candidate.api === requestedApi);
  if (valid.length === 1) return valid[0];
  if (valid.length > 1) return valid.find((candidate) => candidate.api === "rest") ?? valid[0];
  return evaluations.find((candidate) => candidate.api === "rest") ?? evaluations[0];
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
    const resolvedTargets = await Promise.all(
      parentObjects.map(async (parentObject) => ({
        parentObject,
        describe: (await loadSchemaDescription(conn, parentObject, api, state)).describe,
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
    const childDescribe = (await loadSchemaDescription(conn, rel.childSObject, api, state))
      .describe;
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
  api: SoqlApiMode,
  state?: SfSoqlSessionState,
): Promise<SoqlFinding[]> {
  const findings: SoqlFinding[] = [];
  for (const fieldName of shape.where_fields ?? []) {
    const resolved = await resolveField(conn, describe, fieldName, api, state);
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
    const resolved = await resolveField(conn, describe, fieldName, api, state);
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
    const resolved = await resolveField(conn, describe, fieldName, api, state);
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
    const resolved = await resolveField(conn, describe, fieldName, api, state);
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
    const resolved = await resolveField(conn, describe, aggregate.field, api, state);
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
