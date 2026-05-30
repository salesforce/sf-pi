/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Thin Salesforce CLI contract for Code Analyzer.
 *
 * SF Pi intentionally shells out to the supported `sf code-analyzer` commands
 * and parses output files. This keeps Code Analyzer engine packages out of the
 * Pi runtime and mirrors the VS Code extension's integration boundary.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ExecFn } from "../../../lib/common/sf-environment/detect.ts";
import { nextReportPath } from "./artifacts.ts";
import type {
  CodeAnalyzerDoctorReport,
  CodeAnalyzerReportSummary,
  CodeAnalyzerRunJson,
  CodeAnalyzerRunRequest,
  CodeAnalyzerRuleJson,
  ProbeResult,
} from "./types.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_RUN_TIMEOUT_MS = 120_000;
const DEFAULT_DOCTOR_TIMEOUT_MS = 15_000;
const PREVIEW_LIMIT = 4_000;

export async function runCodeAnalyzerDoctor(exec: ExecFn): Promise<CodeAnalyzerDoctorReport> {
  const [sf, plugin, java, python] = await Promise.all([
    probeCommand(exec, "sf", ["--version"]),
    probePlugin(exec),
    probeCommand(exec, "java", ["-version"]),
    probePython(exec),
  ]);
  const blockers = [sf, plugin].filter((p) => !p.ok).length;
  const optional = [java, python].filter((p) => !p.ok).length;
  const summary = blockers
    ? "Code Analyzer setup is blocked. Install Salesforce CLI and the code-analyzer plugin."
    : optional
      ? "Code Analyzer is installed; some engine prerequisites are missing."
      : "Code Analyzer is ready.";
  return { sf, plugin, java, python, summary };
}

