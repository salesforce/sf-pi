/* SPDX-License-Identifier: Apache-2.0 */
/** Query plan and execution operations for sf-soql. */

import type { Connection } from "@salesforce/core";
import { apiCall, apiVersion, explainQuery, queryAll, restQuery } from "./api.ts";
import { writeRunBundle, writeSoqlArtifact } from "./artifacts.ts";
import { buildDigest, row, section, toolResultFromDigest } from "./digest.ts";
import { errorResult } from "./errors.ts";
import { flattenRecords } from "./flattener.ts";
import {
  hasTopLevelLimit,
  isAggregateOrCount,
  parseSoql,
  readTopLevelLimit,
  toCountQuery,
  withLimit,
} from "./parser.ts";
import type {
  SfSoqlParams,
  SfSoqlSessionState,
  SoqlApiMode,
  SoqlOperation,
  SoqlPlanDigest,
  SoqlRunDigest,
  ToolResult,
} from "./types.ts";
import { requireQuery } from "./validator.ts";

const DEFAULT_SAMPLE_ROWS = 25;
const DEFAULT_MAX_ROWS = 200;
const HARD_MAX_ROWS = 2_000;

export async function explain(
  conn: Connection,
  params: SfSoqlParams,
  state?: SfSoqlSessionState,
): Promise<ToolResult> {
  try {
    const rawQuery = requireQuery(params);
    const shape = parseSoql(rawQuery);
    const query = shape.normalized ?? rawQuery;
    const plan = await explainPlanDigest(conn, query);
    const artifact = await writeSoqlArtifact(
      "plans",
      `${shape.primary_object ?? "query"}-${Date.now()}.json`,
      { query, plan },
    );
    const digest = buildDigest({
      action: "query.explain",
      status: plan.verdict === "risky" ? "warning" : "pass",
      icon: "📈",
      title: `SOQL Query Plan${shape.primary_object ? ` · ${shape.primary_object}` : ""}`,
      org: { alias: params.target_org, api_version: apiVersion(conn) },
      meta: [
        plan.relative_cost !== undefined ? `cost=${plan.relative_cost}` : "cost=unknown",
        plan.verdict ?? "unknown",
      ],
      query: { ...shape, operation: "explain" },
      plan,
      api_calls: [
        apiCall(
          "GET",
          "/query?explain=SELECT...",
          shape.primary_object ? `object=${shape.primary_object}` : undefined,
        ),
      ],
      sections: [
        section("📈", "Best Plan", [
          row("🧠", "Leading Op", plan.leading_operation_type),
          row("💰", "Relative Cost", plan.relative_cost),
          row("📊", "Cardinality", plan.cardinality),
          row("🏢", "Object Rows", plan.sobject_cardinality),
          row("✅", "Verdict", plan.verdict),
        ]),
        section(
          "📝",
          "Notes",
          (plan.notes ?? []).slice(0, 6).map((note) => row("💡", "Note", note)),
        ),
      ],
      artifacts: [artifact],
    });
    if (state) {
      state.lastRunnable = params;
      state.lastDigest = digest;
    }
    return toolResultFromDigest(digest);
  } catch (err) {
    return errorResult(params, err);
  }
}

export async function explainPlanDigest(conn: Connection, query: string): Promise<SoqlPlanDigest> {
  const response = await explainQuery(conn, query);
  const plans = response.plans ?? [];
  const best = [...plans].sort(
    (a, b) => (a.relativeCost ?? Number.MAX_VALUE) - (b.relativeCost ?? Number.MAX_VALUE),
  )[0];
  if (!best) return { available: false, verdict: "unknown" };
  const cost = best.relativeCost;
  const cardinality = best.cardinality;
  const sobjectCardinality = best.sobjectCardinality;
  const verdict = queryPlanVerdict({
    cost,
    cardinality,
    sobjectCardinality,
    leadingOperationType: best.leadingOperationType,
  });
  return {
    available: true,
    leading_operation_type: best.leadingOperationType,
    relative_cost: cost,
    cardinality,
    sobject_cardinality: sobjectCardinality,
    sobject_type: best.sobjectType,
    fields: best.fields,
    verdict,
    notes: [
      ...queryPlanNotes({
        cost,
        cardinality,
        sobjectCardinality,
        leadingOperationType: best.leadingOperationType,
      }),
      ...plans
        .flatMap((plan) => plan.notes ?? [])
        .map((note) =>
          [note.description, note.tableEnumOrId, note.fields?.join(", ")]
            .filter(Boolean)
            .join(" · "),
        ),
    ],
  };
}

