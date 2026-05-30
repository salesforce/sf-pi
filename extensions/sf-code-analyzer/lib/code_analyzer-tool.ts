/* SPDX-License-Identifier: Apache-2.0 */
/**
 * LLM-facing Code Analyzer family tool.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { buildExecFn } from "../../../lib/common/exec-adapter.ts";
import { nextReportPath } from "./artifacts.ts";
import { runApexGuru, validateApexGuru } from "./apexguru.ts";
import { formatApexGuruSetupSuggestion } from "./apexguru-guidance.ts";
import {
  runCodeAnalyzer,
  runCodeAnalyzerConfig,
  runCodeAnalyzerDoctor,
  runCodeAnalyzerRules,
} from "./cli.ts";
import { renderDoctor, renderToolSummary } from "./display.ts";
import type { CodeAnalyzerReportSummary } from "./types.ts";

export const CODE_ANALYZER_TOOL_NAME = "code_analyzer";
export const CODE_ANALYZER_DETAILS_KEY = "sfCodeAnalyzer";

const CodeAnalyzerParams = Type.Object({
  action: StringEnum(["doctor", "run", "rules", "config", "apexguru", "last_report"] as const, {
    description: "Code Analyzer action to run.",
  }),
  workspace: Type.Optional(
    Type.Array(Type.String(), {
      description: "Workspace paths/globs. Defaults to ['.'] for run.",
    }),
  ),
  target: Type.Optional(
    Type.Array(Type.String(), { description: "Target files/folders/globs within the workspace." }),
  ),
  rule_selector: Type.Optional(
    Type.Array(Type.String(), {
      description: "Rule selectors such as Recommended, pmd:Security, eslint:Recommended.",
    }),
  ),
  config_file: Type.Optional(Type.String({ description: "Optional code-analyzer.yml path." })),
  severity_threshold: Type.Optional(
    Type.String({ description: "Run failure threshold: 1/critical, 2/high, 3/moderate, etc." }),
  ),
  include_fixes: Type.Optional(
    Type.Boolean({ description: "Include available fix data for violations." }),
  ),
  include_suggestions: Type.Optional(
    Type.Boolean({ description: "Include available suggestion data for violations." }),
  ),
  no_suppressions: Type.Optional(
    Type.Boolean({ description: "Ignore inline and config suppressions for this run." }),
  ),
  include_unmodified_rules: Type.Optional(
    Type.Boolean({ description: "For action='config', include unmodified rule config." }),
  ),
  target_org: Type.Optional(
    Type.String({ description: "Salesforce org alias or username for ApexGuru actions." }),
  ),
  output_files: Type.Optional(
    Type.Array(Type.String(), {
      description: "Additional output files. Format inferred from extension.",
    }),
  ),
  timeout_ms: Type.Optional(Type.Number({ description: "Optional command timeout in ms." })),
});

type CodeAnalyzerToolInput = {
  action: "doctor" | "run" | "rules" | "config" | "apexguru" | "last_report";
  workspace?: string[];
  target?: string[];
  rule_selector?: string[];
  config_file?: string;
  severity_threshold?: string;
  include_fixes?: boolean;
  include_suggestions?: boolean;
  no_suppressions?: boolean;
  include_unmodified_rules?: boolean;
  target_org?: string;
  output_files?: string[];
  timeout_ms?: number;
};

export function registerCodeAnalyzerTool(pi: ExtensionAPI): void {
  const exec = buildExecFn(pi);
  pi.registerTool({
    name: CODE_ANALYZER_TOOL_NAME,
    label: "Code Analyzer",
    description:
      "Run Salesforce Code Analyzer actions: doctor, run, rules, config, or summarize the last report.",
    promptSnippet:
      "Run Salesforce Code Analyzer scans, rule discovery, config generation, and report summaries.",
    promptGuidelines: [
      "Use code_analyzer action='doctor' before diagnosing Code Analyzer setup or engine prerequisite issues.",
      "Use code_analyzer action='rules' to preview rule selectors before broad scans.",
      "Use code_analyzer action='run' for explicit user-requested scans; automatic deferred scans are owned by sf-code-analyzer.",
      "Use code_analyzer action='apexguru' for explicit ApexGuru performance analysis of one Apex file when org readiness allows.",
      "Use code_analyzer action='last_report' to recover the latest Code Analyzer report from the current session branch.",
    ],
    parameters: CodeAnalyzerParams,
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const input = params as CodeAnalyzerToolInput;
      onUpdate?.({
        content: [{ type: "text", text: runningMessage(input) }],
        details: {},
      });

      if (input.action === "doctor") {
        const doctor = await runCodeAnalyzerDoctor(exec);
        return {
          content: [{ type: "text", text: renderDoctor(doctor) }],
          details: { [CODE_ANALYZER_DETAILS_KEY]: { action: "doctor", doctor } },
        };
      }

      if (input.action === "last_report") {
        const latest = findLatestReport(ctx);
        return {
          content: [
            {
              type: "text",
              text: latest
                ? renderToolSummary(latest)
                : "No Code Analyzer report found on this branch.",
            },
          ],
          details: { [CODE_ANALYZER_DETAILS_KEY]: { action: "last_report", report: latest } },
        };
      }

      const summary = await executeReportAction(exec, ctx, input);
      return {
        content: [{ type: "text", text: renderToolSummary(summary) }],
        details: { [CODE_ANALYZER_DETAILS_KEY]: { action: input.action, report: summary } },
      };
    },
  });
}

async function executeReportAction(
  exec: ReturnType<typeof buildExecFn>,
  ctx: ExtensionContext,
  input: CodeAnalyzerToolInput,
): Promise<CodeAnalyzerReportSummary> {
  if (input.action === "apexguru") {
    const file = input.target?.[0];
    if (!file)
      throw new Error("code_analyzer action='apexguru' requires target with one Apex file.");
    const availability = await validateApexGuru(input.target_org);
    if (availability.access !== "enabled") {
      return {
        kind: "run",
        ok: false,
        source: "apexguru",
        command: `ApexGuru ${file}`,
        durationMs: 0,
        targets: [file],
        selectors: ["apexguru"],
        stderrPreview: formatApexGuruSetupSuggestion(
          `ApexGuru is not enabled for the target org: ${availability.message}`,
        ),
        exitCode: 1,
      };
    }
    return runApexGuru({
      file,
      cwd: ctx.cwd,
      target_org: input.target_org,
      timeout_ms: input.timeout_ms,
      reportFile: nextReportPath(ctx, "run", "json"),
    });
  }
  if (input.action === "run") return runCodeAnalyzer(exec, ctx, input);
  if (input.action === "rules") return runCodeAnalyzerRules(exec, ctx, input);
  if (input.action === "config") {
    return runCodeAnalyzerConfig(exec, ctx, {
      ...input,
      include_unmodified_rules: input.include_unmodified_rules,
    });
  }
  throw new Error(`Unsupported code_analyzer action: ${input.action}`);
}

function runningMessage(input: CodeAnalyzerToolInput): string {
  switch (input.action) {
    case "apexguru":
      return `✨ ApexGuru org-backed analysis running for ${input.target?.[0] ?? "target file"}…`;
    case "run":
      return `🧪 Salesforce Code Analyzer CLI scan running (${(input.rule_selector ?? ["Recommended"]).join(", ")})…`;
    case "rules":
      return `📚 Salesforce Code Analyzer rule discovery running…`;
    case "config":
      return `⚙️ Salesforce Code Analyzer config generation running…`;
    case "doctor":
      return "🩺 Salesforce Code Analyzer setup doctor running…";
    case "last_report":
      return "📄 Reading latest Code Analyzer report from this session branch…";
    default:
      return `Code Analyzer ${input.action} running…`;
  }
}

function findLatestReport(ctx: ExtensionContext): CodeAnalyzerReportSummary | undefined {
  const branch = ctx.sessionManager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role !== "toolResult" || message.toolName !== CODE_ANALYZER_TOOL_NAME) continue;
    const details = message.details as Record<string, unknown> | undefined;
    const envelope = details?.[CODE_ANALYZER_DETAILS_KEY] as
      | { report?: CodeAnalyzerReportSummary }
      | undefined;
    if (envelope?.report?.reportFile) return envelope.report;
  }
  return undefined;
}
