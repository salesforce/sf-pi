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
import { buildAutoScanFollowUp } from "./auto-scan-followup.ts";
import { type AutoScanGroup, planAutoScanGroups } from "./auto-scan-plan.ts";
import {
  formatApexGuruBudgetExhaustedTranscript,
  formatApexGuruSkippedTranscript,
  formatApexGuruTranscript,
  formatAutoScanErrorTranscript,
  formatLocalScanTranscript,
} from "./auto-scan-transcript.ts";
import { nextReportPath } from "./artifacts.ts";
import { runCodeAnalyzer } from "./cli.ts";
import { isApexGuruReadyForAutoInsight, readApexGuruReadiness } from "./apexguru-readiness.ts";
import { classifyCodeAnalyzerTarget } from "./file-classify.ts";
import { isCodeAnalyzerReadyForAutoScan, readCodeAnalyzerReadiness } from "./readiness.ts";
import { buildScanRecipeGuidance } from "./recipes.ts";
import { readEffectiveCodeAnalyzerSettings } from "./settings.ts";
import { emitCodeAnalyzerTranscript } from "./transcript.ts";
import type { CodeAnalyzerReportSummary } from "./types.ts";

const AUTO_SCAN_TIMEOUT_MS = 30_000;
const AUTO_APEXGURU_BATCH_TIMEOUT_MS = 60_000;

interface ScanOutcome {
  selector: string;
  targetCount: number;
  summary?: CodeAnalyzerReportSummary;
  error?: string;
  guidanceText?: string;
}

export interface DeferredCodeAnalyzerAutoScanDeps {
  readSettings?: typeof readEffectiveCodeAnalyzerSettings;
  readReadiness?: typeof readCodeAnalyzerReadiness;
  isReadyForAutoScan?: typeof isCodeAnalyzerReadyForAutoScan;
  runCodeAnalyzer?: typeof runCodeAnalyzer;
  readApexGuruReadiness?: typeof readApexGuruReadiness;
  isApexGuruReadyForAutoInsight?: typeof isApexGuruReadyForAutoInsight;
  runApexGuru?: typeof runApexGuru;
  nextReportPath?: typeof nextReportPath;
  buildScanRecipeGuidance?: typeof buildScanRecipeGuidance;
}

export function registerDeferredCodeAnalyzerAutoScan(
  pi: ExtensionAPI,
  exec: ExecFn,
  deps: DeferredCodeAnalyzerAutoScanDeps = {},
): void {
  const readSettings = deps.readSettings ?? readEffectiveCodeAnalyzerSettings;
  const readReadiness = deps.readReadiness ?? readCodeAnalyzerReadiness;
  const isReady = deps.isReadyForAutoScan ?? isCodeAnalyzerReadyForAutoScan;
  const pendingFiles = new Set<string>();
  let running = false;
  let lastViolationSignature: string | undefined;

  pi.on("tool_result", async (event, ctx) => {
    collectChangedFile(event, ctx, pendingFiles);
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (running || pendingFiles.size === 0) return;
    const settings = readSettings(ctx.cwd);
    if (!settings.autoScan) {
      pendingFiles.clear();
      return;
    }

    const readiness = readReadiness();
    if (!isReady(readiness)) {
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
        groups.map((group) => runLocalScanGroup(pi, exec, ctx, group, deps)),
      );

      const apexGuruOutcome = await runApexGuruAutoInsights(
        pi,
        ctx,
        settings.apexGuruAuto,
        plan.apexGuruCandidates,
        deps,
      );
      const violations = [
        ...localOutcomes.flatMap((outcome) => outcome.summary?.run?.violations ?? []),
        ...apexGuruOutcome.violations,
      ];
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

      const followUp = buildAutoScanFollowUp({
        groups: [
          ...localOutcomes.map((outcome) => ({
            selector: outcome.selector,
            targetCount: outcome.targetCount,
            reportFile: outcome.summary?.reportFile,
            violations: outcome.summary?.run?.violations ?? [],
          })),
          ...apexGuruOutcome.groups,
        ],
        broaderValidation: localOutcomes
          .map((outcome) => outcome.guidanceText)
          .filter(Boolean)
          .join("\n"),
      });
      if (followUp) pi.sendUserMessage(followUp, { deliverAs: "followUp" });
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
  deps: DeferredCodeAnalyzerAutoScanDeps,
): Promise<ScanOutcome> {
  const executeCodeAnalyzer = deps.runCodeAnalyzer ?? runCodeAnalyzer;
  const buildGuidance = deps.buildScanRecipeGuidance ?? buildScanRecipeGuidance;
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
    const summary = await executeCodeAnalyzer(exec, ctx, {
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
    const guidance = buildGuidance({
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
    return {
      selector: group.selector,
      targetCount: group.targets.length,
      summary,
      guidanceText: guidance.text,
    };
  } catch (error) {
    const errorMessage = message(error);
    emitCodeAnalyzerTranscript(
      pi,
      formatAutoScanErrorTranscript({
        selector: group.selector,
        targetCount: group.targets.length,
        error: errorMessage,
      }),
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
  deps: DeferredCodeAnalyzerAutoScanDeps,
) {
  const readApexReadiness = deps.readApexGuruReadiness ?? readApexGuruReadiness;
  const isApexReady = deps.isApexGuruReadyForAutoInsight ?? isApexGuruReadyForAutoInsight;
  const executeApexGuru = deps.runApexGuru ?? runApexGuru;
  const reportPath = deps.nextReportPath ?? nextReportPath;
  apexFiles = [...apexFiles].sort();
  if (!enabled || apexFiles.length === 0) return { violations: [], groups: [] };

  if (!isApexReady()) {
    const apexGuruState = readApexReadiness();
    emitCodeAnalyzerTranscript(
      pi,
      formatApexGuruSkippedTranscript({
        access: apexGuruState.access,
        reason: apexGuruState.message,
        targetCount: apexFiles.length,
      }),
      { status: "skipped", targetCount: apexFiles.length },
    );
    return { violations: [], groups: [] };
  }

  const violations = [];
  const groups = [];
  const apexGuruStarted = Date.now();
  for (const file of apexFiles) {
    const remaining = AUTO_APEXGURU_BATCH_TIMEOUT_MS - (Date.now() - apexGuruStarted);
    if (remaining <= 0) {
      emitCodeAnalyzerTranscript(pi, formatApexGuruBudgetExhaustedTranscript(apexFiles.length), {
        status: "timeout",
        targetCount: apexFiles.length,
      });
      break;
    }
    try {
      const apexGuru = await executeApexGuru({
        file,
        cwd: ctx.cwd,
        timeout_ms: remaining,
        reportFile: reportPath(ctx, "run", "json"),
      });
      const apexViolations = apexGuru.run?.violations ?? [];
      violations.push(...apexViolations);
      groups.push({
        selector: "apexguru",
        targetCount: 1,
        reportFile: apexGuru.reportFile,
        violations: apexViolations,
      });
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
  return { violations, groups };
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