function queryPlanVerdict(plan: {
  cost?: number;
  cardinality?: number;
  sobjectCardinality?: number;
  leadingOperationType?: string;
}): "selective" | "risky" | "unknown" {
  if (plan.cost === undefined) return "unknown";
  const ratio = cardinalityRatio(plan.cardinality, plan.sobjectCardinality);
  if (plan.cost > 1) return "risky";
  if (
    ratio !== undefined &&
    ratio > 0.1 &&
    plan.leadingOperationType?.toLowerCase() === "tablescan"
  ) {
    return "risky";
  }
  return "selective";
}

function queryPlanNotes(plan: {
  cost?: number;
  cardinality?: number;
  sobjectCardinality?: number;
  leadingOperationType?: string;
}): string[] {
  const notes: string[] = [];
  const ratio = cardinalityRatio(plan.cardinality, plan.sobjectCardinality);
  if (plan.leadingOperationType) notes.push(`Leading operation: ${plan.leadingOperationType}`);
  if (plan.cardinality === 0)
    notes.push("Optimizer estimates zero matching rows for this query shape/filter.");
  if (ratio !== undefined) notes.push(`Estimated match ratio: ${(ratio * 100).toFixed(2)}%`);
  if (plan.cost !== undefined && plan.cost > 1)
    notes.push("Relative cost is above 1.0; review filters before broad execution.");
  if (
    ratio !== undefined &&
    ratio > 0.1 &&
    plan.leadingOperationType?.toLowerCase() === "tablescan"
  ) {
    notes.push("TableScan touches a large share of the object; prefer a more selective filter.");
  }
  return notes;
}

function cardinalityRatio(cardinality?: number, sobjectCardinality?: number): number | undefined {
  if (!cardinality || !sobjectCardinality) return undefined;
  return cardinality / sobjectCardinality;
}

export async function sampleQuery(
  conn: Connection,
  params: SfSoqlParams,
  state: SfSoqlSessionState,
): Promise<ToolResult> {
  const maxRows = clamp(params.max_rows ?? params.limit ?? DEFAULT_SAMPLE_ROWS, 1, HARD_MAX_ROWS);
  const rawQuery = requireQuery(params);
  const shape = parseSoql(rawQuery);
  const query = withLimit(shape.normalized ?? rawQuery, maxRows);
  return executeQuery(
    conn,
    { ...params, query, max_rows: maxRows },
    state,
    "query.sample",
    "query",
  );
}

export async function runQuery(
  conn: Connection,
  params: SfSoqlParams,
  state: SfSoqlSessionState,
): Promise<ToolResult> {
  const rawQuery = requireQuery(params);
  const shape = parseSoql(rawQuery);
  const query = shape.normalized ?? rawQuery;
  const explicitLimit = readTopLevelLimit(query);
  const maxRows = clamp(params.max_rows ?? explicitLimit ?? DEFAULT_MAX_ROWS, 1, HARD_MAX_ROWS);
  if (
    !hasTopLevelLimit(query) &&
    !params.max_rows &&
    !params.allow_unbounded &&
    !isAggregateOrCount(query)
  ) {
    const digest = buildDigest({
      action: "query.run",
      status: "warning",
      icon: "🛡️",
      title: `SOQL Run · review required${shape.primary_object ? ` · ${shape.primary_object}` : ""}`,
      org: { alias: params.target_org, api_version: apiVersion(conn) },
      query: shape,
      validation: {
        verdict: "review",
        findings: [
          {
            severity: "warning",
            icon: "⚠️",
            label: "Limit",
            message:
              "Query has no LIMIT. Run query.sample, query.count, or pass max_rows to continue.",
          },
        ],
      },
      api_calls: [apiCall("PARSE", "SOQL", "safety_gate=no_limit")],
      output_mode: params.output_mode,
      sections: [
        section("🛡️", "Safety Gate", [
          row("⚠️", "Reason", "Query has no top-level LIMIT."),
          row("🧪", "Safe option", "query.sample max_rows=25"),
          row("🧮", "Estimate", "query.count"),
          row("🔓", "Override", "query.run max_rows=500"),
        ]),
      ],
    });
    state.lastDigest = digest;
    return toolResultFromDigest(digest);
  }
  const operation: SoqlOperation = shape.all_rows ? "queryAll" : "query";
  return executeQuery(conn, { ...params, query, max_rows: maxRows }, state, "query.run", operation);
}

