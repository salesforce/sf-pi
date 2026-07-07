/* SPDX-License-Identifier: Apache-2.0 */
/**
 * LLM-facing Code Analyzer family tool.
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { buildExecFn } from "../../../lib/common/exec-adapter.ts";
import { nextReportPath } from "./artifacts.ts";
import { runApexGuru, validateApexGuru } from "./apexguru.ts";
import {
  buildApexGuruBrowserFollowUp,
  formatApexGuruSetupRunbook,
  formatApexGuruSetupSuggestion,
} from "./apexguru-guidance.ts";
import {
  runCodeAnalyzer,
  runCodeAnalyzerConfig,
  runCodeAnalyzerDoctor,
  runCodeAnalyzerRules,
} from "./cli.ts";
import {
  buildCodeAnalyzerFacts,
  renderCodeAnalyzerCallLine,
  renderCodeAnalyzerDoctorCard,
  renderCodeAnalyzerPlainCard,
  renderCodeAnalyzerRecipesCard,
  renderCodeAnalyzerReportCard,
  renderDoctor,
  renderToolSummary,
} from "./display.ts";
import { buildScanRecipeGuidance } from "./recipes.ts";
import { applyReportFilters, summaryFromReportFile } from "./report-filter.ts";
import type { CodeAnalyzerDoctorReport, CodeAnalyzerReportSummary } from "./types.ts";

export const CODE_ANALYZER_TOOL_NAME = "code_analyzer";
export const CODE_ANALYZER_DETAILS_KEY = "sfCodeAnalyzer";

const CodeAnalyzerParams = Type.Object({
  action: StringEnum(
    [
      "doctor",
      "run",
      "rules",
      "config",
      "apexguru",
      "apexguru_setup_help",
      "recipes",
      "last_report",
    ] as const,
    {
      description: "Code Analyzer action to run.",
    },
  ),
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
  report_file: Type.Optional(
    Type.String({ description: "For last_report, inspect this explicit report artifact path." }),
  ),
  engine: Type.Optional(
    Type.String({ description: "For last_report, filter findings by engine." }),
  ),
  rule: Type.Optional(Type.String({ description: "For last_report, filter findings by rule." })),
  file: Type.Optional(Type.String({ description: "For last_report, filter findings by file." })),
  start_browser_workflow: Type.Optional(
    Type.Boolean({
      description:
        "For apexguru_setup_help, ask for approval and queue an SF Browser setup-check follow-up.",
    }),
  ),
  output_files: Type.Optional(
    Type.Array(Type.String(), {
      description: "Additional output files. Format inferred from extension.",
    }),
  ),
  timeout_ms: Type.Optional(Type.Number({ description: "Optional command timeout in ms." })),
  output_mode: Type.Optional(
    StringEnum(["summary", "inline", "file_only"] as const, {
      description: "How much result detail to return. Defaults to summary.",
    }),
  ),
});

type CodeAnalyzerToolInput = {
  action:
    | "doctor"
    | "run"
    | "rules"
    | "config"
    | "apexguru"
    | "apexguru_setup_help"
    | "recipes"
    | "last_report";
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
  report_file?: string;
  engine?: string;
  rule?: string;
  file?: string;
  start_browser_workflow?: boolean;
  output_files?: string[];
  timeout_ms?: number;
  output_mode?: "summary" | "inline" | "file_only";
};

export function registerCodeAnalyzerTool(pi: ExtensionAPI): void {
  const exec = buildExecFn(pi);
  pi.registerTool({
    name: CODE_ANALYZER_TOOL_NAME,
    label: "Code Analyzer",
    description:
      "Run Salesforce Code Analyzer actions: doctor, run, rules, config, ApexGuru, ApexGuru setup help, or summarize the last report.",
    promptSnippet:
      "Run Salesforce Code Analyzer scans, rule discovery, config generation, and report summaries.",
    promptGuidelines: [
      "Use code_analyzer action='doctor' before diagnosing Code Analyzer setup or engine prerequisite issues.",
      "Use code_analyzer action='recipes' to see default automatic profiles and broader explicit scan presets.",
      "Use code_analyzer action='rules' to preview rule selectors before broad scans.",
      "Use code_analyzer action='run' for explicit user-requested scans; automatic deferred scans are owned by sf-code-analyzer.",
      "Use code_analyzer action='apexguru' for explicit ApexGuru performance analysis of one Apex file when org readiness allows.",
      "Use code_analyzer action='apexguru_setup_help' to get the SF Browser setup-check runbook; do not start browser setup without user approval.",
      "Use code_analyzer output_mode='inline' for richer bounded detail and output_mode='file_only' when the report path is enough.",
      "Use code_analyzer action='last_report' to recover the latest Code Analyzer report from the current session branch.",
    ],
    parameters: CodeAnalyzerParams,
    renderShell: "self",
    renderCall: (args, theme) =>
      new Text(renderCodeAnalyzerCallLine(args as CodeAnalyzerToolInput, theme), 0, 0),
    renderResult: (result, opts, theme) => renderResult(result, opts, theme),
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
        const latest = findReport(ctx, input);
        return {
          content: [
            {
              type: "text",
              text: latest
                ? renderToolSummary(latest, input.output_mode ?? "summary")
                : "No Code Analyzer report found on this branch.",
            },
          ],
          details: {
            [CODE_ANALYZER_DETAILS_KEY]: {
              action: "last_report",
              report: latest,
              facts: latest?.run ? buildCodeAnalyzerFacts(latest.run) : undefined,
            },
          },
        };
      }

      if (input.action === "recipes") {
        const guidance = buildScanRecipeGuidance({
          selectors: input.rule_selector ?? [],
          targets: input.target ?? [],
          includeExamples: input.output_mode === "inline",
        });
        return {
          content: [{ type: "text", text: guidance.text }],
          details: {
            [CODE_ANALYZER_DETAILS_KEY]: {
              action: input.action,
              recipes: guidance.recipes,
              suggestions: guidance.suggestions,
              herdrHandoff: guidance.herdrHandoffs,
            },
          },
        };
      }

      if (input.action === "apexguru_setup_help") {
        const text = formatApexGuruSetupRunbook(input.target_org);
        if (input.start_browser_workflow && ctx.hasUI) {
          const confirmed = await ctx.ui.confirm(
            "Start ApexGuru setup check with SF Browser?",
            `${text}\n\nThis queues a normal agent follow-up that uses sf_browser tools visibly. No Setup enable/accept/save click should happen without a second explicit approval.`,
          );
          if (confirmed) {
            pi.sendUserMessage(buildApexGuruBrowserFollowUp(input.target_org), {
              deliverAs: "followUp",
            });
          }
        }
        return {
          content: [{ type: "text", text }],
          details: { [CODE_ANALYZER_DETAILS_KEY]: { action: input.action, runbook: text } },
        };
      }

      const summary = await executeReportAction(exec, ctx, input);
      return {
        content: [
          { type: "text", text: renderToolSummary(summary, input.output_mode ?? "summary") },
        ],
        details: {
          [CODE_ANALYZER_DETAILS_KEY]: {
            action: input.action,
            report: summary,
            facts: summary.run ? buildCodeAnalyzerFacts(summary.run) : undefined,
          },
        },
      };
    },
  });
}

function renderResult(
  result: { content?: unknown; details?: unknown },
  opts: { isPartial?: boolean; expanded?: boolean },
  theme: Theme,
): Text {
  if (opts.isPartial) return new Text(theme.fg("warning", "⏳ Code Analyzer running…"), 0, 0);

  const details = asRecord(result.details);
  const envelope = details?.[CODE_ANALYZER_DETAILS_KEY] as
    | {
        action?: string;
        report?: CodeAnalyzerReportSummary;
        doctor?: CodeAnalyzerDoctorReport;
        recipes?: unknown[];
        suggestions?: unknown[];
      }
    | undefined;
  if (envelope?.report) {
    return new Text(renderCodeAnalyzerReportCard(envelope.report, opts, theme), 0, 0);
  }
  if (envelope?.doctor) {
    return new Text(renderCodeAnalyzerDoctorCard(envelope.doctor, theme), 0, 0);
  }
  if (envelope?.action === "recipes") {
    return new Text(
      renderCodeAnalyzerRecipesCard(
        {
          recipes: asRecipeItems(envelope.recipes),
          suggestions: asRecipeItems(envelope.suggestions),
        },
        opts,
        theme,
      ),
      0,
      0,
    );
  }
  return new Text(
    renderCodeAnalyzerPlainCard(
      "Code Analyzer",
      firstText(result) || "Code Analyzer completed.",
      theme,
    ),
    0,
    0,
  );
}

function asRecipeItems(value: unknown): Array<{
  id?: string;
  kind?: string;
  label?: string;
  when?: string;
  ruleSelector?: string[];
  herdrRecommended?: boolean;
}> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      item && typeof item === "object" ? (item as Record<string, unknown>) : undefined,
    )
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : undefined,
      kind: typeof item.kind === "string" ? item.kind : undefined,
      label: typeof item.label === "string" ? item.label : undefined,
      when: typeof item.when === "string" ? item.when : undefined,
      ruleSelector: Array.isArray(item.ruleSelector)
        ? item.ruleSelector.filter((selector): selector is string => typeof selector === "string")
        : undefined,
      herdrRecommended:
        typeof item.herdrRecommended === "boolean" ? item.herdrRecommended : undefined,
    }));
}

function firstText(result: { content?: unknown }): string {
  if (!Array.isArray(result.content)) return "";
  return (
    result.content.find((item): item is { type: string; text: string } =>
      Boolean(
        item &&
        typeof item === "object" &&
        (item as { type?: unknown }).type === "text" &&
        typeof (item as { text?: unknown }).text === "string",
      ),
    )?.text ?? ""
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
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
    case "recipes":
      return "📋 Reading Salesforce Code Analyzer scan recipes…";
    case "rules":
      return `📚 Salesforce Code Analyzer rule discovery running…`;
    case "config":
      return `⚙️ Salesforce Code Analyzer config generation running…`;
    case "doctor":
      return "🩺 Salesforce Code Analyzer setup doctor running…";
    case "apexguru_setup_help":
      return "🧭 Preparing ApexGuru SF Browser setup-check runbook…";
    case "last_report":
      return "📄 Reading latest Code Analyzer report from this session branch…";
    default:
      return `Code Analyzer ${input.action} running…`;
  }
}

function findReport(
  ctx: ExtensionContext,
  input: CodeAnalyzerToolInput,
): CodeAnalyzerReportSummary | undefined {
  const report = input.report_file
    ? summaryFromReportFile(input.report_file)
    : findLatestReport(ctx);
  return report
    ? applyReportFilters(report, {
        engine: input.engine,
        severity_threshold: input.severity_threshold,
        rule: input.rule,
        file: input.file,
      })
    : undefined;
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
      { report?: CodeAnalyzerReportSummary } | undefined;
    if (envelope?.report?.reportFile) return envelope.report;
  }
  return undefined;
}
