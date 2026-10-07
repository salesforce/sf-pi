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

export function normalizeTimestampLiteral(
  input: unknown,
  now: Date = new Date(),
): string | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  if (typeof input !== "string") throw new Error("since must be a string timestamp.");
  const trimmed = input.trim();
  const relative = relativeTimestamp(trimmed, now);
  if (relative) return relative;
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z?)?$/.test(trimmed)) {
    throw new Error(
      "since must be YYYY-MM-DD, an ISO-like UTC timestamp, or a relative window such as 24h, 7d, yesterday, or last 30 minutes.",
    );
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed} 00:00:00`;
  return trimmed.replace("T", " ").replace(/Z$/, "");
}

function relativeTimestamp(value: string, now: Date): string | undefined {
  const normalized = value.toLowerCase().replace(/\s+/g, " ");
  if (normalized === "today" || normalized === "yesterday") {
    const start = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - Number(normalized === "yesterday"),
      ),
    );
    return sqlTimestamp(start);
  }
  const compact = normalized.match(/^(\d+)(m|h|d|w)$/);
  const verbose = normalized.match(/^last (\d+) (minute|minutes|hour|hours|day|days|week|weeks)$/);
  if (!compact && !verbose) return undefined;
  const amount = Number(compact?.[1] ?? verbose?.[1]);
  const unit = compact?.[2] ?? verbose?.[2]?.replace(/s$/, "");
  const unitMs =
    unit === "m" || unit === "minute"
      ? 60_000
      : unit === "h" || unit === "hour"
        ? 3_600_000
        : unit === "d" || unit === "day"
          ? 86_400_000
          : 604_800_000;
  return sqlTimestamp(new Date(now.getTime() - amount * unitMs));
}

function sqlTimestamp(value: Date): string {
  return value.toISOString().slice(0, 19).replace("T", " ");
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