export async function countQuery(
  conn: Connection,
  params: SfSoqlParams,
  state: SfSoqlSessionState,
): Promise<ToolResult> {
  const rawQuery = requireQuery(params);
  const shape = parseSoql(rawQuery);
  return executeQuery(
    conn,
    { ...params, query: toCountQuery(shape.normalized ?? rawQuery), max_rows: 1 },
    state,
    "query.count",
    "count",
  );
}

export async function runQueryAll(
  conn: Connection,
  params: SfSoqlParams,
  state: SfSoqlSessionState,
): Promise<ToolResult> {
  const rawQuery = requireQuery(params);
  const shape = parseSoql(rawQuery);
  const maxRows = clamp(params.max_rows ?? params.limit ?? DEFAULT_MAX_ROWS, 1, HARD_MAX_ROWS);
  return executeQuery(
    conn,
    { ...params, query: shape.normalized ?? rawQuery, max_rows: maxRows, include_deleted: true },
    state,
    "query.queryAll",
    "queryAll",
  );
}

async function executeQuery(
  conn: Connection,
  params: SfSoqlParams,
  state: SfSoqlSessionState,
  action: SoqlRunDigest["action"],
  operation: SoqlOperation,
): Promise<ToolResult> {
  try {
    const rawQuery = requireQuery(params);
    const shape = { ...parseSoql(rawQuery), operation, api: params.api ?? "rest" };
    const query = shape.normalized ?? rawQuery;
    const maxRows = clamp(params.max_rows ?? DEFAULT_MAX_ROWS, 1, HARD_MAX_ROWS);
    const started = Date.now();
    const apiMode: SoqlApiMode = params.api ?? "rest";
    const result =
      operation === "queryAll"
        ? await queryAll(conn, query, maxRows)
        : await restQuery(conn, query, apiMode, maxRows);
    const durationMs = Date.now() - started;
    const flattened = flattenRecords(result.records);
    const sampleRows = flattened.rows.slice(0, sampleRowLimit(params.output_mode));
    const summary = {
      action,
      operation,
      query,
      totalSize: result.totalSize,
      rowsReturned: result.records.length,
      done: result.done,
      durationMs,
    };
    const artifacts = await writeRunBundle({
      slug: shape.primary_object ?? operation,
      query,
      raw: result,
      flattened,
      summary,
    });
    const digest = buildDigest({
      action,
      status: operation === "queryAll" ? "warning" : "pass",
      icon: operation === "count" ? "🧮" : operation === "queryAll" ? "🕰️" : "⚡",
      title: titleFor(action, operation, shape.primary_object),
      org: { alias: params.target_org, api_version: apiVersion(conn) },
      meta: [apiMode.toUpperCase(), `${result.records.length} rows`],
      query: shape,
      result: {
        total_size: result.totalSize,
        rows_returned: result.records.length,
        done: result.done,
        next_records_url: result.nextRecordsUrl,
        columns: flattened.columns,
        sample_rows: sampleRows,
        duration_ms: durationMs,
      },
      api_calls: [apiCall("GET", apiPathFor(operation, apiMode), `maxRows=${maxRows}`)],
      sections: [
        ...(operation === "queryAll"
          ? [
              section("🕰️", "Scope Warning", [
                row("🗑️", "Deleted rows", "included where supported"),
                row("🛡️", "Reason", "queryAll / ALL ROWS requested explicitly"),
              ]),
            ]
          : []),
        section("📦", "Result Summary", [
          row("📦", "Rows returned", result.records.length),
          row("📊", "Total size", result.totalSize),
          row("🔁", "Complete", result.done),
          row("⏱️", "Duration", `${durationMs}ms`),
          row("📁", "Artifacts", artifacts.length),
        ]),
        section(
          "🧾",
          "Sample Table",
          sampleTableRows(flattened.columns, sampleRows, flattened.rows.length, params.output_mode),
        ),
      ],
      artifacts,
      output_mode: params.output_mode,
    });
    state.lastRunnable = params;
    state.lastDigest = digest;
    return toolResultFromDigest(digest);
  } catch (err) {
    return errorResult({ ...params, action }, err);
  }
}

