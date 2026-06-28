/* SPDX-License-Identifier: Apache-2.0 */
/** Relationship/subquery-aware SOQL result flattening for cards and artifacts. */

import type { QueryResultRecord } from "./types.ts";

const RELATIONSHIP_DEPTH = 8;
const SUBQUERY_DEPTH = 4;

export interface FlattenedRows {
  columns: string[];
  rows: Record<string, string>[];
  rawRows: Record<string, unknown>[];
}

export function flattenRecords(records: QueryResultRecord[]): FlattenedRows {
  const rawRows = records.filter(isRecord).flatMap((record) => flattenRecord(record));
  const columns = collectColumns(rawRows);
  const rows = rawRows.map((row) =>
    Object.fromEntries(columns.map((column) => [column, formatDisplayValue(row[column])])),
  );
  return { columns, rows, rawRows };
}

export function toCsv(flattened: FlattenedRows): string {
  if (!flattened.columns.length) return "";
  const header = flattened.columns.map(escapeCsv).join(",");
  const lines = flattened.rows.map((row) =>
    flattened.columns.map((column) => escapeCsv(row[column] ?? "")).join(","),
  );
  return [header, ...lines].join("\n");
}

function flattenRecord(
  record: Record<string, unknown>,
  depth = SUBQUERY_DEPTH,
  prefix = "",
): Record<string, unknown>[] {
  const base: Record<string, unknown> = {};
  const subqueries: Record<string, unknown>[][] = [];
  for (const [key, value] of Object.entries(record)) {
    if (key === "attributes") continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isSubquery(value)) {
      if (depth <= 0) {
        base[path] = value;
        continue;
      }
      const rows = value.records
        .filter(isRecord)
        .flatMap((child) => flattenRecord(child, depth - 1, path));
      if (rows.length) subqueries.push(rows);
      continue;
    }
    if (isRecord(value)) {
      flattenRelationship(base, path, value, RELATIONSHIP_DEPTH);
      continue;
    }
    base[path] = value;
  }
  if (!subqueries.length) return [base];
  const totalRows = subqueries.reduce((sum, rows) => sum + rows.length - 1, 1);
  const grid = Array.from({ length: totalRows }, () => ({}) as Record<string, unknown>);
  Object.assign(grid[0], base);
  let overflowStart = 1;
  for (const rows of subqueries) {
    Object.assign(grid[0], rows[0]);
    for (let i = 1; i < rows.length; i++) Object.assign(grid[overflowStart + i - 1], rows[i]);
    overflowStart += rows.length - 1;
  }
  return grid;
}

function flattenRelationship(
  out: Record<string, unknown>,
  prefix: string,
  value: Record<string, unknown>,
  depth: number,
): void {
  if (depth <= 0) {
    out[prefix] = value;
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key === "attributes") continue;
    const path = `${prefix}.${key}`;
    if (isRecord(nested) && !isSubquery(nested)) flattenRelationship(out, path, nested, depth - 1);
    else out[path] = nested;
  }
}

function collectColumns(rows: Record<string, unknown>[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return truncate(JSON.stringify(value));
  return truncate(String(value));
}

function truncate(value: string): string {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

function escapeCsv(value: string): string {
  return /[,"\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSubquery(
  value: unknown,
): value is { totalSize: number; done: boolean; records: unknown[] } {
  return (
    isRecord(value) &&
    typeof value.totalSize === "number" &&
    typeof value.done === "boolean" &&
    Array.isArray(value.records)
  );
}
