/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Human and LLM summaries for Code Analyzer reports.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  CodeAnalyzerDoctorReport,
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

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
