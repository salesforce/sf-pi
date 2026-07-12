/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Human and LLM summaries for Code Analyzer reports.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import {
  renderSfPiResultCardPanel,
  renderSfPiResultCardText,
  type SfPiArtifact,
  type SfPiResultCard,
  type SfPiSection,
} from "../../../lib/common/display/result-card.ts";
import type {
  CodeAnalyzerDoctorReport,
  CodeAnalyzerFactCount,
  CodeAnalyzerFactViolation,
  CodeAnalyzerFacts,
  CodeAnalyzerReportSummary,
  CodeAnalyzerRunJson,
  CodeAnalyzerViolation,
  CodeAnalyzerOutputMode,
} from "./types.ts";

const SEVERITY_LABELS: Record<number, string> = {
  1: "critical",
  2: "high",
  3: "moderate",
  4: "low",
  5: "info",
};

interface CodeAnalyzerRenderArgs {
  action?: string;
  rule_selector?: string[];
  target?: string[];
  target_org?: string;
  output_mode?: string;
}

export function renderDoctor(report: CodeAnalyzerDoctorReport): string {
  return [
    report.summary,
    "",
    `Salesforce CLI: ${status(report.sf)}`,
    `Code Analyzer plugin: ${status(report.plugin)}`,
    `Java 11+ (PMD/CPD/SFGE): ${status(report.java)}`,
    `Python 3.10+ (Flow): ${status(report.python)}`,
    "",
    report.plugin.ok
      ? "Use code_analyzer action='run' or /sf-code-analyzer run for scans."
      : "Install/update with: sf plugins install code-analyzer",
  ].join("\n");
}

function status(value: { ok: boolean; detail: string }): string {
  return `${value.ok ? "✓" : "✗"} ${value.detail}`;
}

export function renderToolSummary(
  summary: CodeAnalyzerReportSummary,
  mode: CodeAnalyzerOutputMode = "summary",
): string {
  if (mode === "file_only") return renderFileOnlySummary(summary);
  if (summary.kind === "run") return renderRunSummary(summary, mode);
  if (summary.kind === "rules") return renderRulesSummary(summary, mode);
  return renderConfigSummary(summary, mode);
}

export function buildCodeAnalyzerFacts(run: CodeAnalyzerRunJson | undefined): CodeAnalyzerFacts {
  const violations = run?.violations ?? [];
  const severity = severityCounts(run, violations);
  const total = run?.violationCounts?.total ?? violations.length;
  return {
    total,
    maxSeverity: maxSeverityFromCounts(severity),
    severity,
    topViolations: [...violations].sort(compareViolation).slice(0, 10).map(factViolation),
    topRules: topRules(violations),
    topFiles: topFiles(violations),
    fixable: violations.filter((violation) => violation.fixes?.length).length,
  };
}

export function renderCodeAnalyzerCallLine(args: CodeAnalyzerRenderArgs, theme: Theme): string {
  const action = args.action ?? "?";
  const selector = args.rule_selector?.length ? args.rule_selector.join(", ") : undefined;
  const target = args.target?.length
    ? `${args.target.length} target${args.target.length === 1 ? "" : "s"}`
    : undefined;
  const bits = [action, selector, target, args.target_org, args.output_mode].filter(
    (bit): bit is string => Boolean(bit),
  );
  return `${theme.fg("toolTitle", theme.bold("🧪 Code Analyzer"))} ${theme.fg("muted", bits.join(" · "))}`;
}

export function renderCodeAnalyzerReportCard(
  summary: CodeAnalyzerReportSummary,
  opts: { expanded?: boolean } = {},
  theme: Theme,
): string {
  return renderSfPiResultCardText(codeAnalyzerReportCard(summary), opts, theme);
}

export function renderCodeAnalyzerReportPanel(
  summary: CodeAnalyzerReportSummary,
  opts: { expanded?: boolean } = {},
  theme: Theme,
): Component {
  return renderSfPiResultCardPanel(codeAnalyzerReportCard(summary), opts, theme);
}

export interface CodeAnalyzerRecipeCardItem {
  id?: string;
  kind?: string;
  label?: string;
  when?: string;
  ruleSelector?: string[];
  herdrRecommended?: boolean;
}

