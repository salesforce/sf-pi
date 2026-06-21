/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared SOQL helper used by every resolver that queries the org.
 *
 * Centralizes:
 *   - URL construction for /query (data API) vs /tooling/query
 *   - SOQL IN-list quoting + dedup
 *   - "tolerate any error → null" semantics so resolvers never throw
 */

import type { Connection } from "@salesforce/core";
import { boundedSoqlQuery } from "../bounded-salesforce-transport.ts";

export type QueryEndpoint = "/query" | "/tooling/query";

export function soqlInList(names: readonly string[]): string {
  const unique = Array.from(new Set(names));
  // SOQL string literals require `\` and `'` to be escaped. Escape `\`
  // first so a literal backslash in `n` can't pair with the inserted `\`
  // from the quote-escape pass and re-enable the closing quote.
  return unique.map((n) => `'${n.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`).join(",");
}

export async function safeQueryRecords<T extends Record<string, unknown>>(
  conn: Connection,
  endpoint: QueryEndpoint,
  soql: string,
): Promise<T[] | null> {
  try {
    const res = await boundedSoqlQuery<T>(conn, soql, {
      api: endpoint === "/tooling/query" ? "tooling" : "data",
    });
    if (res.ok === false) return null;
    return res.records;
  } catch {
    return null;
  }
}

/**
 * Run a `SELECT <nameField> FROM <sobject> WHERE <nameField> IN (...)`
 * query and return the set of resolved name values. Returns `null` on
 * any error (network, auth, INVALID_TYPE, etc.) so the caller treats
 * that as "couldn't verify".
 */
export async function safeNamesQuery(
  conn: Connection,
  endpoint: QueryEndpoint,
  sobject: string,
  nameField: string,
  names: readonly string[],
): Promise<Set<string> | null> {
  if (names.length === 0) return new Set();
  const soql = `SELECT ${nameField} FROM ${sobject} WHERE ${nameField} IN (${soqlInList(names)})`;
  const records = await safeQueryRecords<Record<string, unknown>>(conn, endpoint, soql);
  if (!records) return null;
  const found = new Set<string>();
  for (const r of records) {
    const v = r[nameField];
    if (typeof v === "string") found.add(v);
  }
  return found;
}
