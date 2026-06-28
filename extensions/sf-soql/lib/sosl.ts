/* SPDX-License-Identifier: Apache-2.0 */
/** Native SOSL search execution for sf-soql. */

import type { Connection } from "@salesforce/core";
import { apiCall, apiVersion, soslSearch } from "./api.ts";
import { writeSoqlArtifact } from "./artifacts.ts";
import { buildDigest, row, section, toolResultFromDigest } from "./digest.ts";
import { errorResult } from "./errors.ts";
import { flattenRecords } from "./flattener.ts";
import type { SfSoqlParams, ToolResult } from "./types.ts";

export async function runSosl(conn: Connection, params: SfSoqlParams): Promise<ToolResult> {
  try {
    const query = params.query?.trim();
    if (!query) throw new Error("query is required for sosl.run.");
    const maxRows = Math.max(1, Math.min(200, params.max_rows ?? params.limit ?? 25));
    const result = await soslSearch(conn, query);
    const records = (result.searchRecords ?? []).slice(0, maxRows);
    const flattened = flattenRecords(records);
    const artifact = await writeSoqlArtifact("sosl", `${Date.now()}-search.json`, {
      query,
      result,
    });
    const digest = buildDigest({
      action: "sosl.run",
      status: "pass",
      icon: "🔎",
      title: "SOSL Run",
      org: { alias: params.target_org, api_version: apiVersion(conn) },
      meta: [`${records.length} records`],
      api_calls: [apiCall("GET", "/search?q=FIND...", `maxRows=${maxRows}`)],
      sections: [
        section("📦", "Result Summary", [
          row("📦", "Records", records.length),
          row("📁", "Artifacts", 1),
        ]),
        section(
          "🧾",
          "Sample Records",
          flattened.rows.length
            ? flattened.rows
                .slice(0, 5)
                .map((sample, index) => row("🔹", `Record ${index + 1}`, compact(sample)))
            : [row("ℹ️", "Records", "No SOSL records returned.")],
        ),
      ],
      artifacts: [artifact],
    });
    return toolResultFromDigest(digest);
  } catch (err) {
    return errorResult(params, err);
  }
}

function compact(rowValue: Record<string, string>): string {
  return Object.entries(rowValue)
    .slice(0, 5)
    .map(([key, value]) => `${key}=${value || "—"}`)
    .join(" · ");
}