export function renderCodeAnalyzerDoctorCard(
  report: CodeAnalyzerDoctorReport,
  theme: Theme,
): string {
  return renderSfPiResultCardText(codeAnalyzerDoctorCard(report), {}, theme);
}

export function renderCodeAnalyzerDoctorPanel(
  report: CodeAnalyzerDoctorReport,
  theme: Theme,
): Component {
  return renderSfPiResultCardPanel(codeAnalyzerDoctorCard(report), {}, theme);
}

export function renderCodeAnalyzerRecipesCard(
  input: {
    recipes?: CodeAnalyzerRecipeCardItem[];
    suggestions?: CodeAnalyzerRecipeCardItem[];
  },
  opts: { expanded?: boolean } = {},
  theme: Theme,
): string {
  return renderSfPiResultCardText(codeAnalyzerRecipesCard(input), opts, theme);
}

export function renderCodeAnalyzerRecipesPanel(
  input: {
    recipes?: CodeAnalyzerRecipeCardItem[];
    suggestions?: CodeAnalyzerRecipeCardItem[];
  },
  opts: { expanded?: boolean } = {},
  theme: Theme,
): Component {
  return renderSfPiResultCardPanel(codeAnalyzerRecipesCard(input), opts, theme);
}

export function renderCodeAnalyzerPlainCard(title: string, body: string, theme: Theme): string {
  return renderSfPiResultCardText(codeAnalyzerPlainCard(title, body), { expanded: true }, theme);
}

export function renderCodeAnalyzerPlainPanel(title: string, body: string, theme: Theme): Component {
  return renderSfPiResultCardPanel(codeAnalyzerPlainCard(title, body), { expanded: true }, theme);
}

function codeAnalyzerPlainCard(title: string, body: string): SfPiResultCard {
  return {
    tool: codeAnalyzerToolChrome(),
    title,
    status: "info",
    summary: firstLine(body),
    sections: [
      {
        title: "Details",
        icon: "🧾",
        rows: body
          .split("\n")
          .filter((line) => line.trim())
          .slice(1)
          .map((line, index) => ({ label: index === 0 ? "detail" : "", value: line })),
        collapsedLimit: 4,
      },
    ],
  };
}

function codeAnalyzerToolChrome(): SfPiResultCard["tool"] {
  return { id: "sf-code-analyzer", label: "Code Analyzer", icon: "🧪" };
}

function codeAnalyzerDoctorCard(report: CodeAnalyzerDoctorReport): SfPiResultCard {
  const overall = report.sf.ok && report.plugin.ok && report.java.ok && report.python.ok;
  const partial = report.sf.ok && report.plugin.ok && (!report.java.ok || !report.python.ok);
  return {
    tool: codeAnalyzerToolChrome(),
    title: "Code Analyzer Doctor",
    status: overall ? "success" : partial ? "warning" : "error",
    summary: report.summary,
    chips: [
      {
        label: overall ? "ready" : partial ? "partial" : "blocked",
        tone: overall ? "success" : partial ? "warning" : "error",
      },
    ],
    scope: [{ label: "surface", value: "local setup readiness" }],
    sections: [
      {
        title: "Prerequisites",
        icon: "🩺",
        rows: [
          probeRow("sf", report.sf),
          probeRow("plugin", report.plugin),
          probeRow("java", report.java),
          probeRow("python", report.python),
        ],
      },
    ],
    next: [
      report.plugin.ok ? "run scan or inspect recipes" : "install/update Code Analyzer plugin",
    ],
  };
}

