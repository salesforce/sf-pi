/* SPDX-License-Identifier: Apache-2.0 */
/** Local .soql and Apex embedded SOQL diagnostics. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Connection } from "@salesforce/core";
import { apiVersion } from "./api.ts";
import { buildDigest, finding, row, section, toolResultFromDigest } from "./digest.ts";
import { parseSoql } from "./parser.ts";
import type { SfSoqlParams, SoqlFinding, ToolResult } from "./types.ts";
import { validateQuery } from "./validator.ts";

export async function diagnoseFile(
  conn: Connection,
  params: SfSoqlParams,
  cwd: string,
): Promise<ToolResult> {
  const file = params.file?.trim();
  if (!file) throw new Error("file is required for file.diagnose.");
  const filePath = path.resolve(cwd, file);
  const text = await readFile(filePath, "utf8");
  const queries = extractQueries(filePath, text);
  const findings: SoqlFinding[] = [];
  const rows = [];
  for (const [index, query] of queries.entries()) {
    const validation = await validateQuery(conn, {
      action: "query.validate",
      target_org: params.target_org,
      query,
      include_plan: params.include_plan,
    });
    const digest = validation.details.digest as
      { status?: string; validation?: { findings?: SoqlFinding[] } } | undefined;
    const queryFindings =
      digest?.validation?.findings?.filter((item) => item.severity !== "info") ?? [];
    findings.push(
      ...queryFindings.map((item) => ({ ...item, label: `Query ${index + 1} ${item.label}` })),
    );
    rows.push(
      row(
        digest?.status === "fail" ? "❌" : queryFindings.length ? "⚠️" : "✅",
        `Query ${index + 1}`,
        summarizeQuery(query),
      ),
    );
  }
  if (!queries.length)
    findings.push(finding("warning", "⚠️", "No Queries", "No SOQL query was found in this file."));

  const status = findings.some((item) => item.severity === "error")
    ? "fail"
    : findings.some((item) => item.severity === "warning")
      ? "warning"
      : "pass";
  const digest = buildDigest({
    action: "file.diagnose",
    status,
    icon: "📄",
    title: `SOQL File Diagnose · ${path.basename(filePath)}`,
    org: { alias: params.target_org, api_version: apiVersion(conn) },
    validation: {
      verdict: status === "fail" ? "invalid" : status === "warning" ? "review" : "safe",
      findings,
    },
    api_calls: [
      { method: "READ", path: path.basename(filePath), detail: `queries=${queries.length}` },
    ],
    sections: [
      section("📄", "Queries", rows.length ? rows : [row("⚠️", "Queries", "No SOQL found")]),
      section(
        "🛡️",
        "Findings",
        findings.length
          ? findings.map((item) => row(item.icon, item.label, item.message))
          : [row("✅", "Validation", "All discovered queries passed validation.")],
      ),
    ],
  });
  return toolResultFromDigest(digest);
}

function extractQueries(filePath: string, text: string): string[] {
  if (filePath.endsWith(".soql")) return [text.trim()].filter(Boolean);
  if (filePath.endsWith(".cls") || filePath.endsWith(".trigger"))
    return extractApexBracketQueries(text);
  return [text.trim()].filter((query) => /^SELECT\b/i.test(query));
}

function extractApexBracketQueries(text: string): string[] {
  const queries: string[] = [];
  const re = /\[\s*(SELECT\b[\s\S]*?)\]/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) queries.push(match[1].replace(/\s+/g, " ").trim());
  return queries;
}

function summarizeQuery(query: string): string {
  const shape = parseSoql(query);
  return `${shape.primary_object ?? "Unknown"}: ${query.replace(/\s+/g, " ")}`;
}
