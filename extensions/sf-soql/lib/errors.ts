/* SPDX-License-Identifier: Apache-2.0 */
/** Structured SOQL failure cards for Salesforce API and validation errors. */

import { parseSoql } from "./parser.ts";
import { buildDigest, row, section, toolResultFromDigest } from "./digest.ts";
import type { SfSoqlParams, ToolResult } from "./types.ts";

interface ParsedSalesforceError {
  errorCode?: string;
  message: string;
  status?: number;
}

export function errorResult(params: SfSoqlParams, err: unknown): ToolResult {
  const parsed = parseSalesforceError(err);
  const shape = params.query ? safeParse(params.query) : undefined;
  const digest = buildDigest({
    action: params.action,
    status: "fail",
    icon: "❌",
    title: `SOQL ${humanAction(params.action)} · failed${shape?.primary_object ? ` · ${shape.primary_object}` : ""}`,
    org: { alias: params.target_org },
    query: shape,
    api_calls: [
      {
        method: "ERROR",
        path: parsed.errorCode ?? "Salesforce API",
        detail: parsed.status ? `status=${parsed.status}` : undefined,
      },
    ],
    sections: [
      section("🔥", "Root Cause", [
        row("🏷️", "Error Code", parsed.errorCode),
        row("💬", "Message", parsed.message),
        row("🧭", "Action", params.action),
      ]),
      section("💡", "Suggested Fix", [
        row("🧬", "Schema", suggestionFor(parsed.errorCode)),
        row(
          "🛡️",
          "Safety",
          "Run schema.describe / schema.relationships, then query.validate before retrying.",
        ),
      ]),
    ],
  });
  return toolResultFromDigest(digest);
}

function safeParse(query: string) {
  try {
    return parseSoql(query);
  } catch {
    return { raw: query, normalized: query };
  }
}

function parseSalesforceError(err: unknown): ParsedSalesforceError {
  const raw = err instanceof Error ? err.message : String(err);
  const status = /failed \((\d+)\)/.exec(raw)?.[1];
  const bodyText = raw.slice(raw.indexOf(":") + 1).trim();
  const body = safeJson(bodyText);
  const first = Array.isArray(body) ? body[0] : body;
  if (first && typeof first === "object") {
    const candidate = first as { errorCode?: string; message?: string };
    return {
      errorCode: candidate.errorCode,
      message: candidate.message ?? raw,
      status: status ? Number(status) : undefined,
    };
  }
  return { message: raw, status: status ? Number(status) : undefined };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function humanAction(action: string): string {
  return action.replace(/^query\./, "").replace(/^schema\./, "");
}

function suggestionFor(errorCode?: string): string {
  switch (errorCode) {
    case "INVALID_FIELD":
      return "Verify field and relationship API names with schema.describe / schema.relationships.";
    case "INVALID_TYPE":
      return "Verify object API name and REST vs Tooling mode.";
    case "MALFORMED_QUERY":
      return "Check SOQL syntax, clause order, and unsupported expressions.";
    case "INSUFFICIENT_ACCESS":
      return "Current user may lack object or field access for this query.";
    case "QUERY_TIMEOUT":
      return "Narrow filters, run query.explain, or sample/count before a larger run.";
    default:
      return "Inspect the full query and native API error, then validate the query shape.";
  }
}