function codeAnalyzerRecipesCard(input: {
  recipes?: CodeAnalyzerRecipeCardItem[];
  suggestions?: CodeAnalyzerRecipeCardItem[];
}): SfPiResultCard {
  const recipes = input.recipes ?? [];
  const suggestions = input.suggestions ?? [];
  const automatic = recipes.filter((recipe) => recipe.kind === "automatic");
  const explicit = recipes.filter((recipe) => recipe.kind !== "automatic");
  const herdr = recipes.filter((recipe) => recipe.herdrRecommended);
  const sections: SfPiSection[] = [];
  if (automatic.length) {
    sections.push({
      title: "Automatic profiles",
      icon: "◉",
      rows: automatic.map((recipe) => ({
        label: recipe.id ?? "auto",
        value: recipeDetail(recipe),
      })),
      collapsedLimit: 3,
    });
  }
  sections.push({
    title: suggestions.length ? "Recommended next scans" : "Suggestions",
    icon: suggestions.length ? "💡" : "ⓘ",
    rows: suggestions.length
      ? suggestions.map((recipe) => ({
          label: recipe.id ?? "scan",
          value: recipeDetail(recipe),
          tone: recipe.herdrRecommended ? "warning" : "muted",
        }))
      : [{ label: "current", value: "no broader suggestion for current target/selector" }],
    collapsedLimit: 3,
  });
  if (explicit.length) {
    sections.push({
      title: "Explicit recipes",
      icon: "📋",
      rows: explicit.map((recipe) => ({
        label: recipe.id ?? "recipe",
        value: recipeDetail(recipe),
        tone: recipe.herdrRecommended ? "warning" : "muted",
      })),
      collapsedLimit: 4,
    });
  }
  return {
    tool: codeAnalyzerToolChrome(),
    title: "Scan Recipes",
    status: "info",
    summary: "Choose the narrowest scan that answers the question; use Herdr for broad scans.",
    chips: [
      { label: `${recipes.length} recipes`, tone: "info" },
      { label: `${automatic.length} automatic`, tone: "muted" },
      { label: `${herdr.length} Herdr-friendly`, tone: herdr.length ? "warning" : "muted" },
    ],
    scope: [
      { label: "profiles", value: `${automatic.length} automatic · ${explicit.length} explicit` },
    ],
    sections,
    next: ["choose recipe → run scan; use Herdr for broad scans"],
  };
}

function codeAnalyzerReportCard(summary: CodeAnalyzerReportSummary): SfPiResultCard {
  if (summary.kind === "rules") return rulesReportCard(summary);
  if (summary.kind === "config") return configReportCard(summary);
  return runReportCard(summary);
}

function runReportCard(summary: CodeAnalyzerReportSummary): SfPiResultCard {
  const facts = buildCodeAnalyzerFacts(summary.run);
  const status = !summary.ok ? "error" : facts.total > 0 ? "warning" : "success";
  const source = sourceText(summary);
  const chips: NonNullable<SfPiResultCard["chips"]> = [
    {
      label: `${facts.total} finding${facts.total === 1 ? "" : "s"}`,
      tone: facts.total ? "warning" : "success",
    },
    ...(facts.maxSeverity
      ? [{ label: `max sev${facts.maxSeverity}`, tone: severityTone(facts.maxSeverity) }]
      : []),
    { label: formatMs(summary.durationMs), tone: "muted" },
  ];
  return {
    tool: codeAnalyzerToolChrome(),
    title: summary.source === "apexguru" ? "ApexGuru Analysis" : "Code Analyzer Scan",
    status,
    summary: runSummarySentence(summary, facts),
    chips,
    scope: [
      { label: "selector", value: selectorPlain(summary), tone: "info" },
      { label: "target", value: targetText(summary) },
      { label: "source", value: source },
      { label: "why", value: lineageText(summary) },
    ],
    rails: [
      {
        label: summary.source === "apexguru" ? "API" : "CLI",
        items: [
          { verb: summary.kind, target: summary.command, detail: `exit=${summary.exitCode}` },
        ],
      },
    ],
    sections: runSections(summary, facts),
    artifacts: reportArtifacts(summary),
    next: nextSteps(summary, facts),
    renderHints: { collapsedLines: 20, expandedMaxLines: 120 },
  };
}

