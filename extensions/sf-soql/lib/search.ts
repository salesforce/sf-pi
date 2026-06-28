/* SPDX-License-Identifier: Apache-2.0 */
/** Bounded schema search for SOQL object discovery. */

import type { Connection } from "@salesforce/core";
import { apiCall, apiVersion, listSObjects } from "./api.ts";
import { buildDigest, row, section, toolResultFromDigest } from "./digest.ts";
import type { SfSoqlParams, ToolResult } from "./types.ts";

export async function schemaSearch(conn: Connection, params: SfSoqlParams): Promise<ToolResult> {
  const term = (params.query ?? params.object ?? "").trim().toLowerCase();
  if (!term) throw new Error("query or object is required for schema.search.");
  const limit = Math.max(1, Math.min(50, params.limit ?? params.max_rows ?? 15));
  const result = await listSObjects(conn);
  const matches = (result.sobjects ?? [])
    .filter((obj) => obj.queryable !== false)
    .map((obj) => ({
      name: obj.name,
      label: obj.label,
      searchable: obj.searchable,
      score: scoreObject(term, obj.name, obj.label, obj.labelPlural),
    }))
    .filter((obj) => obj.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);

  const digest = buildDigest({
    action: "schema.search",
    status: matches.length ? "pass" : "warning",
    icon: "🔍",
    title: `SOQL Schema Search · ${params.query ?? params.object}`,
    org: { alias: params.target_org, api_version: apiVersion(conn) },
    meta: [`matches=${matches.length}`],
    api_calls: [apiCall("GET", `/services/data/v${apiVersion(conn)}/sobjects`, `query=${term}`)],
    sections: [
      section(
        "🔍",
        "Matches",
        matches.length
          ? matches.map((match) =>
              row(
                "🔹",
                match.name,
                `${match.label ?? match.name}${match.searchable ? " · searchable" : ""}`,
              ),
            )
          : [row("⚠️", "No matches", "Try a different object API name or label fragment.")],
      ),
    ],
  });
  return toolResultFromDigest(digest);
}

function scoreObject(term: string, name: string, label?: string, labelPlural?: string): number {
  const values = [name, label, labelPlural]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  if (values.some((value) => value === term)) return 100;
  if (values.some((value) => value.startsWith(term))) return 75;
  if (values.some((value) => value.includes(term))) return 50;
  return 0;
}
