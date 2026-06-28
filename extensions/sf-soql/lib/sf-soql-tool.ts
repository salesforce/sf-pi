/* SPDX-License-Identifier: Apache-2.0 */
/** Single SF SOQL family tool registration. */

import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { soqlConnection } from "./api.ts";
import { errorResult } from "./errors.ts";
import { renderSoqlResultMarkdown } from "./render.ts";
import type { SfSoqlParams, SfSoqlSessionState, ToolResult } from "./types.ts";
import {
  countQuery,
  diagnoseFile,
  explain,
  exportQueryResult,
  lastHistory,
  lspStatus,
  orgPreflight,
  queryDraft,
  rerunHistory,
  runQuery,
  runQueryAll,
  runSosl,
  sampleQuery,
  schemaDescribe,
  schemaRelationships,
  schemaSearch,
  status,
  validateQuery,
} from "./operations.ts";

export const SF_SOQL_TOOL_NAME = "sf_soql";

const Action = StringEnum(
  [
    "status",
    "org.preflight",
    "schema.describe",
    "schema.relationships",
    "schema.search",
    "query.draft",
    "query.validate",
    "query.explain",
    "query.sample",
    "query.run",
    "query.count",
    "query.queryAll",
    "query.export",
    "sosl.run",
    "file.diagnose",
    "lsp.status",
    "history.last",
    "history.rerun",
  ] as const,
  { description: "SF SOQL lifecycle action." },
);

const Params = Type.Object({
  action: Action,
  target_org: Type.Optional(Type.String({ description: "Salesforce org alias or username." })),
  query: Type.Optional(
    Type.String({ description: "SOQL query text for validate/explain/sample/run/count/queryAll." }),
  ),
  object: Type.Optional(Type.String({ description: "sObject API name for schema actions." })),
  fields: Type.Optional(Type.Array(Type.String(), { description: "Fields for query.draft." })),
  filters: Type.Optional(
    Type.Array(Type.String(), { description: "WHERE fragments for query.draft." }),
  ),
  order_by: Type.Optional(Type.String({ description: "ORDER BY fragment for query.draft." })),
  intent: Type.Optional(Type.String({ description: "Natural-language purpose for query.draft." })),
  file: Type.Optional(
    Type.String({ description: "Local .soql/.cls/.trigger file for file.diagnose." }),
  ),
  output_file: Type.Optional(
    Type.String({ description: "Workspace path for query.export output." }),
  ),
  format: Type.Optional(
    StringEnum(["csv", "json", "raw_json", "flattened_json"] as const, {
      description: "Export artifact format for query.export. Default csv.",
    }),
  ),
  api: Type.Optional(
    StringEnum(["rest", "tooling"] as const, { description: "Query API mode. Default rest." }),
  ),
  max_rows: Type.Optional(
    Type.Number({ description: "Maximum rows to fetch. Hard-capped by sf-soql." }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Alias for max_rows in sample/queryAll workflows." }),
  ),
  include_plan: Type.Optional(
    Type.Boolean({ description: "Run query plan during validation when useful." }),
  ),
  allow_unbounded: Type.Optional(
    Type.Boolean({ description: "Allow query.run without LIMIT, still hard-capped." }),
  ),
  include_deleted: Type.Optional(
    Type.Boolean({ description: "Explicit queryAll/query deleted-row acknowledgement." }),
  ),
  output_mode: Type.Optional(
    StringEnum(["summary", "inline", "file_only"] as const, {
      description: "Reserved output mode for future richer output.",
    }),
  ),
});

export function registerSfSoqlTool(pi: ExtensionAPI): void {
  const state: SfSoqlSessionState = {};
  pi.registerTool<typeof Params>({
    name: SF_SOQL_TOOL_NAME,
    label: "SF SOQL",
    description:
      "API-native SOQL lifecycle tool: schema describe, relationship discovery, validation, query plan, bounded sample/run/count/queryAll, and artifacts.",
    promptSnippet:
      "Run API-native SOQL lifecycle workflows: describe schema, validate/explain queries, run bounded samples/counts, and inspect artifacts.",
    promptGuidelines: [
      "Use sf_soql before raw sf data query for SOQL lifecycle work: schema search/describe, relationship discovery, draft, validation, query plan, bounded sample/run/count/queryAll, SOSL, export, file diagnostics, and rerun.",
      "Use schema.describe or schema.relationships before writing relationship queries; do not guess custom fields or relationship names.",
      "Prefer query.sample or query.count before broad query.run. query.run without LIMIT returns a safety review unless max_rows or allow_unbounded is explicit.",
      "Use api='tooling' explicitly for Tooling API objects such as ApexClass, ApexTrigger, ApexLog, or ApexTestResult.",
      "query.queryAll and ALL ROWS are explicit and include deleted/archived records where supported; call this out to the user.",
      "Raw and flattened query results are persisted as SOQL Artifacts; keep LLM-facing output compact.",
      "For complex SOQL authoring or optimization, read the querying-soql skill for syntax, relationship-query, aggregate-query, selector-pattern, and anti-pattern guidance. Still use sf_soql, not raw sf CLI, for schema validation, query plans, samples, counts, and execution.",
    ],
    parameters: Params,
    renderCall: (args, theme) => renderCall(args as SfSoqlParams, theme),
    renderResult: (result, opts, theme) => renderResult(result as ToolResult, opts, theme),
    async execute(_id, rawParams, signal, _onUpdate, ctx) {
      const params = rawParams as SfSoqlParams;
      try {
        if (params.action === "history.last") return lastHistory(state);
        const conn = await soqlConnection(params.target_org, signal);
        switch (params.action) {
          case "status":
            return status(conn, params);
          case "org.preflight":
            return orgPreflight(conn, params);
          case "schema.describe":
            return schemaDescribe(conn, params);
          case "schema.relationships":
            return schemaRelationships(conn, params);
          case "schema.search":
            return schemaSearch(conn, params);
          case "query.draft":
            return queryDraft(conn, params);
          case "file.diagnose":
            return diagnoseFile(conn, params, ctx.cwd);
          case "lsp.status":
            return lspStatus(params);
          case "query.validate":
            return validateQuery(conn, params);
          case "query.explain":
            return explain(conn, params, state);
          case "query.sample":
            return sampleQuery(conn, params, state);
          case "query.run":
            return runQuery(conn, params, state);
          case "query.count":
            return countQuery(conn, params, state);
          case "query.queryAll":
            return runQueryAll(conn, params, state);
          case "query.export":
            return exportQueryResult(params, state, ctx.cwd);
          case "sosl.run":
            return runSosl(conn, params);
          case "history.rerun":
            return rerunHistory(conn, params, state);
          default:
            return {
              content: [{ type: "text", text: `Unsupported sf_soql action: ${params.action}` }],
              details: { ok: false, action: params.action },
            };
        }
      } catch (err) {
        return errorResult(params, err);
      }
    },
  });
}

function renderCall(args: SfSoqlParams, theme: Theme): Text {
  const label = theme.fg("toolTitle", theme.bold("🔎 SF SOQL "));
  const target = args.target_org ? theme.fg("dim", ` · ${args.target_org}`) : "";
  return new Text(label + theme.fg("muted", args.action) + target, 0, 0);
}

function renderResult(result: ToolResult, opts: { isPartial?: boolean }, theme: Theme): Text {
  if (opts.isPartial) return new Text(theme.fg("warning", "🔎 SF SOQL running…"), 0, 0);
  return new Text(renderSoqlResultMarkdown(result), 0, 0);
}
