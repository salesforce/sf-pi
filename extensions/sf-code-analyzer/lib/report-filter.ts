/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only report artifact filtering for code_analyzer last_report. */
import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  CodeAnalyzerReportSummary,
  CodeAnalyzerRunJson,
  CodeAnalyzerViolation,
} from "./types.ts";

export interface CodeAnalyzerReportFilters {
  engine?: string;
  severity_threshold?: string;
  rule?: string;
  file?: string;
}

export function summaryFromReportFile(reportFile: string): CodeAnalyzerReportSummary {
  const parsed = JSON.parse(readFileSync(reportFile, "utf8")) as CodeAnalyzerRunJson;
  return {
    kind: "run",
    ok: true,
    source: parsed.versions?.apexguru === "org-service" ? "apexguru" : "code-analyzer-cli",
    command: `report ${reportFile}`,
    durationMs: 0,
    reportFile,
    outputFiles: [reportFile],
    exitCode: 0,
    run: parsed,
  };
}

export function applyReportFilters(
  summary: CodeAnalyzerReportSummary,
  filters: CodeAnalyzerReportFilters,
): CodeAnalyzerReportSummary {
  if (!summary.run?.violations?.length) return summary;
  const threshold = parseSeverityThreshold(filters.severity_threshold);
  const engine = filters.engine?.toLowerCase();
  const rule = filters.rule?.toLowerCase();
  const file = filters.file ? path.normalize(filters.file).toLowerCase() : undefined;
  const violations = summary.run.violations.filter((violation) => {
    if (engine && violation.engine.toLowerCase() !== engine) return false;
    if (rule && violation.rule.toLowerCase() !== rule) return false;
    if (threshold !== undefined && violation.severity > threshold) return false;
    if (file && !violationTouchesFile(violation, file)) return false;
    return true;
  });
  return {
    ...summary,
    run: {
      ...summary.run,
      violationCounts: buildViolationCounts(violations),
      violations,
    },
  };
}

export function parseSeverityThreshold(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "1":
    case "critical":
      return 1;
    case "2":
    case "high":
      return 2;
    case "3":
    case "moderate":
      return 3;
    case "4":
    case "low":
      return 4;
    case "5":
    case "info":
      return 5;
    default:
      return undefined;
  }
}

function violationTouchesFile(violation: CodeAnalyzerViolation, file: string): boolean {
  return violation.locations.some((location) => {
    if (!location.file) return false;
    const normalized = path.normalize(location.file).toLowerCase();
    return normalized === file || normalized.endsWith(file);
  });
}

function buildViolationCounts(
  violations: CodeAnalyzerViolation[],
): NonNullable<CodeAnalyzerRunJson["violationCounts"]> {
  const counts = { total: violations.length, sev1: 0, sev2: 0, sev3: 0, sev4: 0, sev5: 0 };
  for (const violation of violations) {
    const key = `sev${violation.severity}` as keyof typeof counts;
    if (key in counts) counts[key] += 1;
  }
  return counts;
}