function apiPathFor(operation: SoqlOperation, apiMode: SoqlApiMode): string {
  if (operation === "queryAll") return "/queryAll?q=SELECT...";
  if (apiMode === "tooling") return "/tooling/query?q=SELECT...";
  return "/query?q=SELECT...";
}

function titleFor(action: string, operation: SoqlOperation, objectName?: string): string {
  const base =
    action === "query.sample"
      ? "SOQL Sample"
      : operation === "count"
        ? "SOQL Count"
        : operation === "queryAll"
          ? "SOQL QueryAll"
          : "SOQL Run";
  return `${base}${objectName ? ` · ${objectName}` : ""}`;
}

function sampleTableRows(
  columns: string[],
  sampleRows: Record<string, string>[],
  totalRows: number,
  outputMode: SfSoqlParams["output_mode"],
) {
  const visibleColumns = columns.slice(0, outputMode === "inline" ? 8 : 5);
  if (!visibleColumns.length || (!sampleRows.length && totalRows === 0)) {
    return [row("ℹ️", "Rows", "No rows returned.")];
  }
  if (!sampleRows.length) return [row("📁", "Preview", "Suppressed; inspect artifacts.")];
  const widths = visibleColumns.map((column) =>
    Math.min(
      outputMode === "inline" ? 40 : 24,
      Math.max(column.length, ...sampleRows.map((sample) => displayCell(sample[column]).length)),
    ),
  );
  const header = visibleColumns.map((column, index) => padCell(column, widths[index])).join(" │ ");
  const rows = [row("📋", "Columns", header)];
  for (const [index, sample] of sampleRows.entries()) {
    rows.push(
      row(
        "🔹",
        `Row ${index + 1}`,
        visibleColumns
          .map((column, columnIndex) => padCell(displayCell(sample[column]), widths[columnIndex]))
          .join(" │ "),
      ),
    );
  }
  if (totalRows > sampleRows.length) {
    rows.push(row("…", "More rows", `+${totalRows - sampleRows.length} rows in artifacts`));
  }
  if (columns.length > visibleColumns.length) {
    rows.push(
      row("…", "More columns", `+${columns.length - visibleColumns.length} columns in artifacts`),
    );
  }
  return rows;
}

function sampleRowLimit(outputMode: SfSoqlParams["output_mode"]): number {
  if (outputMode === "file_only") return 0;
  return outputMode === "inline" ? 20 : 5;
}

function displayCell(value: string | undefined): string {
  return value || "—";
}

function padCell(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function lastHistory(state: SfSoqlSessionState): ToolResult {
  const digest = state.lastDigest;
  if (!digest) {
    return toolResultFromDigest(
      buildDigest({
        action: "history.last",
        status: "info",
        icon: "🔁",
        title: "SOQL History · empty",
        sections: [
          section("🔁", "History", [
            row("ℹ️", "Last run", "No sf_soql runs recorded in this session."),
          ]),
        ],
      }),
    );
  }
  return toolResultFromDigest({
    ...digest,
    action: "history.last",
    title: `SOQL History · ${digest.title}`,
  });
}

export async function rerunHistory(
  conn: Connection,
  params: SfSoqlParams,
  state: SfSoqlSessionState,
): Promise<ToolResult> {
  if (!state.lastRunnable) return lastHistory(state);
  const next = {
    ...state.lastRunnable,
    target_org: params.target_org ?? state.lastRunnable.target_org,
  };
  if (next.action === "query.explain") return explain(conn, next, state);
  if (next.action === "query.sample") return sampleQuery(conn, next, state);
  if (next.action === "query.count") return countQuery(conn, next, state);
  if (next.action === "query.queryAll") return runQueryAll(conn, next, state);
  return runQuery(conn, next, state);
}
