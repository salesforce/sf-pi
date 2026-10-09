/* SPDX-License-Identifier: Apache-2.0 */
/** Local .soql and Apex embedded SOQL diagnostics. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SoqlConnection as Connection } from "./api.ts";
import { apiVersion, parserApiVersion } from "./api.ts";
import { extractStaticSoqlQueries, type EmbeddedSoqlQuery } from "./apex-query-extractor.ts";
import { buildDigest, finding, row, section, toolResultFromDigest } from "./digest.ts";
import { parseSoql } from "./parser.ts";
import type {
  SfSoqlParams,
  SfSoqlSessionState,
  SoqlFinding,
  SoqlParseContext,
  ToolResult,
} from "./types.ts";
import { validateQuery } from "./validator.ts";

export async function diagnoseFile(
  conn: Connection,
  params: SfSoqlParams,
  cwd: string,
  state?: SfSoqlSessionState,
): Promise<ToolResult> {
  const file = params.file?.trim();
  if (!file) throw new Error("file is required for file.diagnose.");
  const filePath = path.resolve(cwd, file);
  const text = await readFile(filePath, "utf8");
  const queries = extractQueries(filePath, text);
  const parseContext: SoqlParseContext =
    filePath.endsWith(".cls") || filePath.endsWith(".trigger") ? "apex" : "api";
  const findings: SoqlFinding[] = [];
  const rows = [];
  for (const [index, discovered] of queries.entries()) {
    const query = discovered.query;
    const validation = await validateQuery(
      conn,
      {
        action: "query.validate",
        target_org: params.target_org,
        query,
        api: params.api,
        include_plan: params.include_plan,
        parse_context: parseContext,
      },
      state,
    );
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
        `Query ${index + 1} · L${discovered.line}`,
        summarizeQuery(query, parserApiVersion(conn), parseContext),
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

function extractQueries(filePath: string, text: string): EmbeddedSoqlQuery[] {
  if (filePath.endsWith(".cls") || filePath.endsWith(".trigger")) {
    return extractStaticSoqlQueries(text);
  }
  const query = text.trim();
  if (!query || (!filePath.endsWith(".soql") && !/^SELECT\b/i.test(query))) return [];
  const start = text.indexOf(query);
  return [{ query, start, end: start + query.length, line: 1, column: start + 1, source: "file" }];
}

function summarizeQuery(
  query: string,
  apiVersionNumber: number,
  context: SoqlParseContext,
): string {
  const shape = parseSoql(query, { apiVersion: apiVersionNumber, context });
  return `${shape.primary_object ?? "Unknown"}: ${query.replace(/\s+/g, " ")}`;
}
