/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pure Agent Platform Tracing helpers.
 *
 * This module intentionally registers no pi tool and performs no network I/O.
 * The d360_api tool owns transport; these helpers own the deterministic parts
 * that are worth testing: bounded SQL snippets, span normalization, trace-tree
 * reconstruction, and compact summaries.
 */

import { normalizeTimestampLiteral } from "../sql.ts";

export const APT_SPAN_DMO = "ssot__TelemetryTraceSpan__dlm";
export const APT_SPAN_DLO = "ObservabilitySpans__dll";
export const APT_ROOT_PARENT_SPAN_ID = "0000000000000000";

export const APT_SPAN_FIELDS = [
  "ssot__Id__c",
  "ssot__TelemetryTrace__c",
  "ssot__TelemetryParentSpanId__c",
  "ssot__OperationName__c",
  "ssot__ServiceName__c",
  "ssot__StatusCode__c",
  "ssot__DurationNumber__c",
  "ssot__StartDateTime__c",
  "ssot__EndDateTime__c",
  "ssot__TelemetrySpanAttributeText__c",
] as const;

export interface TraceSqlOptions {
  /** Optional lower bound. Accepts YYYY-MM-DD or ISO-ish UTC timestamp strings. */
  since?: string;
  /** Default depends on query shape; always clamped to a small bounded value. */
  limit?: number;
}

export interface NormalizedPlatformSpan {
  id: string;
  traceId?: string;
  parentSpanId?: string;
  operationName?: string;
  serviceName?: string;
  statusCode?: string;
  durationNanos?: number;
  durationMs?: number;
  startDateTime?: string;
  endDateTime?: string;
  attributesText?: string;
  attributes?: unknown;
  raw: Record<string, unknown>;
}

export interface SpanTreeNode extends NormalizedPlatformSpan {
  children: SpanTreeNode[];
  depth: number;
  orphanParentId?: string;
}

export interface SpanTree {
  roots: SpanTreeNode[];
  nodesById: Record<string, SpanTreeNode>;
  orphanCount: number;
}

export interface SpanTreeSummary {
  totalSpans: number;
  rootCount: number;
  orphanCount: number;
  errorCount: number;
  maxDepth: number;
  totalDurationMs: number;
  slowestSpan?: Pick<
    NormalizedPlatformSpan,
    "id" | "operationName" | "statusCode" | "durationMs" | "traceId"
  >;
  errorOperations: string[];
}

export function buildFindErrorSpansSql(opts: TraceSqlOptions = {}): string {
  const where = ["ssot__StatusCode__c = 'ERROR'", ...sincePredicate(opts.since)];
  return [
    `SELECT ${APT_SPAN_FIELDS.join(", ")}`,
    `FROM "${APT_SPAN_DMO}"`,
    `WHERE ${where.join(" AND ")}`,
    "ORDER BY ssot__StartDateTime__c DESC",
    `LIMIT ${boundedLimit(opts.limit, 20, 200)}`,
  ].join("\n");
}

export function buildTraceTreeSql(traceId: string, opts: TraceSqlOptions = {}): string {
  const cleaned = requiredString(traceId, "traceId");
  return [
    `SELECT ${APT_SPAN_FIELDS.join(", ")}`,
    `FROM "${APT_SPAN_DMO}"`,
    `WHERE ssot__TelemetryTrace__c = ${sqlString(cleaned)}`,
    "ORDER BY ssot__StartDateTime__c ASC",
    `LIMIT ${boundedLimit(opts.limit, 500, 2_000)}`,
  ].join("\n");
}

export function buildOperationPerformanceSql(opts: TraceSqlOptions = {}): string {
  return [
    "SELECT ssot__OperationName__c AS operation_name,",
    "       AVG(ssot__DurationNumber__c) AS avg_duration_nanos,",
    "       MAX(ssot__DurationNumber__c) AS max_duration_nanos,",
    "       COUNT(*) AS span_count",
    `FROM "${APT_SPAN_DMO}"`,
    ...whereClause(sincePredicate(opts.since)),
    "GROUP BY ssot__OperationName__c",
    `LIMIT ${boundedLimit(opts.limit, 20, 100)}`,
  ].join("\n");
}

