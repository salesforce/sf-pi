/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared Code Analyzer data shapes.
 *
 * These mirror the public JSON report shape emitted by
 * `sf code-analyzer run --output-file <file>.json` closely enough for SF Pi
 * to summarize findings without depending on Code Analyzer internals.
 */

export type CodeAnalyzerAction =
  "doctor" | "run" | "rules" | "config" | "apexguru" | "apexguru_setup_help" | "last_report";

export type CodeAnalyzerOutputMode = "summary" | "inline" | "file_only";

export type CodeAnalyzerEngine =
  "cpd" | "eslint" | "flow" | "pmd" | "regex" | "retire-js" | "sfge" | "apexguru";

export interface CodeAnalyzerLocation {
  file?: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  comment?: string;
}

export interface CodeAnalyzerFix {
  location: CodeAnalyzerLocation;
  fixedCode?: string;
}

export interface CodeAnalyzerSuggestion {
  location: CodeAnalyzerLocation;
  message?: string;
}

export interface CodeAnalyzerViolation {
  rule: string;
  engine: CodeAnalyzerEngine | string;
  severity: number;
  tags?: string[];
  primaryLocationIndex: number;
  locations: CodeAnalyzerLocation[];
  message: string;
  resources?: string[];
  fixes?: CodeAnalyzerFix[];
  suggestions?: CodeAnalyzerSuggestion[];
}

export interface CodeAnalyzerRunJson {
  runDir?: string;
  violationCounts?: {
    total?: number;
    sev1?: number;
    sev2?: number;
    sev3?: number;
    sev4?: number;
    sev5?: number;
  };
  versions?: Record<string, string>;
  violations?: CodeAnalyzerViolation[];
}

export interface CodeAnalyzerFactViolation {
  engine: string;
  rule: string;
  severity: number;
  file?: string;
  line?: number;
  column?: number;
  message: string;
}

export interface CodeAnalyzerFactCount {
  label: string;
  count: number;
  engine?: string;
  severity?: number;
}

export interface CodeAnalyzerFacts {
  total: number;
  maxSeverity?: number;
  severity: {
    sev1: number;
    sev2: number;
    sev3: number;
    sev4: number;
    sev5: number;
  };
  topViolations: CodeAnalyzerFactViolation[];
  topRules: CodeAnalyzerFactCount[];
  topFiles: CodeAnalyzerFactCount[];
  fixable: number;
}

export interface CodeAnalyzerRuleJson {
  rules?: Array<{
    name: string;
    description?: string;
    engine: string;
    severity?: number;
    tags?: string[];
    resources?: string[];
  }>;
}

export interface CodeAnalyzerRunRequest {
  workspace?: string[];
  target?: string[];
  rule_selector?: string[];
  config_file?: string;
  severity_threshold?: string;
  include_fixes?: boolean;
  include_suggestions?: boolean;
  no_suppressions?: boolean;
  output_files?: string[];
  timeout_ms?: number;
}

export interface CodeAnalyzerReportSummary {
  kind: "run" | "rules" | "config";
  ok: boolean;
  /** Human-facing execution source, e.g. local CLI or ApexGuru org service. */
  source: "code-analyzer-cli" | "apexguru";
  command: string;
  durationMs: number;
  reportFile?: string;
  outputFiles?: string[];
  workspace?: string[];
  targets?: string[];
  selectors?: string[];
  stdoutPreview?: string;
  stderrPreview?: string;
  exitCode: number;
  run?: CodeAnalyzerRunJson;
  rules?: CodeAnalyzerRuleJson;
}

export interface CodeAnalyzerDoctorReport {
  sf: ProbeResult;
  plugin: ProbeResult & { version?: string };
  java: ProbeResult;
  python: ProbeResult;
  summary: string;
}

export interface ProbeResult {
  ok: boolean;
  detail: string;
}
