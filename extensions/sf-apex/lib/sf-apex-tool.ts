/* SPDX-License-Identifier: Apache-2.0 */
/** Single SF Apex family tool registration. */

import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { apexConnection } from "./api.ts";
import { apexErrorResult } from "./errors.ts";
import { renderApexResultMarkdown } from "./render.ts";
import type { SfApexParams, SfApexSessionState, ToolResult } from "./types.ts";
import {
  analyzeLog,
  apexSearch,
  authorPlan,
  coverageSummary,
  diagnoseFile,
  getLog,
  latestLog,
  orgPreflight,
  rerunTest,
  runAnonymous,
  runTest,
  startTrace,
  status,
  stopTrace,
  testDiscover,
  testPlan,
  testResult,
  traceStatus,
  watchLog,
} from "./operations.ts";

export const SF_APEX_TOOL_NAME = "sf_apex";

const Action = StringEnum(
  [
    "status",
    "org.preflight",
    "apex.search",
    "test.discover",
    "test.plan",
    "coverage.summary",
    "author.plan",
    "diagnose.file",
    "trace.start",
    "trace.stop",
    "trace.status",
    "log.latest",
    "log.get",
    "log.analyze",
    "log.watch",
    "anon.run",
    "test.run",
    "test.result",
    "test.rerun",
  ] as const,
  { description: "SF Apex lifecycle action." },
);

