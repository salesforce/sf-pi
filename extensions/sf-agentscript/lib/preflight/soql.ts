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
import { connRequest } from "../../../../lib/common/sf-conn/request.ts";

export type QueryEndpoint = "/query" | "/tooling/query";

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
  const unique = Array.from(new Set(names));
  const inList = unique.map((n) => `'${n.replace(/'/g, "\\'")}'`).join(",");
  const soql = `SELECT ${nameField} FROM ${sobject} WHERE ${nameField} IN (${inList})`;
  try {
    const url = `${endpoint}?q=${encodeURIComponent(soql)}`;
    const res = await connRequest<{ records?: Array<Record<string, unknown>> }>(conn, {
      method: "GET",
      url,
    });
    if (res.status >= 400) return null;
    const found = new Set<string>();
    for (const r of res.body?.records ?? []) {
      const v = r[nameField];
      if (typeof v === "string") found.add(v);
    }
    return found;
  } catch {
    return null;
  }
}
