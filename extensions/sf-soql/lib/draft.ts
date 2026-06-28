/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic SOQL draft generation from explicit intent/object/fields/filters. */

import type { Connection } from "@salesforce/core";
import { apiCall, apiVersion, describeSObject } from "./api.ts";
import { buildDigest, finding, row, section, toolResultFromDigest } from "./digest.ts";
import { parseSoql } from "./parser.ts";
import type { SfSoqlParams, SoqlFinding, ToolResult } from "./types.ts";

const DEFAULT_FIELDS = ["Id", "Name"];

export async function queryDraft(conn: Connection, params: SfSoqlParams): Promise<ToolResult> {
  const objectName = params.object?.trim();
  if (!objectName) throw new Error("object is required for query.draft.");
  const describe = await describeSObject(conn, objectName);
  const fieldNames = new Set(describe.fields.map((field) => field.name.toLowerCase()));
  const requestedFields = params.fields?.length ? params.fields : DEFAULT_FIELDS;
  const usableFields = requestedFields.filter(
    (field) => fieldNames.has(field.toLowerCase()) || field.includes("."),
  );
  const findings: SoqlFinding[] = [];
  for (const field of requestedFields) {
    if (!usableFields.includes(field)) {
      findings.push(
        finding(
          "warning",
          "⚠️",
          "Field",
          `${field} was not found on ${objectName} and was omitted.`,
        ),
      );
    }
  }
  if (!usableFields.length) usableFields.push("Id");
  const filters = params.filters?.map((filter) => filter.trim()).filter(Boolean) ?? [];
  const orderBy = params.order_by?.trim();
  const limit = Math.max(1, Math.min(2000, params.max_rows ?? params.limit ?? 50));
  const query = [
    `SELECT ${usableFields.join(", ")}`,
    `FROM ${objectName}`,
    filters.length ? `WHERE ${filters.join(" AND ")}` : undefined,
    orderBy ? `ORDER BY ${orderBy}` : undefined,
    `LIMIT ${limit}`,
  ]
    .filter(Boolean)
    .join(" ");
  const shape = parseSoql(query);
  const digest = buildDigest({
    action: "query.draft",
    status: findings.some((item) => item.severity === "warning") ? "warning" : "pass",
    icon: "📝",
    title: `SOQL Draft · ${objectName}`,
    org: { alias: params.target_org, api_version: apiVersion(conn) },
    query: shape,
    validation: {
      verdict: findings.length ? "review" : "safe",
      findings: findings.length
        ? findings
        : [
            finding(
              "info",
              "✅",
              "Draft",
              "Draft query uses verified top-level fields and an explicit LIMIT.",
            ),
          ],
    },
    api_calls: [
      apiCall("GET", `/sobjects/${objectName}/describe`, `fields=${describe.fields.length}`),
    ],
    sections: [
      section("📝", "Draft", [
        row("🎯", "Intent", params.intent),
        row("🧾", "Object", objectName),
        row("🧩", "Fields", usableFields.join(", ")),
        row("🔎", "Filters", filters.join(" AND ")),
        row("↕️", "Order", orderBy),
        row("📦", "Limit", limit),
      ]),
      section(
        "🛡️",
        "Findings",
        (findings.length
          ? findings
          : [finding("info", "✅", "Draft", "Ready for query.validate or query.sample.")]
        ).map((item) => row(item.icon, item.label, item.message)),
      ),
    ],
  });
  return toolResultFromDigest(digest);
}