function rulesReportCard(summary: CodeAnalyzerReportSummary): SfPiResultCard {
  const rules = summary.rules?.rules ?? [];
  return {
    tool: codeAnalyzerToolChrome(),
    title: "Rules Discovery",
    status: summary.ok ? "success" : "error",
    summary: summary.ok
      ? `Discovered ${rules.length} Code Analyzer rule${rules.length === 1 ? "" : "s"}.`
      : `Rule discovery failed with exit ${summary.exitCode}.`,
    chips: [
      { label: `${rules.length} rules`, tone: summary.ok ? "success" : "error" },
      { label: formatMs(summary.durationMs), tone: "muted" },
    ],
    scope: [
      { label: "selector", value: selectorPlain(summary) },
      { label: "why", value: lineageText(summary) },
    ],
    rails: [
      {
        label: "CLI",
        items: [{ verb: "rules", target: summary.command, detail: `exit=${summary.exitCode}` }],
      },
    ],
    sections: [
      {
        title: "Rule catalog",
        icon: "📚",
        rows: rules.slice(0, 20).map((rule) => ({
          label: `sev${rule.severity ?? "?"}`,
          value: `${rule.engine}/${rule.name}${rule.tags?.length ? ` · ${rule.tags.slice(0, 4).join(",")}` : ""}`,
          tone: typeof rule.severity === "number" ? severityTone(rule.severity) : "muted",
        })),
        collapsedLimit: 4,
      },
      ...stderrSection(summary),
    ],
    artifacts: reportArtifacts(summary),
    next: [summary.ok ? "choose selector → run scan" : "review stderr and retry"],
  };
}

function configReportCard(summary: CodeAnalyzerReportSummary): SfPiResultCard {
  return {
    tool: codeAnalyzerToolChrome(),
    title: "Config Export",
    status: summary.ok ? "success" : "error",
    summary: summary.ok
      ? "Effective Code Analyzer configuration was written."
      : `Config export failed with exit ${summary.exitCode}.`,
    chips: [
      { label: summary.ok ? "written" : "failed", tone: summary.ok ? "success" : "error" },
      { label: formatMs(summary.durationMs), tone: "muted" },
    ],
    scope: [
      { label: "selector", value: selectorPlain(summary) },
      { label: "file", value: summary.reportFile ?? "none" },
    ],
    rails: [
      {
        label: "CLI",
        items: [{ verb: "config", target: summary.command, detail: `exit=${summary.exitCode}` }],
      },
    ],
    sections: stderrSection(summary),
    artifacts: reportArtifacts(summary),
    next: [summary.ok ? "inspect config or run scan" : "review stderr and retry"],
  };
}

function probeRow(label: string, value: { ok: boolean; detail: string }) {
  return {
    label,
    value: compactStatus(value),
    icon: value.ok ? "✓" : "✗",
    tone: value.ok ? ("success" as const) : ("error" as const),
  };
}

function runSummarySentence(summary: CodeAnalyzerReportSummary, facts: CodeAnalyzerFacts): string {
  if (!summary.ok)
    return `Scan failed with exit ${summary.exitCode}; inspect diagnostics before retrying.`;
  if (facts.total === 0) return "Scan completed cleanly with no findings.";
  return `Scan completed with ${facts.total} finding${facts.total === 1 ? "" : "s"}; prioritize the highest severity items first.`;
}

function selectorPlain(summary: CodeAnalyzerReportSummary): string {
  return summary.selectors?.join(", ") || (summary.kind === "config" ? "all" : "Recommended");
}

function severityTone(severity: number): "error" | "warning" | "muted" {
  if (severity <= 2) return "error";
  if (severity === 3) return "warning";
  return "muted";
}

function runSections(summary: CodeAnalyzerReportSummary, facts: CodeAnalyzerFacts): SfPiSection[] {
  const sections: SfPiSection[] = [
    {
      title: "Scan summary",
      icon: "📊",
      rows: [
        {
          label: "severity",
          value: severityText(facts),
          tone: facts.total ? "warning" : "success",
        },
        { label: "exit", value: String(summary.exitCode), tone: summary.ok ? "muted" : "error" },
        ...(facts.fixable > 0
          ? [
              {
                label: "fixable",
                value: `${facts.fixable} engine-provided fix${facts.fixable === 1 ? "" : "es"}`,
                tone: "warning" as const,
              },
            ]
          : []),
      ],
      collapsedLimit: 3,
    },
  ];

  if (facts.topViolations.length) {
    sections.push({
      title: "Top findings",
      icon: "🔥",
      rows: facts.topViolations.slice(0, 10).map((violation) => ({
        label: `sev${violation.severity}`,
        value: `${violation.engine}/${violation.rule} ${locationText(violation.file, violation.line)}`,
        tone: severityTone(violation.severity),
      })),
      collapsedLimit: 3,
    });
  }

  if (facts.topRules.length || facts.topFiles.length) {
    sections.push({
      title: "Hotspots",
      icon: "🎯",
      rows: [
        ...facts.topRules.slice(0, 5).map((item) => ({ label: "rule", value: countText(item) })),
        ...facts.topFiles.slice(0, 5).map((item) => ({ label: "file", value: countText(item) })),
      ],
      collapsedLimit: 3,
    });
  }

  sections.push(...stderrSection(summary));
  return sections;
}

