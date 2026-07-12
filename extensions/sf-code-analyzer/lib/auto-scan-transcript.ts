/* SPDX-License-Identifier: Apache-2.0 */
/** Pure transcript formatting for deferred Code Analyzer auto-scans. */
import path from "node:path";

export function formatLocalScanTranscript(
  status: "running" | "clean" | "findings",
  input: {
    selectors: string[];
    targetCount: number;
    durationMs?: number;
    violationCount?: number;
    reportFile?: string;
    targetFiles?: string[];
  },
): string {
  const state =
    status === "running"
      ? "⏳ Running"
      : status === "clean"
        ? "✓ Clean"
        : `⚠ Findings (${input.violationCount ?? 0})`;
  const footer =
    status === "running"
      ? "Report will appear when complete"
      : status === "clean"
        ? "No action needed"
        : "Review report before continuing";
  return [
    "╭─ 🧪 Code Analyzer Auto-scan",
    "│",
    `│  ${state}${input.durationMs !== undefined ? `  ${formatMs(input.durationMs)}` : ""}`,
    "│",
    "│  Scope",
    "│    Tool     Local Salesforce Code Analyzer CLI",
    `│    Engines  ${input.selectors.join(", ")}`,
    `│    Targets  ${input.targetCount} changed file${input.targetCount === 1 ? "" : "s"}`,
    input.durationMs !== undefined ? `│    Duration ${formatMs(input.durationMs)}` : undefined,
    "│",
    "│  Reasoning",
    ...reasoningLines(input.selectors),
    ...(input.targetFiles?.length ? ["│", "│  Files", ...targetFileLines(input.targetFiles)] : []),
    input.reportFile ? "│" : undefined,
    input.reportFile ? "│  Evidence" : undefined,
    input.reportFile ? "│    Report" : undefined,
    input.reportFile ? `│      ${shortReportPath(input.reportFile)}` : undefined,
    `╰─ ${footer}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatApexGuruTranscript(
  status: "clean" | "findings",
  input: { file: string; durationMs: number; violationCount: number; reportFile?: string },
): string {
  return [
    status === "clean"
      ? "✅ ✨ ApexGuru auto insight clean"
      : `⚠️ ✨ ApexGuru auto insight found ${input.violationCount} finding(s)`,
    "   Tool: ApexGuru Insights org service",
    `   Target: ${path.basename(input.file)}`,
    `   Duration: ${formatMs(input.durationMs)}`,
    input.reportFile ? `   Report: ${shortReportPath(input.reportFile)}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatApexGuruSkippedTranscript(input: {
  access: string;
  reason: string;
  targetCount: number;
}): string {
  return [
    "⚪ ✨ ApexGuru auto insight skipped",
    "   Tool: ApexGuru Insights org service",
    `   Reason: ${input.access.replace(/_/g, " ")} · ${input.reason}`,
    `   Targets: ${input.targetCount} changed production Apex file${input.targetCount === 1 ? "" : "s"}`,
    "   Setup help: I can use SF Browser to check Scale Center / ApexGuru Insights and help enable ApexGuru if Salesforce exposes the setup option, after your approval.",
  ].join("\n");
}

export function formatAutoScanErrorTranscript(input: {
  selector: string;
  targetCount: number;
  error: string;
}): string {
  return [
    "⚠️ 🧪 Code Analyzer auto-scan error",
    "   Tool: Local Salesforce Code Analyzer CLI",
    `   Engines: ${input.selector}`,
    `   Targets: ${input.targetCount} changed file${input.targetCount === 1 ? "" : "s"}`,
    `   Error: ${input.error}`,
  ].join("\n");
}

export function formatApexGuruBudgetExhaustedTranscript(candidateCount: number): string {
  return `[sf-code-analyzer] ApexGuru auto insight budget exhausted · ${candidateCount} candidate(s)`;
}

function reasoningLines(selectors: string[]): string[] {
  return selectors.flatMap((selector) => {
    if (selector === "eslint:Recommended") {
      return [
        "│    Selected  JS/TS changed file → eslint:Recommended",
        "│    Others    PMD/Flow/SFGE skipped; no Apex or Flow file in this scan group",
      ];
    }
    if (selector === "pmd:Recommended") {
      return [
        "│    Selected  Apex changed file → pmd:Recommended",
        "│    Others    ESLint/Flow skipped; no JS/TS or Flow file in this scan group",
      ];
    }
    if (selector === "flow:Recommended") {
      return [
        "│    Selected  Flow metadata changed file → flow:Recommended",
        "│    Others    ESLint/PMD skipped; no JS/TS or Apex file in this scan group",
      ];
    }
    return [`│    Selected  ${selector} matched changed file type`];
  });
}

function targetFileLines(files: string[]): string[] {
  const visible = files.slice(0, 5).map((file) => `│    • ${shortFilePath(file)}`);
  const hidden = files.length - visible.length;
  return hidden > 0
    ? [...visible, `│    • +${hidden} more file${hidden === 1 ? "" : "s"}`]
    : visible;
}

function shortFilePath(filePath: string): string {
  const normalized = path.normalize(filePath);
  const parts = normalized.split(path.sep).filter(Boolean);
  if (parts.length <= 4) return normalized;
  return `…/${parts.slice(-4).join("/")}`;
}

function shortReportPath(filePath: string): string {
  const normalized = path.normalize(filePath);
  const parts = normalized.split(path.sep).filter(Boolean);
  if (parts.length <= 3) return normalized;
  return `…/${parts.at(-1) ?? path.basename(normalized)}`;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
