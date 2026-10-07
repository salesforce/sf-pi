/* SPDX-License-Identifier: Apache-2.0 */
/** Pure SQL helpers shared by sf_data360 observability and query actions. */

export interface QuerySqlResponse {
  data?: unknown[][];
  metadata?: Array<{ name?: string }>;
  errorCode?: string;
  message?: string;
  status?: unknown;
}

export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required ${label}.`);
  }
  return value.trim();
}

export function boundedLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value), max));
}

export function normalizeTimestampLiteral(input: unknown): string | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  if (typeof input !== "string") throw new Error("since must be a string timestamp.");
  const trimmed = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z?)?$/.test(trimmed)) {
    throw new Error(
      "since must be YYYY-MM-DD or an ISO-like UTC timestamp, e.g. 2026-05-01T00:00:00Z.",
    );
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed} 00:00:00`;
  return trimmed.replace("T", " ").replace(/Z$/, "");
}

export function sinceTimestampPredicate(field: string, since: unknown): string[] {
  const normalized = normalizeTimestampLiteral(since);
  return normalized ? [`${field} >= TIMESTAMP ${sqlString(normalized)}`] : [];
}

export function rowsFromQuery(response: QuerySqlResponse): Array<Record<string, unknown>> {
  const names = (response.metadata ?? []).map((m, index) => m.name ?? `col_${index}`);
  return (response.data ?? []).map((row) =>
    Object.fromEntries(names.map((name, index) => [name, row[index]])),
  );
}

export function firstCell(response: QuerySqlResponse): unknown {
  return response.data?.[0]?.[0];
}
