/* SPDX-License-Identifier: Apache-2.0 */
/** Single SF Apex family tool registration. */

import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { connectSalesforce } from "../../../lib/common/sf-conn/index.ts";
import { renderApexResultMarkdown } from "./render.ts";
import type { SfApexParams, SfApexSessionState, ToolResult } from "./types.ts";
import { Params } from "./schema.ts";
import { executeApex } from "./execute.ts";
import { nativeApexArtifacts } from "./artifacts.ts";
import { nativeApexDiagnostics } from "./diagnostics.ts";
export const SF_APEX_TOOL_NAME = "sf_apex";

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
      "Use sf_apex before raw CLI for Apex lifecycle evidence; normal Pi file tools own source edits and focused tests should reproduce behavior before changes when feasible.",
      "Anonymous Apex is a bounded probe or rollback rehearsal, not a substitute for maintainable targeted tests.",
      "Use the installed Apex guide path declared in <sf_engineering_constitution> for trace, log, test, coverage, and artifact workflows.",
    ],
    parameters: Params,
    renderCall: (args, theme) => renderCall(args as SfApexParams, theme),
    renderResult: (result, opts, theme) => renderResult(result as ToolResult, opts, theme),
    async execute(_id, rawParams, signal, _onUpdate, ctx) {
      const params = rawParams as SfApexParams;
      return executeApex(params, {
        cwd: ctx.cwd,
        signal,
        state,
        artifacts: nativeApexArtifacts,
        connect: connectSalesforce,
        diagnostics: nativeApexDiagnostics,
      });
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
