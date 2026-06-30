/* SPDX-License-Identifier: Apache-2.0 */
/** Single SF LWC family tool registration. */

import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { renderLwcResultMarkdown } from "./render.ts";
import type { SfLwcParams, SfLwcSessionState, ToolResult } from "./types.ts";
import {
  componentInspect,
  componentList,
  fileDiagnose,
  historyLast,
  historyRerun,
  projectScan,
  status,
  testDiscover,
  testPlan,
  testRun,
} from "./operations.ts";
import { lwcErrorResult } from "./errors.ts";

export const SF_LWC_TOOL_NAME = "sf_lwc";

const Action = StringEnum(
  [
    "status",
    "project.scan",
    "component.list",
    "component.inspect",
    "file.diagnose",
    "test.discover",
    "test.plan",
    "test.run",
    "history.last",
    "history.rerun",
  ] as const,
  { description: "SF LWC lifecycle action." },
);

const Params = Type.Object({
  action: Action,
  workspace: Type.Optional(
    Type.String({ description: "Workspace or SFDX project path. Defaults to cwd." }),
  ),
  package_dir: Type.Optional(
    Type.String({ description: "SFDX package directory to scan, such as force-app." }),
  ),
  component: Type.Optional(Type.String({ description: "LWC component bundle name." })),
  components: Type.Optional(
    Type.Array(Type.String(), { description: "Reserved component list for future use." }),
  ),
  file: Type.Optional(
    Type.String({ description: "Local LWC file path for diagnosis or test planning." }),
  ),
  files: Type.Optional(
    Type.Array(Type.String(), { description: "Local LWC file paths for diagnosis." }),
  ),
  test_file: Type.Optional(Type.String({ description: "Local LWC Jest test file path." })),
  test_name: Type.Optional(Type.String({ description: "Exact LWC Jest test name to run." })),
  test_pattern: Type.Optional(
    Type.String({ description: "Advanced Jest --testNamePattern. Prefer test_name when exact." }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum items to show inline. Artifacts remain complete." }),
  ),
  include_source: Type.Optional(
    Type.Boolean({ description: "Include source snippets in component inspection artifacts." }),
  ),
  include_dependencies: Type.Optional(
    Type.Boolean({ description: "Reserved flag for dependency-rich inspection." }),
  ),
  include_tests: Type.Optional(
    Type.Boolean({ description: "Reserved flag for test-rich inspection." }),
  ),
  report_formats: Type.Optional(
    Type.Array(StringEnum(["json", "markdown"] as const), {
      description:
        "Guaranteed local test report artifact formats. V1 always writes JSON/stdout/stderr/markdown.",
    }),
  ),
  timeout_seconds: Type.Optional(
    Type.Number({
      description: "Bounded local Jest timeout. Default 120 seconds; clamped to 1..300.",
      minimum: 1,
      maximum: 300,
    }),
  ),
  output_mode: Type.Optional(
    StringEnum(["summary", "inline", "file_only"] as const, {
      description: "Reserved output mode for future richer output.",
    }),
  ),
});

export function registerSfLwcTool(pi: ExtensionAPI): void {
  const state: SfLwcSessionState = {};
  pi.registerTool<typeof Params>({
    name: SF_LWC_TOOL_NAME,
    label: "SF LWC",
    description:
      "Local-native LWC lifecycle tool: project scan, component inspection, focused diagnostics, targeted local Jest tests, and artifacts.",
    promptSnippet:
      "Run local-native Lightning Web Component lifecycle workflows: scan/inspect bundles, diagnose LWC files, discover/plan/run bounded local Jest tests, and inspect artifacts.",
    promptGuidelines: [
      "Use sf_lwc for local Lightning Web Component lifecycle workflows before raw npm/Jest commands: project scan, component list/inspect, file diagnostics, test discovery/planning/runs, and reruns.",
      "sf_lwc V1 is local-only. Do not use it for deploy/retrieve, org source synchronization, visual preview, component creation, or component rename.",
      "project.scan only scans SFDX package directories from sfdx-project.json; it is not a workspace-wide frontend scanner.",
      "test.run may execute the local project's node_modules/.bin/lwc-jest runner with bounded args/timeouts. It must not install dependencies, start watch mode, or call Salesforce CLI.",
      "Use sf_apex for Apex controller verification, sf_soql for schema/field validation, sf-code-analyzer for broader static analysis, and sf-lsp for advisory background diagnostics.",
      "For LWC authoring, test authoring, and fixing component diagnostics, read the generating-lwc-components skill when deeper framework guidance is useful. Still use sf_lwc first for scan, inspect, diagnose, and bounded local Jest execution.",
      "For SLDS 2 uplift, deprecated SLDS/LWC tokens, hardcoded style values, SLDS class overrides, or styling-hook migration, read uplifting-components-to-slds2. Use sf_lwc for local component context and evidence; use code_analyzer or a future sf_slds2 surface for SLDS lint execution.",
    ],
    parameters: Params,
    renderCall: (args, theme) => renderCall(args as SfLwcParams, theme),
    renderResult: (result, opts, theme) => renderResult(result as ToolResult, opts, theme),
    async execute(_id, rawParams, _signal, _onUpdate, ctx) {
      const params = rawParams as SfLwcParams;
      try {
        switch (params.action) {
          case "status":
            return status(params, ctx.cwd);
          case "project.scan":
            return projectScan(params, ctx.cwd);
          case "component.list":
            return componentList(params, ctx.cwd);
          case "component.inspect":
            return componentInspect(params, ctx.cwd);
          case "file.diagnose":
            return fileDiagnose(params, ctx.cwd);
          case "test.discover":
            return testDiscover(params, ctx.cwd);
          case "test.plan":
            return testPlan(params, ctx.cwd);
          case "test.run":
            return testRun(params, ctx.cwd, state);
          case "history.last":
            return historyLast(state);
          case "history.rerun":
            return historyRerun(params, ctx.cwd, state);
          default:
            return {
              content: [{ type: "text", text: `Unsupported sf_lwc action: ${params.action}` }],
              details: { ok: false, action: params.action },
            };
        }
      } catch (error) {
        return lwcErrorResult(params, error);
      }
    },
  });
}

function renderCall(args: SfLwcParams, theme: Theme): Text {
  const label = theme.fg("toolTitle", theme.bold("🧩 SF LWC "));
  const scope = args.component ?? args.file ?? args.test_file ?? args.workspace;
  const suffix = scope ? theme.fg("dim", ` · ${scope}`) : "";
  return new Text(label + theme.fg("muted", args.action) + suffix, 0, 0);
}

function renderResult(result: ToolResult, opts: { isPartial?: boolean }, theme: Theme): Text {
  if (opts.isPartial) return new Text(theme.fg("warning", "🧩 SF LWC running…"), 0, 0);
  return new Text(renderLwcResultMarkdown(result), 0, 0);
}
