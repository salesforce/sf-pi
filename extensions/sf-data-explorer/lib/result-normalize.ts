/* SPDX-License-Identifier: Apache-2.0 */
import type { ExplorerMode, RunResult, SpaRow } from "./types.ts";

export interface CoreQueryResponse {
  totalSize: number;
  done: boolean;
  records: Array<Record<string, unknown>>;
  nextRecordsUrl?: string;
}

export type CoreSearchResponse =
  | Array<Record<string, unknown>>
  | { searchRecords?: Array<Record<string, unknown>>; [key: string]: unknown };

export interface Data360SqlResponse {
  data?: unknown[][];
  metadata?: Array<{ name?: string; type?: string; nullable?: boolean }>;
  returnedRows?: number;
  status?: unknown;
}

function withoutAttributes(record: Record<string, unknown>): SpaRow {
  const out: SpaRow = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "attributes") continue;
    out[key] = value;
  }
  return out;
}

function columnsFromRows(rows: SpaRow[], preferred: string[] = []): string[] {
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const c of preferred) {
    if (c && !seen.has(c)) {
      seen.add(c);
      columns.push(c);
    }
  }
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

export function normalizeCoreQueryResult(
  raw: CoreQueryResponse,
  args: { query: string; targetOrg: string; apiVersion?: string; preferredColumns?: string[] },
): RunResult {
  const rows = (raw.records ?? []).map(withoutAttributes);
  return {
    rows,
    columns: columnsFromRows(rows, args.preferredColumns),
    totalReturned: raw.totalSize ?? rows.length,
    raw,
    query: args.query,
    mode: "soql",
    targetOrg: args.targetOrg,
    apiVersion: args.apiVersion,
  };
}

export function normalizeCoreSearchResult(
  raw: CoreSearchResponse,
  args: { query: string; targetOrg: string; apiVersion?: string; preferredColumns?: string[] },
): RunResult {
  const records = Array.isArray(raw) ? raw : (raw?.searchRecords ?? []);
  const rows = records.map((record) => {
    const attrs = record.attributes as { type?: string } | undefined;
    return { ...(attrs?.type ? { _object: attrs.type } : {}), ...withoutAttributes(record) };
  });
  return {
    rows,
    columns: columnsFromRows(rows, ["_object", ...(args.preferredColumns ?? [])]),
    totalReturned: rows.length,
    raw,
    query: args.query,
    mode: "sosl",
    targetOrg: args.targetOrg,
    apiVersion: args.apiVersion,
  };
}

export function normalizeData360SqlResult(
  raw: Data360SqlResponse,
  args: { query: string; targetOrg: string; apiVersion?: string },
): RunResult {
  const columns = (raw.metadata ?? []).map((m, i) => m.name || `col_${i + 1}`);
  const rows: SpaRow[] = (raw.data ?? []).map((row) => {
    const out: SpaRow = {};
    row.forEach((value, i) => {
      out[columns[i] ?? `col_${i + 1}`] = value;
    });
    return out;
  });
  return {
    rows,
    columns,
    totalReturned: raw.returnedRows ?? rows.length,
    raw,
    query: args.query,
    mode: "sql",
    targetOrg: args.targetOrg,
    apiVersion: args.apiVersion,
  };
}

export function modeLabel(mode: ExplorerMode): string {
  if (mode === "soql") return "SOQL";
  if (mode === "sosl") return "SOSL";
  return "Data 360 SQL";
}
