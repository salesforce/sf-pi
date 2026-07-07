/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Human and LLM summaries for Code Analyzer reports.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
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
  if (summary.kind === "rules") return renderRulesCard(summary, theme);
  if (summary.kind === "config") return renderConfigCard(summary, theme);
  return opts.expanded
    ? renderRunCardExpanded(summary, theme)
    : renderRunCardCollapsed(summary, theme);
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
  const overall = report.sf.ok && report.plugin.ok && report.java.ok && report.python.ok;
  const partial = report.sf.ok && report.plugin.ok && (!report.java.ok || !report.python.ok);
  const statusLabel = overall
    ? theme.fg("success", "✅ ready")
    : partial
      ? theme.fg("warning", "⚠️ partial readiness")
      : theme.fg("error", "❌ blocked");
  const lines = [
    titleLine(theme, "🧪 Code Analyzer Doctor", statusLabel),
    row(theme, "sf", compactStatus(report.sf)),
    row(theme, "plugin", compactStatus(report.plugin)),
    row(theme, "java", compactStatus(report.java)),
    row(theme, "python", compactStatus(report.python)),
    lastRow(
      theme,
      "next",
      report.plugin.ok ? "run scan or inspect recipes" : "install/update Code Analyzer plugin",
    ),
  ];
  return lines.join("\n");
}

export function renderCodeAnalyzerRecipesCard(
  input: {
    recipes?: CodeAnalyzerRecipeCardItem[];
    suggestions?: CodeAnalyzerRecipeCardItem[];
  },
  opts: { expanded?: boolean } = {},
  theme: Theme,
): string {
  const recipes = input.recipes ?? [];
  const suggestions = input.suggestions ?? [];
  const automatic = recipes.filter((recipe) => recipe.kind === "automatic");
  const explicit = recipes.filter((recipe) => recipe.kind !== "automatic");
  const lines = [
    titleLine(theme, "📋 Code Analyzer Recipes", theme.fg("accent", `${recipes.length} recipes`)),
    row(
      theme,
      "profiles",
      `${automatic.length} automatic · ${explicit.length} explicit · ${recipes.filter((recipe) => recipe.herdrRecommended).length} Herdr-friendly`,
    ),
  ];

  if (automatic.length) {
    lines.push(row(theme, "auto", automatic.slice(0, 3).map(recipeChip).join(" · ")));
  }
  if (suggestions.length) {
    lines.push(row(theme, "suggest", suggestions.slice(0, 3).map(recipeChip).join(" · ")));
  } else {
    lines.push(row(theme, "suggest", "none for current target/selector"));
  }

  if (opts.expanded) {
    lines.push("", section(theme, "Explicit recipes"));
    for (const recipe of explicit.slice(0, 8)) {
      lines.push(row(theme, recipe.id ?? "recipe", recipeDetail(recipe)));
    }
    const omitted = explicit.length - Math.min(explicit.length, 8);
    if (omitted > 0) lines.push(row(theme, "omitted", `${omitted} more recipe(s)`));
  } else {
    const broad = explicit.filter((recipe) => recipe.herdrRecommended).slice(0, 4);
    if (broad.length) lines.push(row(theme, "broad", broad.map(recipeChip).join(" · ")));
  }

  lines.push(lastRow(theme, "next", "choose recipe → run scan; use Herdr for broad scans"));
  return lines.join("\n");
}

export function renderCodeAnalyzerPlainCard(title: string, body: string, theme: Theme): string {
  return [
    titleLine(theme, `🧪 ${title}`, theme.fg("accent", "info")),
    ...body
      .split("\n")
      .map((line) => (line ? `${theme.fg("border", "│  ")}${line}` : theme.fg("border", "│"))),
    theme.fg("border", "╰─"),
  ].join("\n");
}