const Params = Type.Object({
  action: Action,
  target_org: Type.Optional(Type.String({ description: "Salesforce org alias or username." })),
  target: Type.Optional(Type.String({ description: "Primary Apex file/class target." })),
  targets: Type.Optional(Type.Array(Type.String(), { description: "Apex file/class targets." })),
  query: Type.Optional(Type.String({ description: "Search query for apex.search/test.discover." })),
  test_only: Type.Optional(
    Type.Boolean({ description: "Restrict apex.search to likely test classes." }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Discovery result limit. Default 25, max 100." }),
  ),
  intent: Type.Optional(Type.String({ description: "Authoring intent for author.plan." })),
  file: Type.Optional(
    Type.String({ description: "Local file path for diagnose.file or log.analyze." }),
  ),
  body: Type.Optional(Type.String({ description: "Anonymous Apex body or raw Apex log body." })),
  log_id: Type.Optional(Type.String({ description: "ApexLog Id for log.get." })),
  user_id: Type.Optional(Type.String({ description: "Tooling User Id to trace/read logs for." })),
  duration_minutes: Type.Optional(
    Type.Number({ description: "Trace duration. Default 30, max 120." }),
  ),
  wait_seconds: Type.Optional(
    Type.Number({ description: "Wait window for log.watch/test polling." }),
  ),
  poll_interval_seconds: Type.Optional(
    Type.Number({ description: "Polling interval for log.watch." }),
  ),
  allow_mutation: Type.Optional(
    Type.Boolean({ description: "Required for mutation-like Anonymous Apex." }),
  ),
  include_coverage: Type.Optional(
    Type.Boolean({ description: "Collect Apex coverage evidence with test.run/test.result." }),
  ),
  include_uncovered_lines: Type.Optional(
    Type.Boolean({
      description: "Include covered/uncovered line arrays in coverage.summary artifacts.",
    }),
  ),
  org_wide: Type.Optional(
    Type.Boolean({ description: "Include org-wide Apex coverage in coverage.summary." }),
  ),
  threshold_percent: Type.Optional(
    Type.Number({ description: "Coverage threshold signal only; does not fail runs." }),
  ),
  tests: Type.Optional(
    Type.Array(Type.String(), {
      description: "Targeted tests as ClassName or ClassName.methodName.",
    }),
  ),
  class_names: Type.Optional(
    Type.Array(Type.String(), { description: "Targeted Apex test class names." }),
  ),
  run_id: Type.Optional(Type.String({ description: "AsyncApexJob id from test.run." })),
  output_mode: Type.Optional(
    StringEnum(["summary", "inline", "file_only"] as const, {
      description: "Reserved output mode for future richer output.",
    }),
  ),
});

export function registerSfApexTool(pi: ExtensionAPI): void {
  const state: SfApexSessionState = {};
  pi.registerTool<typeof Params>({
    name: SF_APEX_TOOL_NAME,
    label: "SF Apex",
    description:
      "API-native Apex lifecycle tool: authoring plan, diagnostics, trace flags, logs, bounded log watch, Anonymous Apex, and targeted tests.",
    promptSnippet:
      "Run API-native Apex lifecycle workflows: plan, diagnose, trace/log, anonymous Apex, and targeted tests.",
    promptGuidelines: [
      "Use sf_apex for Apex lifecycle workflows before raw Salesforce CLI: authoring plan, diagnostics, trace flags, logs, anonymous Apex probes, and targeted test runs.",
      "When sf_apex has an action for the Apex lifecycle step, use it instead of raw sf CLI. Use raw sf CLI only for capabilities not yet exposed by sf_apex.",
      "Use sf_apex native discovery actions (org.preflight, apex.search, test.discover, test.plan, coverage.summary) instead of raw Tooling SOQL when choosing Apex lifecycle targets.",
      "sf_apex does not edit source files directly. Use normal read/write/edit tools for code changes, then sf_apex diagnose.file and targeted sf_apex test.run.",
      "Use sf_apex trace.start before asking the user to reproduce Apex behavior that needs logs; use sf_apex log.watch for a bounded native tail-like observer.",
      "Use sf_apex anon.run for small Apex probes. If the body appears mutating, pass allow_mutation=true only when intentional.",
      "sf_apex author.plan may return recommended_skills such as generating-apex, generating-apex-test, running-apex-tests, or debugging-apex-logs; read those skills when deeper Apex guidance is useful.",
    ],
    parameters: Params,
    renderCall: (args, theme) => renderCall(args as SfApexParams, theme),
    renderResult: (result, opts, theme) => renderResult(result as ToolResult, opts, theme),
    async execute(_id, rawParams, signal, _onUpdate, ctx) {
      const params = rawParams as SfApexParams;
      try {
        if (params.action === "author.plan") return authorPlan(params);
        if (params.action === "diagnose.file") return diagnoseFile(params, ctx.cwd);
        if (params.action === "log.analyze") return analyzeLog(params);

        const conn = await apexConnection(params.target_org, signal);
        switch (params.action) {
          case "status":
            return status(conn, params);
          case "org.preflight":
            return orgPreflight(conn, params);
          case "apex.search":
            return apexSearch(conn, params);
          case "test.discover":
            return testDiscover(conn, params);
          case "test.plan":
            return testPlan(conn, params);
          case "coverage.summary":
            return coverageSummary(conn, params);
          case "trace.start":
            return startTrace(conn, params, state);
          case "trace.stop":
            return stopTrace(conn, params, state);
          case "trace.status":
            return traceStatus(conn, params);
          case "log.latest":
            return latestLog(conn, params, state);
          case "log.get":
            return getLog(conn, params, state);
          case "log.watch":
            return watchLog(conn, params, state);
          case "anon.run":
            return runAnonymous(conn, params);
          case "test.run":
            return runTest(conn, params, state);
          case "test.result":
            return testResult(conn, params, state);
          case "test.rerun":
            return rerunTest(conn, params, state);
          default:
            return {
              content: [{ type: "text", text: `Unsupported sf_apex action: ${params.action}` }],
              details: { ok: false, action: params.action },
            };
        }
      } catch (error) {
        return apexErrorResult(params, error);
      }
    },
  });
}

function renderCall(args: SfApexParams, theme: Theme): Text {
  const label = theme.fg("toolTitle", theme.bold("⚡ SF Apex "));
  const target = args.target_org ? theme.fg("dim", ` · ${args.target_org}`) : "";
  return new Text(label + theme.fg("muted", args.action) + target, 0, 0);
}

function renderResult(result: ToolResult, opts: { isPartial?: boolean }, theme: Theme): Text {
  if (opts.isPartial) return new Text(theme.fg("warning", "⚡ SF Apex running…"), 0, 0);
  return new Text(renderApexResultMarkdown(result), 0, 0);
}
