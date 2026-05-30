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
  },
): string {
  const title =
    status === "running"
      ? "🔄 🧪 Code Analyzer auto-scan running"
      : status === "clean"
        ? "✅ 🧪 Code Analyzer auto-scan clean"
        : `⚠️ 🧪 Code Analyzer auto-scan found ${input.violationCount ?? 0} finding(s)`;
  return [
    title,
    "   Tool: Local Salesforce Code Analyzer CLI",
    `   Engines: ${input.selectors.join(", ")}`,
    `   Targets: ${input.targetCount} changed file${input.targetCount === 1 ? "" : "s"}`,
    input.durationMs !== undefined ? `   Duration: ${formatMs(input.durationMs)}` : undefined,
    input.reportFile ? `   Report: ${input.reportFile}` : undefined,
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
    input.reportFile ? `   Report: ${input.reportFile}` : undefined,
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

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
