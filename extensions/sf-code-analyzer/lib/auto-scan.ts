/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Deferred post-agent Code Analyzer quality pass.
 *
 * The hook records files changed by successful write/edit tool results and waits
 * until `agent_end` before running Code Analyzer. This lets the model complete a
 * coherent edit pass before quality feedback steers any repair loop.
 */
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { isEditToolResult, isWriteToolResult } from "@earendil-works/pi-coding-agent";
import type { ExecFn } from "../../../lib/common/sf-environment/detect.ts";
import { runApexGuru } from "./apexguru.ts";
import { nextReportPath } from "./artifacts.ts";
import { type AutoScanGroup, planAutoScanGroups } from "./auto-scan-plan.ts";
import { runCodeAnalyzer } from "./cli.ts";
import { renderActionableFindings } from "./display.ts";
import { isApexGuruReadyForAutoInsight, readApexGuruReadiness } from "./apexguru-readiness.ts";
import { classifyCodeAnalyzerTarget } from "./file-classify.ts";
import { isCodeAnalyzerReadyForAutoScan, readCodeAnalyzerReadiness } from "./readiness.ts";
import { buildScanRecipeGuidance } from "./recipes.ts";
import { readEffectiveCodeAnalyzerSettings } from "./settings.ts";
import { emitCodeAnalyzerTranscript } from "./transcript.ts";
import type { CodeAnalyzerReportSummary, CodeAnalyzerRunJson } from "./types.ts";

const AUTO_SCAN_TIMEOUT_MS = 30_000;
const AUTO_APEXGURU_BATCH_TIMEOUT_MS = 60_000;

interface ScanOutcome {
  selector: string;
  targetCount: number;
  summary?: CodeAnalyzerReportSummary;
  error?: string;
}

export function registerDeferredCodeAnalyzerAutoScan(pi: ExtensionAPI, exec: ExecFn): void {
  const pendingFiles = new Set<string>();
  let running = false;
  let lastViolationSignature: string | undefined;

  pi.on("tool_result", async (event, ctx) => {
    collectChangedFile(event, ctx, pendingFiles);
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (running || pendingFiles.size === 0) return;
    const settings = readEffectiveCodeAnalyzerSettings(ctx.cwd);
    if (!settings.autoScan) {
      pendingFiles.clear();
      return;
    }

    const readiness = readCodeAnalyzerReadiness();
    if (!isCodeAnalyzerReadyForAutoScan(readiness)) {
      const count = pendingFiles.size;
      pendingFiles.clear();
      emitCodeAnalyzerTranscript(
        pi,
        `[sf-code-analyzer] deferred scan skipped · ${readiness.status} · ${count} target(s)`,
        { status: "skipped", targetCount: count },
      );
      return;
    }

    running = true;
    const files = [...pendingFiles].sort();
    pendingFiles.clear();
    try {
      const plan = planAutoScanGroups(files);
      if (plan.groups.length === 0) return;

      const groups = plan.groups;
      const localOutcomes = await Promise.all(
        groups.map((group) => runLocalScanGroup(pi, exec, ctx, group)),
      );

      const apexGuruViolations = await runApexGuruAutoInsights(
        pi,
        ctx,
        settings.apexGuruAuto,
        plan.apexGuruCandidates,
      );
      const localViolations = localOutcomes.flatMap(
        (outcome) => outcome.summary?.run?.violations ?? [],
      );
      const violations = [...localViolations, ...apexGuruViolations];
      const signature = violationSignature(violations);
      const reports = localOutcomes
        .map((outcome) => outcome.summary?.reportFile)
        .filter((report): report is string => Boolean(report));

      if (violations.length === 0) {
        lastViolationSignature = undefined;
        return;
      }
      if (signature === lastViolationSignature) {
        emitCodeAnalyzerTranscript(
          pi,
          `[sf-code-analyzer] repair loop stopped · violation signature unchanged · reports: ${reports.join(", ") || "none"}`,
          { status: "stopped", violationCount: violations.length },
        );
        return;
      }
      lastViolationSignature = signature;

      const aggregateRun: CodeAnalyzerRunJson = {
        violationCounts: undefined,
        violations,
      };
      const feedback = renderActionableFindings(aggregateRun);
      if (!feedback) return;
      pi.sendUserMessage(
        [
          "<sf_code_analyzer>",
          "Deferred Code Analyzer scan completed after the edit pass.",
          `Groups: ${groups.map((group) => `${group.selector} (${group.targets.length})`).join(", ")}`,
          `Reports: ${reports.join(", ") || "none"}`,
          "",
          feedback,
          "",
          "Please fix the actionable findings, then run relevant verification.",
          "</sf_code_analyzer>",
        ].join("\n"),
        { deliverAs: "followUp" },
      );
    } catch (error) {
      emitCodeAnalyzerTranscript(pi, `[sf-code-analyzer] deferred scan error · ${message(error)}`, {
        status: "error",
      });
    } finally {
      running = false;
    }
  });

  pi.on("session_shutdown", () => {
    pendingFiles.clear();
    running = false;
    lastViolationSignature = undefined;
  });
}