async function probePlugin(exec: ExecFn): Promise<ProbeResult & { version?: string }> {
  const result = await exec("sf", ["plugins", "inspect", "code-analyzer", "--json"], {
    timeout: DEFAULT_DOCTOR_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    return {
      ok: false,
      detail: trimPreview(result.stderr || result.stdout || "code-analyzer plugin not found"),
    };
  }
  try {
    const parsed = JSON.parse(result.stdout) as Array<{ version?: string }>;
    const version = Array.isArray(parsed) ? parsed[0]?.version : undefined;
    return {
      ok: Boolean(version),
      version,
      detail: version ? `code-analyzer ${version}` : result.stdout,
    };
  } catch {
    return { ok: true, detail: trimPreview(result.stdout) };
  }
}

async function probePython(exec: ExecFn): Promise<ProbeResult> {
  const python3 = await probeCommand(exec, "python3", ["--version"]);
  if (python3.ok) return python3;
  return probeCommand(exec, "python", ["--version"]);
}

async function probeCommand(exec: ExecFn, command: string, args: string[]): Promise<ProbeResult> {
  const result = await exec(command, args, { timeout: DEFAULT_DOCTOR_TIMEOUT_MS });
  const output = trimPreview(result.stdout || result.stderr);
  return {
    ok: result.code === 0,
    detail: output || (result.code === 0 ? `${command} available` : `${command} unavailable`),
  };
}

export async function runCodeAnalyzer(
  exec: ExecFn,
  ctx: ExtensionContext,
  request: CodeAnalyzerRunRequest,
): Promise<CodeAnalyzerReportSummary> {
  const started = Date.now();
  const reportFile = nextReportPath(ctx, "run", "json");
  const outputFiles = unique([reportFile, ...(request.output_files ?? [])]);
  const workspace = request.workspace ?? ["."];
  const targets = request.target ?? [];
  const selectors = splitSelectors(request.rule_selector ?? ["Recommended"]);
  const args = ["code-analyzer", "run"];
  appendRepeated(args, "--workspace", workspace);
  appendRepeated(args, "--target", targets);
  appendRepeated(args, "--rule-selector", selectors);
  if (request.config_file) args.push("--config-file", request.config_file);
  if (request.severity_threshold) args.push("--severity-threshold", request.severity_threshold);
  if (request.include_fixes) args.push("--include-fixes");
  if (request.include_suggestions) args.push("--include-suggestions");
  if (request.no_suppressions) args.push("--no-suppressions");
  appendRepeated(args, "--output-file", outputFiles);

  const result = await exec("sf", args, {
    timeout: request.timeout_ms ?? DEFAULT_RUN_TIMEOUT_MS,
    cwd: ctx.cwd,
  });
  const run = parseJsonFile<CodeAnalyzerRunJson>(reportFile);
  const ok = result.code === 0 || Boolean(run);
  return {
    kind: "run",
    ok,
    source: "code-analyzer-cli",
    command: formatCommand("sf", args),
    durationMs: Date.now() - started,
    reportFile,
    outputFiles,
    workspace,
    targets,
    selectors,
    stdoutPreview: trimPreview(result.stdout),
    stderrPreview: trimPreview(result.stderr),
    exitCode: result.code,
    run,
  };
}

export async function runCodeAnalyzerRules(
  exec: ExecFn,
  ctx: ExtensionContext,
  request: Pick<
    CodeAnalyzerRunRequest,
    "workspace" | "target" | "rule_selector" | "config_file" | "output_files" | "timeout_ms"
  >,
): Promise<CodeAnalyzerReportSummary> {
  const started = Date.now();
  const reportFile = nextReportPath(ctx, "rules", "json");
  const outputFiles = unique([reportFile, ...(request.output_files ?? [])]);
  const selectors = splitSelectors(request.rule_selector ?? ["Recommended"]);
  const args = ["code-analyzer", "rules"];
  appendRepeated(args, "--workspace", request.workspace);
  appendRepeated(args, "--target", request.target);
  appendRepeated(args, "--rule-selector", selectors);
  if (request.config_file) args.push("--config-file", request.config_file);
  appendRepeated(args, "--output-file", outputFiles);
  const result = await exec("sf", args, {
    timeout: request.timeout_ms ?? DEFAULT_RUN_TIMEOUT_MS,
    cwd: ctx.cwd,
  });
  const rules = parseJsonFile<CodeAnalyzerRuleJson>(reportFile);
  return {
    kind: "rules",
    ok: result.code === 0 || Boolean(rules),
    source: "code-analyzer-cli",
    command: formatCommand("sf", args),
    durationMs: Date.now() - started,
    reportFile,
    outputFiles,
    workspace: request.workspace,
    targets: request.target,
    selectors,
    stdoutPreview: trimPreview(result.stdout),
    stderrPreview: trimPreview(result.stderr),
    exitCode: result.code,
    rules,
  };
}

export async function runCodeAnalyzerConfig(
  exec: ExecFn,
  ctx: ExtensionContext,
  request: Pick<
    CodeAnalyzerRunRequest,
    | "workspace"
    | "target"
    | "rule_selector"
    | "config_file"
    | "output_files"
    | "timeout_ms"
    | "no_suppressions"
  > & {
    include_unmodified_rules?: boolean;
  },
): Promise<CodeAnalyzerReportSummary> {
  const started = Date.now();
  const reportFile = request.output_files?.[0] ?? nextReportPath(ctx, "config", "yml");
  const selectors = splitSelectors(request.rule_selector ?? ["all"]);
  const args = ["code-analyzer", "config"];
  appendRepeated(args, "--workspace", request.workspace);
  appendRepeated(args, "--target", request.target);
  appendRepeated(args, "--rule-selector", selectors);
  if (request.config_file) args.push("--config-file", request.config_file);
  if (request.include_unmodified_rules) args.push("--include-unmodified-rules");
  if (request.no_suppressions) args.push("--no-suppressions");
  args.push("--output-file", reportFile);
  const result = await exec("sf", args, {
    timeout: request.timeout_ms ?? DEFAULT_RUN_TIMEOUT_MS,
    cwd: ctx.cwd,
  });
  return {
    kind: "config",
    ok: result.code === 0 && existsSync(reportFile),
    source: "code-analyzer-cli",
    command: formatCommand("sf", args),
    durationMs: Date.now() - started,
    reportFile,
    outputFiles: [reportFile],
    workspace: request.workspace,
    targets: request.target,
    selectors,
    stdoutPreview: trimPreview(result.stdout),
    stderrPreview: trimPreview(result.stderr),
    exitCode: result.code,
  };
}

function appendRepeated(args: string[], flag: string, values: string[] | undefined): void {
  for (const value of values ?? []) {
    if (!value) continue;
    args.push(flag, value);
  }
}

export function splitSelectors(values: string[]): string[] {
  return values.flatMap((value) => value.replace(/\s+/g, " ").trim().split(" ")).filter(Boolean);
}

function parseJsonFile<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => path.normalize(v)))];
}

export function trimPreview(value: string | undefined, limit = PREVIEW_LIMIT): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}\n… truncated ${trimmed.length - limit} chars`;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args.map((arg) => (/[\s()]/.test(arg) ? JSON.stringify(arg) : arg))].join(
    " ",
  );
}