function stderrSection(summary: CodeAnalyzerReportSummary): SfPiSection[] {
  if (summary.ok) return [];
  const rows = [
    summary.stderrPreview
      ? {
          label: "stderr",
          value: diagnosticPreview(summary.stderrPreview),
          tone: "error" as const,
        }
      : undefined,
    summary.stdoutPreview
      ? { label: "stdout", value: diagnosticPreview(summary.stdoutPreview) }
      : undefined,
  ].filter((row): row is NonNullable<typeof row> => Boolean(row));
  return rows.length ? [{ title: "Diagnostics", icon: "🧯", rows, collapsedLimit: 2 }] : [];
}

function diagnosticPreview(value: string): string {
  const line = firstLine(value).replace(/\s+/gu, " ").trim();
  return line.length > 180 ? `${line.slice(0, 179)}…` : line;
}

function reportArtifacts(summary: CodeAnalyzerReportSummary): SfPiArtifact[] {
  const artifacts: SfPiArtifact[] = [];
  if (summary.reportFile)
    artifacts.push({
      label: summary.kind === "config" ? "config" : "report",
      path: summary.reportFile,
      kind: summary.kind === "config" ? "text" : "json",
    });
  for (const outputFile of summary.outputFiles ?? []) {
    if (outputFile === summary.reportFile) continue;
    artifacts.push({ label: "output", path: outputFile, kind: artifactKindFromPath(outputFile) });
  }
  return artifacts;
}

function artifactKindFromPath(file: string): SfPiArtifact["kind"] {
  if (/\.html?$/i.test(file)) return "html";
  if (/\.csv$/i.test(file)) return "csv";
  if (/\.md$/i.test(file)) return "markdown";
  if (/\.log$/i.test(file)) return "log";
  if (/\.json$/i.test(file) || /\.sarif$/i.test(file)) return "json";
  return "text";
}