async function runLocalScanGroup(
  pi: ExtensionAPI,
  exec: ExecFn,
  ctx: ExtensionContext,
  group: AutoScanGroup,
): Promise<ScanOutcome> {
  emitCodeAnalyzerTranscript(
    pi,
    formatLocalScanTranscript("running", {
      selectors: [group.selector],
      targetCount: group.targets.length,
    }),
    { status: "running", targetCount: group.targets.length },
  );
  try {
    const targetPaths = group.targets;
    const summary = await runCodeAnalyzer(exec, ctx, {
      workspace: ["."],
      target: targetPaths,
      rule_selector: [group.selector],
      include_fixes: true,
      include_suggestions: true,
      timeout_ms: AUTO_SCAN_TIMEOUT_MS,
    });
    const count = summary.run?.violations?.length ?? 0;
    emitCodeAnalyzerTranscript(
      pi,
      formatLocalScanTranscript(count === 0 ? "clean" : "findings", {
        selectors: [group.selector],
        targetCount: group.targets.length,
        durationMs: summary.durationMs,
        violationCount: count,
        reportFile: summary.reportFile,
      }),
      {
        status: count === 0 ? "clean" : "findings",
        reportFile: summary.reportFile,
        targetCount: group.targets.length,
        violationCount: count,
        durationMs: summary.durationMs,
      },
    );
    const guidance = buildScanRecipeGuidance({
      selectors: [group.selector],
      targets: targetPaths,
      includeCatalog: false,
    });
    if (guidance.text) {
      emitCodeAnalyzerTranscript(pi, guidance.text, {
        status: "skipped",
        targetCount: group.targets.length,
      });
    }
    return { selector: group.selector, targetCount: group.targets.length, summary };
  } catch (error) {
    const errorMessage = message(error);
    emitCodeAnalyzerTranscript(
      pi,
      `⚠️ 🧪 Code Analyzer auto-scan error\n   Tool: Local Salesforce Code Analyzer CLI\n   Engines: ${group.selector}\n   Targets: ${group.targets.length} changed file${group.targets.length === 1 ? "" : "s"}\n   Error: ${errorMessage}`,
      { status: "error", targetCount: group.targets.length },
    );
    return { selector: group.selector, targetCount: group.targets.length, error: errorMessage };
  }
}

async function runApexGuruAutoInsights(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  enabled: boolean,
  apexFiles: string[],
) {
  apexFiles = [...apexFiles].sort();
  if (!enabled || apexFiles.length === 0) return [];

  if (!isApexGuruReadyForAutoInsight()) {
    const apexGuruState = readApexGuruReadiness();
    emitCodeAnalyzerTranscript(
      pi,
      formatApexGuruSkippedTranscript(
        apexGuruState.access,
        apexGuruState.message,
        apexFiles.length,
      ),
      { status: "skipped", targetCount: apexFiles.length },
    );
    return [];
  }

  const violations = [];
  const apexGuruStarted = Date.now();
  for (const file of apexFiles) {
    const remaining = AUTO_APEXGURU_BATCH_TIMEOUT_MS - (Date.now() - apexGuruStarted);
    if (remaining <= 0) {
      emitCodeAnalyzerTranscript(
        pi,
        `[sf-code-analyzer] ApexGuru auto insight budget exhausted · ${apexFiles.length} candidate(s)`,
        { status: "timeout", targetCount: apexFiles.length },
      );
      break;
    }
    try {
      const apexGuru = await runApexGuru({
        file,
        cwd: ctx.cwd,
        timeout_ms: remaining,
        reportFile: nextReportPath(ctx, "run", "json"),
      });
      const apexViolations = apexGuru.run?.violations ?? [];
      violations.push(...apexViolations);
      emitCodeAnalyzerTranscript(
        pi,
        formatApexGuruTranscript(apexViolations.length ? "findings" : "clean", {
          file,
          durationMs: apexGuru.durationMs,
          violationCount: apexViolations.length,
          reportFile: apexGuru.reportFile,
        }),
        {
          status: apexViolations.length ? "findings" : "clean",
          reportFile: apexGuru.reportFile,
          violationCount: apexViolations.length,
          durationMs: apexGuru.durationMs,
        },
      );
    } catch (error) {
      emitCodeAnalyzerTranscript(
        pi,
        `[sf-code-analyzer] ApexGuru auto insight skipped · ${path.basename(file)} · ${message(error)}`,
        { status: "skipped" },
      );
    }
  }
  return violations;
}

function collectChangedFile(
  event: ToolResultEvent,
  ctx: ExtensionContext,
  pendingFiles: Set<string>,
): void {
  if (event.isError) return;
  if (!isWriteToolResult(event) && !isEditToolResult(event)) return;
  const rawPath = event.input?.path;
  if (typeof rawPath !== "string" || !rawPath.trim()) return;
  const filePath = path.resolve(ctx.cwd, rawPath);
  if (!classifyCodeAnalyzerTarget(filePath)) return;
  pendingFiles.add(filePath);
}

function violationSignature(
  violations: Array<{
    engine: string;
    rule: string;
    severity: number;
    locations: Array<{ file?: string; startLine?: number; startColumn?: number }>;
  }>,
): string {
  return violations
    .map((violation) => {
      const loc = violation.locations[0] ?? {};
      return [
        violation.engine,
        violation.rule,
        violation.severity,
        loc.file,
        loc.startLine,
        loc.startColumn,
      ].join(":");
    })
    .sort()
    .join("|");
}

function formatLocalScanTranscript(
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

function formatApexGuruTranscript(
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

function formatApexGuruSkippedTranscript(
  access: string,
  reason: string,
  targetCount: number,
): string {
  return [
    "⚪ ✨ ApexGuru auto insight skipped",
    "   Tool: ApexGuru Insights org service",
    `   Reason: ${access.replace(/_/g, " ")} · ${reason}`,
    `   Targets: ${targetCount} changed production Apex file${targetCount === 1 ? "" : "s"}`,
    "   Setup help: I can use SF Browser to check Scale Center / ApexGuru Insights and help enable ApexGuru if Salesforce exposes the setup option, after your approval.",
  ].join("\n");
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