function recipeChip(recipe: CodeAnalyzerRecipeCardItem): string {
  return `${recipe.id ?? recipe.label ?? "recipe"}${recipe.ruleSelector?.length ? ` (${recipe.ruleSelector.join(", ")})` : ""}`;
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

function renderRunCardCollapsed(summary: CodeAnalyzerReportSummary, theme: Theme): string {
  const facts = buildCodeAnalyzerFacts(summary.run);
  const lines = [runTitle(summary, facts, theme), scanRow(summary, theme), whyRow(summary, theme)];
  if (facts.total > 0) lines.push(row(theme, "severity", severityText(facts)));
  for (const violation of facts.topViolations.slice(0, 3)) {
    lines.push(row(theme, "finding", formatFactViolation(violation, theme)));
  }
  const focus = focusText(facts);
  if (focus) lines.push(row(theme, "focus", focus));
  if (facts.fixable > 0) {
    lines.push(
      row(
        theme,
        "fixable",
        `${theme.fg("warning", String(facts.fixable))} engine-provided fixes available`,
      ),
    );
  }
  lines.push(row(theme, "report", theme.fg("dim", summary.reportFile ?? "none")));
  lines.push(lastRow(theme, "next", nextText(summary, facts)));
  return lines.join("\n");
}

function renderRunCardExpanded(summary: CodeAnalyzerReportSummary, theme: Theme): string {
  const facts = buildCodeAnalyzerFacts(summary.run);
  const lines = [
    runTitle(summary, facts, theme),
    scanRow(summary, theme),
    row(theme, "source", sourceText(summary)),
    row(theme, "report", theme.fg("dim", summary.reportFile ?? "none")),
    "",
    section(theme, "Summary"),
    row(theme, "severity", severityText(facts)),
    row(theme, "selector", selectorText(summary, theme)),
    row(theme, "targets", targetText(summary)),
    row(theme, "exit", String(summary.exitCode)),
    "",
    section(theme, "Why this scan"),
    whyRow(summary, theme),
    row(theme, "storage", "report kept outside repo by default unless output_files were supplied"),
  ];

  const selected = selectFindings(summary.run?.violations ?? []);
  if (selected.length) {
    lines.push("", section(theme, "Top findings"));
    for (const violation of selected) {
      lines.push(row(theme, `sev${violation.severity}`, formatViolationCompact(violation, theme)));
    }
    const omitted = (summary.run?.violations?.length ?? 0) - selected.length;
    if (omitted > 0) lines.push(row(theme, "omitted", `${omitted} more in report`));
  }

  if (facts.topRules.length || facts.topFiles.length) {
    lines.push("", section(theme, "Hotspots"));
    for (const item of facts.topRules.slice(0, 5)) lines.push(row(theme, "rule", countText(item)));
    for (const item of facts.topFiles.slice(0, 5)) lines.push(row(theme, "file", countText(item)));
  }

  if (facts.fixable > 0) {
    lines.push("", section(theme, "Fixability"));
    lines.push(row(theme, "fixes", `${facts.fixable} deterministic engine fixes`));
    lines.push(row(theme, "note", "not applied automatically"));
  }

  lines.push("", section(theme, "Audit"));
  lines.push(row(theme, "cli", theme.fg("dim", summary.command)));
  if (summary.stdoutPreview)
    lines.push(row(theme, "stdout", theme.fg("dim", firstLine(summary.stdoutPreview))));
  if (summary.stderrPreview)
    lines.push(
      row(
        theme,
        "stderr",
        theme.fg(summary.ok ? "dim" : "error", firstLine(summary.stderrPreview)),
      ),
    );
  lines.push("", lastSection(theme, "Next"));
  for (const next of nextSteps(summary, facts))
    lines.push(`${theme.fg("border", "   ")}${theme.fg("accent", "→")} ${next}`);
  return lines.join("\n");
}

function renderRulesCard(summary: CodeAnalyzerReportSummary, theme: Theme): string {
  const count = summary.rules?.rules?.length ?? 0;
  const statusLabel = summary.ok
    ? theme.fg("success", `✅ ${count} rules`)
    : theme.fg("error", `❌ failed · exit ${summary.exitCode}`);
  const lines = [
    titleLine(theme, "📚 Code Analyzer Rules", statusLabel),
    row(theme, "selector", selectorText(summary, theme)),
    row(theme, "duration", formatMs(summary.durationMs)),
    row(theme, "report", theme.fg("dim", summary.reportFile ?? "none")),
    lastRow(theme, "next", summary.ok ? "choose selector → run scan" : "review stderr and retry"),
  ];
  return lines.join("\n");
}

function renderConfigCard(summary: CodeAnalyzerReportSummary, theme: Theme): string {
  const statusLabel = summary.ok
    ? theme.fg("success", "✅ written")
    : theme.fg("error", `❌ failed · exit ${summary.exitCode}`);
  return [
    titleLine(theme, "⚙️ Code Analyzer Config", statusLabel),
    row(theme, "selector", selectorText(summary, theme)),
    row(theme, "duration", formatMs(summary.durationMs)),
    row(theme, "file", theme.fg("dim", summary.reportFile ?? "none")),
    lastRow(theme, "next", summary.ok ? "inspect config or run scan" : "review stderr and retry"),
  ].join("\n");
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

function runTitle(
  summary: CodeAnalyzerReportSummary,
  facts: CodeAnalyzerFacts,
  theme: Theme,
): string {
  const title = summary.source === "apexguru" ? "✨ ApexGuru" : "🧪 Code Analyzer";
  const statusLabel = runStatusLabel(summary, facts, theme);
  const suffix = summary.ok
    ? facts.total > 0
      ? ` · ${facts.total} total${facts.maxSeverity ? ` · ${theme.fg(severityColor(facts.maxSeverity), `max sev${facts.maxSeverity}`)}` : ""}`
      : " · 0 findings"
    : ` · exit ${summary.exitCode}`;
  return titleLine(theme, title, `${statusLabel}${suffix}`);
}

function runStatusLabel(
  summary: CodeAnalyzerReportSummary,
  facts: CodeAnalyzerFacts,
  theme: Theme,
): string {
  if (!summary.ok) return theme.fg("error", "❌ failed");
  if (facts.total > 0) return theme.fg("warning", "⚠️ findings");
  return theme.fg("success", "✅ clean");
}

function titleLine(theme: Theme, title: string, statusLabel: string): string {
  return `${theme.fg("border", "╭─ ")}${theme.fg("toolTitle", theme.bold(title))}  ${statusLabel}`;
}

function scanRow(summary: CodeAnalyzerReportSummary, theme: Theme): string {
  return row(
    theme,
    "scan",
    `${selectorText(summary, theme)} · ${targetText(summary)} · ${formatMs(summary.durationMs)}`,
  );
}

function whyRow(summary: CodeAnalyzerReportSummary, theme: Theme): string {
  return row(theme, "why", lineageText(summary));
}

function selectorText(summary: CodeAnalyzerReportSummary, theme: Theme): string {
  return theme.fg(
    "accent",
    summary.selectors?.join(", ") || (summary.kind === "config" ? "all" : "Recommended"),
  );
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

function focusText(facts: CodeAnalyzerFacts): string | undefined {
  const rule = facts.topRules[0];
  const file = facts.topFiles[0];
  if (!rule && !file) return undefined;
  return [
    rule ? `${rule.engine}/${rule.label} ×${rule.count}` : undefined,
    file ? `${shortPath(file.label)} ×${file.count}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function nextText(summary: CodeAnalyzerReportSummary, facts: CodeAnalyzerFacts): string {
  if (!summary.ok) return "review stderr → fix selector/setup → rerun";
  if (facts.total > 0) return "fix sev1–2 first → rerun same selector";
  return "continue · broader recipe only for release/security work";
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

function section(theme: Theme, title: string): string {
  return `${theme.fg("border", "├─ ")}${theme.fg("accent", theme.bold(title))}`;
}

function lastSection(theme: Theme, title: string): string {
  return `${theme.fg("border", "╰─ ")}${theme.fg("accent", theme.bold(title))}`;
}

function row(theme: Theme, label: string, value: string): string {
  return `${theme.fg("border", "│  ")}${theme.fg("muted", label.padEnd(10))}${value}`;
}

function lastRow(theme: Theme, label: string, value: string): string {
  return `${theme.fg("border", "╰─ ")}${theme.fg("accent", label.padEnd(10))}${value}`;
}

function formatFactViolation(violation: CodeAnalyzerFactViolation, theme: Theme): string {
  return `${theme.fg(severityColor(violation.severity), `sev${violation.severity}`)} ${violation.engine}/${violation.rule} ${locationText(violation.file, violation.line)}`;
}

function formatViolationCompact(violation: CodeAnalyzerViolation, theme: Theme): string {
  const loc = primaryLocation(violation);
  return `${theme.fg(severityColor(violation.severity), `${violation.engine}/${violation.rule}`)} ${locationText(loc.file, loc.startLine)}`;
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

function severityColor(severity: number): "error" | "warning" | "muted" {
  if (severity <= 2) return "error";
  if (severity === 3) return "warning";
  return "muted";
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