function recipeDetail(recipe: CodeAnalyzerRecipeCardItem): string {
  return [
    recipe.label,
    recipe.ruleSelector?.length ? `selector ${recipe.ruleSelector.join(", ")}` : undefined,
    recipe.herdrRecommended ? "Herdr recommended" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function compactStatus(value: { ok: boolean; detail: string }): string {
  return `${value.ok ? "✓" : "✗"} ${firstLine(value.detail)}`;
}

function renderFileOnlySummary(summary: CodeAnalyzerReportSummary): string {
  const count = summary.run?.violationCounts?.total ?? summary.run?.violations?.length;
  return [
    `${summary.source === "apexguru" ? "✨ ApexGuru" : "🧪 Code Analyzer"} ${summary.kind} ${summary.ok ? "completed" : "failed"} in ${formatMs(summary.durationMs)}.`,
    count !== undefined ? `Violations: ${count}.` : undefined,
    summary.reportFile ? `Report: ${summary.reportFile}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderRunSummary(
  summary: CodeAnalyzerReportSummary,
  mode: CodeAnalyzerOutputMode,
): string {
  const run = summary.run;
  const counts = run?.violationCounts;
  const total = counts?.total ?? run?.violations?.length ?? 0;
  const maxSeverity = maxViolationSeverity(run);
  const isApexGuru = summary.source === "apexguru";
  const parts = [
    `${isApexGuru ? "✨ ApexGuru org-backed analysis" : "🧪 Salesforce Code Analyzer CLI scan"} ${summary.ok ? "completed" : "failed"} in ${formatMs(summary.durationMs)}.`,
    `Tool: ${isApexGuru ? "ApexGuru Insights service" : "sf code-analyzer run"}.`,
    summary.selectors?.length ? `Selectors / engines: ${summary.selectors.join(", ")}.` : undefined,
    summary.targets?.length
      ? `Targets: ${summary.targets.length}${summary.targets.length === 1 ? ` (${summary.targets[0]})` : ""}.`
      : undefined,
    `Violations: ${total}${maxSeverity ? ` (max severity ${maxSeverity} ${SEVERITY_LABELS[maxSeverity] ?? ""})` : ""}.`,
    counts
      ? `By severity: sev1=${counts.sev1 ?? 0}, sev2=${counts.sev2 ?? 0}, sev3=${counts.sev3 ?? 0}, sev4=${counts.sev4 ?? 0}, sev5=${counts.sev5 ?? 0}.`
      : undefined,
    summary.reportFile
      ? `${isApexGuru ? "ApexGuru JSON report" : "Code Analyzer JSON report"}: ${summary.reportFile}`
      : undefined,
    summary.exitCode !== 0 ? `Exit code: ${summary.exitCode}` : undefined,
  ].filter(Boolean) as string[];
  const feedback = renderActionableFindings(run, mode === "inline" ? "inline" : "summary");
  if (feedback) parts.push("", feedback);
  if (!summary.ok && summary.stderrPreview) parts.push("", `stderr:\n${summary.stderrPreview}`);
  return parts.join("\n");
}

function renderRulesSummary(
  summary: CodeAnalyzerReportSummary,
  mode: CodeAnalyzerOutputMode,
): string {
  const count = summary.rules?.rules?.length ?? 0;
  const lines = [
    `📚 Salesforce Code Analyzer rule discovery ${summary.ok ? "completed" : "failed"} in ${formatMs(summary.durationMs)}.`,
    `Tool: sf code-analyzer rules.`,
    summary.selectors?.length ? `Selectors / engines: ${summary.selectors.join(", ")}.` : undefined,
    `Rules: ${count}.`,
    summary.reportFile ? `JSON report: ${summary.reportFile}` : undefined,
    !summary.ok && summary.stderrPreview ? `stderr:\n${summary.stderrPreview}` : undefined,
  ].filter(Boolean) as string[];
  if (mode === "inline" && summary.rules?.rules?.length) {
    lines.push("", "Rules:");
    for (const rule of summary.rules.rules.slice(0, 80)) {
      lines.push(
        `- sev${rule.severity ?? "?"} ${rule.engine}/${rule.name} · ${(rule.tags ?? []).join(",")}`,
      );
    }
    if (summary.rules.rules.length > 80)
      lines.push(`… ${summary.rules.rules.length - 80} more rule(s) in report.`);
  }
  return lines.join("\n");
}

function renderConfigSummary(
  summary: CodeAnalyzerReportSummary,
  mode: CodeAnalyzerOutputMode,
): string {
  const lines = [
    `⚙️ Salesforce Code Analyzer config ${summary.ok ? "written" : "failed"} in ${formatMs(summary.durationMs)}.`,
    `Tool: sf code-analyzer config.`,
    summary.selectors?.length ? `Selectors / engines: ${summary.selectors.join(", ")}.` : undefined,
    summary.reportFile ? `Config file: ${summary.reportFile}` : undefined,
    !summary.ok && summary.stderrPreview ? `stderr:\n${summary.stderrPreview}` : undefined,
  ].filter(Boolean) as string[];
  if (mode === "inline" && summary.reportFile && existsSync(summary.reportFile)) {
    lines.push(
      "",
      "Config preview:",
      truncateText(readFileSync(summary.reportFile, "utf8"), 8_000),
    );
  }
  return lines.join("\n");
}

export function renderActionableFindings(
  run: CodeAnalyzerRunJson | undefined,
  mode: CodeAnalyzerOutputMode = "summary",
): string | undefined {
  const violations = run?.violations ?? [];
  if (violations.length === 0) return undefined;

  const selected =
    mode === "inline" ? violations.slice(0, 80).sort(compareViolation) : selectFindings(violations);
  const lines = ["Actionable findings:"];
  selected.forEach((violation, index) => {
    lines.push(renderViolation(index + 1, violation));
  });
  const omitted = violations.length - selected.length;
  if (omitted > 0)
    lines.push(`… ${omitted} lower-priority finding(s) omitted; see report for full details.`);
  return lines.join("\n");
}

export function selectFindings(violations: CodeAnalyzerViolation[]): CodeAnalyzerViolation[] {
  const bySeverity = [...violations].sort(compareViolation);
  const severe = bySeverity.filter((v) => v.severity <= 2);
  const moderate = bySeverity.filter((v) => v.severity === 3).slice(0, 10);
  const low = bySeverity.filter((v) => v.severity >= 4).slice(0, 5);
  return [...severe, ...moderate, ...low];
}

function severityCounts(
  run: CodeAnalyzerRunJson | undefined,
  violations: CodeAnalyzerViolation[],
): CodeAnalyzerFacts["severity"] {
  const counts = { sev1: 0, sev2: 0, sev3: 0, sev4: 0, sev5: 0 };
  for (const violation of violations) {
    const key = `sev${violation.severity}` as keyof typeof counts;
    if (key in counts) counts[key] += 1;
  }
  return {
    sev1: run?.violationCounts?.sev1 ?? counts.sev1,
    sev2: run?.violationCounts?.sev2 ?? counts.sev2,
    sev3: run?.violationCounts?.sev3 ?? counts.sev3,
    sev4: run?.violationCounts?.sev4 ?? counts.sev4,
    sev5: run?.violationCounts?.sev5 ?? counts.sev5,
  };
}

function topRules(violations: CodeAnalyzerViolation[]): CodeAnalyzerFactCount[] {
  const counts = new Map<string, CodeAnalyzerFactCount>();
  for (const violation of violations) {
    const key = `${violation.engine}/${violation.rule}`;
    const current = counts.get(key) ?? {
      label: violation.rule,
      engine: violation.engine,
      severity: violation.severity,
      count: 0,
    };
    current.count += 1;
    current.severity = Math.min(current.severity ?? violation.severity, violation.severity);
    counts.set(key, current);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || (a.severity ?? 5) - (b.severity ?? 5))
    .slice(0, 10);
}

function topFiles(violations: CodeAnalyzerViolation[]): CodeAnalyzerFactCount[] {
  const counts = new Map<string, CodeAnalyzerFactCount>();
  for (const violation of violations) {
    const file = primaryFile(violation);
    if (!file) continue;
    const normalized = path.normalize(file);
    const current = counts.get(normalized) ?? { label: normalized, count: 0 };
    current.count += 1;
    counts.set(normalized, current);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 10);
}

function factViolation(violation: CodeAnalyzerViolation): CodeAnalyzerFactViolation {
  const loc = primaryLocation(violation);
  return {
    engine: violation.engine,
    rule: violation.rule,
    severity: violation.severity,
    file: loc.file ? path.normalize(loc.file) : undefined,
    line: loc.startLine,
    column: loc.startColumn,
    message: violation.message,
  };
}

function targetText(summary: CodeAnalyzerReportSummary): string {
  const count = summary.targets?.length ?? 0;
  if (count > 0) return `${count} target${count === 1 ? "" : "s"}`;
  const workspace = summary.workspace?.join(", ") || ".";
  return `workspace ${workspace}`;
}

function sourceText(summary: CodeAnalyzerReportSummary): string {
  return summary.source === "apexguru"
    ? "ApexGuru Insights service"
    : "local Salesforce Code Analyzer CLI";
}

function lineageText(summary: CodeAnalyzerReportSummary): string {
  if (summary.command.startsWith("report ")) return "report review · artifact supplied";
  if (summary.source === "apexguru") return "explicit ApexGuru run · target supplied";
  if (summary.kind === "rules") return "rules lookup · selector in command";
  if (summary.kind === "config") return "config export · selector in command";
  const selector = summary.selectors?.length ? "selector in command" : "default selector";
  const target = summary.targets?.length ? "targets supplied" : "workspace scope";
  return `explicit run · ${selector} · ${target}`;
}

function severityText(facts: CodeAnalyzerFacts): string {
  const s = facts.severity;
  return `sev1=${s.sev1} · sev2=${s.sev2} · sev3=${s.sev3} · sev4=${s.sev4} · sev5=${s.sev5}`;
}

function nextSteps(summary: CodeAnalyzerReportSummary, facts: CodeAnalyzerFacts): string[] {
  if (!summary.ok)
    return [
      "review stderr/setup details",
      "run rules lookup if selector may be wrong",
      "rerun scan",
    ];
  if (facts.total > 0) {
    return [
      "fix sev1–2 findings first",
      "use last_report with severity_threshold=high while iterating",
      "run broader recipe only if this is release/security-sensitive",
    ];
  }
  return ["continue", "run security/AppExchange recipe only if the change warrants it"];
}

function countText(item: CodeAnalyzerFactCount): string {
  const prefix = item.engine ? `${item.engine}/` : "";
  return `${prefix}${shortPath(item.label)} ×${item.count}`;
}

function locationText(file: string | undefined, line: number | undefined): string {
  if (!file) return "<no file>";
  return `${shortPath(file)}${line ? `:${line}` : ""}`;
}

function shortPath(file: string): string {
  const normalized = path.normalize(file);
  const parts = normalized.split(path.sep).filter(Boolean);
  if (parts.length <= 3) return normalized;
  return `…/${parts.slice(-3).join("/")}`;
}

function maxSeverityFromCounts(counts: CodeAnalyzerFacts["severity"]): number | undefined {
  if (counts.sev1 > 0) return 1;
  if (counts.sev2 > 0) return 2;
  if (counts.sev3 > 0) return 3;
  if (counts.sev4 > 0) return 4;
  if (counts.sev5 > 0) return 5;
  return undefined;
}

function compareViolation(a: CodeAnalyzerViolation, b: CodeAnalyzerViolation): number {
  return (
    a.severity - b.severity ||
    primaryFile(a).localeCompare(primaryFile(b)) ||
    (primaryLocation(a).startLine ?? 0) - (primaryLocation(b).startLine ?? 0) ||
    a.engine.localeCompare(b.engine) ||
    a.rule.localeCompare(b.rule)
  );
}

function renderViolation(index: number, violation: CodeAnalyzerViolation): string {
  const loc = primaryLocation(violation);
  const file = loc.file ? path.normalize(loc.file) : "<no file>";
  const line = loc.startLine
    ? `:${loc.startLine}${loc.startColumn ? `:${loc.startColumn}` : ""}`
    : "";
  const resource = violation.resources?.[0] ? `\n   resource: ${violation.resources[0]}` : "";
  const comment = loc.comment ? `\n   context: ${loc.comment}` : "";
  const fix = firstFixOrSuggestion(violation);
  return `${index}. ${file}${line} ${violation.engine}/${violation.rule} sev${violation.severity} (${SEVERITY_LABELS[violation.severity] ?? "unknown"})\n   ${violation.message}${comment}${resource}${fix ? `\n   ${fix}` : ""}`;
}

function firstFixOrSuggestion(violation: CodeAnalyzerViolation): string | undefined {
  const fix = violation.fixes?.[0];
  if (fix?.fixedCode) return `fix preview: ${oneLine(fix.fixedCode)}`;
  const suggestion = violation.suggestions?.[0];
  if (suggestion?.message) return `suggestion: ${oneLine(suggestion.message)}`;
  return undefined;
}

function oneLine(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > 240 ? `${flat.slice(0, 240)}…` : flat;
}

function maxViolationSeverity(run: CodeAnalyzerRunJson | undefined): number | undefined {
  const severities = (run?.violations ?? [])
    .map((v) => v.severity)
    .filter((s) => Number.isFinite(s));
  return severities.length ? Math.min(...severities) : undefined;
}

function primaryFile(violation: CodeAnalyzerViolation): string {
  return primaryLocation(violation).file ?? "";
}

function primaryLocation(violation: CodeAnalyzerViolation) {
  return violation.locations[violation.primaryLocationIndex] ?? violation.locations[0] ?? {};
}

function truncateText(value: string, maxChars: number): string {
  return value.length <= maxChars
    ? value
    : `${value.slice(0, maxChars)}\n… truncated ${value.length - maxChars} chars`;
}

function firstLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? "—"
  );
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
