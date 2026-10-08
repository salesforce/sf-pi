/* SPDX-License-Identifier: Apache-2.0 */
/** Bounded API-aware schema search for SOQL object discovery. */

import type { SoqlConnection as Connection } from "./api.ts";
import { apiCall, apiVersion, listSObjects, sobjectsPath } from "./api.ts";
import { buildDigest, row, section, toolResultFromDigest } from "./digest.ts";
import type { SfSoqlParams, SObjectCatalogEntry, SoqlApiMode, ToolResult } from "./types.ts";

export async function schemaSearch(conn: Connection, params: SfSoqlParams): Promise<ToolResult> {
  const term = (params.query ?? params.object ?? "").trim().toLowerCase();
  if (!term) throw new Error("query or object is required for schema.search.");
  const limit = Math.max(1, Math.min(50, params.limit ?? params.max_rows ?? 15));
  const requestedApi = params.api ?? "auto";
  const modes: SoqlApiMode[] = requestedApi === "auto" ? ["rest", "tooling"] : [requestedApi];
  const settled = await Promise.allSettled(
    modes.map(async (api) => ({ api, result: await listSObjects(conn, api) })),
  );
  const successful = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (!successful.length) {
    const failure = settled.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  const merged = mergeObjects(successful);
  const matches = [...merged.values()]
    .filter((entry) => entry.object.queryable !== false)
    .map((entry) => ({
      name: entry.object.name,
      label: entry.object.label,
      searchable: entry.object.searchable,
      apis: [...entry.apis].sort(),
      score: scoreObject(term, entry.object.name, entry.object.label, entry.object.labelPlural),
    }))
    .filter((object) => object.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, limit);

  const digest = buildDigest({
    action: "schema.search",
    status: matches.length ? "pass" : "warning",
    icon: "🔍",
    title: `SOQL Schema Search · ${params.query ?? params.object}`,
    org: { alias: params.target_org, api_version: apiVersion(conn) },
    meta: [`matches=${matches.length}`, `api=${requestedApi}`],
    api_resolution: {
      requested: requestedApi,
      resolved: requestedApi === "auto" ? undefined : requestedApi,
      reason: requestedApi === "auto" ? "searched REST and Tooling catalogs" : "explicit selection",
    },
    api_calls: successful.map(({ api }) =>
      apiCall("GET", conn.path(sobjectsPath(api)), `query=${term} · api=${api}`),
    ),
    sections: [
      section(
        "🔍",
        "Matches",
        matches.length
          ? matches.map((match) =>
              row(
                "🔹",
                match.name,
                `${match.label ?? match.name} · ${match.apis.join("/").toUpperCase()}${match.searchable ? " · searchable" : ""}`,
              ),
            )
          : [row("⚠️", "No matches", "Try a different object API name or label fragment.")],
      ),
    ],
  });
  return toolResultFromDigest(digest);
}

function mergeObjects(
  results: Array<{ api: SoqlApiMode; result: { sobjects?: SObjectCatalogEntry[] } }>,
): Map<string, { object: SObjectCatalogEntry; apis: Set<SoqlApiMode> }> {
  const merged = new Map<string, { object: SObjectCatalogEntry; apis: Set<SoqlApiMode> }>();
  for (const { api, result } of results) {
    for (const object of result.sobjects ?? []) {
      const key = object.name.toLowerCase();
      const existing = merged.get(key);
      if (existing) existing.apis.add(api);
      else merged.set(key, { object, apis: new Set([api]) });
    }
  }
  return merged;
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
