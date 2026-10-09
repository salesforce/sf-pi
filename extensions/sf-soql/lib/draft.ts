/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic, API-aware SOQL draft generation from explicit inputs. */

import type { SoqlConnection as Connection } from "./api.ts";
import { apiVersion, parserApiVersion } from "./api.ts";
import { buildDigest, finding, row, section, toolResultFromDigest } from "./digest.ts";
import { parseSoql } from "./parser.ts";
import { resolutionReason, resolveSchemaCandidates } from "./resolver.ts";
import { validateSchemaShape } from "./schema-validator.ts";
import type {
  SfSoqlParams,
  SfSoqlSessionState,
  SoqlApiMode,
  SoqlFinding,
  ToolResult,
} from "./types.ts";

const DEFAULT_FIELDS = ["Id", "Name"];

export async function queryDraft(
  conn: Connection,
  params: SfSoqlParams,
  state?: SfSoqlSessionState,
): Promise<ToolResult> {
  const objectName = params.object?.trim();
  if (!objectName) throw new Error("object is required for query.draft.");
  const requestedFields = params.fields?.length ? params.fields : DEFAULT_FIELDS;
  const resolution = await resolveSchemaCandidates(conn, params, objectName, state);
  const matchingCandidates = resolution.candidates.filter((candidate) => {
    const names = new Set(candidate.describe.fields.map((field) => field.name.toLowerCase()));
    return requestedFields.every((field) => field.includes(".") || names.has(field.toLowerCase()));
  });
  const selected = selectDraftCandidate(
    matchingCandidates.length ? matchingCandidates : resolution.candidates,
    params.api ?? "auto",
  );
  if (!selected)
    throw resolution.errors[0]?.error ?? new Error(`No schema found for ${objectName}.`);
  const describe = selected.describe;
  const fieldNames = new Set(describe.fields.map((field) => field.name.toLowerCase()));
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
  const shape = {
    ...parseSoql(query, { apiVersion: parserApiVersion(conn), context: "api" }),
    api: selected.api,
  };
  if (shape.syntax_errors?.length) {
    findings.push(
      ...shape.syntax_errors.map((error) =>
        finding("error", "❌", "Syntax", `${error.line}:${error.column} ${error.message}`),
      ),
    );
  }
  findings.push(...(await validateSchemaShape(conn, describe, shape, selected.api, state)));
  const reason = resolutionReason(
    params.api ?? "auto",
    resolution.candidates,
    selected.api,
    matchingCandidates.length === 1 && resolution.candidates.length > 1 ? selected.api : undefined,
  );
  const hasErrors = findings.some((item) => item.severity === "error");
  const hasWarnings = findings.some((item) => item.severity === "warning");
  const digest = buildDigest({
    action: "query.draft",
    status: hasErrors ? "fail" : hasWarnings ? "warning" : "pass",
    icon: "📝",
    title: `SOQL Draft · ${objectName}`,
    org: { alias: params.target_org, api_version: apiVersion(conn) },
    meta: [selected.api.toUpperCase()],
    query: shape,
    validation: {
      verdict: hasErrors ? "invalid" : hasWarnings ? "review" : "safe",
      findings,
    },
    api_resolution: {
      requested: params.api ?? "auto",
      resolved: selected.api,
      reason,
    },
    api_calls: resolution.apiCalls,
    sections: [
      section("📝", "Draft", [
        row("🎯", "Intent", params.intent),
        row("🧾", "Object", objectName),
        row("🧭", "API", selected.api.toUpperCase()),
        row("🧩", "Fields", usableFields.join(", ")),
        row("🔎", "Filters", filters.join(" AND ")),
        row("↕️", "Order", orderBy),
        row("📦", "Limit", limit),
      ]),
      section(
        "🛡️",
        "Findings",
        findings.map((item) => row(item.icon, item.label, item.message)),
      ),
    ],
  });
  return toolResultFromDigest(digest);
}

function selectDraftCandidate<T extends { api: SoqlApiMode }>(
  candidates: T[],
  requestedApi: NonNullable<SfSoqlParams["api"]>,
): T | undefined {
  if (requestedApi !== "auto")
    return candidates.find((candidate) => candidate.api === requestedApi);
  return candidates.find((candidate) => candidate.api === "rest") ?? candidates[0];
}
