/* SPDX-License-Identifier: Apache-2.0 */
/** Parse + API-aware describe-backed SOQL validation. */

import type { SoqlConnection as Connection } from "./api.ts";
import { apiCall, apiVersion, parserApiVersion } from "./api.ts";
import { writeSoqlArtifact } from "./artifacts.ts";
import { buildDigest, finding, row, section, toolResultFromDigest } from "./digest.ts";
import { validateObjectSpecificRules } from "./object-validator.ts";
import { isAggregateOrCount, parseSoql } from "./parser.ts";
import { validateQuerySemantics } from "./query-semantics.ts";
import { describeResolutionError, resolutionReason, resolveSchemaCandidates } from "./resolver.ts";
import { validateSchemaShape } from "./schema-validator.ts";
import type {
  SfSoqlParams,
  SfSoqlSessionState,
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
  const context = params.parse_context ?? "api";
  const shape = parseSoql(rawQuery, { apiVersion: parserApiVersion(conn), context });
  const apiCalls = [
    apiCall(
      "PARSE",
      "SOQL",
      `${shape.syntax_errors?.length ? "syntax=errors" : "syntax=ok"} · context=${context} · api=v${apiVersion(conn)}`,
    ),
  ];
  const findings: SoqlFinding[] = [];
  const requestedApi = params.api ?? "auto";
  if (shape.syntax_errors?.length) {
    findings.push(
      ...shape.syntax_errors.map((err) =>
        finding("error", "❌", "Syntax", `${err.line}:${err.column} ${err.message}`),
      ),
    );
  }
  if (context === "api" && shape.bind_variables?.length) {
    findings.push(
      finding(
        "error",
        "❌",
        "Bind Variables",
        "REST and Tooling query actions do not accept Apex bind variables.",
      ),
    );
  }
  findings.push(...validateTypeOfCompatibility(shape));
  findings.push(...validateQuerySemantics(shape));
  findings.push(...validateObjectSpecificRules(shape));

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
            findings: await validateSchemaShape(
              conn,
              candidate.describe,
              shape,
              candidate.api,
              state,
            ),
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
  if (context === "apex" && shape.bind_variables?.length) {
    findings.push(
      finding(
        "info",
        "🔗",
        "Bind Variables",
        `Detected Apex bind variables: ${shape.bind_variables.join(", ")}. Runtime values are not validated by sf-soql.`,
      ),
    );
  }
  if (shape.type_of_fields?.length) {
    findings.push(
      finding(
        "info",
        "🧬",
        "TYPEOF",
        "TYPEOF WHEN branches and the ELSE Name contract are schema-validated.",
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

function validateTypeOfCompatibility(shape: SoqlQueryShape): SoqlFinding[] {
  if (!shape.type_of_clauses?.length) return [];
  const findings: SoqlFinding[] = [];
  if (shape.function_fields?.some((reference) => reference.context === "select")) {
    findings.push(
      finding(
        "error",
        "❌",
        "TYPEOF Functions",
        "TYPEOF cannot be combined with functions in the SELECT clause.",
      ),
    );
  }
  if (
    shape.group_by_fields?.length ||
    shape.having_fields?.length ||
    shape.function_fields?.some(
      (reference) => reference.context === "group_by" || reference.context === "having",
    )
  ) {
    findings.push(
      finding(
        "error",
        "❌",
        "TYPEOF Grouping",
        "TYPEOF cannot be combined with GROUP BY or HAVING.",
      ),
    );
  }
  if (shape.aggregate_fields?.length) {
    findings.push(
      finding(
        "error",
        "❌",
        "TYPEOF Aggregate",
        "TYPEOF cannot be used in aggregate-only queries.",
      ),
    );
  }
  return findings;
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