export function normalizePlatformSpanRow(row: Record<string, unknown>): NormalizedPlatformSpan {
  const id = requiredString(
    firstString(row, ["ssot__Id__c", "span_id", "spanId", "id"]),
    "span id",
  );
  const durationNanos = firstNumber(row, ["ssot__DurationNumber__c", "duration_nanos"]);
  const attributesText = firstString(row, [
    "ssot__TelemetrySpanAttributeText__c",
    "attributes_text",
    "attributes",
  ]);

  return {
    id,
    traceId: firstString(row, ["ssot__TelemetryTrace__c", "trace_id", "traceId"]),
    parentSpanId: emptySentinelToUndefined(
      firstString(row, ["ssot__TelemetryParentSpanId__c", "parent_span_id", "parentSpanId"]),
    ),
    operationName: firstString(row, ["ssot__OperationName__c", "operation_name", "operationName"]),
    serviceName: firstString(row, ["ssot__ServiceName__c", "service_name", "serviceName"]),
    statusCode: firstString(row, ["ssot__StatusCode__c", "status_code", "statusCode"]),
    durationNanos,
    durationMs: durationNanos === undefined ? undefined : durationNanos / 1_000_000,
    startDateTime: firstString(row, ["ssot__StartDateTime__c", "start", "startDateTime"]),
    endDateTime: firstString(row, ["ssot__EndDateTime__c", "end", "endDateTime"]),
    attributesText,
    attributes: parseAttributes(attributesText),
    raw: row,
  };
}

export function buildSpanTree(spans: NormalizedPlatformSpan[]): SpanTree {
  const nodesById: Record<string, SpanTreeNode> = {};
  for (const span of spans) {
    if (nodesById[span.id]) continue;
    nodesById[span.id] = { ...span, children: [], depth: 0 };
  }

  const roots: SpanTreeNode[] = [];
  let orphanCount = 0;

  for (const node of Object.values(nodesById)) {
    const parentId = emptySentinelToUndefined(node.parentSpanId);
    if (!parentId) {
      roots.push(node);
      continue;
    }

    const parent = nodesById[parentId];
    if (!parent) {
      node.orphanParentId = parentId;
      roots.push(node);
      orphanCount++;
      continue;
    }
    parent.children.push(node);
  }

  for (const root of roots) assignDepthAndSort(root, 0);
  roots.sort(compareSpanNodes);

  return { roots, nodesById, orphanCount };
}

export function summarizeSpanTree(tree: SpanTree): SpanTreeSummary {
  const nodes = Object.values(tree.nodesById);
  const errors = nodes.filter((node) => node.statusCode === "ERROR");
  const slowest = nodes
    .filter((node) => typeof node.durationMs === "number")
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))[0];

  return {
    totalSpans: nodes.length,
    rootCount: tree.roots.length,
    orphanCount: tree.orphanCount,
    errorCount: errors.length,
    maxDepth: nodes.reduce((max, node) => Math.max(max, node.depth), 0),
    totalDurationMs: nodes.reduce((sum, node) => sum + (node.durationMs ?? 0), 0),
    slowestSpan: slowest
      ? {
          id: slowest.id,
          traceId: slowest.traceId,
          operationName: slowest.operationName,
          statusCode: slowest.statusCode,
          durationMs: slowest.durationMs,
        }
      : undefined,
    errorOperations: uniqueSorted(errors.map((node) => node.operationName ?? node.id)),
  };
}

function whereClause(predicates: string[]): string[] {
  return predicates.length ? [`WHERE ${predicates.join(" AND ")}`] : [];
}

function sincePredicate(since: string | undefined): string[] {
  const normalized = normalizeTimestampLiteral(since);
  return normalized ? [`ssot__StartDateTime__c >= TIMESTAMP ${sqlString(normalized)}`] : [];
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function boundedLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value), max));
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required ${label}.`);
  }
  return value.trim();
}

function firstString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim() && value !== "NOT_SET") return value.trim();
  }
  return undefined;
}

function firstNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function emptySentinelToUndefined(value: string | undefined): string | undefined {
  if (!value || value === APT_ROOT_PARENT_SPAN_ID || value === "NOT_SET") return undefined;
  return value;
}

function parseAttributes(value: string | undefined): unknown | undefined {
  if (!value || value === "{}") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function assignDepthAndSort(node: SpanTreeNode, depth: number): void {
  node.depth = depth;
  node.children.sort(compareSpanNodes);
  for (const child of node.children) assignDepthAndSort(child, depth + 1);
}

function compareSpanNodes(a: SpanTreeNode, b: SpanTreeNode): number {
  const time = Date.parse(a.startDateTime ?? "") - Date.parse(b.startDateTime ?? "");
  if (Number.isFinite(time) && time !== 0) return time;
  return a.id.localeCompare(b.id);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
